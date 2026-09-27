-- =====================================================================
-- 0022  FEFO compliance on what was really picked, and live updates
--
--  fefo_exceptions(from, to): every rack pick in the period that took a
--  batch while an OLDER expiry of the same SKU was available in the rack
--  at that moment. "Available" rebuilds the stock of each identity at the
--  pick from the ledger (current stock minus every movement since), then
--  leaves out what could not have been taken anyway:
--    · stock moved by the same posting (same transaction timestamp),
--    · stock on hold at that moment (stock_holds history),
--    · stock reserved by another open task at that moment,
--    · quarantine / blocked bins, and stock below the dispatch minimum.
--  What is left is a real FEFO miss: the picker or the plan took newer
--  stock while older stock waited.
-- =====================================================================

create index if not exists movements_item_created_idx on public.movements (item_id, created_at);

create or replace function public.fefo_exceptions(p_from timestamptz, p_to timestamptz)
returns table (
  movement_id uuid, picked_at timestamptz, sku text, description text, from_bin text, batch_lot text,
  expiry_date date, quantity numeric, by_name text, note text, shipment_number text, wave_no text,
  older_expiry date, older_qty numeric, older_bins text
) language sql stable security definer set search_path = public as $$
  with picks as (
    select m.* from public.movements m join public.bins b on b.id = m.from_bin_id
    where m.type = 'picking' and m.created_at >= p_from and m.created_at < p_to
      and b.rack is not null and m.expiry_date is not null
  ), items as (select distinct item_id from picks),
  deltas as (
    select from_bin_id as bin_id, item_id, batch_lot, expiry_date, created_at, -quantity as delta
      from public.movements where from_bin_id is not null and created_at >= p_from and item_id in (select item_id from items)
    union all
    select to_bin_id, item_id, batch_lot, expiry_date, created_at, quantity
      from public.movements where type in ('inbound', 'putaway', 'transfer') and created_at >= p_from and item_id in (select item_id from items)
    union all
    select to_bin_id, item_id, batch_lot, expiry_date, created_at, quantity
      from public.movements where type = 'adjustment' and created_at >= p_from and item_id in (select item_id from items)
  ), ids as (
    select bin_id, item_id, batch_lot, expiry_date from public.inventory where item_id in (select item_id from items)
    union
    select bin_id, item_id, batch_lot, expiry_date from deltas
  ), cand as (
    select p.id as pick_id, x.bin_id, x.expiry_date,
      coalesce((select sum(i.quantity) from public.inventory i where i.bin_id = x.bin_id and i.item_id = x.item_id
                  and i.batch_lot = x.batch_lot and i.expiry_date is not distinct from x.expiry_date), 0)
      - coalesce((select sum(d.delta) from deltas d where d.bin_id = x.bin_id and d.item_id = x.item_id and d.batch_lot = x.batch_lot
                  and d.expiry_date is not distinct from x.expiry_date and d.created_at >= p.created_at), 0) as before_qty,
      coalesce((select sum(-d.delta) from deltas d where d.bin_id = x.bin_id and d.item_id = x.item_id and d.batch_lot = x.batch_lot
                  and d.expiry_date is not distinct from x.expiry_date and d.created_at = p.created_at and d.delta < 0), 0) as same_tx_out,
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
    where x.expiry_date - (p.created_at at time zone 'Asia/Jakarta')::date >= public.item_min_dispatch_days(p.item_id)
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
         p.by_name, p.note, t.shipment_number, w.wave_no, o.older_expiry, o.older_qty, o.older_bins
  from older o
  join picks p on p.id = o.pick_id
  join public.items it on it.id = p.item_id
  join public.bins fb on fb.id = p.from_bin_id
  left join public.pick_tasks t on t.id = p.task_id
  left join public.waves w on w.id = t.wave_id
  order by p.created_at desc;
$$;

-- Picks checked in the period (the denominator of the FEFO rate).
create or replace function public.fefo_pick_count(p_from timestamptz, p_to timestamptz)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.movements m join public.bins b on b.id = m.from_bin_id
  where m.type = 'picking' and m.created_at >= p_from and m.created_at < p_to and b.rack is not null and m.expiry_date is not null;
$$;

grant execute on function public.fefo_exceptions(timestamptz, timestamptz), public.fefo_pick_count(timestamptz, timestamptz) to authenticated;

-- Live updates for the new control tables (guarded like 0015).
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['stock_holds', 'adjustment_requests', 'receipts', 'receipt_actuals', 'stock_recons', 'stock_recon_lines', 'settings', 'items'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
