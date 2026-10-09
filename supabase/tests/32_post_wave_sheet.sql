-- Isi dari picklist (0057): every floor scenario posts from the paper, nothing refuses. Runs in a transaction and rolls back.
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
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.qty(p_bin text, p_batch text default 'TESTB') returns numeric language sql as $$
  select coalesce(sum(v.quantity), 0) from inventory v join bins b on b.id = v.bin_id where b.bin_code = p_bin and v.batch_lot = p_batch $$;
-- Stock: a pallet, a pickface, a second pallet, an earlier wave's relocation source.
select import_snapshot('[
 {"bin_code":"CE28D02","zone":"CE","rack":"28","level":"D","position":"02","sku":"550058592","batch_lot":"TESTB","quantity":44,"expiry_date":"2030-08-05"},
 {"bin_code":"CE11E01","zone":"CE","rack":"11","level":"E","position":"01","sku":"550061081","batch_lot":"TESTB","quantity":44,"expiry_date":"2030-04-08"},
 {"bin_code":"CF39A02","zone":"CF","rack":"39","level":"A","position":"02","sku":"550044709","batch_lot":"TESTB","quantity":10,"expiry_date":"2030-09-14"},
 {"bin_code":"CF12D01","zone":"CF","rack":"12","level":"D","position":"01","sku":"550048593","batch_lot":"TESTB","quantity":48,"expiry_date":"2030-08-21"},
 {"bin_code":"CB11E01","zone":"CB","rack":"11","level":"E","position":"01","sku":"550076253","batch_lot":"TESTB","quantity":45,"expiry_date":"2030-08-27"}]'::jsonb, false, 'uji') \g /dev/null
