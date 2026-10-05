-- Batalkan posting "Pick saja": the pick's cartons come back, its pallet move stays done (5 Oct NO 1 on Tunda).
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
-- NO 1: open the 48 pallet in CF01C01, 20 to the truck, the rest 28 to the pickface CF38A01.
-- NO 2: 4 loose cartons from that pickface.
select save_plan('2026-10-26', '{
  "waves":[{"wave_no":"1","shipment_numbers":["109702466"],"planned_slot":"00:52"},{"wave_no":"2","shipment_numbers":["109702404"],"planned_slot":"01:22"}],
  "tasks":[
    {"wave_no":"1","shipment_number":"109702466","task_type":"PICK","sku":"550044709","from_bin":"CF01C01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":20,"pick_type":"CASE","breaks_pallet":true,"seq":1},
    {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF01C01","to_bin":"CF38A01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":28,"pick_type":"CASE","breaks_pallet":true,"seq":2},
    {"wave_no":"2","shipment_number":"109702404","task_type":"PICK","sku":"550044709","from_bin":"CF38A01","batch_lot":"09I26JJ","expiry_date":"2030-09-09","quantity":4,"pick_type":"CASE","seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"109702466","sku":"550044709","quantity_requested":20,"quantity_allocated":20},
              {"wave_no":"2","shipment_number":"109702404","sku":"550044709","quantity_requested":4,"quantity_allocated":4}]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_wave text, p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-26' and w.wave_no = p_wave and t.seq = p_seq $$;

select post_pick_with_move((pg_temp.t('1',1)).id, (pg_temp.t('1',2)).id, null, null, null, 'Budi') \g /dev/null
select post_task_by((pg_temp.t('2',1)).id, null, null, null, null, null, 'Budi') \g /dev/null
select set_wave_status((select id from waves where planned_date = '2026-10-26' and wave_no = '1'), 'RESCHEDULED') \g /dev/null
select pg_temp.check('setup: pallet emptied, pickface 28 - 4 = 24, NO 1 on Tunda',
  pg_temp.qty('CF01C01') = 0 and pg_temp.qty('CF38A01') = 24);

select pg_temp.check('undoing pick AND move is refused: 4 of the 28 are already gone from the pickface',
  pg_temp.fails(format($q$select unpost_pick_with_move(%L, %L, 'Budi', 'truk ditunda')$q$, (pg_temp.t('1',1)).id, (pg_temp.t('1',2)).id), '%nsufficient stock%'));
select pg_temp.check('nothing changed by the refused undo',
  pg_temp.qty('CF01C01') = 0 and pg_temp.qty('CF38A01') = 24 and (pg_temp.t('1',1)).status = 'COMPLETED');

select unpost_task((pg_temp.t('1',1)).id, 'Budi', 'truk ditunda, karton kembali ke rak') \g /dev/null
select pg_temp.check('pick saja: the 20 cartons are back in the pallet bin',
  pg_temp.qty('CF01C01') = 20);
select pg_temp.check('the move stays done, the pickface keeps its 24',
  (pg_temp.t('1',2)).status = 'COMPLETED' and pg_temp.qty('CF38A01') = 24);
select pg_temp.check('the pick is open again on the Tunda wave, ready to post later',
  (pg_temp.t('1',1)).status = 'PLANNED');
rollback;
