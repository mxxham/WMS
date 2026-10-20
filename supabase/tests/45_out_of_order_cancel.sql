-- Ten chained waves executed out of order, five cancelled (0073).
-- Same warehouse as test 44: five reserve pallets of 36 broken into the shared pickface CB12A02,
-- NO 1..5 pick 2 + relokasi 34, NO 6 takes 2 from CB11E01 and 4 from the pickface, NO 7..10 take 4
-- from the pickface. Nothing here runs in wave order: the relokasi are posted 3-1-5-2-4, the
-- pickface picks jump to NO 9 and NO 7 first, and the cancellations arrive in their own order.
-- The rule is per pallet, not per wave, so the result must be the same as in wave order.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('11111111-1111-1111-1111-111111111111','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.qty(p_bin text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  join items it on it.id = i.item_id where b.bin_code = p_bin and it.sku = '550070614' $$;
create or replace function pg_temp.t(p_wave text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-11-30' and w.wave_no = p_wave and t.seq = p_seq $$;
create or replace function pg_temp.st(p_wave text, p_seq int) returns text language sql as $$
  select status from pick_tasks where id = pg_temp.t(p_wave, p_seq) $$;
create or replace function pg_temp.w(p_wave text) returns uuid language sql as $$
  select id from waves where planned_date = '2026-11-30' and wave_no = p_wave $$;
create or replace function pg_temp.reserves() returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  where b.bin_code in ('CB11A01','CB11B01','CB11C01','CB11D01','CB11E01') $$;
create or replace function pg_temp.picked() returns numeric language sql as $$
  select coalesce(sum(m.quantity), 0) from movements m join pick_tasks t on t.id = m.task_id
  where m.type = 'picking' and t.wave_id in (select id from waves where planned_date = '2026-11-30') $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.qty(text),
  pg_temp.t(text, int), pg_temp.st(text, int), pg_temp.w(text), pg_temp.reserves(), pg_temp.picked() to authenticated;

-- Fixture: five full pallets of 36, pickface CB12A02 empty.
delete from inventory where bin_id in (select id from bins where bin_code in
  ('CB11A01','CB11B01','CB11C01','CB11D01','CB11E01','CB12A02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 36, (select id from bins where bin_code = b), '2030-09-01', 'fixture'
from (values ('CB11A01'), ('CB11B01'), ('CB11C01'), ('CB11D01'), ('CB11E01')) v(b);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select save_plan('2026-11-30', '{
  "waves":[
   {"wave_no":"1","shipment_numbers":["109722231"]},{"wave_no":"2","shipment_numbers":["109721549"]},
   {"wave_no":"3","shipment_numbers":["109721544"]},{"wave_no":"4","shipment_numbers":["109721726"]},
   {"wave_no":"5","shipment_numbers":["109721722"]},{"wave_no":"6","shipment_numbers":["109721692"]},
   {"wave_no":"7","shipment_numbers":["109721721"]},{"wave_no":"8","shipment_numbers":["109721720"]},
   {"wave_no":"9","shipment_numbers":["109721548"]},{"wave_no":"10","shipment_numbers":["109721547"]}],
  "tasks":[
   {"wave_no":"1","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11A01","to_bin":"CB12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"2","shipment_number":"109721549","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"2","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11B01","to_bin":"CB12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"3","shipment_number":"109721544","task_type":"PICK","sku":"550070614","from_bin":"CB11C01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"3","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11C01","to_bin":"CB12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"4","shipment_number":"109721726","task_type":"PICK","sku":"550070614","from_bin":"CB11D01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"4","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11D01","to_bin":"CB12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"5","shipment_number":"109721722","task_type":"PICK","sku":"550070614","from_bin":"CB11E01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"5","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11E01","to_bin":"CB12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"6","shipment_number":"109721692","task_type":"PICK","sku":"550070614","from_bin":"CB11E01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","seq":1},
   {"wave_no":"6","shipment_number":"109721692","task_type":"PICK","sku":"550070614","from_bin":"CB12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":4,"pick_type":"CASE","seq":2},
   {"wave_no":"7","shipment_number":"109721721","task_type":"PICK","sku":"550070614","from_bin":"CB12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":4,"pick_type":"CASE","seq":1},
   {"wave_no":"8","shipment_number":"109721720","task_type":"PICK","sku":"550070614","from_bin":"CB12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":4,"pick_type":"CASE","seq":1},
   {"wave_no":"9","shipment_number":"109721548","task_type":"PICK","sku":"550070614","from_bin":"CB12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":4,"pick_type":"CASE","seq":1},
   {"wave_no":"10","shipment_number":"109721547","task_type":"PICK","sku":"550070614","from_bin":"CB12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":4,"pick_type":"CASE","seq":1}]}'::jsonb) \g /dev/null

-- The truck jumps around: relokasi posted NO 3, NO 1, NO 5, NO 2, NO 4.
select post_task_by(p_task_id => pg_temp.t('3', 2), p_by_name => 'Ani', p_scanned => 'CB11C01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('1', 2), p_by_name => 'Ani', p_scanned => 'CB11A01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('5', 2), p_by_name => 'Ani', p_scanned => 'CB11E01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('2', 2), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('4', 2), p_by_name => 'Ani', p_scanned => 'CB11D01') \g /dev/null
select pg_temp.check('five pallets half-moved in scrambled order: 170 up, 2 left in each reserve',
  pg_temp.qty('CB12A02') = 170 and pg_temp.reserves() = 10);

-- NO 9 is picked first, out of wave order, from the pickface.
select post_task_by(p_task_id => pg_temp.t('9', 1), p_by_name => 'Ani', p_scanned => 'CB12A02') \g /dev/null
select pg_temp.check('NO 9 picked early: 4 gone from the pickface', pg_temp.qty('CB12A02') = 166);
-- Cancelling a wave whose pick is already posted keeps that pick (the truck has the cartons):
-- only the open tasks go. 0073 does not touch that, and no half-posted pallet is left behind.
select set_wave_status(pg_temp.w('9'), 'CANCELLED', 'truk batal') \g /dev/null
select pg_temp.check('a posted pick stays posted when its wave is cancelled, with its cartons out',
  (select status from waves where id = pg_temp.w('9')) = 'CANCELLED' and pg_temp.st('9', 1) = 'COMPLETED'
  and pg_temp.picked() = 4 and pg_temp.qty('CB12A02') = 166);
select restore_wave(pg_temp.w('9'), 'Ani', 'buka lagi, pick-nya sudah di luar') \g /dev/null
select pg_temp.check('restoring it (0069) keeps the posted pick and the stock as they are',
  (select status from waves where id = pg_temp.w('9')) = 'PENDING' and pg_temp.st('9', 1) = 'COMPLETED'
  and pg_temp.qty('CB12A02') = 166);

-- NO 5 is cancelled before its own pallet is finished, while NO 6 still needs CB11E01.
select pg_temp.check('NO 5 refuses while NO 6 still takes from that bin',
  pg_temp.fails($$select set_wave_status(pg_temp.w('5'), 'CANCELLED')$$, '%pick lain (wave NO%yang masih mengambil%'));
select pg_temp.check('nothing moved on that refusal', pg_temp.qty('CB11E01') = 2 and pg_temp.qty('CB12A02') = 166);

-- The other half-posted pallets cancel in any order: NO 2, NO 3, NO 1, NO 4.
select set_wave_status(pg_temp.w('2'), 'CANCELLED', 'truck batal') \g /dev/null
select set_wave_status(pg_temp.w('3'), 'CANCELLED', 'truck batal') \g /dev/null
select set_wave_status(pg_temp.w('1'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('their 2 move up each, whatever order: pickface 172, three reserves empty',
  pg_temp.qty('CB12A02') = 172 and pg_temp.qty('CB11A01') = 0 and pg_temp.qty('CB11B01') = 0 and pg_temp.qty('CB11C01') = 0);

-- NO 6 goes first, then NO 5 gets its way.
select set_wave_status(pg_temp.w('6'), 'CANCELLED', 'truck batal') \g /dev/null
select set_wave_status(pg_temp.w('5'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('NO 5 now cancels: its 2 join its 34', pg_temp.qty('CB11E01') = 0 and pg_temp.qty('CB12A02') = 174);
select set_wave_status(pg_temp.w('4'), 'CANCELLED', 'truk batal') \g /dev/null
select pg_temp.check('five waves cancelled: every reserve bin empty, the pickface holds five pallets',
  pg_temp.reserves() = 0 and pg_temp.qty('CB12A02') = 176);

-- The chain keeps working: NO 7, NO 8, NO 10 pick 4 each from the pickface, in any order.
select post_task_by(p_task_id => pg_temp.t('10', 1), p_by_name => 'Ani', p_scanned => 'CB12A02') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('7', 1), p_by_name => 'Ani', p_scanned => 'CB12A02') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('8', 1), p_by_name => 'Ani', p_scanned => 'CB12A02') \g /dev/null
select pg_temp.check('16 picked in scrambled order: 164 left in the pickface, nothing stranded',
  pg_temp.qty('CB12A02') = 164 and pg_temp.picked() = 16 and pg_temp.reserves() = 0);

rollback;
