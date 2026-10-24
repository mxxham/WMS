-- save_plan_with_retract: retract one shipment's open tasks in a carried wave, then save the new plan.
-- Fixture: wave NO 5 (2 shipments). Shipment A: one posted pick + posted bin-to-bin + one open pick.
-- Shipment B: one open pick. Payload: one-wave plan (NO 6) for shipment A only.
-- Asserts: A's open tasks CANCELLED w/ reason; A's reserve source bin ends at 0 or UPP multiples after settle;
-- A's posted rows unchanged; B's task still PLANNED; wave NO 5 exists with shipment_numbers unchanged;
-- wave NO 6 PENDING with payload tasks/outbound; open_pick_tasks lacks A's retracted rows;
-- a payload reusing NO 5 raises the 0007 clash error and changes nothing (rollback).
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;

-- Supervisor + operator users
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','sup@x','{"name":"Supervisor"}'),
  ('22222222-2222-2222-2222-222222222222','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin'    where id = '11111111-1111-1111-1111-111111111111';
update profiles set role = 'operator' where id = '22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.qty(p_bin text, p_sku text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i
  join bins b on b.id = i.bin_id join items it on it.id = i.item_id
  where b.bin_code = p_bin and it.sku = p_sku $$;
create or replace function pg_temp.t(p_wave text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-11-30' and w.wave_no = p_wave and t.seq = p_seq $$;
create or replace function pg_temp.st(p_wave text, p_seq int) returns text language sql as $$
  select status from pick_tasks where id = pg_temp.t(p_wave, p_seq) $$;
create or replace function pg_temp.w(p_wave text) returns uuid language sql as $$
  select id from waves where planned_date = '2026-11-30' and wave_no = p_wave $$;
create or replace function pg_temp.ship_wave(p_ship text, p_wave text) returns boolean language sql as $$
  select p_ship = any(shipment_numbers) from waves where id = pg_temp.w(p_wave) $$;
create or replace function pg_temp.open_task_count(p_wave text, p_ship text) returns int language sql as $$
  select count(*)::int from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-11-30' and w.wave_no = p_wave and t.shipment_number = p_ship
    and t.status = 'PLANNED' and w.status in ('PENDING','RESCHEDULED') $$;
create or replace function pg_temp.drop_plan_temps() returns void language plpgsql as $$
begin execute 'drop table if exists _replace, _wave_ids, _seen'; exception when others then null; end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.qty(text, text),
  pg_temp.t(text, int), pg_temp.st(text, int), pg_temp.w(text), pg_temp.ship_wave(text, text),
  pg_temp.open_task_count(text, text), pg_temp.drop_plan_temps() to authenticated;

-- ============================================================================
-- Fixture: SKU 550070614 (UPP=36), batch RW1, expiry 2030-09-01.
-- Reserve bin CB11B01 (level B) holds 72 (2 pallets). Pickface CB11A01 (level A) empty.
-- Wave NO 5: shipment A=109722231, shipment B=109721549.
--   Shipment A: pick #1 (2 cartons, COMPLETED), move #2 (32 cartons, COMPLETED), pick #3 (2 cartons, PLANNED)
--   Shipment B: pick #1 (4 cartons, PLANNED)
-- After posting pick #1 + move #2: CB11B01 has 72-2-32=38; CB11A01 has 32.
-- Open tasks: A#3 (2), B#1 (4). Reserve has 38.
-- ============================================================================
update items set upp = 36 where sku = '550070614';
delete from inventory where bin_id in (select id from bins where bin_code in ('CB11B01','CB11A01'))
  and item_id = (select id from items where sku = '550070614');
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 72,
       (select id from bins where bin_code = 'CB11B01'), '2030-09-01', 'fixture';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select pg_temp.drop_plan_temps();
select save_plan('2026-11-30', '{
  "waves":[{"wave_no":"5","shipment_numbers":["109722231","109721549"],"planned_slot":"00:52"}],
  "tasks":[
   {"wave_no":"5","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"5","task_type":"REPLENISH","sku":"550070614","from_bin":"CB11B01","to_bin":"CB11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":32,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"5","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":3},
   {"wave_no":"5","shipment_number":"109721549","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":4,"pick_type":"CASE","breaks_pallet":true,"seq":4}]}'::jsonb) \g /dev/null

-- Post pick #1 (shipment A) and its move #2
select post_task_by(p_task_id => pg_temp.t('5', 1), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null
select post_task_by(p_task_id => pg_temp.t('5', 2), p_by_name => 'Ani', p_scanned => 'CB11B01') \g /dev/null

select pg_temp.check('fixture: after post pick#1+move#2: CB11B01=38, CB11A01=32',
  pg_temp.qty('CB11B01','550070614') = 38 and pg_temp.qty('CB11A01','550070614') = 32);
select pg_temp.check('fixture: tasks status: A#1 COMPLETED, A#2 COMPLETED, A#3 PLANNED, B#1 PLANNED',
  pg_temp.st('5', 1) = 'COMPLETED' and pg_temp.st('5', 2) = 'COMPLETED'
  and pg_temp.st('5', 3) = 'PLANNED' and pg_temp.st('5', 4) = 'PLANNED');
select pg_temp.check('fixture: open tasks count A=1, B=1',
  pg_temp.open_task_count('5','109722231') = 1 and pg_temp.open_task_count('5','109721549') = 1);
select pg_temp.check('fixture: wave 5 has both shipments',
  pg_temp.ship_wave('109722231','5') and pg_temp.ship_wave('109721549','5'));

-- ============================================================================
-- CALL: retract_shipment_open_tasks for shipment A in wave 5
-- ============================================================================
select retract_shipment_open_tasks(pg_temp.w('5'), '109722231', 'sisanya direncanakan ulang') \g /dev/null

select pg_temp.check('retract: A open task (seq 3) now CANCELLED with reason',
  pg_temp.st('5', 3) = 'CANCELLED');
select pg_temp.check('retract: B open task (seq 4) still PLANNED (sibling untouched)',
  pg_temp.st('5', 4) = 'PLANNED');
select pg_temp.check('retract: A posted tasks unchanged (COMPLETED)',
  pg_temp.st('5', 1) = 'COMPLETED' and pg_temp.st('5', 2) = 'COMPLETED');
select pg_temp.check('retract: open_pick_tasks no longer contains A open task',
  pg_temp.open_task_count('5','109722231') = 0 and pg_temp.open_task_count('5','109721549') = 1);
select pg_temp.check('retract: reserve bin CB11B01 ends at 0 or UPP multiple (38 % 36 = 2 -> settle moves 2 to pickface)',
  pg_temp.qty('CB11B01','550070614') % 36 = 0);
select pg_temp.check('retract: pickface CB11A01 increased by residue (32 + 2 = 34)',
  pg_temp.qty('CB11A01','550070614') = 34);

-- ============================================================================
-- CALL: save_plan_with_retract with p_retract for wave 5 shipment A, payload wave NO 6 for A only
-- ============================================================================
select pg_temp.drop_plan_temps();
do $$ declare v_retract jsonb; v_wave5 uuid; v_plan jsonb; begin
  v_wave5 := pg_temp.w('5');
  v_retract := jsonb_build_array(
    jsonb_build_object('wave_id', v_wave5, 'shipment_number', '109722231', 'reason', 'sisanya direncanakan ulang')
  );
  v_plan := jsonb_build_object(
    'waves', jsonb_build_array(
      jsonb_build_object('wave_no', '6', 'shipment_numbers', jsonb_build_array('109722231'), 'planned_slot', '01:22')
    ),
    'tasks', jsonb_build_array(
      jsonb_build_object('wave_no', '6', 'shipment_number', '109722231', 'task_type', 'PICK', 'sku', '550070614',
        'from_bin', 'CB11B01', 'batch_lot', 'RW1', 'expiry_date', '2030-09-01', 'quantity', 4,
        'pick_type', 'CASE', 'breaks_pallet', true, 'seq', 1)
    ),
    'outbound', jsonb_build_array(
      jsonb_build_object('wave_no', '6', 'shipment_number', '109722231', 'sku', '550070614',
        'description', '', 'order_nos', jsonb_build_array(), 'quantity_requested', 4, 'quantity_allocated', 4)
    )
  );
  perform save_plan_with_retract('2026-11-30', v_plan, v_retract);
end $$; \g /dev/null

-- Wave 5 still exists with both shipments, status PENDING (kept wave)
select pg_temp.check('wave 5 still exists, status PENDING, shipments unchanged',
  (select status from waves where id = pg_temp.w('5')) = 'PENDING'
  and pg_temp.ship_wave('109722231','5') and pg_temp.ship_wave('109721549','5'));

-- Wave 6 created PENDING with payload tasks/outbound
select pg_temp.check('wave 6 exists PENDING with shipment A',
  (select status from waves where id = pg_temp.w('6')) = 'PENDING'
  and pg_temp.ship_wave('109722231','6') and not pg_temp.ship_wave('109721549','6'));
select pg_temp.check('wave 6 has the new pick task (4 cartons from CB11B01)',
  pg_temp.open_task_count('6','109722231') = 1
  and (select from_bin_code from (
    select b.bin_code as from_bin_code from pick_tasks t
    join bins b on b.id = t.from_bin_id
    where t.wave_id = pg_temp.w('6') and t.seq = 1) s) = 'CB11B01');

-- Outbound for wave 6
select pg_temp.check('outbound for wave 6 has shipment A with qty 4',
  (select count(*) from outbound where wave_id = pg_temp.w('6') and shipment_number = '109722231') = 1
  and (select quantity_allocated from outbound where wave_id = pg_temp.w('6') and shipment_number = '109722231') = 4);

-- Posted tasks of wave 5 shipment A unchanged
select pg_temp.check('wave 5 A posted tasks still COMPLETED',
  pg_temp.st('5', 1) = 'COMPLETED' and pg_temp.st('5', 2) = 'COMPLETED');
select pg_temp.check('wave 5 A open task still CANCELLED',
  pg_temp.st('5', 3) = 'CANCELLED');

-- Wave 5 shipment B open task still PLANNED
select pg_temp.check('wave 5 B open task still PLANNED',
  pg_temp.st('5', 4) = 'PLANNED');

-- open_pick_tasks lacks A's retracted rows
select pg_temp.check('open_pick_tasks: wave 5 A has 0, wave 5 B has 1, wave 6 A has 1',
  pg_temp.open_task_count('5','109722231') = 0
  and pg_temp.open_task_count('5','109721549') = 1
  and pg_temp.open_task_count('6','109722231') = 1);

-- ============================================================================
-- Clash test: payload reusing NO 5 must raise 0007 clash error and change nothing (rollback)
-- ============================================================================
select pg_temp.drop_plan_temps();
-- Use a temp table to hold the plan JSON to avoid quoting issues
create temp table _clash_plan as
select '{"waves":[{"wave_no":"5","shipment_numbers":["109722231"],"planned_slot":"01:22"}],"tasks":[{"wave_no":"5","shipment_number":"109722231","task_type":"PICK","sku":"550070614","from_bin":"CB11B01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","breaks_pallet":true,"seq":1}],"outbound":[{"wave_no":"5","shipment_number":"109722231","sku":"550070614","description":"","order_nos":[],"quantity_requested":2,"quantity_allocated":2}]}'::jsonb as plan;
grant select on _clash_plan to authenticated;

select pg_temp.check('clash: save_plan_with_retract reusing NO 5 is refused',
  pg_temp.fails($fails$
    select save_plan_with_retract('2026-11-30', (select plan from _clash_plan), '[]'::jsonb)
  $fails$, '%sudah dikerjakan/ditahan/dibatalkan%'));
drop table _clash_plan;
select pg_temp.check('clash: rollback - wave 5 still has both shipments, wave 6 unchanged',
  pg_temp.ship_wave('109722231','5') and pg_temp.ship_wave('109721549','5')
  and (select count(*) from waves where planned_date = '2026-11-30' and wave_no = '6') = 1);
select pg_temp.check('clash: rollback - wave 5 A open task still CANCELLED, B still PLANNED',
  pg_temp.st('5', 3) = 'CANCELLED' and pg_temp.st('5', 4) = 'PLANNED');

rollback;