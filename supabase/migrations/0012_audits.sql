-- =====================================================================
-- 0012  Picking audit & putaway audit
--
--  A checker (supervisor/admin) re-verifies work that is already done:
--    PICK     a COMPLETED pick task: are the cartons picked for the
--             shipment the right SKU/batch, and how many are there?
--             Expected = what the picker reported (actual_quantity),
--             else the planned quantity.
--    PUTAWAY  a putaway/inbound movement: is the stock in the bin it was
--             put into, right SKU/batch, and how many?
--  One audit per task / movement; auditing again overwrites it (the
--  earlier result is kept in `history`). An audit never changes stock:
--  a putaway mismatch is corrected with Adjust stok, a pick mismatch is a
--  finding on the shipment.
-- =====================================================================

create table public.audits (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('PICK', 'PUTAWAY')),
  task_id      uuid references public.pick_tasks(id) on delete cascade,
  movement_id  uuid references public.movements(id),
  expected_qty numeric not null,
  counted_qty  numeric not null check (counted_qty >= 0),
  sku_ok       boolean not null,
  batch_ok     boolean not null,
  result       text not null check (result in ('OK', 'MISMATCH')),
  note         text,
  history      jsonb not null default '[]'::jsonb,   -- earlier results of this audit
  audited_by   uuid references public.profiles(id),
  audited_at   timestamptz not null default now(),
  constraint audit_ref check (
    (kind = 'PICK' and task_id is not null and movement_id is null) or
    (kind = 'PUTAWAY' and movement_id is not null and task_id is null)
  )
);
create unique index audits_task_uq on public.audits (task_id) where task_id is not null;
create unique index audits_movement_uq on public.audits (movement_id) where movement_id is not null;
create index audits_at_idx on public.audits (audited_at desc);

alter table public.audits enable row level security;
create policy "audits: read" on public.audits for select to authenticated using (true);
-- No write policies: audits are recorded through record_audit().

create or replace function public.record_audit(
  p_kind text, p_ref uuid, p_counted numeric, p_sku_ok boolean, p_batch_ok boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_expected numeric; v_result text; v_prev public.audits%rowtype;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengaudit';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;

  if p_kind = 'PICK' then
    select coalesce(actual_quantity, quantity) into v_expected from public.pick_tasks
    where id = p_ref and task_type = 'PICK' and status = 'COMPLETED';
    if v_expected is null then raise exception 'Tugas pick belum selesai atau tidak ditemukan'; end if;
  elsif p_kind = 'PUTAWAY' then
    select quantity into v_expected from public.movements
    where id = p_ref and type in ('putaway', 'inbound');
    if v_expected is null then raise exception 'Mutasi putaway tidak ditemukan'; end if;
  else
    raise exception 'Jenis audit tidak dikenal: %', p_kind;
  end if;

  v_result := case when p_counted = v_expected and p_sku_ok and p_batch_ok then 'OK' else 'MISMATCH' end;
  if v_result = 'MISMATCH' and nullif(trim(p_note), '') is null then
    raise exception 'Ada selisih: catatan wajib diisi';
  end if;

  select * into v_prev from public.audits
  where (p_kind = 'PICK' and task_id = p_ref) or (p_kind = 'PUTAWAY' and movement_id = p_ref)
  for update;

  if v_prev.id is null then
    insert into public.audits (kind, task_id, movement_id, expected_qty, counted_qty, sku_ok, batch_ok, result, note, audited_by)
    values (p_kind, case when p_kind = 'PICK' then p_ref end, case when p_kind = 'PUTAWAY' then p_ref end,
            v_expected, p_counted, p_sku_ok, p_batch_ok, v_result, nullif(trim(p_note), ''), auth.uid());
  else
    update public.audits set
      history = v_prev.history || jsonb_build_object(
        'counted_qty', v_prev.counted_qty, 'sku_ok', v_prev.sku_ok, 'batch_ok', v_prev.batch_ok,
        'result', v_prev.result, 'note', v_prev.note, 'audited_by', v_prev.audited_by, 'audited_at', v_prev.audited_at),
      expected_qty = v_expected, counted_qty = p_counted, sku_ok = p_sku_ok, batch_ok = p_batch_ok,
      result = v_result, note = nullif(trim(p_note), ''), audited_by = auth.uid(), audited_at = now()
    where id = v_prev.id;
  end if;

  return jsonb_build_object('result', v_result, 'expected', v_expected, 'counted', p_counted);
end $$;

-- Completed picks with their audit (one row per task).
create or replace view public.pick_audit_detail with (security_invoker = true) as
select t.id as task_id, w.planned_date, w.wave_no, t.shipment_number, t.seq,
       it.sku, it.description, it.uom,
       fb.bin_code as from_bin, t.batch_lot, t.expiry_date, t.quantity as planned_qty,
       t.actual_quantity, ab.bin_code as actual_from_bin, t.actual_batch_lot, t.deviation_reason,
       t.completed_at, cp.name as completed_by_name,
       a.id as audit_id, a.expected_qty, a.counted_qty, a.sku_ok, a.batch_ok, a.result, a.note as audit_note,
       a.audited_at, ap.name as audited_by_name
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
left join public.profiles cp on cp.id = t.completed_by
left join public.audits a on a.task_id = t.id
left join public.profiles ap on ap.id = a.audited_by
where t.task_type = 'PICK' and t.status = 'COMPLETED';

-- Putaway / inbound movements with their audit.
create or replace view public.putaway_audit_detail with (security_invoker = true) as
select m.id as movement_id, m.type, m.created_at, mp.name as created_by_name,
       it.sku, it.description, it.uom,
       fb.bin_code as from_bin, tb.bin_code as to_bin, m.batch_lot, m.expiry_date, m.quantity, m.note,
       a.id as audit_id, a.expected_qty, a.counted_qty, a.sku_ok, a.batch_ok, a.result, a.note as audit_note,
       a.audited_at, ap.name as audited_by_name
from public.movements m
join public.items it on it.id = m.item_id
join public.bins tb on tb.id = m.to_bin_id
left join public.bins fb on fb.id = m.from_bin_id
left join public.profiles mp on mp.id = m.user_id
left join public.audits a on a.movement_id = m.id
left join public.profiles ap on ap.id = a.audited_by
where m.type in ('putaway', 'inbound');

-- Privileges (see 0005: nothing is granted by default)
grant select on public.audits, public.pick_audit_detail, public.putaway_audit_detail to authenticated;
grant all on public.audits to service_role;
revoke execute on function public.record_audit(text, uuid, numeric, boolean, boolean, text) from public, anon;
grant execute on function public.record_audit(text, uuid, numeric, boolean, boolean, text) to authenticated;
