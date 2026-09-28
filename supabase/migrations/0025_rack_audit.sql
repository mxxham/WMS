-- =====================================================================
-- 0025  Picking audit at the rack
--
--  The checker walks the racks in order instead of the staging lanes.
--  Per bin + SKU picked on a date, they count what is LEFT in the bin,
--  blind (the system quantity is not shown before saving). What is left
--  tells how much was really taken:
--      more left than the system says -> picker took less   -> SHORT
--      less left                      -> picker took more   -> OVER
--  Several lines from the same bin + SKU share one count; a difference
--  goes on the most recently picked line, the others pass.
--
--  A rack count checks quantity and bin only: SKU / batch / damage on the
--  pallet are not seen (method 'RACK', batch recorded as picked).
--  Floor fix + recount, or Terima kurang (0024), work as before.
-- =====================================================================

alter table public.pick_audits
  add column method text not null default 'STAGING' check (method in ('STAGING', 'RACK')),
  add column rack_system numeric,
  add column rack_counted numeric;

-- Bins to count on a date: one row per bin + SKU with lines still to audit,
-- in walking order. No quantities (blind).
create or replace view public.pick_audit_rack with (security_invoker = true) as
select l.planned_date, l.from_bin as bin_code, b.zone, b.rack, b.level, b.position,
       l.sku, l.description, l.uom,
       count(*)::int as lines,
       count(*) filter (where l.line_state = 'MISMATCH')::int as mismatch,
       array_agg(distinct l.shipment_number order by l.shipment_number) as shipments,
       array_agg(distinct coalesce(l.picked_by_name, '')) filter (where l.picked_by_name is not null) as pickers
from public.pick_audit_line l
join public.bins b on b.bin_code = l.from_bin
where l.line_state in ('TODO', 'MISMATCH') and not l.loaded and l.wave_status <> 'CANCELLED'
group by l.planned_date, l.from_bin, b.zone, b.rack, b.level, b.position, l.sku, l.description, l.uom;

create or replace function public.record_rack_audit(
  p_date date, p_bin text, p_sku text, p_checker_name text, p_counted numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  v_bin uuid; v_item uuid; v_system numeric; v_diff numeric; v_target uuid; v_picker text;
  t record; v_counted numeric; v_errors text[]; v_result text; v_attempt int;
  n_lines int := 0; n_bad int := 0;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;
  select id into v_bin from public.bins where bin_code = upper(trim(p_bin));
  select id into v_item from public.items where sku = trim(p_sku);
  if v_bin is null or v_item is null then raise exception 'Bin atau SKU tidak ditemukan'; end if;

  -- The lines this count covers, locked.
  drop table if exists _lines;
  create temp table _lines on commit drop as
  select pt.id, pt.completed_at, pt.picked_by_name, it.sku,
         coalesce(pt.actual_quantity, pt.quantity) as qty,
         coalesce(pt.actual_batch_lot, pt.batch_lot) as batch,
         coalesce(pt.actual_expiry_date, pt.expiry_date) as expiry
  from public.pick_tasks pt
  join public.items it on it.id = pt.item_id
  join public.waves w on w.id = pt.wave_id
  join public.pick_audit_line l on l.task_id = pt.id
  where w.planned_date = p_date and coalesce(pt.actual_from_bin_id, pt.from_bin_id) = v_bin and pt.item_id = v_item
    and l.line_state in ('TODO', 'MISMATCH') and not l.loaded and l.wave_status <> 'CANCELLED';
  perform 1 from public.pick_tasks where id in (select id from _lines) for update;
  if not exists (select 1 from _lines) then
    raise exception 'Tidak ada baris untuk diaudit di % untuk SKU %', upper(trim(p_bin)), p_sku;
  end if;
  select picked_by_name into v_picker from _lines where public.same_person(v_checker, picked_by_name) limit 1;
  if v_picker is not null then raise exception 'Checker tidak boleh picker baris di bin ini (%)', v_picker; end if;

  select coalesce(sum(quantity), 0) into v_system from public.inventory where bin_id = v_bin and item_id = v_item;
  v_diff := p_counted - v_system;
  if v_diff <> 0 and nullif(trim(p_note), '') is null then
    raise exception 'Catatan wajib diisi bila sisa di bin tidak sesuai';
  end if;
  select id into v_target from _lines order by completed_at desc, id desc limit 1;

  for t in select * from _lines loop
    v_counted := case when t.id = v_target then greatest(t.qty - v_diff, 0) else t.qty end;
    v_errors := public.pick_audit_errors(t.sku, t.batch, t.expiry, t.qty, t.sku, t.batch, null, v_counted, false);
    v_result := case when v_errors = '{}' then 'OK' else 'MISMATCH' end;
    select coalesce(max(attempt_no), 0) + 1 into v_attempt from public.pick_audits where task_id = t.id;
    insert into public.pick_audits (task_id, attempt_no, checker_name, found_sku, found_batch, found_expiry,
      counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note,
      method, rack_system, rack_counted, created_by)
    values (t.id, v_attempt, v_checker, t.sku, public.norm_batch(t.batch), null,
      v_counted, false, t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''),
      'RACK', v_system, p_counted, auth.uid());
    n_lines := n_lines + 1;
    if v_result <> 'OK' then n_bad := n_bad + 1; end if;
  end loop;

  -- The system quantity leaves the database only here, after the count is saved.
  return jsonb_build_object('result', case when n_bad = 0 then 'OK' else 'MISMATCH' end,
    'system', v_system, 'counted', p_counted, 'diff', v_diff, 'lines', n_lines);
end $$;
revoke execute on function public.record_rack_audit(date, text, text, text, numeric, text) from public, anon;
grant execute on function public.record_rack_audit(date, text, text, text, numeric, text) to authenticated;