-- NO 3: the earlier wave whose relocation CF12D01 -> CD13A01 nobody posted.
-- NO 6: the wave copied from paper.
select save_plan('2026-10-27', '{
  "waves":[{"wave_no":"3","shipment_numbers":["SH3"],"planned_slot":"01:00"},{"wave_no":"6","shipment_numbers":["SH6"],"planned_slot":"03:00"}],
  "tasks":[
   {"wave_no":"3","shipment_number":"SH3","task_type":"PICK","sku":"550048593","from_bin":"CF12D01","batch_lot":"TESTB","expiry_date":"2030-08-21","quantity":30,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"3","task_type":"REPLENISH","sku":"550048593","from_bin":"CF12D01","to_bin":"CD13A01","batch_lot":"TESTB","expiry_date":"2030-08-21","quantity":18,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"6","shipment_number":"SH6","task_type":"PICK","sku":"550058592","from_bin":"CE28D02","batch_lot":"TESTB","expiry_date":"2030-08-05","quantity":10,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"6","task_type":"REPLENISH","sku":"550058592","from_bin":"CE28D02","to_bin":"CE30A02","batch_lot":"TESTB","expiry_date":"2030-08-05","quantity":34,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"6","shipment_number":"SH6","task_type":"PICK","sku":"550061081","from_bin":"CE11E01","batch_lot":"TESTB","expiry_date":"2030-04-08","quantity":3,"pick_type":"CASE","breaks_pallet":true,"seq":3},
   {"wave_no":"6","task_type":"REPLENISH","sku":"550061081","from_bin":"CE11E01","to_bin":"CE11A02","batch_lot":"TESTB","expiry_date":"2030-04-08","quantity":41,"pick_type":"CASE","breaks_pallet":true,"seq":4},
   {"wave_no":"6","shipment_number":"SH6","task_type":"PICK","sku":"550044709","from_bin":"CF40C01","batch_lot":"TESTB","expiry_date":"2030-09-14","quantity":15,"pick_type":"CASE","seq":5},
   {"wave_no":"6","shipment_number":"SH6","task_type":"PICK","sku":"550048593","from_bin":"CD13A01","batch_lot":"TESTB","expiry_date":"2030-08-21","quantity":12,"pick_type":"CASE","seq":6},
   {"wave_no":"6","shipment_number":"SH6","task_type":"PICK","sku":"550076253","from_bin":"CB11E01","batch_lot":"TESTB","expiry_date":"2030-08-27","quantity":20,"pick_type":"CASE","seq":7}],
  "outbound":[{"wave_no":"6","shipment_number":"SH6","sku":"550058592","quantity_requested":10,"quantity_allocated":10}]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_no text, p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-27' and w.wave_no = p_no and t.seq = p_seq $$;
create or replace function pg_temp.wave(p_no text) returns uuid language sql as $$
  select id from waves where planned_date = '2026-10-27' and wave_no = p_no $$;
create or replace function pg_temp.row(p_pick uuid, p_move uuid, p_sources text, p_to text, p_mq numeric) returns jsonb language sql as $$
  select jsonb_build_object('pick_id', p_pick, 'move_id', p_move, 'sources', p_sources::jsonb, 'move_to', p_to, 'move_qty', p_mq) $$;

-- Refusals first: nothing may be posted when one row is impossible.
select pg_temp.check('a bin that does not exist refuses the whole sheet, nothing posted',
  pg_temp.fails(format($q$select post_wave_sheet(%L, jsonb_build_array(
      pg_temp.row(%L, %L, '[{"bin":"CE28D02","batch":"TESTB","expiry":"2030-08-05","qty":10}]', 'CE30A02', 34),
      pg_temp.row(%L, null, '[{"bin":"CE28D2","batch":"TESTB","expiry":"2030-08-05","qty":3}]', null, null)), 'Ilham', 'picklist')$q$,
    pg_temp.wave('6'), (pg_temp.t('6',1)).id, (pg_temp.t('6',2)).id, (pg_temp.t('6',3)).id), '%Bin CE28D2 tidak ada%')
  and (pg_temp.t('6',1)).status = 'PLANNED' and pg_temp.qty('CE28D02') = 44);
select pg_temp.check('a reason is required',
  pg_temp.fails(format($q$select post_wave_sheet(%L, '[]', 'Ilham', ' ')$q$, pg_temp.wave('6')), '%Alasan wajib%'));

-- The paper for NO 6, in one call:
--  #1/#2  CE28D02: 10 picked, the rest 34 to CE30A02            (as planned)
--  #3/#4  CE11E01: 3 picked, the rest 41 to CE10A02, not CE11A02 (other destination)
--  #5     CF40C01 was empty: 10 from CF39A02 + 5 from CF40A01    (split, other bins; CF40A01 holds nothing in the system)
--  #6     CD13A01: 12 picked; the system has 0 until NO 3's relocation is posted
--  #7     CB11E01: 25 picked (5 more than planned), the rest 20 to CC34A01 (a Bin To Bin the plan did not have)
select post_wave_sheet(pg_temp.wave('6'), jsonb_build_array(
  pg_temp.row((pg_temp.t('6',1)).id, (pg_temp.t('6',2)).id, '[{"bin":"CE28D02","batch":"TESTB","expiry":"2030-08-05","qty":10}]', 'CE30A02', 34),
  pg_temp.row((pg_temp.t('6',3)).id, (pg_temp.t('6',4)).id, '[{"bin":"CE11E01","batch":"TESTB","expiry":"2030-04-08","qty":3}]', 'CE10A02', 41),
  pg_temp.row((pg_temp.t('6',5)).id, null, '[{"bin":"CF39A02","batch":"TESTB","expiry":"2030-09-14","qty":10},{"bin":"CF40A01","batch":"TESTB","expiry":"2030-09-14","qty":5}]', null, null),
  pg_temp.row((pg_temp.t('6',6)).id, null, '[{"bin":"CD13A01","batch":"TESTB","expiry":"2030-08-21","qty":12}]', null, null),
  pg_temp.row((pg_temp.t('6',7)).id, null, '[{"bin":"CB11E01","batch":"TESTB","expiry":"2030-08-27","qty":25}]', 'CC34A01', 20)),
  'Ilham', 'sesuai picklist cetak') \g /dev/null

select pg_temp.check('as planned: pallet 44 − 10 − 34 = 0, pickface 34',
  pg_temp.qty('CE28D02') = 0 and pg_temp.qty('CE30A02') = 34);
select pg_temp.check('other destination: the 41 went to CE10A02, not CE11A02',
  pg_temp.qty('CE11E01') = 0 and pg_temp.qty('CE10A02') = 41 and pg_temp.qty('CE11A02') = 0);
select pg_temp.check('split: 10 from CF39A02 (10 → 0) and 5 from CF40A01, two posted picks of 15',
  pg_temp.qty('CF39A02') = 0
  and (select count(*) from pick_tasks where wave_id = pg_temp.wave('6') and item_id = (select id from items where sku = '550044709') and status = 'COMPLETED') = 2
  and (select sum(actual_quantity) from pick_tasks where wave_id = pg_temp.wave('6') and item_id = (select id from items where sku = '550044709')) = 15);
select pg_temp.check('CF40A01 held nothing: +5 booked as FOUND "Koreksi picklist", and a count task on CF40A01',
  exists (select 1 from movements m join bins b on b.id = m.to_bin_id where b.bin_code = 'CF40A01' and m.type = 'adjustment'
          and m.reason_code = 'FOUND' and m.quantity = 5 and m.note like 'Koreksi picklist%')
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CF40A01' and c.status = 'OPEN'));
select pg_temp.check('picklist_corrections lists it under the wave date: NO 6 #5, CF40A01, +5, system 0, paper 5, count open',
  exists (select 1 from picklist_corrections where planned_date = '2026-10-27' and wave_no = '6' and seq = 5 and bin_code = 'CF40A01'
          and added = 5 and had = 0 and paper = 5 and count_status = 'OPEN'));
select pg_temp.check('the empty planned bin CF40C01 gets its count too (a pick from another bin)',
  exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CF40C01' and c.status = 'OPEN'));
select pg_temp.check('CD13A01: NO 3''s open relocation (18) was posted first instead of a correction; 18 − 12 = 6 left',
  (pg_temp.t('3',2)).status = 'COMPLETED' and pg_temp.qty('CD13A01') = 6
  and not exists (select 1 from movements m join bins b on b.id = m.to_bin_id where b.bin_code = 'CD13A01' and m.reason_code = 'FOUND'));
select pg_temp.check('NO 3''s relocation came from CF12D01, which had enough: 48 − 18 = 30, no correction there',
  pg_temp.qty('CF12D01') = 30
  and not exists (select 1 from movements m join bins b on b.id = m.to_bin_id where b.bin_code = 'CF12D01' and m.reason_code = 'FOUND'));
select pg_temp.check('over-pick: the task was raised to 25 and posted; the added Bin To Bin carried 20; 45 − 25 − 20 = 0',
  (select quantity from pick_tasks where wave_id = pg_temp.wave('6') and task_type = 'PICK' and item_id = (select id from items where sku = '550076253')) = 25 and pg_temp.qty('CB11E01') = 0 and pg_temp.qty('CC34A01') = 20);
select pg_temp.check('the wave''s open rows are all done', not exists (select 1 from pick_tasks where wave_id = pg_temp.wave('6') and status = 'PLANNED'));

-- Correcting a posted row: the paper says #3 was 3 picked and the rest 41 to CE11A02 after all.
-- CE10A02 has meanwhile been picked down to 30 (someone took 11): the undo must not fail.
-- The wave was closed (Selesaikan wave) in the meantime.
reset role;
update waves set status = 'COMPLETED' where id = pg_temp.wave('6');
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note)
select 'picking', id, 'TESTB', 11, (select id from bins where bin_code = 'CE10A02'), '2030-04-08', 'uji' from items where sku = '550061081';
set role authenticated;
select post_wave_sheet(pg_temp.wave('6'), jsonb_build_array(
  pg_temp.row((pg_temp.t('6',3)).id, (select id from pick_tasks where wave_id = pg_temp.wave('6') and task_type = 'REPLENISH' and to_bin_id = (select id from bins where bin_code = 'CE10A02')),
    '[{"bin":"CE11E01","batch":"TESTB","expiry":"2030-04-08","qty":3}]', 'CE11A02', 41)),
  'Ilham', 'koreksi: tujuan CE11A02') \g /dev/null
select pg_temp.check('posted row corrected in one step: CE10A02 30 + 11 corrected − 41 back = 0, CE11A02 41',
  pg_temp.qty('CE10A02') = 0 and pg_temp.qty('CE11A02') = 41 and pg_temp.qty('CE11E01') = 0);
select pg_temp.check('the finished wave closes again', (select status from waves where id = pg_temp.wave('6')) = 'COMPLETED');

-- A Tunda wave stays Tunda.
reset role; update waves set status = 'RESCHEDULED' where id = pg_temp.wave('3'); set role authenticated;
select post_wave_sheet(pg_temp.wave('3'), jsonb_build_array(
  pg_temp.row((pg_temp.t('3',1)).id, null, '[{"bin":"CF12D01","batch":"TESTB","expiry":"2030-08-21","qty":30}]', null, null)),
  'Ilham', 'picklist') \g /dev/null
select pg_temp.check('a Tunda wave posts and stays Tunda', (pg_temp.t('3',1)).status = 'COMPLETED' and (select status from waves where id = pg_temp.wave('3')) = 'RESCHEDULED');

reset role; update profiles set role = 'operator' where id = '11111111-1111-1111-1111-111111111111'; set role authenticated;
select pg_temp.check('an operator cannot use it',
  pg_temp.fails(format($q$select post_wave_sheet(%L, '[]', 'Budi', 'x')$q$, pg_temp.wave('6')), '%Hanya supervisor%'));
rollback;
