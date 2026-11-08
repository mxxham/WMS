-- Volume keluar (0131): a pick counts on its wave's day, not on the day it was posted.
-- 8 Nov 2026: yesterday's wave posted this morning showed its litres on today.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when coalesce(ok, false) then 'PASS' else 'FAIL' end, label; end $$;
grant execute on function pg_temp.check(text, boolean) to authenticated;
delete from inventory v using items i where i.id = v.item_id and i.sku = '550058593';
update items set volume_l = 4 where sku = '550058593';
-- A wave day far from the real clock, so "posted today" can never be the same day.
create temp table d as select date '2026-12-06' as wave_day, (now() at time zone 'Asia/Jakarta')::date as today;
grant select on d to authenticated;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select import_snapshot('[
 {"bin_code":"CC27D02","zone":"CC","rack":"27","level":"D","position":"02","sku":"550058593","batch_lot":"A","quantity":48,"expiry_date":"2030-09-10"}]'::jsonb, false, 'uji92') \g /dev/null
select save_plan('2026-12-06', '{
  "waves":[{"wave_no":"1","shipment_numbers":["S1"],"planned_slot":"08:00"}],
  "tasks":[{"wave_no":"1","shipment_number":"S1","task_type":"PICK","sku":"550058593","from_bin":"CC27D02","batch_lot":"A","expiry_date":"2030-09-10","quantity":10,"pick_type":"CASE","seq":1}]}'::jsonb) \g /dev/null
create temp table before_today as
  select coalesce((select boxes from volume_out_daily where day = (select today from d)), 0) as boxes;

select post_task_by((select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-12-06' and w.wave_no = '1'),
  null, null, null, null, null, 'Sup', 'CC27D02') \g /dev/null

select pg_temp.check('the pick counts on its wave day: 10 cartons, 40 L',
  (select boxes = 10 and litres = 40 from volume_out_daily where day = (select wave_day from d)));
select pg_temp.check('and not on the day it was posted',
  coalesce((select boxes from volume_out_daily where day = (select today from d)), 0) = (select boxes from before_today));

-- A picking movement without a task (none today, but the ledger allows it) keeps its posting day.
reset role;
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note)
select 'picking', i.id, 'A', 2, b.id, '2030-09-10', 'uji92 tanpa task'
from items i, bins b where i.sku = '550058593' and b.bin_code = 'CC27D02';
select pg_temp.check('a pick without a wave stays on its posting day',
  coalesce((select boxes from volume_out_daily where day = (select today from d)), 0) = (select boxes from before_today) + 2);

rollback;
