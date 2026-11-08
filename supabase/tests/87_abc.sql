-- ABC classification runs with history (0126). Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a8711111-1111-1111-1111-111111111111','lead87@pengguna.internal','{"name":"Lead"}','{"username":"t87lead"}'),
  ('a8722222-2222-2222-2222-222222222222','op87@pengguna.internal','{"name":"Op"}','{"username":"t87op"}'),
  ('a8733333-3333-3333-3333-333333333333','adm87@pengguna.internal','{"name":"Adm"}','{"username":"t87adm"}');
update profiles set job = 'leader' where id = 'a8711111-1111-1111-1111-111111111111';
update profiles set job = 'operator' where id = 'a8722222-2222-2222-2222-222222222222';
update profiles set job = 'admin' where id = 'a8733333-3333-3333-3333-333333333333';

-- Three SKUs with stock to pick from: X picked 8 times, Y once, Z once in August 2026 (10 lines).
create temp table fx as
select distinct on (i.item_id) i.item_id, i.bin_id, i.batch_lot, i.expiry_date, it.sku
from inventory i join items it on it.id = i.item_id where i.quantity >= 20 order by i.item_id, i.quantity desc limit 3;
create temp table fxn as select row_number() over (order by sku) as n, * from fx;
grant select on fx, fxn to authenticated;
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note, created_at)
select 'picking'::movement_type, f.item_id, f.batch_lot, 1, f.bin_id, f.expiry_date, 'abc87', timestamptz '2026-08-10 09:00+07' + make_interval(hours => g)
from fxn f, generate_series(1, 8) g where f.n = 1
union all
select 'picking'::movement_type, f.item_id, f.batch_lot, 2, f.bin_id, f.expiry_date, 'abc87', timestamptz '2026-08-20 09:00+07'
from fxn f where f.n in (2, 3);
-- A pick at 23:30 on 31 Aug Jakarta (16:30 UTC) is still August; one at 00:30 on 1 Sep is not.
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note, created_at)
select 'picking'::movement_type, f.item_id, f.batch_lot, 1, f.bin_id, f.expiry_date, 'abc87', t
from fxn f, (values (timestamptz '2026-09-01 00:30+07')) v(t) where f.n = 3;
update items set abc_class = 'C' where id in (select item_id from fx);

set role authenticated;
select pg_temp.as_user('a8722222-2222-2222-2222-222222222222');
select pg_temp.check('an operator cannot run ABC',
  pg_temp.fails($q$select abc_run('2026-08-01', '2026-08-31', 'Op', true)$q$, '%Hanya Inventory, Leader atau Admin%'));

select pg_temp.as_user('a8711111-1111-1111-1111-111111111111');
select pg_temp.check('a period with no picking is refused, nothing stored',
  pg_temp.fails($q$select abc_run('2026-07-01', '2026-07-31', 'Lead', true)$q$, '%Tidak ada picking%')
  and not exists (select 1 from abc_runs where period_from = '2026-07-01'));
select pg_temp.check('a period into the future is refused',
  pg_temp.fails($q$select abc_run('2026-08-01', ((now() at time zone 'Asia/Jakarta')::date + 1), 'Lead', false)$q$, '%masa depan%'));
select pg_temp.check('a name is required',
  pg_temp.fails($q$select abc_run('2026-08-01', '2026-08-31', ' ', false)$q$, '%wajib diisi%'));

select set_config('t.run', abc_run('2026-08-01', '2026-08-31', 'Lead', false)::text, true);
create or replace function pg_temp.cls(p_n int) returns text language sql as $$
  select ri.class from abc_run_items ri join fxn f on f.item_id = ri.item_id
  where ri.run_id = current_setting('t.run')::uuid and f.n = p_n $$;
grant execute on function pg_temp.cls(int) to authenticated;

select pg_temp.check('the run counts the August picking lines only (10, not the 1 Sep pick)',
  (select total_lines = 10 and total_cartons = 12 from abc_runs where id = current_setting('t.run')::uuid));
select pg_temp.check('X (8 of 10 lines, crosses 80%) is A',  pg_temp.cls(1) = 'A');
select pg_temp.check('Y (cumulative 80% before it) is B',   pg_temp.cls(2) = 'B');
select pg_temp.check('Z (cumulative 90% before it) is B',   pg_temp.cls(3) = 'B');
select pg_temp.check('every other SKU, never picked, is C with 0 lines',
  not exists (select 1 from abc_run_items where run_id = current_setting('t.run')::uuid
              and item_id not in (select item_id from fx) and (class <> 'C' or pick_lines <> 0)));
select pg_temp.check('every item is in the run once, ranked 1..n without gaps',
  (select count(*) = (select count(*) from items) and max(rank) = count(*) and count(distinct rank) = count(*)
   from abc_run_items where run_id = current_setting('t.run')::uuid));
select pg_temp.check('shares and pick days are recorded (X: 0.8, cumulative 0.8, 1 day)',
  (select share = 0.8 and cum_share = 0.8 and pick_days = 1 and rank = 1 from abc_run_items ri join fxn f on f.item_id = ri.item_id
   where ri.run_id = current_setting('t.run')::uuid and f.n = 1));
select pg_temp.check('the previous class is kept on the run (C)',
  (select bool_and(prev_class = 'C') from abc_run_items where run_id = current_setting('t.run')::uuid and item_id in (select item_id from fx)));
