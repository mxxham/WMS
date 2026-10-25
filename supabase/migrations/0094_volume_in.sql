-- =====================================================================
-- 0094  volume_in_daily: litres and cartons received per day
--
--  The dashboard's Arus barang chart pairs inflow with outflow. Outflow
--  lives in volume_out_daily (0091); this mirrors it for the inflow side.
--
--  Inflow = movements rows of type 'inbound' (terima) or 'putaway'
--  (the same types the dashboard's Karton masuk tile counts), quantity > 0.
--  Day = the Asia/Jakarta calendar date of movements.created_at, exactly as
--  volume_out_daily defines it so both strips are comparable.
--  litres = sum(quantity x items.volume_l) — one shipping carton/article
--  per its own SKU (owner-confirmed 24 Oct 2026, see 0091's header).
--  Rows with NULL volume_l are excluded from the aggregation; they still
--  counted on stock identity (no stored volume is created anywhere).
--  RLS: security-invoker view + grant select to authenticated, mirroring 0091.
-- =====================================================================

create or replace view public.volume_in_daily with (security_invoker = true) as
with mv as (
  select
    (m.created_at at time zone 'Asia/Jakarta')::date as day,
    m.quantity,
    it.volume_l
  from public.movements m
  join public.items it on it.id = m.item_id
  where m.type in ('inbound', 'putaway')
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

grant select on public.volume_in_daily to authenticated;
