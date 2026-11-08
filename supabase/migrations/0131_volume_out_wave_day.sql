-- =====================================================================
-- 0131  Volume keluar counts a pick on its wave's day
--
--  8 Nov 2026: a wave of yesterday, posted this morning, put its litres
--  and cartons on today in Volume keluar (Audit picking, Dashboard, Home).
--  volume_out_daily (0091) grouped picking movements by the Jakarta day
--  they were posted, while everything else about a wave (Audit picking,
--  the picklists, the Dashboard link into the audit) goes by the wave's
--  planned_date.
--
--  A picking movement posted from a task now counts on that task's wave
--  day. One without a task (the ledger allows it) keeps its posting day.
--  The stock ledger (Buku stok) is unchanged: stock still leaves on the
--  day it was posted.
-- =====================================================================

create or replace view public.volume_out_daily with (security_invoker = true) as
with mv as (
  select
    coalesce(w.planned_date, (m.created_at at time zone 'Asia/Jakarta')::date) as day,
    m.quantity,
    it.volume_l
  from public.movements m
  join public.items it on it.id = m.item_id
  left join public.pick_tasks t on t.id = m.task_id
  left join public.waves w on w.id = t.wave_id
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
