-- =====================================================================
-- 0121  Per-item DO (delivery order = SAP order) numbers on the audit
--
--  The checker must see which DO each audited item belongs to. Until now
--  the only DO on the audit was the shipment's, added at the print edge.
--
--  Three DO sources exist already; nothing is invented here:
--    · outbound.order_nos  the WMS order numbers per wave + shipment + SKU
--                          (0004), written by save_plan from the allocator's
--                          DemandLine.orderNos.
--    · the K_ONE picklist  the per-line "Order No" column, with the line's
--                          "DO Number" column listing the shipment's orders
--                          (lib/sheet-picklist.ts).
--    · Schedule of the day DemandLine / AllocationLine / Shortage.orderNos,
--                          already carried by the allocator.
--  Manual DOs typed on the Wave page live in shipment_do_no (0079) and are
--  merged at read/print time by the UI only; they are not stored per line.
--
--  a) sheet_pick_lines.do_nos: the file's per-line DO numbers.
--  b) sheet_pick_line_state re-issued: its `l.*` was expanded at creation.
--  c) load_sheet_pick_lines stores them normalised — trim, drop empty,
--     dedupe, first-seen order, at most 20 — the same discipline as
--     set_shipment_dos in 0079. Return contract unchanged.
--  d) pick_audit_line gains do_nos as the LAST column, from outbound.order_nos
--     for the same wave + shipment + SKU (CREATE OR REPLACE VIEW rule: new
--     columns can only be appended, volume_l is last today).
--  No new write policy: it is still written only by the RPC below.
-- =====================================================================

-- ---------------------------------------------------------------------
-- a) The file's per-line DO numbers (empty when the file has none)
-- ---------------------------------------------------------------------
alter table public.sheet_pick_lines add column do_nos text[] not null default '{}';

-- ---------------------------------------------------------------------
-- b) sheet_pick_line_state re-issued with the new column
-- ---------------------------------------------------------------------
-- sheet_pick_line_state selects `l.*`, but `*` is expanded when the view is
-- created, so the new column only shows up once the view is re-issued (last
-- definition: 0030; same columns, do_nos now among the l.* ones).
drop view public.sheet_pick_line_state;
create view public.sheet_pick_line_state with (security_invoker = true) as
select l.*,
       a.id as last_audit_id, a.result as last_result, a.errors as last_errors, a.checker_name as last_checker,
       a.created_at as last_audited_at, a.method as last_method, a.rack_system as last_rack_system,
       a.rack_counted as last_rack_counted, coalesce(n.attempts, 0) as attempts,
       case when a.id is null then 'TODO' when a.result = 'OK' then 'OK' else 'MISMATCH' end as line_state
from public.sheet_pick_lines l
left join lateral (select * from public.sheet_pick_audits x where x.line_id = l.id order by attempt_no desc limit 1) a on true
left join lateral (select count(*)::int as attempts from public.sheet_pick_audits x where x.line_id = l.id) n on true;
grant select on public.sheet_pick_line_state to authenticated;

-- ---------------------------------------------------------------------
-- Normalise a DO list, in one place: trim every element, drop the empty
-- ones and the duplicates (case-sensitive), keep first-seen order, stop at
-- 20 elements. Same rule as set_shipment_dos (0079), reused by the loader.
-- ---------------------------------------------------------------------
create or replace function public.norm_do_nos(p_dos jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array(
    select s.d from (
      select trim(e.x) as d, min(e.ord) as first_at
      from jsonb_array_elements_text(
             case when jsonb_typeof(coalesce(p_dos, '[]'::jsonb)) = 'array'
                  then coalesce(p_dos, '[]'::jsonb) else '[]'::jsonb end)
           with ordinality as e(x, ord)
      where trim(e.x) <> ''
      group by trim(e.x)
      order by min(e.ord)
      limit 20
    ) s
    order by s.first_at
  ), '{}'::text[])
$$;

