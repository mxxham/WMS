-- A parked wave carried over under a new shipment number (0036). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;

delete from inventory where bin_id in (select id from bins where bin_code = 'CF38C01');
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550056224'), '12663924', 8, (select id from bins where bin_code = 'CF38C01'), '2030-06-23', 'fixture';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-10-15', '{
  "waves":[{"wave_no":"16","shipment_numbers":["109689769"]}],
  "tasks":[{"wave_no":"16","shipment_number":"109689769","task_type":"PICK","sku":"550056224","from_bin":"CF38C01","batch_lot":"12663924","expiry_date":"2030-06-23","quantity":3,"seq":1}],
  "outbound":[{"wave_no":"16","shipment_number":"109689769","sku":"550056224","order_nos":["538386834"],"quantity_requested":3,"quantity_allocated":3}]}'::jsonb);
create or replace function pg_temp.w() returns waves language sql as $$
  select w.* from waves w join outbound o on o.wave_id = w.id where '538386834' = any(o.order_nos) $$;

select pg_temp.check('carry: only a parked wave',
  pg_temp.fails(format($q$select carry_over_wave(%L, '2026-10-16', '{}')$q$, (pg_temp.w()).id), '%tidak sedang ditunda%'));
select set_wave_status((pg_temp.w()).id, 'RESCHEDULED', 'truk tidak datang');
select pg_temp.check('parked order listed for the next day with its Order No',
  exists (select 1 from parked_orders('2026-10-16') where shipment_number = '109689769' and '538386834' = any(order_nos) and quantity_requested = 3));
select pg_temp.check('its 3 stay reserved for the next day''s plan',
  (select quantity from planning_stock('2026-10-16') where bin_code = 'CF38C01' and sku = '550056224') = 5);

-- The next day's plan has its own NO 16 (another shipment).
reset role; drop table if exists _replace, _wave_ids; set role authenticated;
select save_plan('2026-10-16', '{
  "waves":[{"wave_no":"16","shipment_numbers":["109700001"]}],
  "tasks":[{"wave_no":"16","shipment_number":"109700001","task_type":"PICK","sku":"550056224","from_bin":"CF38C01","batch_lot":"12663924","expiry_date":"2030-06-23","quantity":5,"seq":1}],
  "outbound":[{"wave_no":"16","shipment_number":"109700001","sku":"550056224","quantity_requested":5,"quantity_allocated":5}]}'::jsonb);

select pg_temp.check('carry: unknown old shipment refused',
  pg_temp.fails(format($q$select carry_over_wave(%L, '2026-10-16', '{"999":"1"}')$q$, (pg_temp.w()).id), '%tidak ada di wave%'));
select pg_temp.check('carry: moved as T16 under the new shipment number',
  carry_over_wave((pg_temp.w()).id, '2026-10-16', '{"109689769":"109693399"}', 'jadwal ulang') @> '{"wave_no":"T16","to_date":"2026-10-16"}');
select pg_temp.check('carried wave: new date, active, shipment renamed on wave, task and order',
  (pg_temp.w()).planned_date = '2026-10-16' and (pg_temp.w()).status = 'PENDING' and (pg_temp.w()).shipment_numbers = '{109693399}'
  and (select shipment_number from pick_tasks where wave_id = (pg_temp.w()).id) = '109693399'
  and (select shipment_number = '109693399' and outbound_date = '2026-10-16' from outbound where wave_id = (pg_temp.w()).id));
