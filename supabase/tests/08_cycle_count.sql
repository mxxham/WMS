-- Cycle counting (0014). Runs in a transaction and rolls back.
-- Run after 00 stub, migrations, seed. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;

-- Fixture: CG08C01 holds K8 x20 (class A via bins.abc_class), CG08C02 empty.
delete from inventory where bin_id in (select id from bins where bin_code in ('CG08C01','CG08C02'));
delete from count_tasks where bin_id in (select id from bins where bin_code in ('CG08C01','CG08C02'));
update bins set abc_class = 'A' where bin_code = 'CG08C01';
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note)
values ('adjustment', (select id from items where sku='550044709'), 'K8', 20, (select id from bins where bin_code='CG08C01'), '2031-08-08', 'fixture');

set role authenticated;

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('operator cannot plan cycle counts', pg_temp.fails($q$select plan_cycle_counts(5)$q$, 'Hanya supervisor%'));
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select pg_temp.check('status: class A bin with stock, never counted, 30-day interval',
  (select abc_class = 'A' and has_stock and last_counted_at is null and interval_days = 30 from cycle_count_status where bin_code = 'CG08C01'));
select pg_temp.check('status: empty bin counts as class C, 180 days',
  (select abc_class = 'C' and not has_stock and interval_days = 180 from cycle_count_status where bin_code = 'CG08C02'));
select pg_temp.check('quota out of range is refused', pg_temp.fails($q$select plan_cycle_counts(0)$q$, 'Jumlah bin%'));

select set_config('t.n', (plan_cycle_counts(5)->>'created'), false);
select pg_temp.check('plan creates exactly the quota', current_setting('t.n')::int = 5);
select pg_temp.check('planned tasks are source CYCLE, open, on bins with stock (never counted first)',
  (select count(*) = 5 and bool_and(t.status = 'OPEN' and s.has_stock) from count_tasks t join cycle_count_status s on s.bin_id = t.bin_id where t.source = 'CYCLE'));
select pg_temp.check('planning again never duplicates an open bin',
  (plan_cycle_counts(5)->>'created')::int = 5
  and (select count(*) = count(distinct bin_id) from count_tasks where status in ('OPEN','COUNTED','RECOUNT')));

-- Count CG08C01 (manual task so the fixture bin is certain), then stock moves: apply is refused.
select set_config('t.task', create_count_task('CG08C01', 'uji cycle', 'CYCLE')::text, false);
select submit_count(current_setting('t.task')::uuid, '[{"sku":"550044709","batch_lot":"K8","expiry_date":"2031-08-08","quantity":19}]', 'Andi');
select submit_count(current_setting('t.task')::uuid, '[{"sku":"550044709","batch_lot":"K8","expiry_date":"2031-08-08","quantity":19}]', 'Budi');
reset role;
-- One transaction = one now(): put the count a minute earlier so the movement is after it.
update count_tasks set counted_at = counted_at - interval '1 minute' where id = current_setting('t.task')::uuid;
insert into movements (type,item_id,batch_lot,quantity,to_bin_id,expiry_date,note,reason_code,by_name)
values ('adjustment', (select id from items where sku='550044709'), 'K8', 1, (select id from bins where bin_code='CG08C01'), '2031-08-08', 'moved after count', 'FOUND', 'fixture');
set role authenticated;
select pg_temp.check('apply refused when the bin moved after counting',
  pg_temp.fails(format($q$select apply_count(%L, null, 'COUNT_VARIANCE', 'Citra')$q$, current_setting('t.task')), 'Stok bin CG08C01 berubah setelah dihitung%'));
-- Recount: now the count is newer than the last movement.
select submit_count(current_setting('t.task')::uuid, '[{"sku":"550044709","batch_lot":"K8","expiry_date":"2031-08-08","quantity":19}]', 'Eko');
select pg_temp.check('after a recount, apply posts one adjustment',
  (apply_count(current_setting('t.task')::uuid, null, 'COUNT_VARIANCE', 'Citra')->>'adjustments')::int = 1);
select pg_temp.check('stock is now the counted 19 (was 21)',
  (select quantity = 19 from inventory_detail where bin_code = 'CG08C01' and batch_lot = 'K8'));
select pg_temp.check('an applied count resets the schedule: next due in 30 days',
  (select last_counted_at is not null and due_date = (last_counted_at + interval '30 days')::date and not open_task from cycle_count_status where bin_code = 'CG08C01'));

-- Bins with open wave tasks are not planned.
select save_plan('2026-10-09', '{
  "waves":[{"wave_no":"1","shipment_numbers":["CC1"]}],
  "tasks":[{"wave_no":"1","shipment_number":"CC1","task_type":"PICK","sku":"550044709","from_bin":"CG08C01","batch_lot":"K8","expiry_date":"2031-08-08","quantity":5,"seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"CC1","sku":"550044709","quantity_requested":5,"quantity_allocated":5}]}'::jsonb);
reset role; update count_tasks set counted_at = counted_at - interval '40 days' where id = current_setting('t.task')::uuid; set role authenticated;
select plan_cycle_counts(500);
select pg_temp.check('a due bin with open wave tasks is skipped',
  not exists (select 1 from count_tasks t join bins b on b.id = t.bin_id where b.bin_code = 'CG08C01' and t.status = 'OPEN'));

rollback;