select pg_temp.check('a preview does not change items',
  (select bool_and(abc_class = 'C') from items where id in (select item_id from fx)));

select abc_apply(current_setting('t.run')::uuid, 'Lead');
select pg_temp.check('applying puts the classes on items',
  (select abc_class from items where id = (select item_id from fxn where n = 1)) = 'A'
  and (select abc_class from items where id = (select item_id from fxn where n = 2)) = 'B');
select pg_temp.check('the run records who applied it',
  (select applied_at is not null and applied_by_name = 'Lead' from abc_runs where id = current_setting('t.run')::uuid));
select pg_temp.check('a run is applied once',
  pg_temp.fails(format($q$select abc_apply(%L, 'Lead')$q$, current_setting('t.run')), '%sudah diterapkan%'));
select pg_temp.check('an operator cannot apply',
  pg_temp.fails($q$select pg_temp.as_user('a8722222-2222-2222-2222-222222222222'); select abc_apply(gen_random_uuid(), 'Op')$q$, '%Hanya Inventory%'));
select pg_temp.as_user('a8711111-1111-1111-1111-111111111111');

select pg_temp.check('runs cannot be written directly',
  pg_temp.fails($q$insert into abc_runs (period_from, period_to, a_pct, b_pct, source, total_lines, total_cartons, sku_count, created_by_name)
                   values ('2026-01-01', '2026-01-31', 80, 95, 'MANUAL', 1, 1, 1, 'x')$q$, '%'));
reset role;
select pg_temp.check('history cannot be changed, even by the owner',
  pg_temp.fails($q$update abc_run_items set class = 'A' where run_id = current_setting('t.run')::uuid$q$, '%tidak bisa diubah%')
  and pg_temp.fails($q$update abc_runs set total_lines = 1 where id = current_setting('t.run')::uuid$q$, '%tidak bisa diubah%')
  and pg_temp.fails($q$delete from abc_runs where id = current_setting('t.run')::uuid$q$, '%tidak bisa diubah%'));

-- ---- Limits from the policy ---------------------------------------------------
insert into settings (key, value) values ('inventory_policy', '{"abc_a_pct": 70, "abc_b_pct": 90}')
  on conflict (key) do update set value = settings.value || '{"abc_a_pct": 70, "abc_b_pct": 90}';
set role authenticated;
select pg_temp.as_user('a8711111-1111-1111-1111-111111111111');
select set_config('t.run2', abc_run('2026-08-01', '2026-08-31', 'Lead', true)::text, true);
select pg_temp.check('the limits come from the policy and are stored on the run (70 / 90)',
  (select a_pct = 70 and b_pct = 90 from abc_runs where id = current_setting('t.run2')::uuid));
select pg_temp.check('with A at 70%, X (0 before it) is still A and Z (90% before it) becomes C',
  (select class from abc_run_items ri join fxn f on f.item_id = ri.item_id where ri.run_id = current_setting('t.run2')::uuid and f.n = 1) = 'A'
  and (select class from abc_run_items ri join fxn f on f.item_id = ri.item_id where ri.run_id = current_setting('t.run2')::uuid and f.n = 3) = 'C');
select pg_temp.check('the second run remembers the class the first one applied',
  (select prev_class from abc_run_items ri join fxn f on f.item_id = ri.item_id where ri.run_id = current_setting('t.run2')::uuid and f.n = 1) = 'A');
select pg_temp.as_user('a8733333-3333-3333-3333-333333333333');
select pg_temp.check('set_inventory_policy refuses A >= B',
  pg_temp.fails($q$select set_inventory_policy('{"abc_a_pct": 96}')$q$, '%Batas ABC%'));
select pg_temp.check('set_inventory_policy accepts 75 / 92',
  (set_inventory_policy('{"abc_a_pct": 75, "abc_b_pct": 92}')->>'abc_a_pct')::numeric = 75);
reset role;

-- ---- Monthly --------------------------------------------------------------------
-- Picking in the previous calendar month (Jakarta) for X.
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note, created_at)
select 'picking'::movement_type, f.item_id, f.batch_lot, 1, f.bin_id, f.expiry_date, 'abc87',
       (date_trunc('month', (now() at time zone 'Asia/Jakarta')::date) - interval '10 days')::timestamp at time zone 'Asia/Jakarta' + interval '9 hours'
from fxn f where f.n = 1;
set role authenticated;
select pg_temp.as_user('a8722222-2222-2222-2222-222222222222');
select set_config('t.auto', coalesce(abc_ensure_monthly()::text, ''), true);
select pg_temp.check('any active account triggers the monthly run, applied at once',
  (select source = 'AUTO' and applied_at is not null
          and period_from = date_trunc('month', date_trunc('month', (now() at time zone 'Asia/Jakarta')::date) - interval '1 day')::date
          and period_to = date_trunc('month', (now() at time zone 'Asia/Jakarta')::date)::date - 1
   from abc_runs where id = nullif(current_setting('t.auto'), '')::uuid));
select pg_temp.check('a second call does nothing',
  abc_ensure_monthly() is null
  and (select count(*) = 1 from abc_runs where source = 'AUTO'
       and period_from = date_trunc('month', date_trunc('month', (now() at time zone 'Asia/Jakarta')::date) - interval '1 day')::date));

rollback;
