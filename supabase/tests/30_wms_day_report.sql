-- Laporan WMS harian (0055): on hand, the day's picking, remain — Remain = On hand − PICK − b out + b in.
-- Runs in a transaction and rolls back. Batch 'TESTB' keeps the rows apart from the seed's stock.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Jakarta')::date $$;
create or replace function pg_temp.r(p_bin text) returns record language sql as $$
  select (on_hand, pick, b_out, b_in, putaway, adjust, remain) from wms_day_report(pg_temp.today()) where bin_code = p_bin and batch_lot = 'TESTB' $$;

-- Morning: the import puts a 44 pallet in CF39A01 (part of on hand: before picking).
select import_snapshot('[{"bin_code":"CF39A01","zone":"CF","rack":"39","level":"A","position":"01","sku":"550044709","batch_lot":"TESTB","quantity":44,"expiry_date":"2031-01-01"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan(pg_temp.today(), '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH1"],"planned_slot":"01:00"}],
  "tasks":[
    {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550044709","from_bin":"CF39A01","batch_lot":"TESTB","expiry_date":"2031-01-01","quantity":10,"pick_type":"CASE","breaks_pallet":true,"seq":1},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF39A01","to_bin":"CF39A02","batch_lot":"TESTB","expiry_date":"2031-01-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2}],
  "outbound":[{"wave_no":"1","shipment_number":"SH1","sku":"550044709","quantity_requested":10,"quantity_allocated":10}]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = pg_temp.today() and t.seq = p_seq $$;
select post_pick_with_move(pg_temp.t(1), pg_temp.t(2), null, null, null, 'Budi') \g /dev/null

select pg_temp.check('pallet bin: on hand 44, picked 10, moved out 34, remain 0 (import counted in on hand, shown as adjust 44)',
  pg_temp.r('CF39A01')::text = '(44,10,34,0,0,44,0)');
select pg_temp.check('pickface: on hand 0, moved in 34, remain 34',
  pg_temp.r('CF39A02')::text = '(0,0,0,34,0,0,34)');
select pg_temp.check('Remain = On hand − PICK − b out + b in on every row of the day',
  not exists (select 1 from wms_day_report(pg_temp.today()) where remain <> on_hand - pick - b_out + b_in));

-- The pick is undone the same day: not a stock correction, it is un-picking.
select unpost_task(pg_temp.t(1), 'Budi', 'truk ditunda') \g /dev/null
select pg_temp.check('after undoing the pick: picked 0, remain 10, on hand still 44',
  pg_temp.r('CF39A01')::text = '(44,0,34,0,0,44,10)');

select pg_temp.check('the day before: none of today''s pallet (its remain is that day''s stock, before the import)',
  not exists (select 1 from wms_day_report(pg_temp.today() - 1) where batch_lot = 'TESTB'));
rollback;
