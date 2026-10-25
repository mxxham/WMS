-- =====================================================================
-- 0093  fefo_exceptions: expose the zone (aisle) of the picked bin
--
--  The dashboard needs FEFO violations broken down by zone/aisle. fefo_exceptions
--  already joins bins (fb) but only returned bin_code; zone is added so callers
--  can aggregate per aisle without string-parsing bin codes. Appended at the end
--  so existing SELECT * callers (e.g. tests, temp tables) keep working.
-- =====================================================================

-- The return type changes, so the function is dropped and recreated.
drop function if exists public.fefo_exceptions(timestamptz, timestamptz);

create or replace function public.fefo_exceptions(p_from timestamptz, p_to timestamptz)
returns table (
  movement_id uuid, picked_at timestamptz, sku text, description text, from_bin text, batch_lot text,
  expiry_date date, quantity numeric, by_name text, note text, shipment_number text, wave_no text,
  older_expiry date, older_qty numeric, older_bins text, zone text
) language sql stable security definer set search_path = public as $$
  with picks as (
    -- the dispatch minimum once per pick, not once per (pick, older identity) pair
    select m.*, public.item_min_dispatch_days(m.item_id) as min_days
    from public.movements m join public.bins b on b.id = m.from_bin_id
    where m.type = 'picking' and m.created_at >= p_from and m.created_at < p_to
      and b.rack is not null and m.expiry_date is not null
  ), items as (select distinct item_id from picks),
  ids as (
    select bin_id, item_id, batch_lot, expiry_date from public.inventory where item_id in (select item_id from items)
    union
    select from_bin_id, item_id, batch_lot, expiry_date from public.movements
      where from_bin_id is not null and created_at >= p_from and item_id in (select item_id from items)
    union
    select to_bin_id, item_id, batch_lot, expiry_date from public.movements
      where type in ('inbound', 'putaway', 'transfer', 'adjustment') and created_at >= p_from and item_id in (select item_id from items)
  ), cand as materialized (
    -- materialized: each subquery runs once per pair (inlined, the planner repeats before_qty's)
    select p.id as pick_id, x.bin_id, x.expiry_date,
      coalesce((select sum(i.quantity) from public.inventory i where i.bin_id = x.bin_id and i.item_id = x.item_id
                  and i.batch_lot = x.batch_lot and i.expiry_date is not distinct from x.expiry_date), 0)
      -- undo every movement at or after the pick: add back what left, take off what came in
      + coalesce((select sum(m.quantity) from public.movements m where m.from_bin_id = x.bin_id and m.item_id = x.item_id
                  and m.batch_lot = x.batch_lot and m.expiry_date is not distinct from x.expiry_date and m.created_at >= p.created_at), 0)
      - coalesce((select sum(m.quantity) from public.movements m where m.to_bin_id = x.bin_id and m.item_id = x.item_id
                  and m.type in ('inbound', 'putaway', 'transfer', 'adjustment') and m.batch_lot = x.batch_lot and m.expiry_date is not distinct from x.expiry_date and m.created_at >= p.created_at), 0) as before_qty,
      coalesce((select sum(m.quantity) from public.movements m where m.from_bin_id = x.bin_id and m.item_id = x.item_id
                  and m.batch_lot = x.batch_lot and m.expiry_date is not distinct from x.expiry_date and m.created_at = p.created_at and m.quantity > 0), 0)
      + coalesce((select sum(-m.quantity) from public.movements m where m.to_bin_id = x.bin_id and m.item_id = x.item_id
                  and m.type in ('inbound', 'putaway', 'transfer', 'adjustment') and m.batch_lot = x.batch_lot and m.expiry_date is not distinct from x.expiry_date and m.created_at = p.created_at and m.quantity < 0), 0) as same_tx_out,
      exists (select 1 from public.stock_holds h where h.scope = 'BATCH' and h.item_id = x.item_id and h.batch_lot = x.batch_lot
              and h.created_at <= p.created_at and (h.released_at is null or h.released_at > p.created_at)) as batch_held,
      coalesce((select sum(h.quantity) from public.stock_holds h where h.scope = 'LINE' and h.bin_id = x.bin_id and h.item_id = x.item_id
                  and h.batch_lot = x.batch_lot and h.expiry_date is not distinct from x.expiry_date
                  and h.created_at <= p.created_at and (h.released_at is null or h.released_at > p.created_at)), 0) as line_held,
      coalesce((select sum(t.quantity) from public.pick_tasks t where t.from_bin_id = x.bin_id and t.item_id = x.item_id
                  and t.batch_lot = x.batch_lot and t.expiry_date = x.expiry_date and t.id is distinct from p.task_id
                  and t.created_at <= p.created_at
                  and (t.status = 'PLANNED' or (t.status = 'COMPLETED' and t.completed_at > p.created_at))), 0) as reserved
    from picks p
    join ids x on x.item_id = p.item_id and x.expiry_date < p.expiry_date
    join public.bins b on b.id = x.bin_id and b.rack is not null and b.status = 'active' and b.zone <> 'QUARANTINE'
    where x.expiry_date - (p.created_at at time zone 'Asia/Jakarta')::date >= p.min_days
  ), avail as (
    select c.pick_id, c.bin_id, c.expiry_date,
           case when c.batch_held then 0
                else c.before_qty - c.same_tx_out - least(greatest(c.before_qty - c.same_tx_out, 0), c.line_held) - c.reserved end as qty
    from cand c
  ), older as (
    select a.pick_id, min(a.expiry_date) as older_expiry, sum(a.qty) as older_qty,
           string_agg(distinct bn.bin_code, ', ' order by bn.bin_code) as older_bins
    from avail a join public.bins bn on bn.id = a.bin_id
    where a.qty > 0
    group by a.pick_id
  )
  select p.id, p.created_at, it.sku, it.description, fb.bin_code, p.batch_lot, p.expiry_date, p.quantity,
         p.by_name, p.note, t.shipment_number, w.wave_no, o.older_expiry, o.older_qty, o.older_bins, fb.zone as zone
  from older o
  join picks p on p.id = o.pick_id
  join public.items it on it.id = p.item_id
  join public.bins fb on fb.id = p.from_bin_id
  left join public.pick_tasks t on t.id = p.task_id
  left join public.waves w on w.id = t.wave_id
  order by p.created_at desc;
$$;
