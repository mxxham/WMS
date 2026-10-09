-- Isi dari picklist: the pallet comes down before the pickface is picked, and a short batch
-- is filled from the bin's other batches (0062). Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
create or replace function pg_temp.qty(p_bin text, p_sku text, p_batch text default null) returns numeric language sql as $$
  select coalesce(sum(v.quantity), 0) from inventory v join bins b on b.id = v.bin_id join items i on i.id = v.item_id
  where b.bin_code = p_bin and i.sku = p_sku and (p_batch is null or v.batch_lot = p_batch) $$;
create or replace function pg_temp.found(p_bin text) returns numeric language sql as $$
  select coalesce(sum(m.quantity), 0) from movements m join bins b on b.id = m.to_bin_id
  where b.bin_code = p_bin and m.type = 'adjustment' and m.reason_code = 'FOUND' and m.note like 'Koreksi picklist%' $$;
-- The seed's own stock of these SKUs in these bins is cleared first, so the numbers are the incident's.
reset role;
delete from inventory v using bins b, items i where b.id = v.bin_id and i.id = v.item_id
  and b.bin_code in ('CD13A01','CF11E01','CF11D02','CE01A02','CB07A02') and i.sku in ('550048593','550062460');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- 7 Oct, wave 10: CD13A01 (pickface) 1 of 13H26JJ; pallet CF11E01 48 of 21H26JJ; planned pallet CF11D02 48.
