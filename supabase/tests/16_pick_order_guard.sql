-- Picks in plan order + count on a short pick (0038). Runs in a transaction and rolls back.
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
create or replace function pg_temp.t(p_no text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-19' and w.wave_no = p_no and t.seq = p_seq $$;

-- Pallet of 36 in CF38C01; the pickface CF38C02 is empty (like CC01A01 on 29 Sep); another pallet in CF37C01.
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF38C02', 'CF37C01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550069888'), '17I', q, (select id from bins where bin_code = b), '2030-09-17', 'fixture'
from (values ('CF38C01', 36), ('CF37C01', 36)) v(b, q);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- NO 5 opens the pallet (11) and moves the rest (25) to the pickface; NO 10 then picks 20 from the pickface.
select save_plan('2026-10-19', '{
  "waves":[{"wave_no":"5","shipment_numbers":["S51"],"planned_slot":"04:22"},{"wave_no":"10","shipment_numbers":["S53"],"planned_slot":"06:22"}],
  "tasks":[
    {"wave_no":"5","shipment_number":"S51","task_type":"PICK","sku":"550069888","from_bin":"CF38C01","batch_lot":"17I","expiry_date":"2030-09-17","quantity":11,"seq":1},
    {"wave_no":"5","task_type":"REPLENISH","sku":"550069888","from_bin":"CF38C01","to_bin":"CF38C02","batch_lot":"17I","expiry_date":"2030-09-17","quantity":25,"seq":2},
    {"wave_no":"10","shipment_number":"S53","task_type":"PICK","sku":"550069888","from_bin":"CF38C02","batch_lot":"17I","expiry_date":"2030-09-17","quantity":20,"seq":1}],
  "outbound":[{"wave_no":"5","shipment_number":"S51","sku":"550069888","quantity_requested":11,"quantity_allocated":11},
              {"wave_no":"10","shipment_number":"S53","sku":"550069888","quantity_requested":20,"quantity_allocated":20}]}'::jsonb);

select pg_temp.check('waits: NO 10 #1 listed as waiting for NO 5 #2',
  exists (select 1 from task_waits where task_id = pg_temp.t('10', 1) and wait_wave_no = '5' and wait_seq = 2 and wait_to = 'CF38C02' and wait_qty = 25));
select pg_temp.check('waits: the relocation itself does not wait', not exists (select 1 from task_waits where task_id = pg_temp.t('5', 2)));
select pg_temp.check('guard: NO 10 picked before the relocation is refused, naming it',
  pg_temp.fails(format($q$select post_task_by(%L, p_by_name => 'Budi')$q$, pg_temp.t('10', 1)), '%kerjakan dulu relokasi NO 5 #2 dari CF38C01 ke CF38C02%'));
select pg_temp.check('guard: Selesaikan wave NO 10 refused too',
  pg_temp.fails(format($q$select complete_wave_by(%L, 'Budi')$q$, (select id from waves where planned_date = '2026-10-19' and wave_no = '10')), '%kerjakan dulu relokasi%'));
select pg_temp.check('another bin that really holds it can still be used (Berbeda)',
  (post_task_by(pg_temp.t('10', 1), 20, 'CF37C01', '17I', '2030-09-17', 'pickface kosong', 'Budi')->>'result') = 'POSTED');
select pg_temp.check('count: the planned bin gets a count task (source PICK)',
  exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CF38C02' and c.source = 'PICK'
          and c.status = 'OPEN' and c.reason like 'Pick NO 10 #1 berbeda%pickface kosong%'));
select unpost_task(pg_temp.t('10', 1), 'Budi', 'ulang sesuai urutan');
select post_pick_with_move(pg_temp.t('5', 1), pg_temp.t('5', 2), null, null, null, 'Budi');
select pg_temp.check('after the relocation NO 10 posts as planned',
  (post_task_by(pg_temp.t('10', 1), p_by_name => 'Budi')->>'result') = 'POSTED'
  );
select pg_temp.check('nothing waits any more', not exists (select 1 from task_waits where planned_date = '2026-10-19'));
select pg_temp.check('a pick done as planned opens no extra count',
  (select count(*) from count_tasks c join bins b on b.id = c.bin_id where b.bin_code in ('CF38C01') and c.source = 'PICK') = 0);

rollback;
