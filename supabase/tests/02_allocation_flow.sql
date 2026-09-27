-- Allocation plan -> pick tasks -> ledger. Run after 00 stub, migrations, seed and 01.
-- Every line prints PASS/FAIL; expected errors are caught inside DO blocks.
\set ON_ERROR_STOP on
\pset tuples_only on
reset role;
insert into auth.users values ('33333333-3333-3333-3333-333333333333','adm@x','{"name":"Admin"}') on conflict do nothing;
update profiles set role='admin' where id='33333333-3333-3333-3333-333333333333';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

-- Fixture: CB01A01 gets 20 of batch T1 exp 2031-01-01; CB02B01 gets 48 of T1 exp 2031-01-01
-- and 5 of the SAME batch with a later expiry (two physical rows, one batch).
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
select 'adjustment', (select id from items where sku='550070612'), 'T1', q, (select id from bins where bin_code=b), e::date, 'fixture'
from (values ('CB01A01',20,'2031-01-01'),('CB02B01',48,'2031-01-01'),('CB02B01',5,'2032-06-30')) v(b,q,e);

select pg_temp.check('same batch, two expiries = two inventory rows',
  (select count(*) from inventory_detail where bin_code='CB02B01' and sku='550070612' and batch_lot='T1') = 2);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';  -- operator

do $$ begin
  perform save_plan('2026-09-24', '{"waves":[]}');
  perform pg_temp.check('operator cannot save a plan', false);
exception when others then perform pg_temp.check('operator cannot save a plan', sqlerrm like 'Only supervisors%'); end $$;

do $$ begin
  insert into movements (type,item_id,batch_lot,quantity,from_bin_id,user_id,task_id)
  select 'picking', item_id, batch_lot, 1, bin_id, auth.uid(), gen_random_uuid() from inventory_detail where bin_code='CB01A01' limit 1;
  perform pg_temp.check('client cannot forge a task-linked ledger row', false);
exception when others then perform pg_temp.check('client cannot forge a task-linked ledger row', true); end $$;

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';  -- supervisor
select pg_temp.check('supervisor saves plan', (save_plan('2026-09-24', '{
  "waves":[{"wave_no":"1","shipment_numbers":["S1"],"truck":"CDD","destination":"SBY","planned_slot":"08:00"}],
  "tasks":[
    {"wave_no":"1","task_type":"REPLENISH","sku":"550070612","from_bin":"CB02B01","to_bin":"CB01A01","batch_lot":"T1","expiry_date":"2031-01-01","quantity":10,"pick_type":"CASE","breaks_pallet":true,"seq":1},
    {"wave_no":"1","shipment_number":"S1","task_type":"PICK","sku":"550070612","from_bin":"CB01A01","batch_lot":"T1","expiry_date":"2031-01-01","quantity":25,"pick_type":"CASE","seq":2}],
  "outbound":[{"wave_no":"1","shipment_number":"S1","sku":"550070612","order_nos":["O1"],"quantity_requested":30,"quantity_allocated":25,"shortage_reason":"NO_STOCK"}]
}'::jsonb)->>'tasks')::int = 2);

select pg_temp.check('planning moved no stock',
  (select quantity from inventory_detail where bin_code='CB01A01' and batch_lot='T1') = 20);

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';  -- operator executes
select pg_temp.check('operator posts replenish task',
  post_task((select id from pick_tasks where task_type='REPLENISH'))->>'result' = 'POSTED');
select pg_temp.check('replenish moved only the 2031 row',
  (select quantity from inventory_detail where bin_code='CB02B01' and batch_lot='T1' and expiry_date='2031-01-01') = 38
  and (select quantity from inventory_detail where bin_code='CB02B01' and batch_lot='T1' and expiry_date='2032-06-30') = 5
  and (select quantity from inventory_detail where bin_code='CB01A01' and batch_lot='T1') = 30);
select pg_temp.check('double post is a no-op',
  post_task((select id from pick_tasks where task_type='REPLENISH'))->>'result' = 'ALREADY_POSTED'
  and (select count(*) from movements where task_id is not null) = 1);

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('re-plan keeps a wave that execution has started',
  (save_plan('2026-09-24', '{"waves":[]}')->>'kept')::int = 1
  and exists (select 1 from waves where wave_no = '1' and planned_date = '2026-09-24'));

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('complete_wave posts the rest',
  (complete_wave((select id from waves where wave_no='1'))->>'tasks_posted')::int = 1);
select pg_temp.check('pick left 5 in CB01A01',
  (select quantity from inventory_detail where bin_code='CB01A01' and batch_lot='T1') = 5);
select pg_temp.check('wave, tasks, outbound all COMPLETED',
  (select status from waves where wave_no='1') = 'COMPLETED'
  and not exists (select 1 from pick_tasks where status <> 'COMPLETED')
  and (select status from outbound) = 'COMPLETED');
select pg_temp.check('ledger rows carry task, type and author',
  (select count(*) from movements m join pick_tasks t on t.id = m.task_id
   where m.user_id = '11111111-1111-1111-1111-111111111111'
     and m.type = case t.task_type when 'PICK' then 'picking'::movement_type else 'transfer'::movement_type end) = 2);

-- Short bin: the whole wave rolls back.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select save_plan('2026-09-25', '{
  "waves":[{"wave_no":"7","shipment_numbers":["S2"]}],
  "tasks":[{"wave_no":"7","shipment_number":"S2","task_type":"PICK","sku":"550070612","from_bin":"CB02B01","batch_lot":"T1","expiry_date":"2031-01-01","quantity":10,"seq":1},
           {"wave_no":"7","shipment_number":"S2","task_type":"PICK","sku":"550070612","from_bin":"CB01A01","batch_lot":"T1","expiry_date":"2031-01-01","quantity":999,"seq":2}]}'::jsonb);
do $$ begin
  perform complete_wave((select id from waves where wave_no='7'));
  perform pg_temp.check('short wave rejected', false);
exception when others then perform pg_temp.check('short wave rejected', sqlerrm like 'Insufficient stock%'); end $$;
select pg_temp.check('short wave rolled back completely',
  (select quantity from inventory_detail where bin_code='CB02B01' and batch_lot='T1' and expiry_date='2031-01-01') = 38
  and not exists (select 1 from pick_tasks t join waves w on w.id=t.wave_id where w.wave_no='7' and t.status='COMPLETED'));

select pg_temp.check('supervisor cancels wave -> tasks cancelled',
  (set_wave_status((select id from waves where wave_no='7'), 'CANCELLED', 'truck no-show')->>'tasks_cancelled')::int = 2);
select pg_temp.check('events logged with actor',
  (select count(*) from execution_events where actor is not null) = 4);
reset role;