-- CE01A02: 10 of 19I26JJ + 10 of 21I26JJ.  CB07A02: 3 of 19I26JJ + 2 of 21I26JJ (really short).
select import_snapshot('[
 {"bin_code":"CD13A01","zone":"CD","rack":"13","level":"A","position":"01","sku":"550048593","batch_lot":"13H26JJ","quantity":1,"expiry_date":"2030-08-13"},
 {"bin_code":"CF11E01","zone":"CF","rack":"11","level":"E","position":"01","sku":"550048593","batch_lot":"21H26JJ","quantity":48,"expiry_date":"2030-08-21"},
 {"bin_code":"CF11D02","zone":"CF","rack":"11","level":"D","position":"02","sku":"550048593","batch_lot":"21H26JJ","quantity":48,"expiry_date":"2030-08-21"},
 {"bin_code":"CE01A02","zone":"CE","rack":"01","level":"A","position":"02","sku":"550062460","batch_lot":"19I26JJ","quantity":10,"expiry_date":"2030-09-19"},
 {"bin_code":"CE01A02","zone":"CE","rack":"01","level":"A","position":"02","sku":"550062460","batch_lot":"21I26JJ","quantity":10,"expiry_date":"2030-09-21"},
 {"bin_code":"CB07A02","zone":"CB","rack":"07","level":"A","position":"02","sku":"550062460","batch_lot":"19I26JJ","quantity":3,"expiry_date":"2030-09-19"},
 {"bin_code":"CB07A02","zone":"CB","rack":"07","level":"A","position":"02","sku":"550062460","batch_lot":"21I26JJ","quantity":2,"expiry_date":"2030-09-21"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-10-29', '{
  "waves":[{"wave_no":"10","shipment_numbers":["SH10"],"planned_slot":"06:22"}],
  "tasks":[
   {"wave_no":"10","shipment_number":"SH10","task_type":"PICK","sku":"550048593","from_bin":"CD13A01","batch_lot":"13H26JJ","expiry_date":"2030-08-13","quantity":1,"pick_type":"CASE","seq":1},
   {"wave_no":"10","shipment_number":"SH10","task_type":"PICK","sku":"550048593","from_bin":"CF11D02","batch_lot":"21H26JJ","expiry_date":"2030-08-21","quantity":35,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"10","task_type":"REPLENISH","sku":"550048593","from_bin":"CF11D02","to_bin":"CD13A01","batch_lot":"21H26JJ","expiry_date":"2030-08-21","quantity":13,"pick_type":"CASE","breaks_pallet":true,"seq":3},
   {"wave_no":"10","shipment_number":"SH10","task_type":"PICK","sku":"550062460","from_bin":"CE01A02","batch_lot":"19I26JJ","expiry_date":"2030-09-19","quantity":15,"pick_type":"CASE","seq":4},
   {"wave_no":"10","shipment_number":"SH10","task_type":"PICK","sku":"550062460","from_bin":"CB07A02","batch_lot":"19I26JJ","expiry_date":"2030-09-19","quantity":8,"pick_type":"CASE","seq":5}]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-29' and w.wave_no = '10' and t.seq = p_seq $$;
create or replace function pg_temp.row(p_pick uuid, p_move uuid, p_sources text, p_to text, p_mq numeric) returns jsonb language sql as $$
  select jsonb_build_object('pick_id', p_pick, 'move_id', p_move, 'sources', p_sources::jsonb, 'move_to', p_to, 'move_qty', p_mq) $$;
-- Saved before posting: splits renumber the tasks.
create temp table ids as select (pg_temp.t(1)).id p1, (pg_temp.t(2)).id p2, (pg_temp.t(3)).id m2, (pg_temp.t(4)).id p4, (pg_temp.t(5)).id p5,
  (select id from waves where planned_date = '2026-10-29' and wave_no = '10') w;

-- The paper, in its own order: #2 picks 31 from the pickface BEFORE #3 brings the pallet down.
create temp table res as
select post_wave_sheet((select w from ids), jsonb_build_array(
  pg_temp.row((select p1 from ids), null, '[{"bin":"CD13A01","batch":"13H26JJ","expiry":"2030-08-13","qty":31}]', null, null),
  pg_temp.row((select p2 from ids), (select m2 from ids), '[{"bin":"CF11E01","batch":"21H26JJ","expiry":"2030-08-21","qty":5}]', 'CD13A01', 43),
  pg_temp.row((select p4 from ids), null, '[{"bin":"CE01A02","batch":"19I26JJ","expiry":"2030-09-19","qty":15}]', null, null),
  pg_temp.row((select p5 from ids), null, '[{"bin":"CB07A02","batch":"19I26JJ","expiry":"2030-09-19","qty":8}]', null, null)),
  'Ilham', 'sesuai picklist cetak') as r;

select pg_temp.check('the incident: CD13A01 1 + 43 moved in - 31 picked = 13 left, as the WMS shows',
  pg_temp.qty('CD13A01', '550048593') = 13 and pg_temp.qty('CD13A01', '550048593', '13H26JJ') = 0
  and pg_temp.qty('CD13A01', '550048593', '21H26JJ') = 13);
select pg_temp.check('nothing invented in CD13A01: no koreksi picklist',
  pg_temp.found('CD13A01') = 0);
select pg_temp.check('the pallet: CF11E01 48 - 5 picked - 43 moved = 0',
  pg_temp.qty('CF11E01', '550048593') = 0);
select pg_temp.check('the 31 are split per batch on the shipment: 1 of 13H26JJ + 30 of 21H26JJ',
  (select sum(actual_quantity) from pick_tasks where wave_id = (select w from ids) and status = 'COMPLETED'
     and from_bin_id = (select id from bins where bin_code = 'CD13A01') and actual_batch_lot = '13H26JJ') = 1
  and (select sum(actual_quantity) from pick_tasks where wave_id = (select w from ids) and status = 'COMPLETED'
     and from_bin_id = (select id from bins where bin_code = 'CD13A01') and actual_batch_lot = '21H26JJ') = 30);
select pg_temp.check('the shipment still gets 31 + 5 = 36 of 550048593',
  (select sum(actual_quantity) from pick_tasks t join items i on i.id = t.item_id
    where t.wave_id = (select w from ids) and t.task_type = 'PICK' and i.sku = '550048593') = 36);
select pg_temp.check('mixed batches, no move: CE01A02 takes 10 of 19I26JJ + 5 of 21I26JJ, nothing invented',
  pg_temp.qty('CE01A02', '550062460', '19I26JJ') = 0 and pg_temp.qty('CE01A02', '550062460', '21I26JJ') = 5
  and pg_temp.found('CE01A02') = 0
  and exists (select 1 from res, jsonb_array_elements(r->'auto') a where a->>'kind' = 'batch_fill' and a->>'bin' = 'CE01A02'
              and a->>'batch' = '21I26JJ' and (a->>'qty')::numeric = 5));
select pg_temp.check('a bin really short: CB07A02 3 + 2 taken, only the 3 the whole bin lacks are a koreksi picklist',
  pg_temp.qty('CB07A02', '550062460') = 0 and pg_temp.found('CB07A02') = 3
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CB07A02' and c.status = 'OPEN'));
select pg_temp.check('every line of the wave is posted',
  not exists (select 1 from pick_tasks where wave_id = (select w from ids) and status = 'PLANNED'));
rollback;