select pg_temp.check('no longer parked', not exists (select 1 from parked_orders('2026-10-16')));
select pg_temp.check('both waves of the day together use the 8 in the bin, not more',
  (select sum(quantity) from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-16') = 8);
select pg_temp.check('carried wave can be posted',
  (post_task_by((select id from pick_tasks where wave_id = (pg_temp.w()).id), p_by_name => 'Budi')->>'result') = 'POSTED');

-- ---- Parked shipment back with a new item (0037) -----------------------------
reset role; reset request.jwt.claim.sub; drop table if exists _replace, _wave_ids;
delete from inventory where bin_id in (select id from bins where bin_code in ('CF37C01', 'CF37C02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = s), bt, q, (select id from bins where bin_code = b), '2031-01-01', 'fixture'
from (values ('CF37C01', '550024919', 'A1', 10), ('CF37C02', '550044709', 'B1', 10)) v(b, s, bt, q);
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-10-17', '{
  "waves":[{"wave_no":"5","shipment_numbers":["SX"]}],
  "tasks":[{"wave_no":"5","shipment_number":"SX","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"A1","expiry_date":"2031-01-01","quantity":4,"seq":1},
           {"wave_no":"5","shipment_number":"SX","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"A1","expiry_date":"2031-01-01","quantity":2,"seq":2}],
  "outbound":[{"wave_no":"5","shipment_number":"SX","sku":"550024919","order_nos":["O-0037-A"],"quantity_requested":6,"quantity_allocated":6}]}'::jsonb);
create or replace function pg_temp.x() returns waves language sql as $$
  select w.* from waves w join outbound o on o.wave_id = w.id where 'O-0037-A' = any(o.order_nos) $$;
-- 4 already picked, 2 still open when the wave is parked.
select post_task_by((select id from pick_tasks where wave_id = (pg_temp.x()).id and seq = 1), p_by_name => 'Budi');
select set_wave_status((pg_temp.x()).id, 'RESCHEDULED', 'tunda');
select pg_temp.check('parked: its open 2 stay reserved (10 - 4 picked - 2)',
  (select quantity from planning_stock('2026-10-18') where bin_code = 'CF37C01') = 4);
select pg_temp.check('released for a fresh plan: the open 2 count as free again',
  (select quantity from planning_stock('2026-10-18', array[(pg_temp.x()).id]) where bin_code = 'CF37C01') = 6);

-- Something picked: carry over, then the new item planned with the day moves in.
reset role; drop table if exists _replace, _wave_ids; set role authenticated;
select save_plan('2026-10-18', '{
  "waves":[{"wave_no":"5","shipment_numbers":["SX","SY"]}],
  "tasks":[{"wave_no":"5","shipment_number":"SX","task_type":"PICK","sku":"550044709","from_bin":"CF37C02","batch_lot":"B1","expiry_date":"2031-01-01","quantity":3,"seq":1},
           {"wave_no":"5","task_type":"REPLENISH","sku":"550044709","from_bin":"CF37C02","to_bin":"CF38C02","batch_lot":"B1","expiry_date":"2031-01-01","quantity":7,"seq":2},
           {"wave_no":"5","shipment_number":"SY","task_type":"PICK","sku":"550044709","from_bin":"CF37C02","batch_lot":"B1","expiry_date":"2031-01-01","quantity":0.5,"seq":3}],
  "outbound":[{"wave_no":"5","shipment_number":"SX","sku":"550044709","order_nos":["O-0037-B"],"quantity_requested":3,"quantity_allocated":3},
              {"wave_no":"5","shipment_number":"SY","sku":"550044709","quantity_requested":1,"quantity_allocated":1}]}'::jsonb);
select carry_over_wave((pg_temp.x()).id, '2026-10-18', '{}', 'lanjut');
select pg_temp.check('merge: the new item and its pallet move join the carried wave',
  merge_into_carried_wave((pg_temp.x()).id, 'SX') = '{"tasks": 2, "outbound": 1}'::jsonb);
select pg_temp.check('carried wave T5 has old + new item, new tasks numbered after the old ones',
  (select array_agg(seq order by seq) from pick_tasks where wave_id = (pg_temp.x()).id) = '{1,2,3,4}'
  and (select count(*) from outbound where wave_id = (pg_temp.x()).id) = 2 and (pg_temp.x()).wave_no = 'T5');
select pg_temp.check('the new plan''s NO 5 keeps only SY',
  (select shipment_numbers from waves where planned_date = '2026-10-18' and wave_no = '5') = '{SY}');
select pg_temp.check('merge twice moves nothing', merge_into_carried_wave((pg_temp.x()).id, 'SX') = '{"tasks": 0, "outbound": 0}'::jsonb);

rollback;
