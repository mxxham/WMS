-- Ikut palet (0063): later picks follow a Bin To Bin to the bin it really went to. Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
-- The seed's own stock of the test SKU is cleared, so the numbers are the incident's.
delete from inventory v using items i where i.id = v.item_id and i.sku = '550049044';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- 30 Sep NO 8 #1: pallet CD39E02 44 of TESTF; pickface CC34A02 holds 4 of it already.
select import_snapshot('[
 {"bin_code":"CD39E02","zone":"CD","rack":"39","level":"E","position":"02","sku":"550049044","batch_lot":"TESTF","quantity":44,"expiry_date":"2030-09-15"},
 {"bin_code":"CC34A02","zone":"CC","rack":"34","level":"A","position":"02","sku":"550049044","batch_lot":"TESTF","quantity":4,"expiry_date":"2030-09-15"}]'::jsonb, false, 'uji') \g /dev/null
-- NO 8: pick 6 of the pallet, the rest 38 to CC34A02.
-- NO 12: 3 from CC34A02 (the 4 there cover it), 20 from CC34A02 (counting on the move), 15 from CC34A02 (too).
-- NO 13: 5 from CC34A02 (counting on the move, but the 38 are used up by then).
select save_plan('2026-10-30', '{
  "waves":[{"wave_no":"8","shipment_numbers":["SH8"],"planned_slot":"04:22"},
           {"wave_no":"12","shipment_numbers":["SH12"],"planned_slot":"07:37"},
           {"wave_no":"13","shipment_numbers":["SH13"],"planned_slot":"07:52"}],
  "tasks":[
   {"wave_no":"8","shipment_number":"SH8","task_type":"PICK","sku":"550049044","from_bin":"CD39E02","batch_lot":"TESTF","expiry_date":"2030-09-15","quantity":6,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"8","task_type":"REPLENISH","sku":"550049044","from_bin":"CD39E02","to_bin":"CC34A02","batch_lot":"TESTF","expiry_date":"2030-09-15","quantity":38,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"12","shipment_number":"SH12","task_type":"PICK","sku":"550049044","from_bin":"CC34A02","batch_lot":"TESTF","expiry_date":"2030-09-15","quantity":3,"pick_type":"CASE","seq":1},
   {"wave_no":"12","shipment_number":"SH12","task_type":"PICK","sku":"550049044","from_bin":"CC34A02","batch_lot":"TESTF","expiry_date":"2030-09-15","quantity":20,"pick_type":"CASE","seq":2},
   {"wave_no":"12","shipment_number":"SH12","task_type":"PICK","sku":"550049044","from_bin":"CC34A02","batch_lot":"TESTF","expiry_date":"2030-09-15","quantity":15,"pick_type":"CASE","seq":3},
   {"wave_no":"13","shipment_number":"SH13","task_type":"PICK","sku":"550049044","from_bin":"CC34A02","batch_lot":"TESTF","expiry_date":"2030-09-15","quantity":5,"pick_type":"CASE","seq":1}]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_no text, p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-30' and w.wave_no = p_no and t.seq = p_seq $$;
create or replace function pg_temp.bin(p_task pick_tasks) returns text language sql as $$
  select bin_code from bins where id = p_task.from_bin_id $$;

-- CC34A02 was full: the 38 went to CC33A02 (Ubah baris), then posted.
select edit_pick_row((pg_temp.t('8',1)).id, (pg_temp.t('8',2)).id, 'CD39E02', 'TESTF', '2030-09-15', 'CC33A02', 38, 'Ilham', 'CC34A02 penuh') \g /dev/null
select pg_temp.check('the move remembers its planned destination CC34A02',
  (select bin_code from bins where id = (pg_temp.t('8',2)).planned_to_bin_id) = 'CC34A02'
  and (select bin_code from bins where id = (pg_temp.t('8',2)).to_bin_id) = 'CC33A02');
select pg_temp.check('nothing follows before the move is posted (the cartons are not there yet)',
  pg_temp.bin(pg_temp.t('12',2)) = 'CC34A02');
select post_task_by((pg_temp.t('8',1)).id, null, null, null, null, null, 'Ilham') \g /dev/null
select post_task_by((pg_temp.t('8',2)).id, null, null, null, null, null, 'Ilham') \g /dev/null

select pg_temp.check('NO 12 #1 (3) stays in CC34A02: the 4 already there cover it',
  pg_temp.bin(pg_temp.t('12',1)) = 'CC34A02');
select pg_temp.check('NO 12 #2 (20) and #3 (15) follow the pallet to CC33A02: 35 of the 38',
  pg_temp.bin(pg_temp.t('12',2)) = 'CC33A02' and pg_temp.bin(pg_temp.t('12',3)) = 'CC33A02');
select pg_temp.check('NO 13 #1 (5) stays: only 3 of the 38 are left in CC33A02, so it shows stok kurang as before',
  pg_temp.bin(pg_temp.t('13',1)) = 'CC34A02');
select pg_temp.check('same batch and expiry: FEFO untouched',
  (pg_temp.t('12',2)).batch_lot = 'TESTF' and (pg_temp.t('12',2)).expiry_date = '2030-09-15');
select pg_temp.check('each followed pick logs the move that moved it (Riwayat)',
  exists (select 1 from execution_events where entity_id = (pg_temp.t('12',2)).id
          and reason like 'ikut palet: Bin To Bin NO 8 #2 ke CC33A02, bukan CC34A02%'));
select pg_temp.check('no stock changed by following: CC33A02 38, CC34A02 4',
  (select sum(quantity) from inventory v join bins b on b.id = v.bin_id where b.bin_code = 'CC33A02') = 38
  and (select sum(quantity) from inventory v join bins b on b.id = v.bin_id where b.bin_code = 'CC34A02') = 4);
create temp table posted as select post_task_by((pg_temp.t('12',2)).id, null, null, null, null, null, 'Ilham') r;
select pg_temp.check('the followed pick posts from CC33A02 without a deviation: 38 - 20 = 18 left',
  ((select r from posted)->>'deviated')::boolean = false
  and (select sum(quantity) from inventory v join bins b on b.id = v.bin_id where b.bin_code = 'CC33A02') = 18);

-- A move changed to another bin and then back to its planned bin, before posting: nothing follows.
reset role; drop table if exists _replace, _wave_ids, _seen; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot('[{"bin_code":"CD40E02","zone":"CD","rack":"40","level":"E","position":"02","sku":"550049044","batch_lot":"TESTF","quantity":6,"expiry_date":"2030-09-15"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-10-31', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SHB1"],"planned_slot":"01:00"},{"wave_no":"2","shipment_numbers":["SHB2"],"planned_slot":"02:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SHB1","task_type":"PICK","sku":"550049044","from_bin":"CD40E02","batch_lot":"TESTF","expiry_date":"2030-09-15","quantity":1,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550049044","from_bin":"CD40E02","to_bin":"CC34A02","batch_lot":"TESTF","expiry_date":"2030-09-15","quantity":5,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"2","shipment_number":"SHB2","task_type":"PICK","sku":"550049044","from_bin":"CC34A02","batch_lot":"TESTF","expiry_date":"2030-09-15","quantity":5,"pick_type":"CASE","seq":1}]}'::jsonb) \g /dev/null
create or replace function pg_temp.b(p_no text, p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-31' and w.wave_no = p_no and t.seq = p_seq $$;
select edit_pick_row((pg_temp.b('1',1)).id, (pg_temp.b('1',2)).id, 'CD40E02', 'TESTF', '2030-09-15', 'CC33A02', 5, 'Ilham', 'coba') \g /dev/null
select edit_pick_row((pg_temp.b('1',1)).id, (pg_temp.b('1',2)).id, 'CD40E02', 'TESTF', '2030-09-15', 'CC34A02', 5, 'Ilham', 'kembali') \g /dev/null
select post_task_by((pg_temp.b('1',1)).id, null, null, null, null, null, 'Ilham') \g /dev/null
select post_task_by((pg_temp.b('1',2)).id, null, null, null, null, null, 'Ilham') \g /dev/null
select pg_temp.check('a move changed back to its planned bin forgets the change; the later pick stays in CC34A02',
  (pg_temp.b('1',2)).planned_to_bin_id is null and pg_temp.bin(pg_temp.b('2',1)) = 'CC34A02');
rollback;