revoke execute on function public.norm_do_nos(jsonb) from public, anon;
grant execute on function public.norm_do_nos(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- c) Loading the day's lines from the file (0030 body, + do_nos), after the
--    normaliser above.
--   p_lines: [{picklist, wave_no, shipment_number, seq, bin_code, sku,
--              description, uom, batch, expiry, qty, picker_name,
--              bin_remaining, do_nos[]}]
-- ---------------------------------------------------------------------
create or replace function public.load_sheet_pick_lines(p_date date, p_source text, p_file text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_removed int; v_added int; v_kept int; v_total int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  if p_date is null then raise exception 'Tanggal pick wajib diisi'; end if;
  if p_source not in ('K_ONE', 'ALLOCATOR') then raise exception 'Sumber tidak dikenal: %', p_source; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'File tidak berisi baris pick';
  end if;
  v_total := jsonb_array_length(p_lines);

  delete from public.sheet_pick_lines l
  where l.pick_date = p_date and not exists (select 1 from public.sheet_pick_audits a where a.line_id = l.id);
  get diagnostics v_removed = row_count;

  with src as (
    select nullif(trim(r->>'picklist'), '') as picklist, nullif(trim(r->>'wave_no'), '') as wave_no,
           trim(r->>'shipment_number') as shipment_number, coalesce((r->>'seq')::int, 0) as seq,
           upper(trim(r->>'bin_code')) as bin_code, trim(r->>'sku') as sku,
           coalesce(r->>'description', '') as description, nullif(trim(r->>'uom'), '') as uom,
           public.norm_batch(r->>'batch') as batch, nullif(r->>'expiry', '')::date as expiry,
           (r->>'qty')::numeric as qty, nullif(trim(r->>'picker_name'), '') as picker_name,
           nullif(r->>'bin_remaining', '')::numeric as bin_remaining,
           public.norm_do_nos(r->'do_nos') as do_nos
    from jsonb_array_elements(p_lines) r
  )
  insert into public.sheet_pick_lines (pick_date, source, file_name, picklist, wave_no, shipment_number, seq,
    bin_code, sku, description, uom, batch, expiry, qty, picker_name, bin_remaining, do_nos, created_by)
  select p_date, p_source, nullif(trim(p_file), ''), picklist, wave_no, shipment_number, seq,
         bin_code, sku, description, uom, batch, expiry, qty, picker_name, bin_remaining, do_nos, auth.uid()
  from src
  where coalesce(shipment_number, '') <> '' and coalesce(bin_code, '') <> '' and coalesce(sku, '') <> '' and qty > 0
  on conflict (pick_date, shipment_number, bin_code, sku, batch) do nothing;
  get diagnostics v_added = row_count;

  select count(*) into v_kept from public.sheet_pick_lines l
  where l.pick_date = p_date and exists (select 1 from public.sheet_pick_audits a where a.line_id = l.id);

  return jsonb_build_object('added', v_added, 'kept', v_kept, 'removed', v_removed, 'skipped', v_total - v_added);
end $$;

revoke execute on function public.load_sheet_pick_lines(date, text, text, jsonb) from public, anon;
grant execute on function public.load_sheet_pick_lines(date, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- d) pick_audit_line + do_nos (last column)
--    Source: outbound.order_nos of the same wave + shipment + SKU, trimmed,
--    deduped, sorted; '{}' when the plan carries none. A cancelled outbound
--    line is not a DO of this pick any more.
-- ---------------------------------------------------------------------
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
       sl.id is not null as loaded,
       t.scan_method,
       it.volume_l,
       coalesce(d.do_nos, '{}'::text[]) as do_nos
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join public.shipment_loads sl on sl.wave_id = t.wave_id and sl.shipment_number = t.shipment_number
left join lateral (
  select array(
           select distinct trim(o_d) from public.outbound o
           cross join unnest(o.order_nos) as o_d
           where o.wave_id = t.wave_id and o.shipment_number = t.shipment_number
             and o.sku = it.sku and o.status <> 'CANCELLED' and trim(o_d) <> ''
           order by trim(o_d)
         ) as do_nos
) d on true
where t.task_type = 'PICK' and t.status = 'COMPLETED';

grant select on public.pick_audit_line to authenticated;
