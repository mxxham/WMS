-- =====================================================================
-- 0088  Move (REPLENISH) audit: bin-to-bin moves become auditable
--
-- Extends the picking audit (0024) to REPLENISH tasks. A REPLENISH task
-- moves stock from a reserve bin to a pickface bin (from_bin_id -> to_bin_id).
-- It posts through the same post_task path (movement type = 'transfer'), so
-- stock has already moved when the task is COMPLETED. The audit checks what
-- actually arrived at the pickface bin.
--
-- The pick audit remains PICK-only. This adds a parallel view and RPC for
-- moves, mirroring the same blind-attempt flow, error rule, and line-state
-- machine. No shipment_loads gate: moves have no shipment and stay auditable
-- after loading.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. View: one row per completed REPLENISH task with latest attempt
-- ---------------------------------------------------------------------
create or replace view public.pick_audit_move with (security_invoker = true) as
with latest as (
  select distinct on (task_id) * from public.pick_audits order by task_id, attempt_no desc
), n as (
  select task_id, count(*)::int as attempts from public.pick_audits group by task_id
)
select t.id as task_id, t.wave_id, w.wave_no, w.planned_date, w.status as wave_status, t.seq,
       it.sku, it.description, it.uom,
       coalesce(ab.bin_code, fb.bin_code) as from_bin, coalesce(ab.zone, fb.zone) as zone,
       tb.bin_code as to_bin, tb.zone as to_zone,
       coalesce(t.actual_batch_lot, t.batch_lot) as batch_lot, coalesce(t.actual_expiry_date, t.expiry_date) as expiry_date,
       t.quantity as planned_qty, coalesce(t.actual_quantity, t.quantity) as moved_qty, t.deviation_reason,
       t.completed_at, t.picked_by_name, t.bulk_posted, t.scanned_code,
       l.id as audit_id, l.attempt_no, l.result, l.errors, l.resolution, l.checker_name, l.created_at as audited_at,
       coalesce(n.attempts, 0) as attempts,
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when l.id is null then 'TODO'
            when l.result = 'OK' then 'OK'
            when l.resolution is not null then 'RESOLVED'
            else 'MISMATCH' end as line_state
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
join public.bins tb on tb.id = t.to_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
where t.task_type = 'REPLENISH' and t.status = 'COMPLETED';

-- ---------------------------------------------------------------------
-- 2. RPC: record_move_audit — blind attempt for a REPLENISH task
-- ---------------------------------------------------------------------
create or replace function public.record_move_audit(
  p_task_id uuid, p_checker_name text, p_found text, p_counted numeric,
  p_batch text, p_expiry date, p_damaged boolean, p_note text,
  p_correct boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  t record; v_prev public.pick_audits%rowtype; v_found_sku text; v_code text;
  v_errors text[]; v_result text; v_attempt int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  perform public.pick_audit_correction_check(p_correct, p_note);

  select pt.id, pt.wave_id, pt.task_type, pt.status, pt.picked_by_name, it.sku,
         coalesce(pt.actual_quantity, pt.quantity) as qty,
         coalesce(pt.actual_batch_lot, pt.batch_lot) as batch,
         coalesce(pt.actual_expiry_date, pt.expiry_date) as expiry, w.status as wave_status
    into t
  from public.pick_tasks pt
  join public.items it on it.id = pt.item_id
  join public.waves w on w.id = pt.wave_id
  where pt.id = p_task_id
  for update of pt;

  if not found or t.task_type <> 'REPLENISH' or t.status <> 'COMPLETED' then
    raise exception 'Tugas pindahan belum selesai atau tidak ditemukan';
  end if;
  if t.wave_status = 'CANCELLED' then raise exception 'Wave dibatalkan: baris ini tidak diaudit'; end if;
  if t.qty = 0 then raise exception 'Baris ini tidak dipindah (0): tidak perlu diaudit'; end if;
  if public.same_person(v_checker, t.picked_by_name) then
    raise exception 'Checker tidak boleh petugas pindah baris ini (%)', t.picked_by_name;
  end if;

  select * into v_prev from public.pick_audits where task_id = p_task_id order by attempt_no desc limit 1;
  if v_prev.resolution is not null then raise exception 'Baris ini sudah diterima supervisor: tidak bisa diubah'; end if;
  if v_prev.id is not null and v_prev.result = 'OK' and not coalesce(p_correct, false) then
    raise exception 'Baris ini sudah lolos audit';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;
  if nullif(trim(p_found), '') is null then raise exception 'Scan karton atau ketik SKU yang ada di palet'; end if;

  select sku into v_found_sku from public.item_by_barcode(p_found) limit 1;
  if v_found_sku is null then raise exception 'Barcode / SKU % tidak dikenal di master item', trim(p_found); end if;
  v_code := regexp_replace(p_found, '\s', '', 'g');
  if v_code = v_found_sku then v_code := null; end if;

  v_errors := public.pick_audit_errors(t.sku, t.batch, t.expiry, t.qty,
                                       v_found_sku, p_batch, p_expiry, p_counted, coalesce(p_damaged, false));
  v_result := case when v_errors = '{}' then 'OK' else 'MISMATCH' end;
  v_attempt := coalesce(v_prev.attempt_no, 0) + 1;

  insert into public.pick_audits (task_id, attempt_no, checker_name, found_sku, found_scanned_code, found_batch, found_expiry,
    counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note, correction, created_by)
  values (p_task_id, v_attempt, v_checker, v_found_sku, v_code, public.norm_batch(p_batch), p_expiry,
    p_counted, coalesce(p_damaged, false), t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''),
    coalesce(p_correct, false), auth.uid());

  -- The expected values leave the database only here, after the count is saved.
  return jsonb_build_object('result', v_result, 'errors', to_jsonb(v_errors), 'attempt', v_attempt,
    'expected', jsonb_build_object('sku', t.sku, 'batch', t.batch, 'expiry', t.expiry, 'qty', t.qty),
    'found', jsonb_build_object('sku', v_found_sku, 'code', v_code, 'batch', public.norm_batch(p_batch),
                                'expiry', p_expiry, 'qty', p_counted, 'damaged', coalesce(p_damaged, false)));
