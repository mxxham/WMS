-- Reservation, rolling re-plan, actual confirmation, manual-move guard.
-- Run after 00 stub, migrations, seed (01/02 optional). Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';
grant select, insert, update, delete on all tables in schema public to authenticated;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.avail(p_date date, p_bin text) returns numeric language sql as $$
  select coalesce(sum(quantity), 0) from planning_stock(p_date) where bin_code = p_bin and sku = '550044709' and batch_lot = 'R1' $$;

-- Fixture: SKU 550044709 batch R1: 48 in CF40C01, 48 in CF40C02, 10 in CF40A01 (pickface).
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
select 'adjustment', (select id from items where sku='550044709'), 'R1', q, (select id from bins where bin_code=b), '2031-03-03', 'fixture'
from (values ('CF40C01',48),('CF40C02',48),('CF40A01',10)) v(b,q);

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select save_plan('2026-10-01', '{
  "waves":[{"wave_no":"1","shipment_numbers":["A1"]},{"wave_no":"2","shipment_numbers":["A2"]}],
  "tasks":[
    {"wave_no":"1","shipment_number":"A1","task_type":"PICK","sku":"550044709","from_bin":"CF40C01","batch_lot":"R1","expiry_date":"2031-03-03","quantity":30,"seq":1},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF40C01","to_bin":"CF40A01","batch_lot":"R1","expiry_date":"2031-03-03","quantity":18,"seq":2},
    {"wave_no":"2","shipment_number":"A2","task_type":"PICK","sku":"550044709","from_bin":"CF40A01","batch_lot":"R1","expiry_date":"2031-03-03","quantity":25,"seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"A1","sku":"550044709","quantity_requested":30,"quantity_allocated":30},
              {"wave_no":"2","shipment_number":"A2","sku":"550044709","quantity_requested":25,"quantity_allocated":25}]}'::jsonb);

-- 1. Reservation: another date sees stock net of open tasks (incl. incoming replenish).
select pg_temp.check('reserve bin CF40C01 fully promised (48 - 30 - 18 = 0)', pg_temp.avail('2026-10-02', 'CF40C01') = 0);
select pg_temp.check('pickface projected 10 + 18 in - 25 out = 3', pg_temp.avail('2026-10-02', 'CF40A01') = 3);
select pg_temp.check('untouched bin stays free', pg_temp.avail('2026-10-02', 'CF40C02') = 48);
select pg_temp.check('same date: its own untouched waves are not reserved', pg_temp.avail('2026-10-01', 'CF40C01') = 48);

-- 4. Guard: operator cannot eat reserved stock by hand; supervisor can.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  insert into movements (type,item_id,batch_lot,quantity,from_bin_id,to_bin_id,expiry_date,user_id)
  values ('transfer', (select id from items where sku='550044709'), 'R1', 5, (select id from bins where bin_code='CF40C01'),
          (select id from bins where bin_code='CF39A01'), '2031-03-03', auth.uid());
  perform pg_temp.check('operator blocked from moving reserved stock', false);
exception when others then perform pg_temp.check('operator blocked from moving reserved stock', sqlerrm like 'Stok ini dipesan%'); end $$;
do $$ begin
  insert into movements (type,item_id,batch_lot,quantity,from_bin_id,to_bin_id,expiry_date,user_id)
  values ('transfer', (select id from items where sku='550044709'), 'R1', 8, (select id from bins where bin_code='CF40C02'),
          (select id from bins where bin_code='CF39A01'), '2031-03-03', auth.uid());
  perform pg_temp.check('operator may still move unreserved stock', true);
exception when others then perform pg_temp.check('operator may still move unreserved stock: ' || sqlerrm, false); end $$;

-- 3. Actuals: wave 1 pick short by 2 with a reason; replenish as planned.
do $$ begin
  perform post_task((select id from pick_tasks where task_type='PICK' and shipment_number='A1'), 28);
  perform pg_temp.check('deviation without a reason is refused', false);
exception when others then perform pg_temp.check('deviation without a reason is refused', sqlerrm like 'Alasan wajib%'); end $$;
select pg_temp.check('short pick posted with reason',
  (post_task((select id from pick_tasks where task_type='PICK' and shipment_number='A1'), 28, null, null, null, 'karton rusak')->>'deviated')::boolean);
select pg_temp.check('ledger moved the actual 28, outbound shows 28 picked',
  (select quantity from movements where task_id = (select id from pick_tasks where task_type='PICK' and shipment_number='A1')) = 28
  and (select quantity_picked from outbound where shipment_number='A1') = 28);
select pg_temp.check('replenish as planned', post_task((select id from pick_tasks where task_type='REPLENISH' and batch_lot='R1' and status='PLANNED'))->>'result' = 'POSTED');
select pg_temp.check('bin stock follows actuals: CF40C01 48-28-18 = 2, pickface 10+18 = 28',
  (select quantity from inventory_detail where bin_code='CF40C01' and batch_lot='R1') = 2
  and (select quantity from inventory_detail where bin_code='CF40A01' and batch_lot='R1') = 28);

-- Supervisor moves reserved pickface stock by hand -> wave 2 no longer fits -> flagged.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into movements (type,item_id,batch_lot,quantity,from_bin_id,to_bin_id,expiry_date,user_id,note)
values ('transfer', (select id from items where sku='550044709'), 'R1', 10, (select id from bins where bin_code='CF40A01'),
        (select id from bins where bin_code='CF39A01'), '2031-03-03', auth.uid(), 'supervisor override');
select pg_temp.check('supervisor override flags wave 2 pick as shortfall',
  exists (select 1 from task_shortfalls where wave_no='2' and planned_date='2026-10-01' and physical = 18 and reserved = 25));

-- 2. Re-plan: wave 1 (worked) is kept, wave 2 (untouched) replaced from real stock.
select pg_temp.check('context: wave 2 replaceable, wave 1 kept',
  (select jsonb_path_query_array(plan_context('2026-10-01'), '$.replaceable[*].wave_no') = '["2"]'::jsonb
      and jsonb_path_query_array(plan_context('2026-10-01'), '$.kept[*].wave_no') = '["1"]'::jsonb));
select pg_temp.check('planning stock for the re-plan = real pickface stock 18',
  pg_temp.avail('2026-10-01', 'CF40A01') = 18);
do $$ begin
  perform save_plan('2026-10-01', '{"waves":[{"wave_no":"1","shipment_numbers":["A1"]}]}');
  perform pg_temp.check('cannot re-plan a kept wave NO', false);
exception when others then perform pg_temp.check('cannot re-plan a kept wave NO', sqlerrm like '%tidak bisa direncanakan ulang%'); end $$;
select pg_temp.check('re-plan replaces wave 2 only',
  (save_plan('2026-10-01', '{
    "waves":[{"wave_no":"2","shipment_numbers":["A2"]}],
    "tasks":[{"wave_no":"2","shipment_number":"A2","task_type":"PICK","sku":"550044709","from_bin":"CF40A01","batch_lot":"R1","expiry_date":"2031-03-03","quantity":18,"seq":1},
             {"wave_no":"2","shipment_number":"A2","task_type":"PICK","sku":"550044709","from_bin":"CF40C02","batch_lot":"R1","expiry_date":"2031-03-03","quantity":7,"seq":2}],
    "outbound":[{"wave_no":"2","shipment_number":"A2","sku":"550044709","quantity_requested":25,"quantity_allocated":25}]}'::jsonb)
   @> '{"replaced":1,"kept":1,"tasks":2}'::jsonb)
  and (select count(*) from waves where planned_date='2026-10-01') = 2);
select pg_temp.check('no shortfalls after re-plan', not exists (select 1 from task_shortfalls where planned_date='2026-10-01'));

-- Picker takes from a different bin than planned (with reason): ledger uses the real bin.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('pick from another bin is accepted as a deviation',
  (post_task((select id from pick_tasks where from_bin_id=(select id from bins where bin_code='CF40C02') and status='PLANNED'),
             7, 'CF39A01', 'R1', '2031-03-03', 'palet CF40C02 terhalang')->>'deviated')::boolean);
select pg_temp.check('ledger took the 7 from the real bin CF39A01 (18 -> 11), CF40C02 untouched',
  (select actual_from_bin from pick_task_detail where deviation_reason like 'palet%') = 'CF39A01'
  and (select quantity from inventory_detail where bin_code='CF39A01' and batch_lot='R1') = 11
  and (select quantity from inventory_detail where bin_code='CF40C02' and batch_lot='R1') = 40);
select pg_temp.check('complete wave 2 posts the remaining task',
  (complete_wave((select id from waves where wave_no='2' and planned_date='2026-10-01'))->>'tasks_posted')::int = 1);
select pg_temp.check('outbound picked = 28 (short) + 25',
  (select sum(quantity_picked) from outbound where outbound_date='2026-10-01') = 28 + 25);
reset role;
