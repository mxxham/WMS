-- =====================================================================
-- 0024  Picking audit: every picked line is checked blind by someone
--       other than the picker, before the shipment is loaded
--
--  pick_tasks      + picked_by_name / scanned_code / bulk_posted, stamped
--                    when a task completes from what post_task_by and
--                    complete_wave_by set for their transaction.
--  pick_audits     one row per attempt. The checker records what is on the
--                  pallet (carton scan or SKU, batch, expiry, count, damage)
--                  without seeing the picker's numbers; the database derives
--                  the errors. A line passes when its latest attempt is OK or
--                  a supervisor accepted it (short / other batch).
--  shipment_loads  a shipment is loaded only when every picked line passed;
--                  after that nothing on it is audited or resolved again.
--  Picked stock has already left the system (PICK has no to_bin), so a
--  mismatch fixed on the floor needs no stock change; only the two
--  acceptances post PICK_AUDIT adjustments.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Vocabulary: reason code, count source, policy target
-- ---------------------------------------------------------------------
alter table public.movements drop constraint movements_reason_code_check;
alter table public.movements add constraint movements_reason_code_check check (reason_code in (
  'COUNT_VARIANCE', 'DAMAGED', 'EXPIRED', 'DATA_ENTRY', 'MISPICK', 'FOUND', 'LOST',
  'RECEIVING_DIFF', 'RETURN', 'OPENING', 'OTHER', 'PICK_AUDIT'));
alter table public.count_tasks drop constraint count_tasks_source_check;
alter table public.count_tasks add constraint count_tasks_source_check
  check (source in ('MANUAL', 'PUTAWAY', 'DATA_QUALITY', 'CYCLE', 'RECON', 'RECEIPT', 'PICK_AUDIT'));

create or replace function public.inventory_policy_defaults()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'default_shelf_life_months', 48,   -- Shell packaged lubricants: production + 4 years
    'min_dispatch_days', 0,            -- refuse to ship stock with fewer days left
    'near_expiry_days', 180,           -- "ship first / report to Shell" window
    'adjust_approval_qty', 20,         -- |adjustment| above this (cartons) needs a second person
    'count_tolerance_qty', jsonb_build_object('A', 0, 'B', 0, 'C', 0),  -- per bin, cartons
    'recount_on_variance', true,       -- a count off by more than the tolerance is recounted blind
    'ira_target_pct', 98,
    'require_scan_on_pick', false,     -- pick confirmation needs the carton barcode
    'pick_accuracy_target_pct', 99.5   -- first-attempt line accuracy of the picking audit
  );
$$;

