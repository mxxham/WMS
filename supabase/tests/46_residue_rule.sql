-- Residue rule (0074): cancelling a pick whose relokasi was posted alone
-- must leave the reserve bin (level B-E) at 0 or a whole number of pallets (UPP).
-- CB11B01 (level B, reserve) -> CB11A01 (level A, pickface), SKU 550070614 UPP=36, batch RW1, expiry 2030-09-01.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111','sup@x','{"name":"Supervisor"}') on conflict do nothing;
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
create or replace function pg_temp.note(p_task_id uuid) returns text language sql as $$
  select m.note from movements m join pick_tasks t on t.id = m.task_id where t.id = p_task_id and m.type = 'transfer' $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.qty(text),
  pg_temp.t(text, int), pg_temp.st(text, int), pg_temp.w(text), pg_temp.note(uuid) to authenticated;

-- ============================================================================
-- Fixture helper: drop temp tables created by save_plan before each call
-- ============================================================================
create or replace function pg_temp.drop_plan_temps() returns void language plpgsql as $$
begin execute 'drop table if exists _replace, _wave_ids, _seen'; exception when others then null; end $$;
grant execute on function pg_temp.drop_plan_temps() to authenticated;

-- ============================================================================
-- Test 1: reserve 36 (CB11B01, level B) -> relokasi 34 posted alone -> reserve 2, pickface 34
--         set_order_quantity 2 -> 1 -> cancel pick -> reserve 0, pickface 36
--         Level B bin must end at 0 or whole pallets (multiple of 36).
-- ============================================================================
delete from inventory where bin_id in (select id from bins where bin_code in ('CB11B01','CB11A01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 36,
       (select id from bins where bin_code = 'CB11B01'), '2030-09-01', 'fixture';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select pg_temp.drop_plan_temps();
select save_plan('2026-11-30', '{
  "waves":[{"wave_no":"1","shipment_numbers":["109722231"],"planned_slot":"00:52"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11B01","to_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null

-- Post relokasi alone (simulating post-move-early)
select post_task_by(p_task_id => pg_temp.t('1', 2), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select pg_temp.check('after relokasi posted alone: reserve (CB11B01) 2, pickface (CB11A01) 34',
  pg_temp.qty('CB11B01') = 2 and pg_temp.qty('CB11A01') = 34);

-- Change order quantity 2 -> 1
select set_order_quantity(pg_temp.w('1'), '109722231', '550070614', 1, 'Ani', 'order dikurangi') \g /dev/null
select pg_temp.check('after set_order_quantity: reserve still 2, pickface 34',
  pg_temp.qty('CB11B01') = 2 and pg_temp.qty('CB11A01') = 34);

-- Cancel the pick -> should move residue 2 (2 % 36 = 2) to pickface
select set_task_status(pg_temp.t('1', 1), 'CANCELLED') \g /dev/null
select pg_temp.check('cancel pick: reserve (level B) 0, pickface (level A) 36 (residue 2 moved)',
  pg_temp.st('1', 1) = 'CANCELLED'
  and pg_temp.qty('CB11B01') = 0 and pg_temp.qty('CB11A01') = 36);
select pg_temp.check('level B bin ends at 0 (whole pallets invariant satisfied)',
  pg_temp.qty('CB11B01') % 36 = 0);
select pg_temp.check('note does not have empty parentheses',
  pg_temp.note(pg_temp.t('1', 1)) not like '%()%');

-- ============================================================================
-- Test 2: reserve 38 (CB11B01, level B) -> relokasi 34 posted alone -> reserve 4, pickface 34
--         cancel pick (qty 2) -> reserve 36 (whole pallet stays), pickface 36
-- ============================================================================
select pg_temp.drop_plan_temps();
delete from inventory where bin_id in (select id from bins where bin_code in ('CB11B01','CB11A01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 38,
       (select id from bins where bin_code = 'CB11B01'), '2030-09-01', 'fixture';

select save_plan('2026-11-30', '{
  "waves":[{"wave_no":"2","shipment_numbers":["109722232"],"planned_slot":"01:22"}],
  "tasks":[
   {"wave_no":"2","shipment_number":"109722232","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"2","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11B01","to_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null

select post_task_by(p_task_id => pg_temp.t('2', 2), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select pg_temp.check('after relokasi posted alone (38 start): reserve (CB11B01) 4, pickface (CB11A01) 34',
  pg_temp.qty('CB11B01') = 4 and pg_temp.qty('CB11A01') = 34);

select set_task_status(pg_temp.t('2', 1), 'CANCELLED') \g /dev/null
select pg_temp.check('cancel pick (38 start): reserve (level B) 36 (whole pallet), pickface (level A) 38 (34+4)',
  pg_temp.st('2', 1) = 'CANCELLED'
  and pg_temp.qty('CB11B01') = 36 and pg_temp.qty('CB11A01') = 38); -- 34 + 4 = 38
select pg_temp.check('level B bin ends at 36 (whole pallets invariant satisfied)',
  pg_temp.qty('CB11B01') % 36 = 0);
select pg_temp.check('note does not have empty parentheses (no reason passed)',
  pg_temp.note(pg_temp.t('2', 1)) not like '%()%');

-- ============================================================================
-- Test 3: reserve 36 -> relokasi 34 posted alone -> reserve 2, pickface 34
--         cancel pick (qty 2) -> reserve 0, pickface 36
-- ============================================================================
select pg_temp.drop_plan_temps();
delete from inventory where bin_id in (select id from bins where bin_code in ('CB11B01','CB11A01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 36,
       (select id from bins where bin_code = 'CB11B01'), '2030-09-01', 'fixture';

select save_plan('2026-11-30', '{
  "waves":[{"wave_no":"3","shipment_numbers":["109722233"],"planned_slot":"01:52"}],
  "tasks":[
   {"wave_no":"3","shipment_number":"109722233","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"3","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11B01","to_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null

select post_task_by(p_task_id => pg_temp.t('3', 2), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select pg_temp.check('after relokasi: reserve (CB11B01) 2, pickface (CB11A01) 34',
  pg_temp.qty('CB11B01') = 2 and pg_temp.qty('CB11A01') = 34);

select set_task_status(pg_temp.t('3', 1), 'CANCELLED') \g /dev/null
select pg_temp.check('cancel pick: reserve (level B) 0, pickface (level A) 36',
  pg_temp.st('3', 1) = 'CANCELLED'
  and pg_temp.qty('CB11B01') = 0 and pg_temp.qty('CB11A01') = 36);
select pg_temp.check('level B bin ends at 0 (whole pallets invariant satisfied)',
  pg_temp.qty('CB11B01') % 36 = 0);

-- ============================================================================
-- Test 4: reserve 36 -> relokasi 34 posted + pick 2 posted -> reserve 0, pickface 36
--         (normal completion) -> cancel pick should move nothing (already COMPLETED)
-- ============================================================================
select pg_temp.drop_plan_temps();
delete from inventory where bin_id in (select id from bins where bin_code in ('CB11B01','CB11A01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 36,
       (select id from bins where bin_code = 'CB11B01'), '2030-09-01', 'fixture';

select save_plan('2026-11-30', '{
  "waves":[{"wave_no":"4","shipment_numbers":["109722234"],"planned_slot":"02:22"}],
  "tasks":[
   {"wave_no":"4","shipment_number":"109722234","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"4","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11B01","to_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null

select post_task_by(p_task_id => pg_temp.t('4', 2), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('4', 1), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select pg_temp.check('after full post: reserve (level B) 0, pickface (level A) 36',
  pg_temp.qty('CB11B01') = 0 and pg_temp.qty('CB11A01') = 36);
select pg_temp.check('pick is COMPLETED, cannot cancel',
  pg_temp.fails($$select set_task_status(pg_temp.t('4', 1), 'CANCELLED')$$, '%Task is already completed%'));

rollback;