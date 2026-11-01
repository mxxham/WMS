-- =====================================================================
-- 0122  Bin To Bin (REPLENISH) rows carry their shipment and DO
--
--  On the audit, an item's DO must never look "deleted" because the carton
--  was moved: the Per bin sheet and the Bin To Bin table showed empty
--  Shipment and DO columns for every move.
--
--  A REPLENISH task has no shipment_number by design (the plan builds them
--  shipment-less, lib/allocator/plan.ts), and nothing is copied onto the
--  task here. The shipment and the DO are derived from the wave it belongs
--  to, at read time:
--    · shipment_numbers = the wave's outbound shipments that demand the SAME
--      SKU (outbound rows of wave_id + sku, status <> 'CANCELLED'), sorted;
--      waves.shipment_numbers when the wave carries no demand for that SKU
--      (a pure relocation move belongs to the whole wave).
--    · do_nos = every order number of those outbound rows, plus the manual
--      DOs of shipment_do_no (0079) for this wave and those shipments,
--      normalised once by public.norm_do_nos (0121: trim, drop empty,
--      dedupe, first-seen order, at most 20). Only when the SKU really has
--      outbound demand: a relocation move has no DO of its own, and the
--      manual list of an unrelated shipment is not borrowed.
--
--  pick_audit_move is re-issued from 0114 (the latest definition) with the
--  two columns appended at the very end (CREATE OR REPLACE VIEW append-only
--  rule, after from_audited_at); every existing column keeps its name, type
--  and position. The work is done in per-task lateral joins, so a page that
--  reads one day never aggregates the whole outbound table.
-- =====================================================================

create or replace view public.pick_audit_move with (security_invoker = true) as
with latest as (
  select distinct on (task_id) * from public.pick_audits order by task_id, attempt_no desc
), n as (
  select task_id, count(*)::int as attempts from public.pick_audits group by task_id
), src as (
  select distinct on (task_id) * from public.move_source_audits order by task_id, attempt_no desc
), sn as (
  select task_id, count(*)::int as attempts from public.move_source_audits group by task_id
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
            else 'MISMATCH' end as line_state,
       -- 0114: the count left in the source bin
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when s.id is null then 'TODO'
            when s.result = 'OK' then 'OK'
            else 'MISMATCH' end as from_state,
       coalesce(sn.attempts, 0) as from_attempts,
       s.checker_name as from_checker, s.system_qty as from_system, s.counted_qty as from_counted,
       s.found_sku as from_found_sku, s.note as from_note, s.correction as from_correction, s.created_at as from_audited_at,
       -- 0122: the shipments of this move, and their DOs
       coalesce(dm.shipments, w.shipment_numbers) as shipment_numbers,
       coalesce(doa.do_nos, '{}'::text[]) as do_nos
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
join public.bins tb on tb.id = t.to_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join src s on s.task_id = t.id
left join sn on sn.task_id = t.id
-- The wave's outbound demand for this move's SKU: its shipments, and every order number of theirs
-- flattened in read order. The elements are aggregated one by one on purpose: array_agg over the
-- order_nos arrays themselves raises "cannot accumulate empty arrays" as soon as one row has '{}'.
left join lateral (
  select array_agg(distinct o.shipment_number order by o.shipment_number) as shipments,
         (select array_agg(d.d order by d.ord)
            from public.outbound o2
            cross join lateral unnest(o2.order_nos) with ordinality as d(d, ord)
           where o2.wave_id = t.wave_id and o2.sku = it.sku and o2.status <> 'CANCELLED') as do_list
  from public.outbound o
  where o.wave_id = t.wave_id and o.sku = it.sku and o.status <> 'CANCELLED'
) dm on true
-- The DOs typed by hand on the Wave page for those shipments (none when the move has no demand).
left join lateral (
  select jsonb_agg(e.d order by sd.shipment_number, e.ord) as dos
  from public.shipment_do_no sd
  cross join lateral jsonb_array_elements_text(sd.do_nos) with ordinality as e(d, ord)
  where sd.wave_id = t.wave_id and sd.shipment_number = any(dm.shipments)
) md on true
-- The plan's order numbers, then the manual ones, normalised once.
left join lateral (
  select public.norm_do_nos(coalesce(jsonb_agg(d.d order by d.ord), '[]'::jsonb) || coalesce(md.dos, '[]'::jsonb)) as do_nos
  from unnest(dm.do_list) with ordinality as d(d, ord)
) doa on true
where t.task_type = 'REPLENISH' and t.status = 'COMPLETED';

grant select on public.pick_audit_move to authenticated;
