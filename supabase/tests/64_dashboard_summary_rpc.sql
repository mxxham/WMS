-- 0098: dashboard_summary() replaces the dashboard's two full-table fetches
-- (bin_summary, one row per bin; inventory_detail, one row per stock identity)
-- plus the aggregates the page used to compute in JavaScript. The numbers must
-- still be the ones the page shows, so every field is compared against an
-- independent manual aggregate over the same views — for the seed and for a
-- fixture that exercises the branches the seed does not (staging with and
-- without a received date, stock inside the 90-day window, stock past it, a row
-- without an expiry date). Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

-- The page's own anchor: the Jakarta calendar date (lib/inventory-view jakartaDate).
create or replace function pg_temp.today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Jakarta')::date
$$;

-- ---- Fixture --------------------------------------------------------------
-- Written straight into inventory because this test rolls back before anyone
-- posts a movement; the dashboard reads inventory_detail either way.
delete from public.inventory where bin_id in
  (select id from public.bins where bin_code in ('STG_01', 'STG_02', 'CA01A01'));

insert into public.inventory (bin_id, item_id, batch_lot, quantity, expiry_date, received_date)
select b.id, i.id, f.batch, f.qty, f.exp, f.recv
from (values
  -- staging: today / 1 day / 9 days / no received date
  ('STG_01', '550024919', 'FIX-STG0', 2::numeric, null, pg_temp.today()),
  ('STG_01', '550024921', 'FIX-STG1', 6::numeric, null, pg_temp.today() - 1),
  ('STG_02', '550024929', 'FIX-STG9', 5::numeric, null, pg_temp.today() - 9),
  ('STG_02', '550024919', 'FIX-STGN', 4::numeric, null, null),
  -- rack: inside the 90-day window (x2), past it, and no expiry at all
  ('CA01A01', '550024919', 'FIX-10',  4::numeric, current_date + 10,  current_date - 2),
  ('CA01A01', '550024921', 'FIX-89',  7::numeric, current_date + 89,  current_date - 2),
  ('CA01A01', '550024929', 'FIX-200', 3::numeric, current_date + 200, current_date - 2),
  ('CA01A01', '550024919', 'FIX-NOEX', 1::numeric, null,              current_date - 2)
) as f(bin, sku, batch, qty, exp, recv)
join public.bins b on b.bin_code = f.bin
join public.items i on i.sku = f.sku;

