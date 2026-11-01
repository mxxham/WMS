-- Every audited item carries its own DO, by one rule (0124).
-- save_plan stores a pick's DO split (pick_task_orders) and each DO's cartons
-- (outbound.order_qtys); task_do_nos reads them for pick_audit_line,
-- pick_audit_move and pick_task_detail alike. Runs in a transaction and rolls
-- back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.task(p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-12-01' and t.seq = p_seq $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text), pg_temp.task(int) to authenticated;

-- ---- The plan (as plan.ts builds it) ------------------------------------------
-- S1 orders 550044709 on DO A (20) and DO B (15): pick 1 takes 30 (A 20 + B 10), its pallet rest
-- moves right after (seq 2), pick 3 takes the last 5 of B. S2's pick has no split (a plan
-- saved before 0124): it falls back to its outbound DOs. A move at seq 7 follows no pick (seq 6 is empty).
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select save_plan('2026-12-01', '{
  "waves":[{"wave_no":"1","shipment_numbers":["S1","S2"]}],
  "tasks":[
    {"wave_no":"1","shipment_number":"S1","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":30,"seq":1,
     "orders":[{"order_no":"A","qty":20},{"order_no":" B ","qty":10},{"order_no":"","qty":3},{"order_no":"Z","qty":0}]},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":4,"seq":2},
    {"wave_no":"1","shipment_number":"S1","task_type":"PICK","sku":"550044709","from_bin":"CF38C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":5,"seq":3,
     "orders":[{"order_no":"B","qty":2},{"order_no":"B","qty":3}]},
    {"wave_no":"1","shipment_number":"S2","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":3,"seq":4},
    {"wave_no":"1","shipment_number":"S2","task_type":"PICK","sku":"550044709","from_bin":"CF37C02","batch_lot":"A7","expiry_date":"2031-05-05","quantity":1,"seq":5,
     "orders":[{"order_no":"Q","qty":1}]},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550024919","from_bin":"CF37C01","to_bin":"CF37C02","batch_lot":"C1","expiry_date":"2031-07-07","quantity":2,"seq":7}],
  "outbound":[
    {"wave_no":"1","shipment_number":"S1","sku":"550044709","quantity_requested":35,"quantity_allocated":35,
     "order_nos":["A","B"],"order_qtys":[{"order_no":"A","qty":20},{"order_no":"B","qty":15}]},
    {"wave_no":"1","shipment_number":"S2","sku":"550024919","quantity_requested":3,"quantity_allocated":3,
     "order_nos":["Z2"," Z1 ","Z2"]},
    {"wave_no":"1","shipment_number":"S2","sku":"550044709","quantity_requested":1,"quantity_allocated":1,"order_nos":["Q"]}]}'::jsonb) \g /dev/null

-- ---- Stored ------------------------------------------------------------------
select pg_temp.check('save_plan: a pick''s DOs in fill order, trimmed, blank and zero entries dropped',
  (select array_agg(order_no || ':' || qty order by ord) from pick_task_orders where task_id = pg_temp.task(1)) = '{A:20,B:10}');
select pg_temp.check('save_plan: the same DO twice adds up',
  (select array_agg(order_no || ':' || qty order by ord) from pick_task_orders where task_id = pg_temp.task(3)) = '{B:5}');
select pg_temp.check('save_plan: a pick without a split and a move store no DO rows',
  not exists (select 1 from pick_task_orders where task_id in (pg_temp.task(2), pg_temp.task(4))));
select pg_temp.check('save_plan: each DO''s cartons on the demand line',
  (select order_qtys from outbound o join waves w on w.id = o.wave_id
   where w.planned_date = '2026-12-01' and o.shipment_number = 'S1') = '[{"qty": 20, "order_no": "A"}, {"qty": 15, "order_no": "B"}]'::jsonb);
select pg_temp.check('pick_task_orders: no direct write',
  pg_temp.fails($q$insert into pick_task_orders (task_id, ord, order_no, qty) values (pg_temp.task(4), 1, 'X', 1)$q$));

-- ---- The one rule --------------------------------------------------------------
select pg_temp.check('rule: a split pick shows exactly its own DOs',
  task_do_nos(pg_temp.task(1)) = '{A,B}' and task_do_nos(pg_temp.task(3)) = '{B}');
select pg_temp.check('rule: an unsplit pick falls back to its shipment + SKU''s DOs, first-seen order',
  task_do_nos(pg_temp.task(4)) = '{Z2,Z1}');
select pg_temp.check('rule: a move follows the pick it is the pallet rest of',
  move_pick(pg_temp.task(2)) = pg_temp.task(1) and task_do_nos(pg_temp.task(2)) = '{A,B}');
select pg_temp.check('rule: a move with no pick right before it falls back to the wave''s demand for its SKU',
  move_pick(pg_temp.task(7)) is null and task_do_nos(pg_temp.task(7)) = '{Z2,Z1}');

-- ---- Every surface reads the rule ----------------------------------------------
-- Manual DOs typed on the Wave page are shipment paperwork: they never reach an item.
reset role;
insert into shipment_do_no (wave_id, shipment_number, do_nos)
select wave_id, 'S1', '["PAPER-1"]' from pick_tasks where id = pg_temp.task(1);
update pick_tasks set status = 'COMPLETED' where id in (pg_temp.task(1), pg_temp.task(2), pg_temp.task(3), pg_temp.task(4), pg_temp.task(7));
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select pg_temp.check('pick_audit_line: each item its own DOs, the manual one not added',
  (select do_nos from pick_audit_line where task_id = pg_temp.task(1)) = '{A,B}'
  and (select do_nos from pick_audit_line where task_id = pg_temp.task(3)) = '{B}'
  and (select do_nos from pick_audit_line where task_id = pg_temp.task(4)) = '{Z2,Z1}');
select pg_temp.check('pick_audit_move: the move shows its pick''s shipment and DOs, not the wave''s',
  (select shipment_numbers = '{S1}' and do_nos = '{A,B}' from pick_audit_move where task_id = pg_temp.task(2)));
select pg_temp.check('pick_audit_move: a move with no pick keeps the 0122 shipment fallback',
  (select shipment_numbers = '{S2}' and do_nos = '{Z2,Z1}' from pick_audit_move where task_id = pg_temp.task(7)));
select pg_temp.check('pick_task_detail: the reprint reads the same DOs per task',
  (select bool_and(d.do_nos = task_do_nos(d.id)) from pick_task_detail d where d.planned_date = '2026-12-01')
  and (select do_nos from pick_task_detail where id = pg_temp.task(1)) = '{A,B}');
select pg_temp.check('pick_task_detail: do_nos is appended last',
  (select attname = 'do_nos' from pg_attribute where attrelid = 'public.pick_task_detail'::regclass
   and attnum > 0 and not attisdropped order by attnum desc limit 1));

-- ---- Waves cascade -------------------------------------------------------------
reset role;
delete from waves where planned_date = '2026-12-01';
select pg_temp.check('a deleted plan takes its DO split with it',
  not exists (select 1 from pick_task_orders o left join pick_tasks t on t.id = o.task_id where t.id is null));

rollback;
