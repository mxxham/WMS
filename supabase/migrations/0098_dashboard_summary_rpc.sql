-- 0098: one round trip for the dashboard.
-- The page pulled `bin_summary` (~2,970 rows, one per bin) and `inventory_detail`
-- (one row per stock identity) into Node on every render and aggregated them in
-- JavaScript: the occupancy grid (aisle x level), the ABC split, the shelf-life
-- bar, the expiry calendar, staging aging, the top-10 SKUs by stock, and the
-- near-expiry table (the first 25 rows of a sort over every stock row). The
-- numbers are the same; they are now computed where the rows already live, so
-- the page transfers a few hundred bytes instead of a few thousand rows.
--
-- Rules carried over from the page, deliberately unchanged:
--   * occupancy ignores the CKB 3PL aisles CG/CH (OCCUPANCY_EXCLUDED_ZONES,
--     config/warehouse.ts) and only counts bins that have a rack — floor bins
--     have no level, so the grid and the "Rak terisi" tile keep agreeing with
--     the 3D view;
--   * "occupied" means total_qty > 0, not "has a stock row" (the live data has
--     129 bins carrying a zero-quantity row);
--   * the near-expiry window is the caller's NEAR_EXPIRY_DAYS
--     (config/warehouse.ts, 90), never inventory_policy.near_expiry_days (180):
--     the dashboard's "Stok expired dan mendekati expired" table has always
--     used the config constant;
--   * days_remaining is read from inventory_detail instead of being re-derived,
--     so the shelf buckets and the risky rows use the same "today" as every
--     other screen;
--   * the shelf-life bucket edges are passed in from lib/inventory-view
--     (SHELF_BUCKETS), so the dashboard and the Inventory page cannot drift
--     apart when a threshold changes;
--   * the expiry calendar keeps the page's window arithmetic — N months, or
--     N*4 quarters once the range is longer than two years — and counts a row as
--     "later" when its bucket is outside that window;
--   * ties stay deterministic: risky rows by days_remaining then id, top SKUs by
--     quantity then first-seen id, aisles by zone in byte order — the same order
--     the JavaScript map/insertion order produced.
--
-- p_today is the Jakarta calendar date the page already computed (expiry
-- calendar + staging aging). SECURITY INVOKER: the caller's RLS still decides
-- which bins and stock rows exist.

