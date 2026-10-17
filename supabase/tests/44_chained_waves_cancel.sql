-- Ten chained waves, five of them cancelled (0073).
-- Five pallets in five reserve bins, every one broken into the SAME pickface: NO 1..5 pick 2 and
-- relokasi 34 up to CB12A02, NO 6..10 pick 4 from that pickface. All five relokasi are posted alone
-- first (to unblock the day), then five shipments are cancelled. No phantom stock, no stranded
-- cartons, and the chain keeps working for the waves that stay.
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
create or replace function pg_temp.reserves() returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  where b.bin_code in ('CB11A01','CB11B01','CB11C01','CB11D01','CB11E01') $$;
create or replace function pg_temp.picked() returns numeric language sql as $$
  select coalesce(sum(quantity_picked), 0) from outbound where outbound_date = '2026-11-30' $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.qty(text),
  pg_temp.t(text, int), pg_temp.st(text, int), pg_temp.reserves(), pg_temp.picked() to authenticated;

-- Fixture: five full pallets of 36, pickface CB12A02 empty.
delete from inventory where bin_id in (select id from bins where bin_code in
  ('CB11A01','CB11B01','CB11C01','CB11D01','CB11E01','CB12A02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 36, (select id from bins where bin_code = b), '2030-09-01', 'fixture'
from (values ('CB11A01'), ('CB11B01'), ('CB11C01'), ('CB11D01'), ('CB11E01')) v(b);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- NO 1..5: pick 2 from a reserve, move the other 34 to the shared pickface.
-- NO 6: takes 2 straight from CB11E01 (the last pallet's bin) and 4 from the pickface.
-- NO 7..10: 4 from the pickface each.
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

-- All five pallets are broken early, to unblock the day: 34 each up to the pickface, 2 left behind.
select post_task_by(p_task_id => pg_temp.t('1', 2), p_by_name => 'Ani', p_scanned => 'CB11A01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('2', 2), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('3', 2), p_by_name => 'Ani', p_scanned => 'CB11C01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('4', 2), p_by_name => 'Ani', p_scanned => 'CB11D01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('5', 2), p_by_name => 'Ani', p_scanned => 'CB11E01') \g /dev/null
select pg_temp.check('five pallets half-moved: 170 in the pickface, 2 left in each reserve',
  pg_temp.qty('CB12A02') = 170 and pg_temp.reserves() = 10);

-- NO 1 and NO 2 are cancelled: each finishes its own pallet break, so its reserve ends empty.
select set_wave_status((select id from waves where planned_date = '2026-11-30' and wave_no = '1'), 'CANCELLED', 'truck batal') \g /dev/null
select set_wave_status((select id from waves where planned_date = '2026-11-30' and wave_no = '2'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('NO 1 and NO 2: their reserves are empty and the pickface has both full pallets',
  pg_temp.qty('CB11A01') = 0 and pg_temp.qty('CB11B01') = 0 and pg_temp.qty('CB12A02') = 174);
select pg_temp.check('their picks are cancelled and nothing was counted as picked',
  pg_temp.st('1', 1) = 'CANCELLED' and pg_temp.st('2', 1) = 'CANCELLED' and pg_temp.picked() = 0);

-- NO 5 cannot go yet: NO 6 is still going to take its 2 from CB11E01.
select pg_temp.check('cancelling NO 5 is refused while NO 6 still takes from that bin',
  pg_temp.fails($$select set_wave_status((select id from waves where planned_date = '2026-11-30' and wave_no = '5'), 'CANCELLED')$$, '%pick lain (wave NO%yang masih mengambil%'));
select pg_temp.check('nothing moved: CB11E01 keeps its 2 and the pickface stays at 174',
  pg_temp.qty('CB11E01') = 2 and pg_temp.qty('CB12A02') = 174
  and (select status from waves where planned_date = '2026-11-30' and wave_no = '5') = 'PENDING');

-- Clear NO 6, then NO 5 cancels cleanly.
select set_wave_status((select id from waves where planned_date = '2026-11-30' and wave_no = '6'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('NO 6 cancels without moving stock (nothing of it was posted)',
  (select status from waves where planned_date = '2026-11-30' and wave_no = '6') = 'CANCELLED' and pg_temp.qty('CB11E01') = 2);
select set_wave_status((select id from waves where planned_date = '2026-11-30' and wave_no = '5'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('NO 5 now cancels and its 2 join its 34', pg_temp.qty('CB11E01') = 0 and pg_temp.qty('CB12A02') = 176);

-- The other two cancelled shipments finish the same way.
select set_wave_status((select id from waves where planned_date = '2026-11-30' and wave_no = '3'), 'CANCELLED', 'truck batal') \g /dev/null
select set_wave_status((select id from waves where planned_date = '2026-11-30' and wave_no = '4'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('five waves cancelled: every reserve bin is empty',
  pg_temp.reserves() = 0 and pg_temp.qty('CB11A01') + pg_temp.qty('CB11B01') + pg_temp.qty('CB11C01')
    + pg_temp.qty('CB11D01') + pg_temp.qty('CB11E01') = 0);
select pg_temp.check('the pickface holds all five pallets: 180, and nothing was picked',
  pg_temp.qty('CB12A02') = 180 and pg_temp.picked() = 0);
select pg_temp.check('the five reconciliations are transfers in the ledger, by the session account',
  (select count(*) = 5 and bool_and(m.by_name = p.name) from movements m cross join profiles p
   where p.id = auth.uid() and m.type = 'transfer' and m.quantity = 2 and m.note like 'Batal pick%'));

-- The chain still works: NO 7..10 pick 4 each from the pickface.
select post_task_by(p_task_id => pg_temp.t('7', 1), p_by_name => 'Ani', p_scanned => 'CB12A02') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('8', 1), p_by_name => 'Ani', p_scanned => 'CB12A02') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('9', 1), p_by_name => 'Ani', p_scanned => 'CB12A02') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('10', 1), p_by_name => 'Ani', p_scanned => 'CB12A02') \g /dev/null
select pg_temp.check('the four remaining waves pick 16: 164 left, and every carton is accounted for',
  pg_temp.qty('CB12A02') = 164
  and (select coalesce(sum(m.quantity), 0) = 16 from movements m where m.type = 'picking' and m.task_id in
    (select id from pick_tasks where task_type = 'PICK' and status = 'COMPLETED' and from_bin_id = (select id from bins where bin_code = 'CB12A02'))));

rollback;
