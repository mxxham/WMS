-- =====================================================================
-- 0125  volume_in_daily: a putaway counts on the day the goods ARRIVED
--
--  The team posts a day's putaway the next morning, because the putaway
--  sheet is only finished at night. 0117 records the arrival date the
--  poster chooses (putaway_arrival_moves), and Buku stok already books on
--  it, but the dashboard's Arus barang chart still used the posting time:
--  yesterday's goods showed up as today's inflow.
--
--  Day = putaway_arrival_moves.arrival_date when the movement has one,
--  else the Asia/Jakarta date of movements.created_at as before (receipts,
--  and putaways posted before 0117). Columns and filters are unchanged.
-- =====================================================================

create or replace view public.volume_in_daily with (security_invoker = true) as
with mv as (
  select
    coalesce(pam.arrival_date, (m.created_at at time zone 'Asia/Jakarta')::date) as day,
    m.quantity,
    it.volume_l
  from public.movements m
  join public.items it on it.id = m.item_id
  left join public.putaway_arrival_moves pam on pam.movement_id = m.id
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
