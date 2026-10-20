-- Cancelling a pick whose pallet move is already posted (0073): the pallet break is finished
-- first, so the bin the pallet left is emptied and the pickface holds the whole pallet.
-- CB11A01 and CB11A03 each hold a full pallet of 36; every wave is a pick of 2 plus a relokasi
-- of 34 to a pickface. Runs in a transaction and rolls back. Every line prints PASS/FAIL.
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
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.qty(text),
  pg_temp.t(text, int), pg_temp.st(text, int), pg_temp.w(text) to authenticated;

-- Fixture: a full pallet in CB11A01 (pickface CB11A02) and another in CB11A03 (pickface CB11A04).
delete from inventory where bin_id in (select id from bins where bin_code in ('CB11A01','CB11A02','CB11B01','CB11B02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 36, (select id from bins where bin_code = b), '2030-09-01', 'fixture'
from (values ('CB11A01'), ('CB11B01')) v(b);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- NO 1 untouched; NO 2 posted half-way below; NO 3 still open on the same pallet; NO 4 posted half-way below.
select save_plan('2026-11-30', '{
  "waves":[
   {"wave_no":"1","shipment_numbers":["109722231"],"planned_slot":"00:52"},
   {"wave_no":"2","shipment_numbers":["109721549"],"planned_slot":"01:22"},
   {"wave_no":"3","shipment_numbers":["109721544"],"planned_slot":"01:52"},
   {"wave_no":"4","shipment_numbers":["109721726"],"planned_slot":"02:22"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11A01","to_bin":"CB11A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"2","shipment_number":"109721549","task_type":"PICK","sku":"550070614","from_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"2","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11A01","to_bin":"CB11A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"3","shipment_number":"109721544","task_type":"PICK","sku":"550070614","from_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"3","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11A01","to_bin":"CB11A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"4","shipment_number":"109721726","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"4","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11B01","to_bin":"CB11B02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null

-- An untouched pair cancels as before and moves no stock: there is no half-posted pallet.
select set_task_status(pg_temp.t('1', 1), 'CANCELLED', 'order dibatalkan') \g /dev/null
select set_task_status(pg_temp.t('1', 2), 'CANCELLED', 'order dibatalkan') \g /dev/null
select pg_temp.check('an untouched pair cancels and moves no stock',
  pg_temp.st('1', 1) = 'CANCELLED' and pg_temp.st('1', 2) = 'CANCELLED'
  and pg_temp.qty('CB11A01') = 36 and pg_temp.qty('CB11A02') = 0);

-- NO 2: the relokasi is posted alone, to unblock another wave. NO 4 the same, on the other pallet.
select post_task_by(p_task_id => pg_temp.t('2', 2), p_by_name => 'Ani', p_scanned => 'CB11A01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('4', 2), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select pg_temp.check('34 moved to each pickface, 2 left at each source',
  pg_temp.qty('CB11A02') = 34 and pg_temp.qty('CB11A01') = 2
  and pg_temp.qty('CB11B02') = 34 and pg_temp.qty('CB11B01') = 2);

-- NO 3 still has an open pick from CB11A01: those 2 cartons are its stock, not ours to move.
select pg_temp.check('cancelling the pick is refused while another open pick needs those cartons',
  pg_temp.fails($$select set_task_status(pg_temp.t('2', 1), 'CANCELLED')$$, '%pick lain (wave NO%yang masih mengambil%'));
select pg_temp.check('nothing moved and the pick is still PLANNED',
  pg_temp.st('2', 1) = 'PLANNED' and pg_temp.qty('CB11A01') = 2 and pg_temp.qty('CB11A02') = 34);
select pg_temp.check('cancelling that whole wave is refused as well',
  pg_temp.fails($$select set_wave_status(pg_temp.w('2'), 'CANCELLED')$$, '%pick lain (wave NO%yang masih mengambil%'));
select pg_temp.check('the wave and its tasks are untouched after the refusal',
  (select status from waves where id = pg_temp.w('2')) = 'PENDING'
  and pg_temp.st('2', 1) = 'PLANNED' and pg_temp.st('2', 2) = 'COMPLETED');

-- The way out: NO 3 goes away first, so nobody needs the 2 any more.
select set_task_status(pg_temp.t('3', 1), 'CANCELLED', 'order dibatalkan') \g /dev/null
select set_task_status(pg_temp.t('3', 2), 'CANCELLED', 'order dibatalkan') \g /dev/null
select pg_temp.check('NO 3 is cancelled and the stock did not move', pg_temp.qty('CB11A01') = 2);

-- Now cancelling NO 2's pick finishes the pallet break: the 2 unpicked cartons go up with the 34.
select set_task_status(pg_temp.t('2', 1), 'CANCELLED', 'order dibatalkan') \g /dev/null
select pg_temp.check('the pick is cancelled', pg_temp.st('2', 1) = 'CANCELLED');
select pg_temp.check('CB11A01 is empty and the pickface holds all 36', pg_temp.qty('CB11A01') = 0 and pg_temp.qty('CB11A02') = 36);
select pg_temp.check('the reconciliation is a transfer in the ledger, not an adjustment',
  (select count(*) = 1 and bool_and(m.by_name is not null) from movements m join bins b on b.id = m.from_bin_id
   where m.type = 'transfer' and b.bin_code = 'CB11A01' and m.quantity = 2 and m.note like 'Batal pick NO 2%'));
select pg_temp.check('the cancelled order is not counted as picked',
  (select coalesce(sum(quantity_picked), 0) = 0 from outbound where shipment_number = '109721549'));

-- The whole-wave cancel does the same for every pick of the wave.
select set_wave_status(pg_temp.w('4'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('cancelling the wave finishes its pallet break too',
  (select status from waves where id = pg_temp.w('4')) = 'CANCELLED'
  and pg_temp.qty('CB11B01') = 0 and pg_temp.qty('CB11B02') = 36);

rollback;
