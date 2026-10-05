-- =====================================================================
-- 0055  Laporan WMS harian: on hand, the day's picking, remain
--
--  To compare with SAP the warehouse needs, per day, the WMS sheet's two
--  numbers: ON HAND — the stock once the day's inbound and putaway are done,
--  before picking — and REMAIN — the stock after the day's picking, which is
--  the next day's on hand. The movements ledger cannot be edited, so both are
--  derived from it for any date, without storing snapshots:
--    remain   = stock at the end of the date (now − everything after it)
--    pick     = picking out of the bin that day, less picks undone that day
--               (unpost_task returns a pick as an adjustment pointing at the
--               PICK task, 0034 — counted here as un-picking, not a correction)
--    b out/in = transfers out of / into the bin that day (Bin To Bin, Mutasi)
--    on hand  = remain + pick + b out − b in
--  so Remain = On hand − PICK − b out + b in holds on every row. Putaway,
--  inbound and other adjustments (the morning import, counts) are part of on
--  hand by that definition; their day totals are reported alongside for
--  reference. Day = Asia/Jakarta calendar date. One row per bin + SKU + batch
--  + expiry, the database's stock identity.
-- =====================================================================

create or replace function public.wms_day_report(p_date date)
returns table (
  bin_code text, sku text, description text, uom text, upp numeric, batch_lot text, expiry_date date, received_date date,
  on_hand numeric, pick numeric, b_out numeric, b_in numeric, putaway numeric, adjust numeric, remain numeric
) language sql stable security invoker set search_path = public as $$
  with b as (
    select (p_date::timestamp at time zone 'Asia/Jakarta') as t0, ((p_date + 1)::timestamp at time zone 'Asia/Jakarta') as t1
  ), mv as (
    select m.id, m.type, m.item_id, m.batch_lot, m.expiry_date, m.quantity, m.from_bin_id, m.to_bin_id, m.created_at,
           (m.type = 'adjustment' and exists (select 1 from public.pick_tasks pt where pt.id = m.ref_id and pt.task_type = 'PICK')) as unpick
    from public.movements m, b where m.created_at >= b.t0
  ), legs as (
    -- Every movement as signed deltas on the identities it touches.
    select from_bin_id as bin_id, item_id, batch_lot, expiry_date, -quantity as q, type, unpick, created_at, 'out' as side
      from mv where from_bin_id is not null
    union all
    select to_bin_id, item_id, batch_lot, expiry_date, quantity, type, unpick, created_at, 'in'
      from mv where to_bin_id is not null
  ), agg as (
    select l.bin_id, l.item_id, l.batch_lot, l.expiry_date,
      sum(l.q) filter (where l.created_at >= b.t1) as after_day,
      coalesce(sum(-l.q) filter (where l.created_at < b.t1 and l.type = 'picking'), 0)
        - coalesce(sum(l.q) filter (where l.created_at < b.t1 and l.unpick), 0) as pick,
      coalesce(sum(-l.q) filter (where l.created_at < b.t1 and l.type = 'transfer' and l.side = 'out'), 0) as b_out,
      coalesce(sum(l.q) filter (where l.created_at < b.t1 and l.type = 'transfer' and l.side = 'in'), 0) as b_in,
      coalesce(sum(l.q) filter (where l.created_at < b.t1 and l.type in ('putaway', 'inbound')), 0) as putaway,
      coalesce(sum(l.q) filter (where l.created_at < b.t1 and l.type = 'adjustment' and not l.unpick), 0) as adjust
    from legs l, b group by 1, 2, 3, 4
  ), ids as (
    select bin_id, item_id, batch_lot, expiry_date from public.inventory
    union
    select bin_id, item_id, batch_lot, expiry_date from agg
  ), rows as (
    select i.bin_id, i.item_id, i.batch_lot, i.expiry_date,
      coalesce((select sum(v.quantity) from public.inventory v where v.bin_id = i.bin_id and v.item_id = i.item_id
                and v.batch_lot = i.batch_lot and v.expiry_date is not distinct from i.expiry_date), 0)
        - coalesce(a.after_day, 0) as remain,
      coalesce(a.pick, 0) as pick, coalesce(a.b_out, 0) as b_out, coalesce(a.b_in, 0) as b_in,
      coalesce(a.putaway, 0) as putaway, coalesce(a.adjust, 0) as adjust
    from ids i
    left join agg a on a.bin_id = i.bin_id and a.item_id = i.item_id and a.batch_lot = i.batch_lot
                   and a.expiry_date is not distinct from i.expiry_date
  )
  select bn.bin_code, it.sku, it.description, it.uom, it.upp, r.batch_lot, r.expiry_date,
         (select max(v.received_date) from public.inventory v where v.bin_id = r.bin_id and v.item_id = r.item_id and v.batch_lot = r.batch_lot) as received_date,
         r.remain + r.pick + r.b_out - r.b_in as on_hand, r.pick, r.b_out, r.b_in, r.putaway, r.adjust, r.remain
  from rows r
  join public.bins bn on bn.id = r.bin_id
  join public.items it on it.id = r.item_id
  where r.remain + r.pick + r.b_out - r.b_in <> 0 or r.remain <> 0 or r.pick <> 0 or r.b_out <> 0 or r.b_in <> 0
     or r.putaway <> 0 or r.adjust <> 0
  order by bn.bin_code, it.sku, r.batch_lot, r.expiry_date;
$$;
revoke execute on function public.wms_day_report(date) from public, anon;
grant execute on function public.wms_day_report(date) to authenticated;