create or replace function public.dashboard_summary(
  p_today date default current_date,
  p_near_expiry_days int default 90,
  p_cal_years int default 2,
  p_risky_limit int default 25,
  p_shelf_keys text[] default array['expired','d90','d180','d365','y2','y3','more','none'],
  p_shelf_max numeric[] default array[-1,90,180,365,730,1095]::numeric[]
) returns jsonb
language sql stable security invoker set search_path = public as $$
with bins as materialized (
  select zone, rack, level, total_qty, status from public.bin_summary
), inv as materialized (
  select id, bin_code, zone, sku, description, uom, upp, item_abc, batch_lot, quantity,
         expiry_date, received_date, days_remaining
  from public.inventory_detail
),
-- ---- occupancy ------------------------------------------------------------
rack_bins as materialized (
  select zone, level, total_qty > 0 as occupied
  from bins
  where rack is not null and rack <> '' and zone not in ('CG', 'CH')
),
bin_tally as (
  select count(*)::int as total,
         (count(*) filter (where total_qty > 0))::int as occupied,
         (count(*) filter (where status = 'blocked'))::int as blocked
  from bins
),
rack_tally as (
  select count(*)::int as total, (count(*) filter (where occupied))::int as occ from rack_bins
),
levels as (
  select l.level, l.ord from unnest(array['A','B','C','D','E']) with ordinality as l(level, ord)
),
zone_tally as (
  select zone, count(*)::int as total, (count(*) filter (where occupied))::int as occ
  from rack_bins group by zone
),
cell_tally as (
  select zone, level, count(*)::int as total, (count(*) filter (where occupied))::int as occ
  from rack_bins where level in (select level from levels) group by zone, level
),
level_tally as (
  select level, count(*)::int as total, (count(*) filter (where occupied))::int as occ
  from rack_bins where level in (select level from levels) group by level
),
-- ---- stock by ABC class ---------------------------------------------------
abc_tally as (
  select coalesce(item_abc, '–') as k, coalesce(sum(quantity), 0) as qty, count(distinct sku)::int as skus
  from inv group by 1
),
-- ---- near expiry ----------------------------------------------------------
risky_rows as materialized (
  select id, bin_code, sku, description, uom, batch_lot, quantity, expiry_date, days_remaining
  from inv where days_remaining is not null and days_remaining <= p_near_expiry_days
),
risky_tally as (
  select count(*)::int as cnt,
         coalesce(sum(quantity), 0) as qty,
         (count(*) filter (where days_remaining < 0))::int as expired_cnt,
         coalesce(sum(quantity) filter (where days_remaining < 0), 0) as expired_qty,
         (count(*) filter (where days_remaining >= 0))::int as near_cnt,
         coalesce(sum(quantity) filter (where days_remaining >= 0), 0) as near_qty,
         (count(distinct sku) filter (where days_remaining >= 0))::int as near_skus,
         min(days_remaining) filter (where days_remaining >= 0) as near_min_days
  from risky_rows
),
nodate_tally as (
  select count(*)::int as cnt, coalesce(sum(quantity), 0) as qty from inv where expiry_date is null
),
-- ---- staging (dock-to-stock stand-in) -------------------------------------
staging_tally as (
  select count(*)::int as cnt,
         coalesce(sum(quantity), 0) as qty,
         min(received_date) as oldest,
         coalesce(sum(quantity) filter (where received_date is not null and p_today - received_date <= 0), 0) as lt1,
         coalesce(sum(quantity) filter (where received_date is not null and p_today - received_date between 1 and 2), 0) as d12,
         coalesce(sum(quantity) filter (where received_date is not null and p_today - received_date > 2), 0) as d3p
  from inv where zone = 'STAGING'
),
-- ---- shelf life: every stock row in its horizon bucket ---------------------
shelf_bucket as (
  select v.quantity, v.sku,
    case
      when v.days_remaining is null then p_shelf_keys[array_length(p_shelf_keys, 1)]
      else coalesce(
        (select p_shelf_keys[k.i]
           from generate_subscripts(p_shelf_max, 1) as k(i)
          where v.days_remaining <= p_shelf_max[k.i]
          order by k.i limit 1),
        p_shelf_keys[greatest(array_length(p_shelf_keys, 1) - 1, 1)])
    end as key
  from inv v
),
shelf_tally as (
  select key, count(*)::int as cnt, coalesce(sum(quantity), 0) as qty, count(distinct sku)::int as skus
  from shelf_bucket group by key
),
-- ---- expiry calendar -------------------------------------------------------
cal_tagged as (
  select v.quantity, v.sku, v.expiry_date,
    case when p_cal_years > 2
      then to_char(date_trunc('quarter', v.expiry_date::timestamp), 'YYYY-"Q"Q')
      else to_char(v.expiry_date, 'YYYY-MM') end as ym
  from inv v where v.expiry_date is not null
),
cal_buckets as (
  select g.i as ord,
    case when p_cal_years > 2
      then to_char(date_trunc('quarter', p_today::timestamp) + make_interval(months => g.i * 3), 'YYYY-"Q"Q')
      else to_char(date_trunc('month', p_today::timestamp) + make_interval(months => g.i), 'YYYY-MM') end as ym
  from generate_series(0, case when p_cal_years > 2 then p_cal_years * 4 else p_cal_years * 12 end - 1) as g(i)
),
cal_tally as (
  select b.ym, b.ord, coalesce(sum(t.quantity), 0) as qty, count(distinct t.sku)::int as skus
  from cal_buckets b left join cal_tagged t on t.ym = b.ym
  group by b.ym, b.ord
),
expired_tally as (
  select coalesce(sum(quantity), 0) as qty from cal_tagged where expiry_date < p_today
),
later_tally as (
  select coalesce(sum(t.quantity), 0) as qty
  from cal_tagged t
  where t.expiry_date >= p_today
    and not exists (select 1 from cal_buckets b where b.ym = t.ym)
),
-- ---- top SKUs by stock -----------------------------------------------------
sku_tally as (
  select v.sku,
         (array_agg(v.description order by v.id))[1] as description,
         (array_agg(v.uom order by v.id))[1] as uom,
         sum(v.quantity) as qty,
         sum(case when v.upp is not null and v.upp <> 0 then v.quantity / v.upp else 0 end) as pallets,
         count(distinct v.bin_code)::int as bins,
         (array_agg(v.id order by v.id))[1] as first_id
  from inv v group by v.sku
),
top_skus as (
  select * from sku_tally order by qty desc, first_id limit 10
)
select jsonb_build_object(
  'bins', jsonb_build_object(
    'total', b.total, 'occupied', b.occupied, 'blocked', b.blocked,
    'rack_total', rb.total, 'rack_occupied', rb.occ),
  'levels', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'level', l.level, 'total', coalesce(t.total, 0), 'occ', coalesce(t.occ, 0)) order by l.ord), '[]'::jsonb)
    from levels l left join level_tally t on t.level = l.level),
  'zones', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'zone', z.zone, 'total', z.total, 'occ', z.occ,
             'cells', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'level', l.level, 'total', coalesce(c.total, 0), 'occ', coalesce(c.occ, 0)) order by l.ord), '[]'::jsonb)
               from levels l left join cell_tally c on c.zone = z.zone and c.level = l.level)) order by z.zone collate "C"), '[]'::jsonb)
    from zone_tally z),
  'abc', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'k', k.k, 'qty', coalesce(t.qty, 0), 'skus', coalesce(t.skus, 0)) order by k.ord), '[]'::jsonb)
    from (select a.k, a.ord from unnest(array['A','B','C','–']) with ordinality as a(k, ord)) k
    left join abc_tally t on t.k = k.k),
  'stock', jsonb_build_object('no_date_rows', n.cnt, 'no_date_qty', n.qty),
  'risky', jsonb_build_object(
    'count', r.cnt, 'qty', r.qty,
    'expired_count', r.expired_cnt, 'expired_qty', r.expired_qty,
    'near_count', r.near_cnt, 'near_qty', r.near_qty,
    'near_skus', r.near_skus, 'near_min_days', r.near_min_days,
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'bin_code', x.bin_code, 'sku', x.sku, 'description', x.description, 'uom', x.uom,
               'batch_lot', x.batch_lot, 'quantity', x.quantity, 'expiry_date', x.expiry_date,
               'days_remaining', x.days_remaining) order by x.days_remaining, x.id), '[]'::jsonb)
      from (select * from risky_rows order by days_remaining, id limit greatest(p_risky_limit, 0)) x)),
  'staging', jsonb_build_object(
    'rows', s.cnt, 'qty', s.qty, 'oldest_received_date', s.oldest,
    'aging', jsonb_build_object('lt1', s.lt1, 'd1_2', s.d12, 'd3p', s.d3p)),
  'shelf', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', k.key, 'qty', coalesce(t.qty, 0), 'rows', coalesce(t.cnt, 0), 'skus', coalesce(t.skus, 0)) order by k.ord), '[]'::jsonb)
    from unnest(p_shelf_keys) with ordinality as k(key, ord)
    left join shelf_tally t on t.key = k.key),
  'expiry', jsonb_build_object(
    'expired_qty', e.qty, 'later_qty', l.qty,
    'buckets', (
      select coalesce(jsonb_agg(jsonb_build_object('ym', cb.ym, 'qty', cb.qty, 'skus', cb.skus) order by cb.ord), '[]'::jsonb)
      from cal_tally cb)),
  'top_skus', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'sku', t.sku, 'description', t.description, 'uom', t.uom,
             'qty', t.qty, 'pallets', t.pallets, 'bins', t.bins) order by t.qty desc, t.first_id), '[]'::jsonb)
    from top_skus t)
)
from bin_tally b, rack_tally rb, risky_tally r, nodate_tally n, staging_tally s,
     expired_tally e, later_tally l
$$;

-- Same gate as the other analytics RPCs (0095/0096): signed-in roles only.
revoke execute on function public.dashboard_summary(date, int, int, int, text[], numeric[]) from public, anon;
grant execute on function public.dashboard_summary(date, int, int, int, text[], numeric[]) to authenticated, service_role;

-- New function: PostgREST must re-read the schema cache.
notify pgrst, 'reload schema';