end $$;

-- ---------------------------------------------------------------------
-- 3. Harden resolve_pick_mismatch: reject non-PICK tasks (moves are not
--    supervisor-resolvable; fix on floor and re-audit, or supervisor Ubah)
-- ---------------------------------------------------------------------
create or replace function public.resolve_pick_mismatch(
  p_audit_id uuid, p_action text, p_by_name text, p_note text, p_bin text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; a public.pick_audits%rowtype; t record; v_latest int; v_src uuid; v_src_code text;
  v_diff numeric; v_bin uuid; v_rows int; r public.inventory%rowtype; v_free numeric; v_count uuid; v_note text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menerima selisih';
  end if;
  v_name := public.person_name(p_by_name, 'Nama supervisor');
  if p_action not in ('ACCEPT_SHORT', 'ACCEPT_BATCH') then raise exception 'Tindakan tidak dikenal: %', p_action; end if;
  v_note := nullif(trim(p_note), '');
  if v_note is null then raise exception 'Alasan wajib diisi'; end if;

  select * into a from public.pick_audits where id = p_audit_id;
  if a.id is null then raise exception 'Audit tidak ditemukan'; end if;
  select pt.id, pt.wave_id, pt.shipment_number, pt.item_id, pt.picked_by_name, pt.task_type,
         coalesce(pt.actual_from_bin_id, pt.from_bin_id) as src
    into t
  from public.pick_tasks pt where pt.id = a.task_id for update;
  -- Guard: only PICK tasks may be resolved here. REPLENISH (move) audits are
  -- fixed by re-audit or supervisor correction (Ubah), never by ACCEPT_SHORT/BATCH.
  if t.task_type <> 'PICK' then
    raise exception 'Baris ini pindahan bin: tidak bisa diputuskan di sini';
  end if;
  if exists (select 1 from public.shipment_loads where wave_id = t.wave_id and shipment_number = t.shipment_number) then
    raise exception 'Shipment % sudah dimuat', t.shipment_number;
  end if;
  select max(attempt_no) into v_latest from public.pick_audits where task_id = a.task_id;
  if a.attempt_no <> v_latest then raise exception 'Hanya audit terakhir baris ini yang bisa diputuskan'; end if;
  if a.result <> 'MISMATCH' or a.resolution is not null then raise exception 'Audit ini tidak perlu diputuskan'; end if;
  if public.same_person(v_name, t.picked_by_name) or public.same_person(v_name, a.checker_name) then
    raise exception 'Yang memutuskan harus orang lain dari picker dan checker';
  end if;
  v_src := t.src;
  select bin_code into v_src_code from public.bins where id = v_src;

  perform set_config('app.by_name', v_name, true);
  perform set_config('app.adjust_reason', 'PICK_AUDIT', true);
  perform set_config('app.adjust_approved', 'on', true);

  if p_action = 'ACCEPT_SHORT' then
    if a.errors <> array['SHORT'] then
      raise exception 'Terima kurang hanya untuk selisih kurang saja (SKU, batch dan kondisi sesuai)';
    end if;
    v_diff := a.expected_qty - a.counted_qty;
    insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, ref_id)
    values ('adjustment', t.item_id, a.expected_batch, v_diff, v_src, a.expected_expiry, 'PICK_AUDIT',
            format('Audit picking SH %s: kurang %s karton, dicatat kembali di bin. %s', t.shipment_number, v_diff, v_note), a.id);
    update public.pick_tasks set actual_quantity = a.counted_qty where id = t.id;
    update public.outbound set quantity_picked = greatest(quantity_picked - v_diff, 0)
    where wave_id = t.wave_id and shipment_number = t.shipment_number and item_id = t.item_id;
  else
    if a.errors = '{}' or not (a.errors <@ array['WRONG_BATCH', 'WRONG_EXPIRY']) or a.counted_qty <> a.expected_qty then
      raise exception 'Terima batch hanya untuk batch / expired yang beda dengan jumlah sesuai';
    end if;
    select id into v_bin from public.bins where bin_code = upper(trim(coalesce(p_bin, '')));
    if v_bin is null then raise exception 'Isi bin asal batch % yang ada di palet', a.found_batch; end if;
    select count(*) into v_rows from public.inventory
    where bin_id = v_bin and item_id = t.item_id and public.norm_batch(batch_lot) = a.found_batch
      and (a.found_expiry is null or expiry_date = a.found_expiry);
    if v_rows > 1 then
      raise exception 'Batch % ada dengan beberapa tanggal expired di bin %: audit ulang dengan tanggal expired', a.found_batch, upper(p_bin);
    end if;
    select * into r from public.inventory
    where bin_id = v_bin and item_id = t.item_id and public.norm_batch(batch_lot) = a.found_batch
      and (a.found_expiry is null or expiry_date = a.found_expiry)
    for update;
    v_free := coalesce(r.quantity, 0);
    if r.id is not null then
      v_free := v_free - public.held_qty(r.bin_id, r.item_id, r.batch_lot, r.expiry_date, r.quantity)
                - coalesce((select sum(o.quantity) from public.open_pick_tasks o
                            where o.from_bin_id = r.bin_id and o.item_id = r.item_id and o.batch_lot = r.batch_lot
                              and o.expiry_date = r.expiry_date), 0);
    end if;
    if v_free < a.counted_qty then
      raise exception 'Stok batch % di bin % tidak cukup (bebas %): adjust atau hitung dulu', a.found_batch, upper(trim(p_bin)), v_free;
    end if;
    insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, ref_id)
    values ('adjustment', t.item_id, a.expected_batch, a.expected_qty, v_src, a.expected_expiry, 'PICK_AUDIT',
            format('Audit picking SH %s: batch %s tidak terkirim, dicatat kembali. %s', t.shipment_number, a.expected_batch, v_note), a.id),
           ('adjustment', t.item_id, r.batch_lot, -a.counted_qty, v_bin, r.expiry_date, 'PICK_AUDIT',
            format('Audit picking SH %s: batch %s terkirim. %s', t.shipment_number, r.batch_lot, v_note), a.id);
    update public.pick_tasks set actual_batch_lot = r.batch_lot, actual_expiry_date = r.expiry_date, actual_from_bin_id = v_bin
    where id = t.id;
  end if;

  v_count := public.create_count_task(v_src_code, format('Audit picking SH %s: %s', t.shipment_number,
    case p_action when 'ACCEPT_SHORT' then 'terima kurang' else 'terima batch lain' end), 'PICK_AUDIT');

  update public.pick_audits set resolution = p_action, resolved_by_name = v_name, resolved_at = now(), resolution_note = v_note
  where id = a.id;

  perform set_config('app.adjust_approved', '', true);
  perform set_config('app.adjust_reason', '', true);
  return jsonb_build_object('result', 'RESOLVED', 'action', p_action, 'count_task', v_count);
end $$;

-- ---------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------
grant select on public.pick_audit_move to authenticated;

revoke execute on function public.record_move_audit(uuid, text, text, numeric, text, date, boolean, text, boolean) from public, anon;
grant execute on function public.record_move_audit(uuid, text, text, numeric, text, date, boolean, text, boolean) to authenticated;

revoke execute on function public.resolve_pick_mismatch(uuid, text, text, text, text) from public, anon;
grant execute on function public.resolve_pick_mismatch(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Realtime (if publication exists)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pick_audits') then
    execute format('alter publication supabase_realtime add table public.pick_audits');
  end if;
end $$;