-- One call, exactly as app/(app)/dashboard/page.tsx makes it: today = Jakarta,
-- near expiry from config/warehouse.ts (90, not inventory_policy's 180), two
-- years of monthly buckets, 25 risky rows, shelf edges from SHELF_BUCKETS.
create or replace function pg_temp.summary() returns jsonb language sql stable as $$
  select public.dashboard_summary(
    pg_temp.today(), 90, 2, 25,
    array['expired', 'd90', 'd180', 'd365', 'y2', 'y3', 'more', 'none'],
    array[-1, 90, 180, 365, 730, 1095]::numeric[])
$$;

create temp table dash on commit drop as select pg_temp.summary() as j;
create or replace function pg_temp.f(variadic p_path text[]) returns text language sql stable as $$
  select jsonb_extract_path_text((select j from dash), variadic p_path)
$$;

-- ---- Occupancy: bins, rack positions, one known aisle ----------------------
-- Manual: one row per bin, occupied when the stock it holds is > 0 (a zero-quantity
-- row is not an occupied position — 129 bins in the live data carry one).
create or replace function pg_temp.rack_bins() returns table (zone text, level text, occupied boolean)
language sql stable as $$
  select b.zone, b.level, coalesce(sum(i.quantity), 0) > 0
  from public.bins b left join public.inventory i on i.bin_id = b.id
  where b.rack is not null and b.rack <> '' and b.zone not in ('CG', 'CH')
  group by b.id
$$;

select pg_temp.check('bins.total counts every bin',
  pg_temp.f('bins', 'total')::int = (select count(*) from public.bin_summary));
select pg_temp.check('bins.occupied counts bins holding stock',
  pg_temp.f('bins', 'occupied')::int = (select count(*) from public.bin_summary where total_qty > 0));
select pg_temp.check('bins.blocked counts blocked bins',
  pg_temp.f('bins', 'blocked')::int = (select count(*) from public.bin_summary where status = 'blocked'));
select pg_temp.check('bins.rack_total keeps floor + CKB 3PL aisles out',
  pg_temp.f('bins', 'rack_total')::int = (select count(*) from pg_temp.rack_bins()));
select pg_temp.check('bins.rack_occupied counts occupied rack positions only',
  pg_temp.f('bins', 'rack_occupied')::int = (select count(*) from pg_temp.rack_bins() where occupied));
select pg_temp.check('zones lists every rack aisle once, in byte order',
  (select array_agg(z order by z) from (select distinct zone collate "C" as z from pg_temp.rack_bins()) t)
  = (select array_agg(e->>'zone' order by o) from jsonb_array_elements((select j->'zones' from dash)) with ordinality as a(e, o)));
select pg_temp.check('zone CA total equals manual rack positions',
  (select (e->>'total')::int from jsonb_array_elements((select j->'zones' from dash)) e where e->>'zone' = 'CA')
  = (select count(*) from pg_temp.rack_bins() where zone = 'CA'));
select pg_temp.check('zone CA occupied equals manual occupied positions',
  (select (e->>'occ')::int from jsonb_array_elements((select j->'zones' from dash)) e where e->>'zone' = 'CA')
  = (select count(*) from pg_temp.rack_bins() where zone = 'CA' and occupied));
select pg_temp.check('zone CA level A cell equals manual',
  (select (c->>'occ')::int from jsonb_array_elements((select j->'zones' from dash)) e,
          jsonb_array_elements(e->'cells') c
    where e->>'zone' = 'CA' and c->>'level' = 'A')
  = (select count(*) from pg_temp.rack_bins() where zone = 'CA' and level = 'A' and occupied));
select pg_temp.check('levels B total equals manual rack positions at level B',
  (select (e->>'total')::int from jsonb_array_elements((select j->'levels' from dash)) e where e->>'level' = 'B')
  = (select count(*) from pg_temp.rack_bins() where level = 'B'));

-- ---- Stock by ABC class ---------------------------------------------------
select pg_temp.check('abc quantities match manual per class',
  (select jsonb_object_agg(e->>'k', (e->>'qty')::numeric) from jsonb_array_elements((select j->'abc' from dash)) e)
  = (select jsonb_object_agg(k, coalesce((select sum(quantity) from public.inventory_detail
                                           where coalesce(item_abc, '–') = k), 0))
     from unnest(array['A', 'B', 'C', '–']) k));
select pg_temp.check('abc SKU counts match manual per class',
  (select jsonb_object_agg(e->>'k', (e->>'skus')::int) from jsonb_array_elements((select j->'abc' from dash)) e)
  = (select jsonb_object_agg(k, (select count(distinct sku) from public.inventory_detail
                                  where coalesce(item_abc, '–') = k))
     from unnest(array['A', 'B', 'C', '–']) k));
select pg_temp.check('abc keeps the four classes in A, B, C, tanpa kelas order',
  (select array_agg(e->>'k' order by o) from jsonb_array_elements((select j->'abc' from dash)) with ordinality as a(e, o))
  = array['A', 'B', 'C', '–']);

-- ---- Near expiry: counts, split and the printed rows ----------------------
create or replace function pg_temp.risky(p_days int default 90) returns table (id uuid, bin_code text, batch_lot text, quantity numeric, days_remaining int)
language sql stable as $$
  select id, bin_code, batch_lot, quantity, days_remaining
  from public.inventory_detail
  where days_remaining is not null and days_remaining <= p_days
$$;

select pg_temp.check('risky.count equals the rows in the near-expiry window',
  pg_temp.f('risky', 'count')::int = (select count(*) from pg_temp.risky()));
select pg_temp.check('risky.qty equals the cartons in the window',
  pg_temp.f('risky', 'qty')::numeric = (select coalesce(sum(quantity), 0) from pg_temp.risky()));
select pg_temp.check('risky splits into expired and near, and the halves add up',
  pg_temp.f('risky', 'expired_count')::int
    = (select count(*) from pg_temp.risky() where days_remaining < 0)
  and pg_temp.f('risky', 'near_count')::int
    = (select count(*) from pg_temp.risky() where days_remaining >= 0)
  and pg_temp.f('risky', 'expired_count')::int + pg_temp.f('risky', 'near_count')::int
    = pg_temp.f('risky', 'count')::int);
select pg_temp.check('risky.near_skus counts distinct SKUs inside the window',
  pg_temp.f('risky', 'near_skus')::int
    = (select count(distinct sku) from public.inventory_detail where days_remaining >= 0 and days_remaining <= 90));
select pg_temp.check('risky.near_min_days is the shortest life left',
  pg_temp.f('risky', 'near_min_days')::int
    = (select min(days_remaining) from public.inventory_detail where days_remaining >= 0 and days_remaining <= 90));
select pg_temp.check('risky.rows stops at the 25 the table prints',
  jsonb_array_length((select j->'risky'->'rows' from dash)) = least(25, (select count(*) from pg_temp.risky())));
select pg_temp.check('risky.rows starts with the nearest expiry',
  (select (e->>'days_remaining')::int from jsonb_array_elements((select j->'risky'->'rows' from dash)) with ordinality as a(e, o) where o = 1)
  = (select min(days_remaining) from pg_temp.risky()));
select pg_temp.check('risky.rows is nearest-first, ties broken by id',
  (select jsonb_agg(jsonb_build_object('bin_code', bin_code, 'batch_lot', batch_lot, 'days_remaining', days_remaining))
   from (select * from pg_temp.risky() order by days_remaining, id limit 25) t)
  = (select jsonb_agg(jsonb_build_object('bin_code', e->>'bin_code', 'batch_lot', e->>'batch_lot',
                                         'days_remaining', (e->>'days_remaining')::int))
     from jsonb_array_elements((select j->'risky'->'rows' from dash)) e));
select pg_temp.check('the 89-day fixture is in the printed rows, the 200-day one is not',
  (select count(*) from jsonb_array_elements((select j->'risky'->'rows' from dash)) e where e->>'batch_lot' = 'FIX-89') = 1
  and (select count(*) from jsonb_array_elements((select j->'risky'->'rows' from dash)) e where e->>'batch_lot' = 'FIX-200') = 0);

-- ---- Rows without an expiry date -----------------------------------------
select pg_temp.check('no_date rows/qty match manual',
  pg_temp.f('stock', 'no_date_rows')::int = (select count(*) from public.inventory_detail where expiry_date is null)
  and pg_temp.f('stock', 'no_date_qty')::numeric
    = (select coalesce(sum(quantity), 0) from public.inventory_detail where expiry_date is null));

-- ---- Staging aging --------------------------------------------------------
select pg_temp.check('staging rows/qty match manual for zone STAGING',
  pg_temp.f('staging', 'rows')::int = (select count(*) from public.inventory_detail where zone = 'STAGING')
  and pg_temp.f('staging', 'qty')::numeric
    = (select coalesce(sum(quantity), 0) from public.inventory_detail where zone = 'STAGING'));
select pg_temp.check('staging oldest date is the earliest received_date',
  pg_temp.f('staging', 'oldest_received_date')::date
    = (select min(received_date) from public.inventory_detail where zone = 'STAGING' and received_date is not null));
select pg_temp.check('staging aging buckets match manual, weighted by cartons',
  pg_temp.f('staging', 'aging', 'lt1')::numeric
    = (select coalesce(sum(quantity), 0) from public.inventory_detail
        where zone = 'STAGING' and received_date is not null and pg_temp.today() - received_date <= 0)
  and pg_temp.f('staging', 'aging', 'd1_2')::numeric
    = (select coalesce(sum(quantity), 0) from public.inventory_detail
        where zone = 'STAGING' and received_date is not null and pg_temp.today() - received_date between 1 and 2)
  and pg_temp.f('staging', 'aging', 'd3p')::numeric
    = (select coalesce(sum(quantity), 0) from public.inventory_detail
        where zone = 'STAGING' and received_date is not null and pg_temp.today() - received_date > 2));
select pg_temp.check('staging aging leaves the dateless row out of every bucket',
  pg_temp.f('staging', 'aging', 'lt1')::numeric + pg_temp.f('staging', 'aging', 'd1_2')::numeric
    + pg_temp.f('staging', 'aging', 'd3p')::numeric
  = (select coalesce(sum(quantity), 0) from public.inventory_detail
      where zone = 'STAGING' and received_date is not null));

-- ---- Shelf life -----------------------------------------------------------
select pg_temp.check('shelf keeps every SHELF_BUCKETS key in order',
  (select array_agg(e->>'key' order by o) from jsonb_array_elements((select j->'shelf' from dash)) with ordinality as a(e, o))
  = array['expired', 'd90', 'd180', 'd365', 'y2', 'y3', 'more', 'none']);
select pg_temp.check('shelf holds every carton once',
  (select sum((e->>'qty')::numeric) from jsonb_array_elements((select j->'shelf' from dash)) e)
  = (select coalesce(sum(quantity), 0) from public.inventory_detail));
select pg_temp.check('shelf expired / d90 / d180 edges match manual',
  (select (e->>'qty')::numeric from jsonb_array_elements((select j->'shelf' from dash)) e where e->>'key' = 'expired')
    = (select coalesce(sum(quantity), 0) from public.inventory_detail where days_remaining <= -1)
  and (select (e->>'qty')::numeric from jsonb_array_elements((select j->'shelf' from dash)) e where e->>'key' = 'd90')
    = (select coalesce(sum(quantity), 0) from public.inventory_detail where days_remaining between 0 and 90)
  and (select (e->>'qty')::numeric from jsonb_array_elements((select j->'shelf' from dash)) e where e->>'key' = 'd180')
    = (select coalesce(sum(quantity), 0) from public.inventory_detail where days_remaining between 91 and 180));
select pg_temp.check('shelf "tanpa tanggal" equals the rows with no expiry date',
  (select (e->>'rows')::int from jsonb_array_elements((select j->'shelf' from dash)) e where e->>'key' = 'none')
    = (select count(*) from public.inventory_detail where expiry_date is null)
  and (select (e->>'qty')::numeric from jsonb_array_elements((select j->'shelf' from dash)) e where e->>'key' = 'none')
    = (select coalesce(sum(quantity), 0) from public.inventory_detail where expiry_date is null));
select pg_temp.check('shelf "> 3 tahun" is everything past 1095 days',
  (select (e->>'qty')::numeric from jsonb_array_elements((select j->'shelf' from dash)) e where e->>'key' = 'more')
    = (select coalesce(sum(quantity), 0) from public.inventory_detail where days_remaining > 1095));

-- ---- Expiry calendar ------------------------------------------------------
create or replace function pg_temp.cal_start() returns date language sql stable as $$
  select date_trunc('month', pg_temp.today()::timestamp)::date
$$;
select pg_temp.check('expiry.expired_qty matches manual for expiry_date < today (Jakarta)',
  pg_temp.f('expiry', 'expired_qty')::numeric
    = (select coalesce(sum(quantity), 0) from public.inventory_detail
        where expiry_date is not null and expiry_date < pg_temp.today()));
select pg_temp.check('expiry.later_qty matches manual outside the two-year window',
  pg_temp.f('expiry', 'later_qty')::numeric
    = (select coalesce(sum(quantity), 0) from public.inventory_detail
        where expiry_date >= (pg_temp.cal_start() + interval '24 months')::date));
select pg_temp.check('expiry has 24 monthly buckets for the default 2-year range',
  jsonb_array_length((select j->'expiry'->'buckets' from dash)) = 24
  and (select e->>'ym' from jsonb_array_elements((select j->'expiry'->'buckets' from dash)) with ordinality as a(e, o) where o = 1)
    = to_char(pg_temp.cal_start()::timestamp, 'YYYY-MM'));
select pg_temp.check('expiry buckets + expired + later add up to every dated carton',
  (select sum((e->>'qty')::numeric) from jsonb_array_elements((select j->'expiry'->'buckets' from dash)) e)
    + pg_temp.f('expiry', 'expired_qty')::numeric + pg_temp.f('expiry', 'later_qty')::numeric
  = (select coalesce(sum(quantity), 0) from public.inventory_detail where expiry_date is not null));
select pg_temp.check('expiry bucket of the 10-day fixture equals the manual month total',
  (select (e->>'qty')::numeric from jsonb_array_elements((select j->'expiry'->'buckets' from dash)) e
    where e->>'ym' = to_char((current_date + 10)::timestamp, 'YYYY-MM'))
  = (select coalesce(sum(quantity), 0) from public.inventory_detail
      where expiry_date is not null and to_char(expiry_date, 'YYYY-MM') = to_char((current_date + 10)::timestamp, 'YYYY-MM')));

-- ---- Top SKUs -------------------------------------------------------------
select pg_temp.check('top_skus prints 10 SKUs, largest stock first',
  jsonb_array_length((select j->'top_skus' from dash)) = 10
  and (select (e->>'qty')::numeric from jsonb_array_elements((select j->'top_skus' from dash)) with ordinality as a(e, o) where o = 1)
    = (select max(q) from (select sum(quantity) as q from public.inventory_detail group by sku) t));
select pg_temp.check('top SKUs are ordered by quantity descending',
  (select bool_and(prev >= cur) from (
     select (e->>'qty')::numeric as cur,
            lag((e->>'qty')::numeric) over (order by o) as prev
     from jsonb_array_elements((select j->'top_skus' from dash)) with ordinality as a(e, o)) t));
select pg_temp.check('top SKU cartons, pallets and bin count match manual',
  pg_temp.f('top_skus', '0', 'qty')::numeric
    = (select sum(quantity) from public.inventory_detail
        where sku = (select j->'top_skus'->0->>'sku' from dash))
  and pg_temp.f('top_skus', '0', 'bins')::int
    = (select count(distinct bin_code) from public.inventory_detail
        where sku = (select j->'top_skus'->0->>'sku' from dash))
  and pg_temp.f('top_skus', '0', 'pallets')::numeric
    = (select coalesce(sum(case when upp is not null and upp <> 0 then quantity / upp else 0 end), 0)
       from public.inventory_detail where sku = (select j->'top_skus'->0->>'sku' from dash)));
select pg_temp.check('top SKU label comes from the item master, not the row order',
  pg_temp.f('top_skus', '0', 'description') = (select description from public.items
     where sku = (select j->'top_skus'->0->>'sku' from dash))
  and pg_temp.f('top_skus', '0', 'uom') is not distinct from (select uom from public.items
     where sku = (select j->'top_skus'->0->>'sku' from dash)));

-- ---- Parameters actually drive the answer ---------------------------------
select pg_temp.check('p_near_expiry_days narrows the risky window',
  (public.dashboard_summary(pg_temp.today(), 0, 2, 25,
     array['expired', 'd90', 'd180', 'd365', 'y2', 'y3', 'more', 'none'],
     array[-1, 90, 180, 365, 730, 1095]::numeric[])->'risky'->>'count')::int
  = (select count(*) from pg_temp.risky(0)));
select pg_temp.check('p_risky_limit caps the rows without changing the counts',
  jsonb_array_length(public.dashboard_summary(pg_temp.today(), 90, 2, 2,
    array['expired', 'd90', 'd180', 'd365', 'y2', 'y3', 'more', 'none'],
    array[-1, 90, 180, 365, 730, 1095]::numeric[])->'risky'->'rows') = 2
  and (public.dashboard_summary(pg_temp.today(), 90, 2, 2,
        array['expired', 'd90', 'd180', 'd365', 'y2', 'y3', 'more', 'none'],
        array[-1, 90, 180, 365, 730, 1095]::numeric[])->'risky'->>'count')::int
    = (select count(*) from pg_temp.risky()));
select pg_temp.check('p_cal_years = 5 switches the calendar to 20 quarters',
  jsonb_array_length(public.dashboard_summary(pg_temp.today(), 90, 5, 25,
    array['expired', 'd90', 'd180', 'd365', 'y2', 'y3', 'more', 'none'],
    array[-1, 90, 180, 365, 730, 1095]::numeric[])->'expiry'->'buckets') = 20
  and (public.dashboard_summary(pg_temp.today(), 90, 5, 25,
        array['expired', 'd90', 'd180', 'd365', 'y2', 'y3', 'more', 'none'],
        array[-1, 90, 180, 365, 730, 1095]::numeric[])->'expiry'->'buckets'->0->>'ym')
    = to_char(date_trunc('quarter', pg_temp.today()::timestamp), 'YYYY-"Q"Q'));

-- ---- Empty config: no settings row, no policy needed ----------------------
delete from public.settings where key = 'inventory_policy';
select pg_temp.check('dashboard_summary still answers with no inventory_policy row',
  jsonb_typeof(public.dashboard_summary()) = 'object'
  and (public.dashboard_summary()->'bins'->>'total')::int = (select count(*) from public.bin_summary)
  and (public.dashboard_summary()->'risky'->>'count')::int = (select count(*) from pg_temp.risky()));

-- ---- Shape: invoker, stable, pinned search_path, grants -------------------
select pg_temp.check('dashboard_summary is security invoker, stable, search_path = public',
  (select not p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=public']
     from pg_proc p
    where p.oid = 'public.dashboard_summary(date,integer,integer,integer,text[],numeric[])'::regprocedure));
select pg_temp.check('dashboard_summary executable by authenticated',
  has_function_privilege('authenticated', 'public.dashboard_summary(date,integer,integer,integer,text[],numeric[])', 'execute'));
select pg_temp.check('dashboard_summary NOT executable by anon',
  not has_function_privilege('anon', 'public.dashboard_summary(date,integer,integer,integer,text[],numeric[])', 'execute'));
select pg_temp.check('dashboard_summary NOT executable by PUBLIC',
  (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p
    where p.oid = 'public.dashboard_summary(date,integer,integer,integer,text[],numeric[])'::regprocedure));

rollback;
