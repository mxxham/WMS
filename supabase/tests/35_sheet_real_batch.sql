-- Isi dari picklist takes the batch the bin really holds (0061). Runs in a transaction and rolls back.
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
create or replace function pg_temp.qty(p_bin text, p_batch text) returns numeric language sql as $$
  select coalesce(sum(v.quantity), 0) from inventory v join bins b on b.id = v.bin_id where b.bin_code = p_bin and v.batch_lot = p_batch $$;
create or replace function pg_temp.found(p_bin text) returns numeric language sql as $$
  select coalesce(sum(m.quantity), 0) from movements m join bins b on b.id = m.to_bin_id
  where b.bin_code = p_bin and m.type = 'adjustment' and m.reason_code = 'FOUND' and m.note like 'Koreksi picklist%' $$;
-- CE01A01: 27 of 19I26JJ (the 7 Oct incident: the paper said 01I26JJ).
-- CE01A02: 10 of 19I26JJ and 10 of 21I26JJ (two batches: the earliest expiry is taken).
-- CB07A02: 20 of 18H26JJ exp 2030-08-18 (paper: right batch, expiry one day off).
-- CD15A02: 4 of 20H26JJ (paper: right batch, more cartons than the system has).
-- CF13A01: none of this SKU (paper batch kept: koreksi picklist as before).
select import_snapshot('[
 {"bin_code":"CE01A01","zone":"CE","rack":"01","level":"A","position":"01","sku":"550062460","batch_lot":"19I26JJ","quantity":27,"expiry_date":"2030-09-19"},
 {"bin_code":"CE01A02","zone":"CE","rack":"01","level":"A","position":"02","sku":"550062460","batch_lot":"21I26JJ","quantity":10,"expiry_date":"2030-09-21"},
 {"bin_code":"CE01A02","zone":"CE","rack":"01","level":"A","position":"02","sku":"550062460","batch_lot":"19I26JJ","quantity":10,"expiry_date":"2030-09-19"},
 {"bin_code":"CB07A02","zone":"CB","rack":"07","level":"A","position":"02","sku":"550062460","batch_lot":"18H26JJ","quantity":20,"expiry_date":"2030-08-18"},
 {"bin_code":"CD15A02","zone":"CD","rack":"15","level":"A","position":"02","sku":"550062461","batch_lot":"20H26JJ","quantity":4,"expiry_date":"2030-08-20"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-10-28', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH1"],"planned_slot":"01:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550062460","from_bin":"CE01A01","batch_lot":"19I26JJ","expiry_date":"2030-09-19","quantity":27,"pick_type":"CASE","seq":1},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550062460","from_bin":"CE01A02","batch_lot":"19I26JJ","expiry_date":"2030-09-19","quantity":5,"pick_type":"CASE","seq":2},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550062460","from_bin":"CB07A02","batch_lot":"18H26JJ","expiry_date":"2030-08-18","quantity":5,"pick_type":"CASE","seq":3},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550062461","from_bin":"CD15A02","batch_lot":"20H26JJ","expiry_date":"2030-08-20","quantity":6,"pick_type":"CASE","seq":4},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550062462","from_bin":"CF13A01","batch_lot":"01I26JJ","expiry_date":"2030-09-01","quantity":3,"pick_type":"CASE","seq":5}]}'::jsonb) \g /dev/null
create or replace function pg_temp.t(p_seq int) returns pick_tasks language sql as $$
  select t.* from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-10-28' and w.wave_no = '1' and t.seq = p_seq $$;
create or replace function pg_temp.row(p_pick uuid, p_sources text) returns jsonb language sql as $$
  select jsonb_build_object('pick_id', p_pick, 'move_id', null, 'sources', p_sources::jsonb, 'move_to', null, 'move_qty', null) $$;
create temp table res as
select post_wave_sheet((select id from waves where planned_date = '2026-10-28' and wave_no = '1'), jsonb_build_array(
  pg_temp.row((pg_temp.t(1)).id, '[{"bin":"CE01A01","batch":"01I26JJ","expiry":"2030-09-01","qty":27}]'),
  pg_temp.row((pg_temp.t(2)).id, '[{"bin":"CE01A02","batch":"01I26JJ","expiry":"2030-09-01","qty":5}]'),
  pg_temp.row((pg_temp.t(3)).id, '[{"bin":"CB07A02","batch":"18H26JJ","expiry":"2030-08-17","qty":5}]'),
  pg_temp.row((pg_temp.t(4)).id, '[{"bin":"CD15A02","batch":"01I26JJ","expiry":"2030-09-01","qty":6}]'),
  pg_temp.row((pg_temp.t(5)).id, '[{"bin":"CF13A01","batch":"01I26JJ","expiry":"2030-09-01","qty":3}]')),
  'Ilham', 'sesuai picklist cetak') as r;

select pg_temp.check('the 7 Oct case: CE01A01 27 of 19I26JJ, paper 01I26JJ: the bin empties, nothing is invented',
  pg_temp.qty('CE01A01', '19I26JJ') = 0 and pg_temp.qty('CE01A01', '01I26JJ') = 0 and pg_temp.found('CE01A01') = 0);
select pg_temp.check('the posted pick carries the real batch and expiry',
  (pg_temp.t(1)).actual_batch_lot = '19I26JJ' and (pg_temp.t(1)).actual_expiry_date = '2030-09-19' and (pg_temp.t(1)).actual_quantity = 27);
select pg_temp.check('the rewrite is reported: batch_from_bin, paper 01I26JJ -> 19I26JJ',
  exists (select 1 from res, jsonb_array_elements(r->'auto') a where a->>'kind' = 'batch_from_bin' and a->>'bin' = 'CE01A01'
          and a->>'paper_batch' = '01I26JJ' and a->>'batch' = '19I26JJ' and (a->>'qty')::numeric = 27));
select pg_temp.check('two other batches in the bin: the earliest expiry (19I26JJ) is taken, 21I26JJ untouched (FEFO)',
  pg_temp.qty('CE01A02', '19I26JJ') = 5 and pg_temp.qty('CE01A02', '21I26JJ') = 10 and pg_temp.found('CE01A02') = 0);
select pg_temp.check('right batch, expiry one day off: the bin''s expiry is used, no second stock line',
  pg_temp.qty('CB07A02', '18H26JJ') = 15 and (pg_temp.t(3)).actual_expiry_date = '2030-08-18'
  and (select count(*) from inventory v join bins b on b.id = v.bin_id where b.bin_code = 'CB07A02') = 1 and pg_temp.found('CB07A02') = 0);
select pg_temp.check('wrong batch and short: the real batch is used and only the real shortfall (2) is a correction',
  pg_temp.qty('CD15A02', '20H26JJ') = 0 and pg_temp.qty('CD15A02', '01I26JJ') = 0 and pg_temp.found('CD15A02') = 2
  and (pg_temp.t(4)).actual_batch_lot = '20H26JJ');
select pg_temp.check('a bin without the SKU keeps the paper batch: +3 koreksi picklist and a count, as before',
  pg_temp.found('CF13A01') = 3 and (pg_temp.t(5)).actual_batch_lot = '01I26JJ'
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CF13A01' and c.status = 'OPEN'));
select pg_temp.check('a bin that holds the paper batch is never rewritten',
  not exists (select 1 from res, jsonb_array_elements(r->'auto') a where a->>'kind' = 'batch_from_bin' and a->>'bin' in ('CF13A01')));
rollback;
