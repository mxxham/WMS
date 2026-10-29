-- SAP comparison against the daily report's on hand (0113).
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
-- "Today" (WIB): a putaway of 3 and a pick of 5. The on hand of today keeps
-- the putaway and adds the pick back, exactly like Laporan WMS harian.
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
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Jakarta')::date $$;
create or replace function pg_temp.now_phys(p_sku text) returns numeric language sql as $$
  select coalesce((select physical from wms_stock_by_sku() where sku = p_sku), 0) $$;
create or replace function pg_temp.day_phys(p_sku text) returns numeric language sql as $$
  select coalesce((select physical from wms_stock_by_sku_day(pg_temp.today()) where sku = p_sku), 0) $$;
create or replace function pg_temp.line(p_sku text) returns public.stock_recon_lines language sql as $$
  select * from stock_recon_lines where recon_id = current_setting('t.rec')::uuid and sku = p_sku $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.as_user(uuid), pg_temp.today(),
  pg_temp.now_phys(text), pg_temp.day_phys(text), pg_temp.line(text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a7511111-1111-1111-1111-111111111111','inv75@pengguna.internal','{"name":"Inv"}','{"username":"t75inv"}');
update profiles set job = 'inventory' where id = 'a7511111-1111-1111-1111-111111111111';

select set_config('t.before', pg_temp.now_phys('550058593')::text, true);
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note) values
  ('putaway', (select id from items where sku = '550058593'), 'T75', 3, (select id from bins where bin_code = 'CF39C02'), '2031-01-01', 't75');
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, note) values
  ('picking', (select id from items where sku = '550058593'), '15I26JJ', 5, (select id from bins where bin_code = 'CC22C01'), 't75');

select pg_temp.check('now = before + putaway 3 - pick 5', pg_temp.now_phys('550058593') = current_setting('t.before')::numeric - 2);
select pg_temp.check('on hand of today keeps the putaway and adds the pick back',
  pg_temp.day_phys('550058593') = current_setting('t.before')::numeric + 3);
select pg_temp.check('on hand per SKU = the sum of Qty (on hand) in wms_day_report',
  pg_temp.day_phys('550058593') = (select sum(on_hand) from wms_day_report(pg_temp.today()) where sku = '550058593'));
select pg_temp.check('every SKU agrees with the report',
  not exists (select 1 from (select sku, sum(on_hand) q from wms_day_report(pg_temp.today()) group by sku having sum(on_hand) <> 0) r
              full join wms_stock_by_sku_day(pg_temp.today()) d on d.sku = r.sku
              where coalesce(r.q, 0) <> coalesce(d.physical, 0)));

-- A shipment picked today whose GI SAP already posted: today's pick is added back, so it is timing.
insert into waves (id, wave_no, planned_date, shipment_numbers, status) values
  ('a7522222-2222-2222-2222-222222222222', '75', pg_temp.today(), '{SH75}', 'COMPLETED');
insert into outbound (outbound_date, wave_id, shipment_number, sku, item_id, order_nos, quantity_requested, quantity_allocated, status) values
  (pg_temp.today(), 'a7522222-2222-2222-2222-222222222222', 'SH75', '550058593', (select id from items where sku = '550058593'), '{538375000}', 5, 5, 'COMPLETED');
insert into pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, expiry_date, quantity, actual_quantity, seq, status, completed_at)
values ('a7522222-2222-2222-2222-222222222222', 'SH75', 'PICK', (select id from items where sku = '550058593'),
        (select id from bins where bin_code = 'CC22C01'), '2030-09-15', 5, 5, 1, 'COMPLETED', now());

set role authenticated;
select pg_temp.as_user('a7511111-1111-1111-1111-111111111111');
select set_config('t.rec', create_stock_recon_mb52(pg_temp.today(), 'MB52.xlsx', null,
  '[{"sku":"550058593","uom":"CAR","unrestricted":100,"blocked":0}]', '[]', '{WHS1}',
  format('[{"line_no":2,"sku":"550058593","sloc":"WHS1","mvt_type":"601","quantity":-5,"reference":"0538375000","posting_date":"%s"}]', pg_temp.today())::jsonb,
  '[]', 'Inv', null, pg_temp.today())::text, true);

select pg_temp.check('recon compares the on hand of the day',
  (pg_temp.line('550058593')).wms_unrestricted + (pg_temp.line('550058593')).wms_blocked = current_setting('t.before')::numeric + 3);
select pg_temp.check('the day is recorded, no cut-off time',
  (select wms_day = pg_temp.today() and wms_at is null from stock_recon_summary where id = current_setting('t.rec')::uuid));
select pg_temp.check('shipments: today''s pick is added back -> GI 5, picked 0, timing -5',
  (select status = 'SAP_MORE' and picked = 0 and timing = -5 from recon_shipment_match(current_setting('t.rec')::uuid) where shipment_number = 'SH75'));
select pg_temp.check('a day in the future is refused',
  pg_temp.fails($q$select create_stock_recon_mb52(current_date, 'x', null, '[{"sku":"550058593","unrestricted":1}]', '[]', '{WHS1}', '[]', '[]', 'Inv', null, current_date + 2)$q$, '%masa depan%'));
select pg_temp.check('cut-off time and day together are refused',
  pg_temp.fails($q$select create_stock_recon_mb52(current_date, 'x', null, '[{"sku":"550058593","unrestricted":1}]', '[]', '{WHS1}', '[]', '[]', 'Inv', now() - interval '1 hour', current_date - 1)$q$, '%tidak keduanya%'));
select pg_temp.check('0112 cut-off still works through the same function',
  create_stock_recon_mb52(current_date, 'x', null, '[{"sku":"550058593","unrestricted":1}]', '[]', '{WHS1}', '[]', '[]', 'Inv', now() - interval '1 microsecond') is not null);
reset role;
select pg_temp.check('anon cannot execute wms_stock_by_sku_day',
  not has_function_privilege('anon', 'public.wms_stock_by_sku_day(date)', 'execute'));
rollback;
