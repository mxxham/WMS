-- Same-wave cancel, cross-wave blocking, and restore safety (0074)
-- CB11B01 (level B, reserve) / CB11A01 (level A, pickface), SKU 550070614 UPP=36, batch RW1, expiry 2030-09-01.
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
-- Test 1: Same-wave two picks on one pallet cancels cleanly (no deadlock)
--   Wave 1: two PICKs (seq 1, 3) + one REPLENISH (seq 2) from CB11B01 (level B)
--   Post REPLENISH alone (32), then cancel wave -> both picks cancelled, reserve (level B) 0, pickface (level A) 36
--   Each pick is 2 cartons. Two picks = 4 cartons. REPLENISH moves 32.
--   After relokasi: reserve has 4 (36-32), pickface 32.
--   Cancel wave: first pick moves 4 % 36 = 4 to pickface -> reserve 0, pickface 36.
--   Second pick: reserve 0, residue 0, moves nothing.
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
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11B01","to_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":32,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"1","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":3}]}'::jsonb) \g /dev/null

-- Post relokasi alone
select post_task_by(p_task_id => pg_temp.t('1', 2), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select pg_temp.check('after relokasi 32 posted: reserve (CB11B01) 4, pickface (CB11A01) 32',
  pg_temp.qty('CB11B01') = 4 and pg_temp.qty('CB11A01') = 32);

-- Cancel the whole wave - should NOT deadlock
select set_wave_status(pg_temp.w('1'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('wave cancelled successfully (no deadlock)',
  (select status from waves where id = pg_temp.w('1')) = 'CANCELLED'
  and pg_temp.st('1', 1) = 'CANCELLED'
  and pg_temp.st('1', 3) = 'CANCELLED');
select pg_temp.check('after wave cancel: reserve (level B) 0, pickface (level A) 36',
  pg_temp.qty('CB11B01') = 0 and pg_temp.qty('CB11A01') = 36);
select pg_temp.check('level B bin ends at 0 (whole pallets invariant satisfied)',
  pg_temp.qty('CB11B01') % 36 = 0);

-- ============================================================================
-- Test 2: Cross-wave blocking still refuses, and message names the blocking wave NO
--   Use CB11C01 (level C, reserve) / CB11A02 (level A, pickface) for wave 2 and 3
-- ============================================================================
select pg_temp.drop_plan_temps();
delete from inventory where bin_id in (select id from bins where bin_code in ('CB11C01','CB11A02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 36,
       (select id from bins where bin_code = 'CB11C01'), '2030-09-01', 'fixture';

select save_plan('2026-11-30', '{
  "waves":[
    {"wave_no":"2","shipment_numbers":["109721549"],"planned_slot":"01:22"},
    {"wave_no":"3","shipment_numbers":["109721544"],"planned_slot":"01:52"}],
  "tasks":[
   {"wave_no":"2","shipment_number":"109721549","task_type":"PICK","sku":"550070614","from_bin":"CB11C01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"2","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11C01","to_bin":"CB11A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"3","shipment_number":"109721544","task_type":"PICK","sku":"550070614","from_bin":"CB11C01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"3","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11C01","to_bin":"CB11A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null

-- Post relokasi for wave 2 alone
select post_task_by(p_task_id => pg_temp.t('2', 2), p_by_name => 'Ani', p_scanned => 'CB11C01') \g /dev/null
select pg_temp.check('after wave 2 relokasi: reserve (CB11C01) 2, pickface (CB11A02) 34',
  pg_temp.qty('CB11C01') = 2 and pg_temp.qty('CB11A02') = 34);

-- Wave 3 still has open pick from CB11C01 - cancelling wave 2 should be refused
-- and the message should name wave NO 3
select pg_temp.check('cancelling wave 2 refused because wave 3 still needs those cartons',
  pg_temp.fails($$select set_wave_status(pg_temp.w('2'), 'CANCELLED')$$, '%wave NO 3%'));
select pg_temp.check('wave 2 and its tasks untouched after refusal',
  (select status from waves where id = pg_temp.w('2')) = 'PENDING'
  and pg_temp.st('2', 1) = 'PLANNED' and pg_temp.st('2', 2) = 'COMPLETED');

-- The way out: cancel wave 3 first
select set_task_status(pg_temp.t('3', 1), 'CANCELLED', 'order dibatalkan') \g /dev/null
select set_task_status(pg_temp.t('3', 2), 'CANCELLED', 'order dibatalkan') \g /dev/null
select pg_temp.check('wave 3 cancelled, stock unchanged', pg_temp.qty('CB11C01') = 2);

-- Now wave 2 can cancel
select set_wave_status(pg_temp.w('2'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('wave 2 cancels after wave 3 gone: reserve (level C) 0, pickface (level A) 36',
  (select status from waves where id = pg_temp.w('2')) = 'CANCELLED'
  and pg_temp.qty('CB11C01') = 0 and pg_temp.qty('CB11A02') = 36);
select pg_temp.check('level C bin ends at 0 (whole pallets invariant satisfied)',
  pg_temp.qty('CB11C01') % 36 = 0);

-- ============================================================================
-- Test 3: After cancel, set_task_status(..., 'PLANNED') is refused for a PICK
--         whose pallet break was already completed (posted_pallet_move_seq not null)
-- ============================================================================
-- Use the wave 1 from Test 1 which was cancelled after relokasi was posted
-- pick #1 (seq 1) was CANCELLED and its pallet break completed
select pg_temp.check('restore pick #1 (pallet break completed) is refused',
  pg_temp.fails($$select set_task_status(pg_temp.t('1', 1), 'PLANNED')$$, '%palet sudah dipindahkan%relokasi #2%'));
select pg_temp.check('pick #1 stays CANCELLED', pg_temp.st('1', 1) = 'CANCELLED');
select pg_temp.check('pick #3 (also cancelled with wave, pallet break completed) also refused',
  pg_temp.fails($$select set_task_status(pg_temp.t('1', 3), 'PLANNED')$$, '%palet sudah dipindahkan%relokasi #2%'));

-- ============================================================================
-- Test 4: restore_wave skips such lines and reports them under skipped_pallet_breaks
-- ============================================================================
-- Wave 1 is already CANCELLED and both picks had their pallet breaks completed
-- (the relokasi #2 was posted before the wave cancel)
select pg_temp.check('restore_wave on wave 1: restores 0, skips 2 pallet breaks',
  (select (r->>'restored')::int = 0 and jsonb_array_length(r->'skipped_pallet_breaks') = 2
   from restore_wave(pg_temp.w('1'), 'Supervisor', 'salah batal') r));
select pg_temp.check('skipped lines have correct info',
  (select (r->'skipped_pallet_breaks'->0->>'seq')::int = 1 and (r->'skipped_pallet_breaks'->0->>'reason') like '%relokasi #2%'
   from restore_wave(pg_temp.w('1'), 'Supervisor', 'salah batal') r));
select pg_temp.check('wave restored to PENDING, other lines (relokasi) also restored',
  (select status from waves where id = pg_temp.w('1')) = 'PENDING'
  and pg_temp.st('1', 2) = 'PLANNED');

-- ============================================================================
-- Test 5: restore_wave on a wave with mixed lines (some with completed pallet break,
--         some without) restores the others and skips the pallet-break ones
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

-- Post relokasi alone, then cancel the pick only (not the wave)
select post_task_by(p_task_id => pg_temp.t('4', 2), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select set_task_status(pg_temp.t('4', 1), 'CANCELLED', 'order dibatalkan') \g /dev/null
select pg_temp.check('pick cancelled, pallet break completed: reserve (level B) 0, pickface (level A) 36',
  pg_temp.qty('CB11B01') = 0 and pg_temp.qty('CB11A01') = 36);

-- Now cancel the wave (which only has the relokasi left as PLANNED? No, relokasi is COMPLETED)
-- Actually wave status is still PENDING, pick is CANCELLED, relokasi is COMPLETED
-- Let's test restore_wave on a wave where the pick was cancelled with completed pallet break
select set_wave_status(pg_temp.w('4'), 'CANCELLED', 'truck batal') \g /dev/null
select pg_temp.check('wave 4 cancelled', (select status from waves where id = pg_temp.w('4')) = 'CANCELLED');

-- restore_wave should skip the pick (pallet break completed) but restore the wave status
select pg_temp.check('restore_wave wave 4: restores wave to PENDING, skips pick #1',
  (select (r->>'restored')::int = 0 and jsonb_array_length(r->'skipped_pallet_breaks') = 1
   from restore_wave(pg_temp.w('4'), 'Supervisor', 'salah batal') r));
select pg_temp.check('wave 4 is PENDING again', (select status from waves where id = pg_temp.w('4')) = 'PENDING');

rollback;