create or replace function public.set_inventory_policy(p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; merged jsonb;
begin
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Hanya admin yang bisa mengubah aturan inventory';
  end if;
  if jsonb_typeof(p_value) <> 'object' then raise exception 'Format aturan tidak valid'; end if;
  for k, v in select * from jsonb_each(p_value) loop
    if not public.inventory_policy_defaults() ? k then raise exception 'Aturan % tidak dikenal', k; end if;
    if k in ('recount_on_variance', 'require_scan_on_pick') then
      if jsonb_typeof(v) <> 'boolean' then raise exception '% harus ya/tidak', k; end if;
    elsif k = 'count_tolerance_qty' then
      if jsonb_typeof(v) <> 'object' or not (v ?& array['A', 'B', 'C']) then raise exception 'Toleransi hitung butuh nilai A, B dan C'; end if;
      if exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'number' or (e.value)::numeric < 0) then
        raise exception 'Toleransi hitung harus angka ≥ 0';
      end if;
    elsif jsonb_typeof(v) <> 'number' or (v)::numeric < 0 then
      raise exception '% harus angka ≥ 0', k;
    end if;
  end loop;
  if (p_value ? 'default_shelf_life_months') and ((p_value->>'default_shelf_life_months')::numeric not between 1 and 240) then
    raise exception 'Umur simpan 1–240 bulan';
  end if;
  if (p_value ? 'ira_target_pct') and ((p_value->>'ira_target_pct')::numeric > 100) then
    raise exception 'Target akurasi maksimal 100%%';
  end if;
  if (p_value ? 'pick_accuracy_target_pct') and ((p_value->>'pick_accuracy_target_pct')::numeric > 100) then
    raise exception 'Target akurasi picking maksimal 100%%';
  end if;
  merged := public.inventory_policy() || p_value;
  insert into public.settings (key, value, updated_at) values ('inventory_policy', merged, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return merged;
end $$;

-- ---------------------------------------------------------------------
-- 2. Who picked, what was scanned, bulk-posted
-- ---------------------------------------------------------------------
alter table public.pick_tasks
  add column picked_by_name text,
  add column scanned_code   text,
  add column bulk_posted    boolean not null default false;

-- Earlier picks: the name typed on the floor went to the movement (0023).
update public.pick_tasks t set picked_by_name = m.by_name
from public.movements m
where m.task_id = t.id and t.status = 'COMPLETED' and nullif(trim(m.by_name), '') is not null;

create or replace function public.stamp_pick_confirmation()
returns trigger language plpgsql as $$
begin
  if new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED' then
    new.picked_by_name := coalesce(nullif(trim(new.picked_by_name), ''), nullif(current_setting('app.by_name', true), ''));
    new.scanned_code := coalesce(new.scanned_code, nullif(current_setting('app.pick_scanned', true), ''));
    new.bulk_posted := new.bulk_posted or coalesce(current_setting('app.pick_bulk', true), '') = 'on';
  end if;
  return new;
end $$;
create trigger pick_tasks_stamp_confirmation before update on public.pick_tasks
  for each row execute function public.stamp_pick_confirmation();
revoke execute on function public.stamp_pick_confirmation() from public, anon, authenticated;

-- post_task_by (0023) + the scanned code for the stamp. Settings are reset
-- so a later post in the same transaction does not inherit them.
create or replace function public.post_task_by(
  p_task_id uuid, p_actual_qty numeric default null, p_from_bin text default null, p_batch_lot text default null,
  p_expiry date default null, p_reason text default null, p_by_name text default null, p_scanned text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name, 'Nama picker'); t record; v_scan_sku text; v_res jsonb;
begin
  select pt.task_type, it.sku, it.ean into t
  from public.pick_tasks pt join public.items it on it.id = pt.item_id where pt.id = p_task_id;
  if t.sku is null then raise exception 'Tugas tidak ada'; end if;
  if nullif(trim(p_scanned), '') is not null then
    select sku into v_scan_sku from public.item_by_barcode(p_scanned) limit 1;
    if v_scan_sku is null then raise exception 'Barcode % tidak dikenal di master item', trim(p_scanned); end if;
    if v_scan_sku <> t.sku then raise exception 'Barang salah: yang di-scan SKU %, tugas ini SKU %', v_scan_sku, t.sku; end if;
  elsif t.task_type = 'PICK' and t.ean is not null and (public.inventory_policy()->>'require_scan_on_pick')::boolean then
    raise exception 'Scan barcode karton SKU % dulu', t.sku;
  end if;
  perform set_config('app.by_name', v_name, true);
  perform set_config('app.pick_scanned', regexp_replace(coalesce(p_scanned, ''), '\s', '', 'g'), true);
  perform set_config('app.pick_bulk', '', true);
  v_res := public.post_task(p_task_id, p_actual_qty, p_from_bin, p_batch_lot, p_expiry, p_reason);
  perform set_config('app.pick_scanned', '', true);
  return v_res;
end $$;
revoke execute on function public.post_task_by(uuid, numeric, text, text, date, text, text, text) from public, anon;
grant execute on function public.post_task_by(uuid, numeric, text, text, date, text, text, text) to authenticated;

-- complete_wave_by (0023): the lines it posts are marked bulk (no scan).
create or replace function public.complete_wave_by(p_wave_id uuid, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res jsonb;
begin
  perform set_config('app.by_name', public.person_name(p_by_name), true);
  perform set_config('app.pick_scanned', '', true);
  perform set_config('app.pick_bulk', 'on', true);
  v_res := public.complete_wave(p_wave_id);
  perform set_config('app.pick_bulk', '', true);
  return v_res;
end $$;
revoke execute on function public.complete_wave_by(uuid, text) from public, anon;
grant execute on function public.complete_wave_by(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. The error rule (lib/pick-audit.ts mirrors it)
-- ---------------------------------------------------------------------
create or replace function public.norm_batch(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '\s', '', 'g'));
$$;

create or replace function public.pick_audit_errors(
  p_expected_sku text, p_expected_batch text, p_expected_expiry date, p_expected_qty numeric,
  p_found_sku text, p_found_batch text, p_found_expiry date, p_counted numeric, p_damaged boolean)
returns text[] language sql immutable as $$
  select array_remove(array[
    case when p_found_sku is distinct from p_expected_sku then 'WRONG_SKU' end,
    case when p_found_sku = p_expected_sku and p_counted < p_expected_qty then 'SHORT' end,
    case when p_found_sku = p_expected_sku and p_counted > p_expected_qty then 'OVER' end,
    case when p_found_sku = p_expected_sku
          and public.norm_batch(p_found_batch) <> public.norm_batch(p_expected_batch) then 'WRONG_BATCH' end,
    case when p_found_sku = p_expected_sku and p_found_expiry is not null and p_expected_expiry is not null
          and p_found_expiry <> p_expected_expiry then 'WRONG_EXPIRY' end,
    case when p_damaged then 'DAMAGED' end
  ], null);
$$;

-- ---------------------------------------------------------------------
-- 4. Attempts and loads
-- ---------------------------------------------------------------------
create table public.pick_audits (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references public.pick_tasks(id) on delete cascade,
  attempt_no         int not null check (attempt_no >= 1),
  checker_name       text not null,
  found_sku          text not null,
  found_scanned_code text,
  found_batch        text not null default '',
  found_expiry       date,
  counted_qty        numeric not null check (counted_qty >= 0),
  damaged            boolean not null default false,
  expected_sku       text not null,
  expected_batch     text not null default '',
  expected_expiry    date,
  expected_qty       numeric not null,
  errors             text[] not null default '{}'
                       check (errors <@ array['WRONG_SKU','SHORT','OVER','WRONG_BATCH','WRONG_EXPIRY','DAMAGED']),
  result             text not null check (result in ('OK', 'MISMATCH')),
  note               text,
  resolution         text check (resolution in ('ACCEPT_SHORT', 'ACCEPT_BATCH')),
  resolved_by_name   text,
  resolved_at        timestamptz,
  resolution_note    text,
  legacy             boolean not null default false,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  unique (task_id, attempt_no),
  constraint pick_audit_result check ((result = 'OK') = (errors = '{}')),
  constraint pick_audit_resolution check (
    resolution is null or (result = 'MISMATCH' and resolved_by_name is not null and resolved_at is not null
                           and nullif(trim(resolution_note), '') is not null))
);
create index pick_audits_created_idx on public.pick_audits (created_at desc);

create table public.shipment_loads (
  id              uuid primary key default gen_random_uuid(),
  wave_id         uuid not null references public.waves(id) on delete cascade,
  shipment_number text not null,
  loaded_by_name  text not null,
  truck           text,
  legacy          boolean not null default false,
  created_by      uuid references public.profiles(id),
  loaded_at       timestamptz not null default now(),
  unique (wave_id, shipment_number)
);

alter table public.pick_audits enable row level security;
alter table public.shipment_loads enable row level security;
create policy "pick_audits: read" on public.pick_audits for select to authenticated using (true);
create policy "shipment_loads: read" on public.shipment_loads for select to authenticated using (true);
-- No write policies: written only through the functions below.

-- ---------------------------------------------------------------------
-- 5. Views
-- ---------------------------------------------------------------------
-- One row per completed PICK task with its latest attempt.
create or replace view public.pick_audit_line with (security_invoker = true) as
with latest as (
  select distinct on (task_id) * from public.pick_audits order by task_id, attempt_no desc
), n as (
  select task_id, count(*)::int as attempts from public.pick_audits group by task_id
)
select t.id as task_id, t.wave_id, w.wave_no, w.planned_date, w.status as wave_status, t.shipment_number, t.seq,
       it.sku, it.description, it.uom,
       coalesce(ab.bin_code, fb.bin_code) as from_bin, coalesce(ab.zone, fb.zone) as zone,
       coalesce(t.actual_batch_lot, t.batch_lot) as batch_lot, coalesce(t.actual_expiry_date, t.expiry_date) as expiry_date,
       t.quantity as planned_qty, coalesce(t.actual_quantity, t.quantity) as picked_qty, t.deviation_reason,
       t.completed_at, t.picked_by_name, t.bulk_posted, t.scanned_code,
       l.id as audit_id, l.attempt_no, l.result, l.errors, l.resolution, l.checker_name, l.created_at as audited_at,
       coalesce(n.attempts, 0) as attempts,
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when l.id is null then 'TODO'
            when l.result = 'OK' then 'OK'
            when l.resolution is not null then 'RESOLVED'
            else 'MISMATCH' end as line_state,
       sl.id is not null as loaded
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join public.shipment_loads sl on sl.wave_id = t.wave_id and sl.shipment_number = t.shipment_number
where t.task_type = 'PICK' and t.status = 'COMPLETED';

-- One row per wave + shipment with PICK tasks.
create or replace view public.pick_audit_shipment with (security_invoker = true) as
with tasks as (
  select wave_id, shipment_number,
         count(*) filter (where status in ('PLANNED', 'RESCHEDULED'))::int as open_tasks,
         count(*) filter (where status = 'COMPLETED')::int as lines
  from public.pick_tasks where task_type = 'PICK' group by wave_id, shipment_number
), st as (
  select wave_id, shipment_number,
         count(*) filter (where line_state = 'TODO')::int as todo,
         count(*) filter (where line_state in ('OK', 'AUTO_PASS'))::int as ok,
         count(*) filter (where line_state = 'MISMATCH')::int as mismatch,
         count(*) filter (where line_state = 'RESOLVED')::int as resolved
  from public.pick_audit_line group by wave_id, shipment_number
)
select w.id as wave_id, w.wave_no, w.planned_date, w.planned_slot, w.status as wave_status, w.truck as planned_truck,
       t.shipment_number, t.open_tasks, t.lines,
       coalesce(st.todo, 0) as todo, coalesce(st.ok, 0) as ok, coalesce(st.mismatch, 0) as mismatch, coalesce(st.resolved, 0) as resolved,
       case when sl.id is not null then 'LOADED'
            when w.status = 'CANCELLED' or (t.open_tasks = 0 and t.lines = 0) then 'CANCELLED'
            when t.open_tasks > 0 then 'PICKING'
            when coalesce(st.mismatch, 0) > 0 then 'HAS_MISMATCH'
            when coalesce(st.todo, 0) > 0 then 'READY_AUDIT'
            else 'READY_LOAD' end as state,
       sl.loaded_at, sl.loaded_by_name, sl.truck, coalesce(sl.legacy, false) as load_legacy
from tasks t
join public.waves w on w.id = t.wave_id
left join st on st.wave_id = t.wave_id and st.shipment_number = t.shipment_number
left join public.shipment_loads sl on sl.wave_id = t.wave_id and sl.shipment_number = t.shipment_number;

-- First attempt per line (not migrated ones): the basis of every accuracy KPI.
create or replace view public.pick_audit_first with (security_invoker = true) as
select a.id, a.task_id, a.created_at as audited_at, a.checker_name, a.expected_qty, a.counted_qty, a.errors, a.result,
       l.wave_id, l.wave_no, l.planned_date, l.shipment_number, l.sku, l.description, l.zone, l.from_bin,
       l.picked_by_name, l.bulk_posted, l.scanned_code is not null as scanned, l.completed_at,
       round((extract(epoch from a.created_at - l.completed_at) / 60)::numeric, 1) as minutes_to_audit
from public.pick_audits a
join public.pick_audit_line l on l.task_id = a.task_id
where a.attempt_no = 1 and not a.legacy;

-- ---------------------------------------------------------------------
-- 6. Recording an attempt
-- ---------------------------------------------------------------------
create or replace function public.record_pick_audit(
  p_task_id uuid, p_checker_name text, p_found text, p_counted numeric,
  p_batch text, p_expiry date, p_damaged boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  t record; v_prev public.pick_audits%rowtype; v_found_sku text; v_code text;
  v_errors text[]; v_result text; v_attempt int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  select pt.id, pt.wave_id, pt.shipment_number, pt.task_type, pt.status, pt.picked_by_name, it.sku,
         coalesce(pt.actual_quantity, pt.quantity) as qty, coalesce(pt.actual_batch_lot, pt.batch_lot) as batch,
         coalesce(pt.actual_expiry_date, pt.expiry_date) as expiry, w.status as wave_status
    into t
  from public.pick_tasks pt join public.items it on it.id = pt.item_id join public.waves w on w.id = pt.wave_id
  where pt.id = p_task_id
  for update of pt;
  if not found or t.task_type <> 'PICK' or t.status <> 'COMPLETED' then
    raise exception 'Tugas pick belum selesai atau tidak ditemukan';
  end if;
  if t.wave_status = 'CANCELLED' then raise exception 'Wave dibatalkan: baris ini tidak diaudit'; end if;
  if exists (select 1 from public.shipment_loads where wave_id = t.wave_id and shipment_number = t.shipment_number) then
    raise exception 'Shipment % sudah dimuat', t.shipment_number;
  end if;
  if t.qty = 0 then raise exception 'Baris ini tidak dipick (0): tidak perlu diaudit'; end if;
  if public.same_person(v_checker, t.picked_by_name) then
    raise exception 'Checker tidak boleh picker baris ini (%)', t.picked_by_name;
  end if;
  select * into v_prev from public.pick_audits where task_id = p_task_id order by attempt_no desc limit 1;
  if v_prev.id is not null and (v_prev.result = 'OK' or v_prev.resolution is not null) then
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
    counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note, created_by)
  values (p_task_id, v_attempt, v_checker, v_found_sku, v_code, public.norm_batch(p_batch), p_expiry,
    p_counted, coalesce(p_damaged, false), t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''), auth.uid());

  -- The expected values leave the database only here, after the count is saved.
  return jsonb_build_object('result', v_result, 'errors', to_jsonb(v_errors), 'attempt', v_attempt,
    'expected', jsonb_build_object('sku', t.sku, 'batch', t.batch, 'expiry', t.expiry, 'qty', t.qty),
    'found', jsonb_build_object('sku', v_found_sku, 'code', v_code, 'batch', public.norm_batch(p_batch),
                                'expiry', p_expiry, 'qty', p_counted, 'damaged', coalesce(p_damaged, false)));
end $$;

-- ---------------------------------------------------------------------
-- 7. A supervisor accepts a mismatch instead of a floor fix
--    ACCEPT_SHORT  ship what is there; the missing cartons go back on the
--                  books in the source bin.
--    ACCEPT_BATCH  ship the batch that is there; the planned batch goes
--                  back to the source bin, the found batch comes out of
--                  the bin it was taken from.
--    Both open a recount of the source bin: its records were wrong or
--    cartons are unaccounted for. No approval queue: the resolver is
--    already a second person (≠ picker, ≠ checker).
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
  select pt.id, pt.wave_id, pt.shipment_number, pt.item_id, pt.picked_by_name,
         coalesce(pt.actual_from_bin_id, pt.from_bin_id) as src
    into t
  from public.pick_tasks pt where pt.id = a.task_id for update;
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
-- Privileges (see 0005: nothing is granted by default)
-- ---------------------------------------------------------------------
grant select on public.pick_audits, public.shipment_loads,
  public.pick_audit_line, public.pick_audit_shipment, public.pick_audit_first to authenticated;
grant all on public.pick_audits, public.shipment_loads to service_role;
revoke execute on function public.norm_batch(text),
  public.pick_audit_errors(text, text, date, numeric, text, text, date, numeric, boolean) from public, anon;
grant execute on function public.norm_batch(text),
  public.pick_audit_errors(text, text, date, numeric, text, text, date, numeric, boolean) to authenticated;
revoke execute on function public.record_pick_audit(uuid, text, text, numeric, text, date, boolean, text) from public, anon;
grant execute on function public.record_pick_audit(uuid, text, text, numeric, text, date, boolean, text) to authenticated;
revoke execute on function public.resolve_pick_mismatch(uuid, text, text, text, text) from public, anon;
grant execute on function public.resolve_pick_mismatch(uuid, text, text, text, text) to authenticated;
