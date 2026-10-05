-- Posting Bin To Bin saja: a delayed wave's move posted by itself so a later wave can go on (0053).
-- Runs in a transaction and rolls back.
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
create or replace function pg_temp.qty(p_bin text) returns numeric language sql as $$
  select coalesce(sum(v.quantity), 0) from inventory v join bins b on b.id = v.bin_id join items i on i.id = v.item_id
  where b.bin_code = p_bin and i.sku = '550044709' and v.batch_lot = '09I26JJ' $$;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- NO 1: open pallet CF01C01 (48), 20 to the truck, the rest 28 to the pickface CF38A01.
-- NO 3: 4 loose cartons from that pickface — it has to wait for NO 1's move.
select save_plan('2026-10-26', '{
  "waves":[{"wave_no":"1","shipment_numbers":["109702466"],"planned_slot":"00:52"},{"wave_no":"3","shipment_numbers":["109702467"],"planned_slot":"01:52"}],
  "tasks":[
    {"wave_no":"1","shipment_number":"109702466","task_type":"PICK","sku":"550044709","from_bin":"CF01C01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":20,"pick_type":"CASE","breaks_pallet":true,"seq":1},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF01C01","to_bin":"CF38A01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":28,"pick_type":"CASE","breaks_pallet":true,"seq":2},
    {"wave_no":"3","shipment_number":"109702467","task_type":"PICK","sku":"550044709","from_bin":"CF38A01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":4,"pick_type":"CASE","seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"109702466","sku":"550044709","quantity_requested":20,"quantity_allocated":20},
              {"wave_no":"3","shipment_number":"109702467","sku":"550044709","quantity_requested":4,"quantity_allocated":4}]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_wave text, p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-26' and w.wave_no = p_wave and t.seq = p_seq $$;
create or replace function pg_temp.wave(p_wave text) returns waves language sql as $$
  select * from waves where planned_date = '2026-10-26' and wave_no = p_wave $$;
select set_wave_status((pg_temp.wave('1')).id, 'RESCHEDULED') \g /dev/null

select pg_temp.check('NO 3 waits for NO 1 #2, and the notice knows that move and that NO 1 is on Tunda',
  exists (select 1 from task_waits where task_id = (pg_temp.t('3',1)).id
          and wait_task_id = (pg_temp.t('1',2)).id and wait_wave_status = 'RESCHEDULED' and wait_qty = 28));
select pg_temp.check('a Tunda wave cannot be worked on the normal way',
  pg_temp.fails(format($q$select post_task_by(%L, null, null, null, null, null, 'Budi')$q$, (pg_temp.t('1',2)).id), '%RESCHEDULED%'));
reset role;
update profiles set role = 'operator' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select pg_temp.check('on a Tunda wave only a supervisor posts the move',
  pg_temp.fails(format($q$select post_move_early(%L, 'Budi')$q$, (pg_temp.t('1',2)).id), '%hanya supervisor%'));
reset role;
update profiles set role = 'supervisor' where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;

select pg_temp.check('the move alone is posted',
  (post_move_early((pg_temp.t('1',2)).id, 'Budi')->>'result') = 'POSTED');
select pg_temp.check('28 moved to the pickface, the 20 for NO 1 stay on the pallet',
  pg_temp.qty('CF38A01') = 28 and pg_temp.qty('CF01C01') = 20);
select pg_temp.check('NO 1 is still on Tunda with its pick open',
  (pg_temp.wave('1')).status = 'RESCHEDULED' and (pg_temp.t('1',1)).status = 'PLANNED' and (pg_temp.t('1',2)).status = 'COMPLETED');
select pg_temp.check('logged as posted without its pick',
  exists (select 1 from execution_events where entity_id = (pg_temp.t('1',2)).id and reason like 'Bin To Bin diposting tanpa pick-nya oleh Budi (wave NO 1 ditunda)'));
select pg_temp.check('NO 3 no longer waits, and posts',
  not exists (select 1 from task_waits where task_id = (pg_temp.t('3',1)).id)
  and (post_task_by((pg_temp.t('3',1)).id, null, null, null, null, null, 'Budi')->>'result') = 'POSTED' and pg_temp.qty('CF38A01') = 24);
select pg_temp.check('posting the same move again refused',
  pg_temp.fails(format($q$select post_move_early(%L, 'Budi')$q$, (pg_temp.t('1',2)).id), '%sudah COMPLETED%'));
rollback;
