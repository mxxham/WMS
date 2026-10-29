-- =====================================================================
-- 0115  Bin To Bin destination: a rack count instead of a blind audit
--
-- 0088 audits what arrived at the destination bin blind: scan the SKU, type
-- the batch, count the cartons. The checker walking a rack asked on 28 Oct
-- 2026 for the same check as every other bin on the rack: see what the
-- system holds in the bin, confirm it (Sesuai) or count it (Salah).
--
-- record_move_rack_audit does that for one REPLENISH line, the way
-- record_rack_audit (0025 / 0032) does it for picks: the checker counts every
-- carton of the SKU in the destination bin; the difference from the stock
-- the database holds now is put on this line (arrived = moved + difference).
-- It writes an ordinary pick_audits attempt (method RACK), so the line state
-- of pick_audit_move, the Excel and the history work unchanged.
-- =====================================================================

create or replace function public.record_move_rack_audit(
  p_task_id uuid, p_checker_name text, p_counted numeric, p_note text default null,
  p_found_sku text default null, p_correct boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  t record; v_prev public.pick_audits%rowtype; v_system numeric; v_diff numeric; v_counted numeric;
  v_found text; v_errors text[]; v_result text; v_attempt int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  perform public.pick_audit_correction_check(p_correct, p_note);
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;

  select pt.id, pt.task_type, pt.status, pt.picked_by_name, pt.item_id, pt.to_bin_id, it.sku,
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

  v_found := public.rack_found_sku(p_found_sku, t.sku, p_note);
  select coalesce(sum(quantity), 0) into v_system from public.inventory where bin_id = t.to_bin_id and item_id = t.item_id;
  v_diff := p_counted - v_system;
  if v_diff <> 0 and nullif(trim(p_note), '') is null then
    raise exception 'Catatan wajib diisi bila isi bin tujuan tidak sesuai';
  end if;
  v_counted := greatest(t.qty + v_diff, 0);
  v_errors := public.pick_audit_errors(t.sku, t.batch, t.expiry, t.qty, coalesce(v_found, t.sku), t.batch, null, v_counted, false);
  v_result := case when v_errors = '{}' then 'OK' else 'MISMATCH' end;
  v_attempt := coalesce(v_prev.attempt_no, 0) + 1;

  insert into public.pick_audits (task_id, attempt_no, checker_name, found_sku, found_scanned_code, found_batch, found_expiry,
    counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note,
    method, rack_system, rack_counted, correction, created_by)
  values (p_task_id, v_attempt, v_checker, coalesce(v_found, t.sku),
    case when v_found is not null and regexp_replace(p_found_sku, '\s', '', 'g') <> v_found then regexp_replace(p_found_sku, '\s', '', 'g') end,
    public.norm_batch(t.batch), null,
    v_counted, false, t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''),
    'RACK', v_system, p_counted, coalesce(p_correct, false), auth.uid());

  return jsonb_build_object('result', v_result, 'attempt', v_attempt, 'system', v_system, 'counted', p_counted,
    'diff', v_diff, 'found_sku', v_found);
end $$;

revoke execute on function public.record_move_rack_audit(uuid, text, numeric, text, text, boolean) from public, anon;
grant execute on function public.record_move_rack_audit(uuid, text, numeric, text, text, boolean) to authenticated;
