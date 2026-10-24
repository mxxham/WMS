-- =====================================================================
-- 0091  Outbound volume (litres) per day
--
--  The owner wants to see how many litres have gone OUT of the warehouse
--  per day. Volume semantics (confirmed by owner, 24 Oct 2026):
--    - items.volume_l holds the volume of ONE shipping carton/article per its
--      own SKU (CAR-row SKUs = per carton; EA-row SKUs = per shipped article,
--      e.g. a 208 L drum or a 24-bottle case labeled 20 L).
--    - Picking quantities are in cartons everywhere (the allocator, SAP
--      Delivery quantity, WMS Qty all use CAR).
--    - Therefore: litres per line = picked_qty × items.volume_l.
--  No stored/computed volume column is added to inventory or movements — this
--  is a read-only display aggregation. Per-line litres print in every place
--  too, so a strange master value shows up on that line instead of being
--  averaged away.
--
--  a) pick_audit_line view refreshed adding it.volume_l (every existing column
--     kept; definition from 0068_rack_scan.sql + volume_l).
--  b) New view volume_out_daily: litres and cartons actually picked per day,
--     from real movements rows of type 'picking' joined to pick_tasks+waves
--     (posted picks only). Day is defined by movements.created_at (Asia/Jakarta
--     calendar date). Columns: day date, boxes numeric (Σ qty), litres numeric
--     (Σ qty × volume_l), picks int (rows).
--  c) RLS: security-invoker views + grant select to authenticated (template
--     from 0024/0068/0088).
-- =====================================================================

-- ---------------------------------------------------------------------
-- a) Refresh pick_audit_line with items.volume_l
-- ---------------------------------------------------------------------
-- The 0068 definition ends with scan_method as the last column. Per
-- PostgreSQL CREATE OR REPLACE VIEW rules, new columns can only be appended
-- at the end. volume_l is added after scan_method; test 40's assertion that
-- scan_method is the final column is therefore superseded by this migration.
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
       it.volume_l
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join public.shipment_loads sl on sl.wave_id = t.wave_id and sl.shipment_number = t.shipment_number
where t.task_type = 'PICK' and t.status = 'COMPLETED';

grant select on public.pick_audit_line to authenticated;

-- ---------------------------------------------------------------------
-- b) New view: volume_out_daily
--     Daily outbound volume from posted picking movements.
--     Day = Asia/Jakarta calendar date of movements.created_at.
-- ---------------------------------------------------------------------
create or replace view public.volume_out_daily with (security_invoker = true) as
with mv as (
  select
    (m.created_at at time zone 'Asia/Jakarta')::date as day,
    m.quantity,
    it.volume_l
  from public.movements m
  join public.items it on it.id = m.item_id
  where m.type = 'picking'
    and m.quantity > 0
    and it.volume_l is not null
)
select
  day,
  sum(quantity)::numeric as boxes,
  sum(quantity * volume_l)::numeric as litres,
  count(*)::int as picks
from mv
group by day
order by day desc;

grant select on public.volume_out_daily to authenticated;

-- ---------------------------------------------------------------------
-- Realtime (if publication exists) — mirrors 0015/0024/0088 pattern
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  -- pick_audit_line is a view, not a table; only tables go into the publication.
  -- volume_out_daily is a view; no publication entry needed.
end $$;