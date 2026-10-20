-- Paperless picking: post_pick_line and Minta supervisor (0067). Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','sup@x','{"name":"Supervisor"}') on conflict do nothing;
insert into auth.users values ('22222222-2222-2222-2222-222222222222','op@x','{"name":"Operator"}') on conflict do nothing;
update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
update profiles set role = 'operator' where id = '22222222-2222-2222-2222-222222222222';
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.qty(p_bin text, p_sku text) returns numeric language sql as $$
  select coalesce(sum(v.quantity), 0) from inventory v join bins b on b.id = v.bin_id join items i on i.id = v.item_id
  where b.bin_code = p_bin and i.sku = p_sku $$;
create or replace function pg_temp.t(p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-02' and w.wave_no = '1' and t.seq = p_seq $$;
create or replace function pg_temp.wave() returns uuid language sql as $$
  select id from waves where planned_date = '2026-11-02' and wave_no = '1' $$;
create or replace function pg_temp.row(p_pick uuid, p_move uuid, p_sources text, p_to text, p_mq numeric) returns jsonb language sql as $$
  select jsonb_build_object('pick_id', p_pick, 'move_id', p_move, 'sources', p_sources::jsonb, 'move_to', p_to, 'move_qty', p_mq) $$;
create or replace function pg_temp.requests() returns bigint language sql as $$ select count(*) from pick_line_requests $$;
delete from inventory v using bins b where b.id = v.bin_id
  and b.bin_code in ('CB18A02','CB18A01','CB34D02','CB33E02','CB33E01','CD13A01','CE01A01','CE01A02');
grant execute on function pg_temp.check(text, boolean), pg_temp.qty(text, text), pg_temp.t(int), pg_temp.wave(),
  pg_temp.row(uuid, uuid, text, text, numeric), pg_temp.requests() to authenticated;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select import_snapshot('[
 {"bin_code":"CB18A02","zone":"CB","rack":"18","level":"A","position":"02","sku":"550070614","batch_lot":"P20","quantity":16,"expiry_date":"2030-08-20"},
 {"bin_code":"CB34D02","zone":"CB","rack":"34","level":"D","position":"02","sku":"550070614","batch_lot":"P11","quantity":36,"expiry_date":"2030-09-11"},
 {"bin_code":"CB33E02","zone":"CB","rack":"33","level":"E","position":"02","sku":"550070614","batch_lot":"P11","quantity":36,"expiry_date":"2030-09-11"},
 {"bin_code":"CB33E01","zone":"CB","rack":"33","level":"E","position":"01","sku":"550070614","batch_lot":"P11","quantity":36,"expiry_date":"2030-09-11"},
 {"bin_code":"CD13A01","zone":"CD","rack":"13","level":"A","position":"01","sku":"550048593","batch_lot":"Q13","quantity":5,"expiry_date":"2030-08-13"},
 {"bin_code":"CE01A01","zone":"CE","rack":"01","level":"A","position":"01","sku":"550062460","batch_lot":"R1","quantity":10,"expiry_date":"2030-09-01"},
 {"bin_code":"CE01A02","zone":"CE","rack":"01","level":"A","position":"02","sku":"550062460","batch_lot":"R1","quantity":10,"expiry_date":"2030-09-01"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-11-02', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH1"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CB18A02","batch_lot":"P20","expiry_date":"2030-08-20","quantity":16,"pick_type":"CASE","seq":1},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CB34D02","batch_lot":"P11","expiry_date":"2030-09-11","quantity":13,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CB34D02","to_bin":"CB18A02","batch_lot":"P11","expiry_date":"2030-09-11","quantity":23,"pick_type":"CASE","breaks_pallet":true,"seq":3},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CB33E02","batch_lot":"P11","expiry_date":"2030-09-11","quantity":10,"pick_type":"CASE","seq":4},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550048593","from_bin":"CD13A01","batch_lot":"Q13","expiry_date":"2030-08-13","quantity":8,"pick_type":"CASE","seq":5},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550062460","from_bin":"CE01A01","batch_lot":"R1","expiry_date":"2030-09-01","quantity":40,"pick_type":"CASE","seq":6},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550062460","from_bin":"CE01A02","batch_lot":"R1","expiry_date":"2030-09-01","quantity":10,"pick_type":"CASE","seq":7},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CB33E01","batch_lot":"P11","expiry_date":"2030-09-11","quantity":5,"pick_type":"CASE","seq":8}]}'::jsonb) \g /dev/null
-- Ids before posting: splits renumber the tasks.
create temp table ids as select pg_temp.t(1) p1, pg_temp.t(2) p2, pg_temp.t(3) m3, pg_temp.t(4) p4, pg_temp.t(5) p5, pg_temp.t(6) p6, pg_temp.t(7) p7, pg_temp.t(8) p8;

-- From here on: the operator.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$ begin
  perform post_wave_sheet(pg_temp.wave(), '[]'::jsonb, 'Ani', 'x');
  raise notice 'FAIL an operator still cannot use Isi dari picklist';
exception when others then raise notice 'PASS an operator still cannot use Isi dari picklist'; end $$;

do $$ begin
  perform post_pick_line(pg_temp.wave(), pg_temp.row((select p1 from ids), null, '[{"bin":"CB18A02","batch":"P20","expiry":"2030-08-20","qty":16}]', null, null), ' ', 'sesuai', 'CB18A02');
  raise notice 'FAIL a line without a name is refused';
exception when others then raise notice 'PASS a line without a name is refused'; end $$;

create temp table r1 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p1 from ids), null,
  '[{"bin":"CB18A02","batch":"P20","expiry":"2030-08-20","qty":16}]', null, null), 'Ani', 'sesuai', 'CB18A02') as r;
select pg_temp.check('as planned: posted by an operator, CB18A02 16 -> 0, picked_by_name Ani',
  (select r->>'result' = 'posted' from r1) and pg_temp.qty('CB18A02', '550070614') = 0
  and (select picked_by_name from pick_tasks where id = (select p1 from ids)) = 'Ani');
select pg_temp.check('a line posted at the bin is not bulk: bulk_posted false, scanned_code the confirmed bin (0068)',
  (select not bulk_posted and scanned_code = 'CB18A02' from pick_tasks where id = (select p1 from ids)));

create temp table r2 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p2 from ids), (select m3 from ids),
  '[{"bin":"CB34D02","batch":"P11","expiry":"2030-09-11","qty":13}]', 'CB18A01', 23), 'Ani', 'pickface penuh', 'CB34D02') as r;
select pg_temp.check('pallet: 13 picked, the rest 23 to CB18A01 instead of CB18A02',
  (select r->>'result' = 'posted' from r2) and pg_temp.qty('CB34D02', '550070614') = 0
  and pg_temp.qty('CB18A01', '550070614') = 23 and pg_temp.qty('CB18A02', '550070614') = 0);

create temp table r4 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p4 from ids), null,
  '[{"bin":"CB33E02","batch":"P11","expiry":"2030-09-11","qty":6},{"bin":"CB33E01","batch":"P11","expiry":"2030-09-11","qty":4}]', null, null), 'Ani', 'palet terhalang', 'CB33E02') as r;
select pg_temp.check('two sources: 6 from CB33E02 + 4 from CB33E01 (split_task inside works for an operator)',
  (select r->>'result' = 'posted' from r4) and pg_temp.qty('CB33E02', '550070614') = 30 and pg_temp.qty('CB33E01', '550070614') = 32);

create temp table r5 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p5 from ids), null,
  '[{"bin":"CD13A01","batch":"Q13","expiry":"2030-08-13","qty":8}]', null, null), 'Ani', 'sesuai', 'CD13A01') as r;
select pg_temp.check('correction of 3 (<= 20): posted, CD13A01 5 + 3 - 8 = 0, a count task opens',
  (select r->>'result' = 'posted' and (r->>'corrections')::int = 1 from r5) and pg_temp.qty('CD13A01', '550048593') = 0
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CD13A01' and c.status = 'OPEN'));

create temp table r6 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p6 from ids), null,
  '[{"bin":"CE01A01","batch":"R1","expiry":"2030-09-01","qty":40}]', null, null), 'Ani', 'sesuai', 'CE01A01') as r;
select pg_temp.check('correction of 30 (> 20): refused, nothing posted, stock untouched, no FOUND booked',
  (select r->>'result' = 'refused' and r->>'kind' = 'correction_over_limit' and r->>'message' like '%minta supervisor%' from r6)
  and pg_temp.qty('CE01A01', '550062460') = 10
  and (select status from pick_tasks where id = (select p6 from ids)) = 'PLANNED'
  and not exists (select 1 from movements m join bins b on b.id = m.to_bin_id where b.bin_code = 'CE01A01' and m.reason_code = 'FOUND'));
select pg_temp.check('the refused line is a request for a supervisor, listed open',
  exists (select 1 from pick_line_requests_open where pick_id = (select p6 from ids) and kind = 'correction_over_limit' and by_name = 'Ani'));

select post_pick_line(pg_temp.wave(), pg_temp.row((select p6 from ids), null,
  '[{"bin":"CE01A01","batch":"R1","expiry":"2030-09-01","qty":40}]', null, null), 'Ani', 'sesuai', 'CE01A01') \g /dev/null
select pg_temp.check('a refused line retried keeps one open request',
  (select count(*) from pick_line_requests where pick_id = (select p6 from ids) and status = 'OPEN') = 1);

do $$ begin
  perform post_pick_line(pg_temp.wave(), pg_temp.row((select p7 from ids), null, '[{"bin":"CE01A02","batch":"R1","expiry":"2030-09-01","qty":11}]', null, null), 'Ani', 'x', 'CE01A02');
  raise notice 'FAIL more than the order line is refused';
exception when others then raise notice 'PASS more than the order line is refused'; end $$;
select pg_temp.check('input mistakes write no request', pg_temp.requests() = 1);

create temp table r7 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p7 from ids), null,
  '[{"bin":"CE01A02","batch":"R1","expiry":"2030-09-01","qty":7}]', null, null), 'Ani', 'bin kosong / kurang', 'CE01A02') as r;
select pg_temp.check('fewer than planned: 7 of 10 posted',
  (select r->>'result' = 'posted' from r7) and pg_temp.qty('CE01A02', '550062460') = 3);

create temp table r7b as select post_pick_line(pg_temp.wave(), pg_temp.row((select p7 from ids), null,
  '[{"bin":"CE01A02","batch":"R1","expiry":"2030-09-01","qty":9}]', null, null), 'ani', 'salah ketik', 'CE01A02') as r;
select pg_temp.check('re-post own line (name case-insensitive): 9 instead of 7, stock taken once (10 - 9 = 1)',
  (select r->>'result' = 'posted' from r7b) and pg_temp.qty('CE01A02', '550062460') = 1);

create temp table r7c as select post_pick_line(pg_temp.wave(), pg_temp.row((select p7 from ids), null,
  '[{"bin":"CE01A02","batch":"R1","expiry":"2030-09-01","qty":10}]', null, null), 'Budi', 'x', 'CE01A02') as r;
select pg_temp.check('same line posted twice by two names: second is a request, stock taken once',
  (select r->>'result' = 'refused' and r->>'kind' = 'other_picker' and r->>'message' like '%ani%' from r7c)
  and pg_temp.qty('CE01A02', '550062460') = 1);

create temp table r8 as select post_pick_line(pg_temp.wave(), pg_temp.row((select p8 from ids), null,
  '[{"bin":"CB33E01","batch":"P11","expiry":"2030-09-11","qty":0}]', null, null), 'Ani', 'bin kosong / kurang', 'CB33E01') as r;
select pg_temp.check('Qty 0 posts as a short pick with a count task, not an input mistake',
  (select r->>'result' = 'posted' from r8) and (select status from pick_tasks where id = (select p8 from ids)) = 'COMPLETED'
  and exists (select 1 from count_tasks c join bins b on b.id = c.bin_id where b.bin_code = 'CB33E01' and c.status = 'OPEN'));

-- A checker audits line 1; the picker may no longer change it.
reset role;
insert into pick_audits (task_id, attempt_no, checker_name, found_sku, counted_qty, expected_sku, expected_qty, result)
values ((select p1 from ids), 1, 'Cek', '550070614', 16, '550070614', 16, 'OK');
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table r1b as select post_pick_line(pg_temp.wave(), pg_temp.row((select p1 from ids), null,
  '[{"bin":"CB18A02","batch":"P20","expiry":"2030-08-20","qty":15}]', null, null), 'Ani', 'x', 'CB18A02') as r;
select pg_temp.check('re-post of an audited line: request, nothing changes',
  (select r->>'result' = 'refused' and r->>'kind' = 'audited' from r1b)
  and (select actual_quantity from pick_tasks where id = (select p1 from ids)) = 16);

-- A Tunda wave belongs to a supervisor.
reset role;
update waves set status = 'RESCHEDULED' where id = pg_temp.wave();
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table rt as select post_pick_line(pg_temp.wave(), pg_temp.row((select p6 from ids), null,
  '[{"bin":"CE01A01","batch":"R1","expiry":"2030-09-01","qty":0}]', null, null), 'Ani', 'x', 'CE01A01') as r;
select pg_temp.check('a Tunda wave: request, nothing posted',
  (select r->>'result' = 'refused' and r->>'kind' = 'wave_not_pending' from rt)
  and (select status from pick_tasks where id = (select p6 from ids)) = 'PLANNED');
reset role;
update waves set status = 'PENDING' where id = pg_temp.wave();
set role authenticated;

-- The supervisor posts line 6 through Isi dari picklist: its requests drop off by themselves.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select post_wave_sheet(pg_temp.wave(), jsonb_build_array(pg_temp.row((select p6 from ids), null,
  '[{"bin":"CE01A01","batch":"R1","expiry":"2030-09-01","qty":40}]', null, null)), 'Supervisor', 'dicek') \g /dev/null
select pg_temp.check('posted by the supervisor: the line''s requests leave the open list',
  not exists (select 1 from pick_line_requests_open where pick_id = (select p6 from ids)));
select pg_temp.check('Isi dari picklist still records its lines as bulk (no scan)',
  (select bulk_posted from pick_tasks where id = (select p6 from ids)));

do $$ begin
  perform close_pick_line_request((select id from pick_line_requests where kind = 'other_picker' limit 1), 'Supervisor', ' ');
  raise notice 'FAIL closing a request needs a note';
exception when others then raise notice 'PASS closing a request needs a note'; end $$;
select close_pick_line_request((select id from pick_line_requests where kind = 'other_picker' limit 1), 'Supervisor', 'Ani benar, 9') \g /dev/null
select pg_temp.check('closed with name and note: off the open list',
  not exists (select 1 from pick_line_requests_open where kind = 'other_picker')
  and exists (select 1 from pick_line_requests where kind = 'other_picker' and status = 'CLOSED' and closed_by_name = 'Supervisor'));

-- Review focus: a pick posted after its move was posted early keeps that move.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
reset role;
-- import_snapshot makes temp tables (_seen, _replace, _wave_ids) per transaction; a second import here needs them gone.
drop table if exists _seen, _replace, _wave_ids;
delete from inventory v using bins b where b.id = v.bin_id and b.bin_code in ('CC01A01','CC01A02');
set role authenticated;
select import_snapshot('[
 {"bin_code":"CC01A01","zone":"CC","rack":"01","level":"A","position":"01","sku":"550071397","batch_lot":"S1","quantity":36,"expiry_date":"2030-09-01"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-11-03', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH2"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH2","task_type":"PICK","sku":"550071397","from_bin":"CC01A01","batch_lot":"S1","expiry_date":"2030-09-01","quantity":6,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550071397","from_bin":"CC01A01","to_bin":"CC01A02","batch_lot":"S1","expiry_date":"2030-09-01","quantity":30,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null
create temp table ids2 as select
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-03' and t.seq = 1) p,
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-03' and t.seq = 2) m,
  (select id from waves where planned_date = '2026-11-03') w;
-- Budi posts the move first (Posting Bin To Bin saja), leaving 6 in the pallet for the pick.
select post_task((select m from ids2), 30, null, null, null, null) \g /dev/null
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table rm as select post_pick_line((select w from ids2), pg_temp.row((select p from ids2), (select m from ids2),
  '[{"bin":"CC01A01","batch":"S1","expiry":"2030-09-01","qty":6}]', 'CC01A02', 30), 'Ani', 'sesuai', 'CC01A01') as r;
select pg_temp.check('pick posted after its move was posted early keeps the move: CC01A02 30, CC01A01 0, nothing invented',
  (select r->>'result' = 'posted' and (r->>'corrections')::int = 0 from rm) and pg_temp.qty('CC01A02', '550071397') = 30
  and pg_temp.qty('CC01A01', '550071397') = 0
  and not exists (select 1 from movements m join bins b on b.id = m.to_bin_id where b.bin_code = 'CC01A01' and m.reason_code = 'FOUND'));

-- The early-move case above is also: an open pick posted next to a move someone else posted (post_task by the
-- supervisor session, no picker name), the row leaving that move as posted -> allowed.

-- Review focus: a move that is not the pick's own, and another picker's completed move.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
reset role;
drop table if exists _seen, _replace, _wave_ids;
delete from inventory v using bins b where b.id = v.bin_id and b.bin_code in ('CC02A01','CC02A02','CC03A01');
set role authenticated;
select import_snapshot('[
 {"bin_code":"CC02A01","zone":"CC","rack":"02","level":"A","position":"01","sku":"550071397","batch_lot":"S1","quantity":36,"expiry_date":"2030-09-01"},
 {"bin_code":"CC03A01","zone":"CC","rack":"03","level":"A","position":"01","sku":"550071397","batch_lot":"S1","quantity":10,"expiry_date":"2030-09-01"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-11-04', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH3"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH3","task_type":"PICK","sku":"550071397","from_bin":"CC02A01","batch_lot":"S1","expiry_date":"2030-09-01","quantity":6,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550071397","from_bin":"CC02A01","to_bin":"CC02A02","batch_lot":"S1","expiry_date":"2030-09-01","quantity":30,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"1","shipment_number":"SH3","task_type":"PICK","sku":"550071397","from_bin":"CC03A01","batch_lot":"S1","expiry_date":"2030-09-01","quantity":4,"pick_type":"CASE","seq":3}]}'::jsonb) \g /dev/null
create temp table ids3 as select
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-04' and t.seq = 1) a,
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-04' and t.seq = 2) m,
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-04' and t.seq = 3) b,
  (select id from waves where planned_date = '2026-11-04') w;
select post_task((select m from ids3), 30, null, null, null, null) \g /dev/null
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

create temp table req_before as select pg_temp.requests() n;
do $$ begin
  perform post_pick_line((select w from ids3), pg_temp.row((select b from ids3), (select m from ids3),
    '[{"bin":"CC03A01","batch":"S1","expiry":"2030-09-01","qty":4}]', 'CC02A02', 30), 'Ani', 'x', 'CC03A01');
  raise notice 'FAIL a move that is not the pick''s own is refused';
exception when others then raise notice 'PASS a move that is not the pick''s own is refused'; end $$;
select pg_temp.check('that mistake writes no request and posts nothing',
  pg_temp.requests() = (select n from req_before)
  and (select status from pick_tasks where id = (select b from ids3)) = 'PLANNED'
  and (select status from pick_tasks where id = (select m from ids3)) = 'COMPLETED');

create temp table rc as select post_pick_line((select w from ids3), pg_temp.row((select a from ids3), (select m from ids3),
  '[{"bin":"CC02A01","batch":"S1","expiry":"2030-09-01","qty":6}]', 'CC02A02', 20), 'Ani', 'x', 'CC02A01') as r;
select pg_temp.check('changing a move someone else posted (pick still open): request other_picker, move stays as posted',
  (select r->>'result' = 'refused' and r->>'kind' = 'other_picker' from rc)
  and (select status from pick_tasks where id = (select m from ids3)) = 'COMPLETED'
  and (select status from pick_tasks where id = (select a from ids3)) = 'PLANNED'
  and pg_temp.qty('CC02A02', '550071397') = 30 and pg_temp.qty('CC02A01', '550071397') = 6);

create temp table rd as select post_pick_line((select w from ids3), pg_temp.row((select a from ids3), (select m from ids3),
  '[{"bin":"CC02A01","batch":"S2","expiry":"2030-09-01","qty":6}]', 'CC02A02', 30), 'Ani', 'x', 'CC02A01') as r;
select pg_temp.check('same destination, quantity and bin but another batch: other_picker, move stays as posted',
  (select r->>'result' = 'refused' and r->>'kind' = 'other_picker' from rd)
  and (select status from pick_tasks where id = (select m from ids3)) = 'COMPLETED'
  and pg_temp.qty('CC02A02', '550071397') = 30);

create temp table re as select post_pick_line((select w from ids3), pg_temp.row((select a from ids3), (select m from ids3),
  '[{"bin":"CC03A01","batch":"S1","expiry":"2030-09-01","qty":3},{"bin":"CC02A01","batch":"S1","expiry":"2030-09-01","qty":3}]', 'CC02A02', 30), 'Ani', 'x', 'CC03A01') as r;
select pg_temp.check('the move''s bin as second source, another bin first: other_picker, move stays as posted',
  (select r->>'result' = 'refused' and r->>'kind' = 'other_picker' from re)
  and (select status from pick_tasks where id = (select m from ids3)) = 'COMPLETED'
  and pg_temp.qty('CC02A02', '550071397') = 30 and pg_temp.qty('CC03A01', '550071397') = 10);

create temp table rg as select post_pick_line((select w from ids3), pg_temp.row((select a from ids3), (select m from ids3),
  '[{"bin":"CC02A01","batch":"S1","expiry":"2030-09-01","qty":6}]', '', 30), 'Ani', 'x', 'CC02A01') as r;
select pg_temp.check('blank move_to with everything else matching the other''s move: other_picker, move still COMPLETED, stock unchanged',
  (select r->>'result' = 'refused' and r->>'kind' = 'other_picker' from rg)
  and (select status from pick_tasks where id = (select m from ids3)) = 'COMPLETED'
  and (select status from pick_tasks where id = (select a from ids3)) = 'PLANNED'
  and pg_temp.qty('CC02A02', '550071397') = 30 and pg_temp.qty('CC02A01', '550071397') = 6);

create temp table rf as select post_pick_line((select w from ids3), pg_temp.row((select a from ids3), (select m from ids3),
  '[{"bin":" cc02a01 ","batch":"S1","expiry":"2030-09-01","qty":6}]', ' cc02a02', 30), 'Ani', 'x', 'CC02A01') as r;
select pg_temp.check('move_to and bin differing only by case/whitespace read as unchanged: pick posts next to the other''s move',
  (select r->>'result' = 'posted' and (r->>'corrections')::int = 0 from rf)
  and (select status from pick_tasks where id = (select a from ids3)) = 'COMPLETED'
  and pg_temp.qty('CC02A02', '550071397') = 30 and pg_temp.qty('CC02A01', '550071397') = 0);
-- Move-only line (a Bin To Bin with no pick on its line): a blank destination or quantity must be refused,
-- because the engine would cancel the planned move. Fixture: a wave whose only move has no pick.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
reset role;
drop table if exists _seen, _replace, _wave_ids;
delete from inventory v using bins b where b.id = v.bin_id and b.bin_code in ('CC04A01','CC04A02','CC05A01');
set role authenticated;
select import_snapshot('[
 {"bin_code":"CC04A01","zone":"CC","rack":"04","level":"A","position":"01","sku":"550071397","batch_lot":"S1","quantity":5,"expiry_date":"2030-09-01"},
 {"bin_code":"CC05A01","zone":"CC","rack":"05","level":"A","position":"01","sku":"550071397","batch_lot":"S1","quantity":2,"expiry_date":"2030-09-01"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-11-05', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH4"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH4","task_type":"PICK","sku":"550071397","from_bin":"CC05A01","batch_lot":"S1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550071397","from_bin":"CC04A01","to_bin":"CC04A02","batch_lot":"S1","expiry_date":"2030-09-01","quantity":5,"pick_type":"CASE","seq":2}]}'::jsonb) \g /dev/null
create temp table ids4 as select
  (select id from waves where planned_date = '2026-11-05') w,
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-05' and t.seq = 2) mo;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

create temp table req_mo as select pg_temp.requests() n;
do $$ begin
  perform post_pick_line((select w from ids4), pg_temp.row(null, (select mo from ids4),
    '[{"bin":"CC04A01","batch":"S1","expiry":"2030-09-01","qty":5}]', '', 5), 'Ani', 'x', 'CC04A01');
  raise notice 'FAIL a move-only row with a blank destination is refused';
exception when others then
  if sqlerrm like 'Isi bin tujuan dan Qty sisa%' then raise notice 'PASS a move-only row with a blank destination is refused';
  else raise notice 'FAIL a move-only row with a blank destination is refused: %', sqlerrm; end if;
end $$;
do $$ begin
  perform post_pick_line((select w from ids4), pg_temp.row(null, (select mo from ids4),
    '[{"bin":"CC04A01","batch":"S1","expiry":"2030-09-01","qty":5}]', 'CC04A02', 0), 'Ani', 'x', 'CC04A01');
  raise notice 'FAIL a move-only row with zero Qty sisa is refused';
exception when others then
  if sqlerrm like 'Isi bin tujuan dan Qty sisa%' then raise notice 'PASS a move-only row with zero Qty sisa is refused';
  else raise notice 'FAIL a move-only row with zero Qty sisa is refused: %', sqlerrm; end if;
end $$;
select pg_temp.check('those mistakes write no request and leave the Bin To Bin PLANNED, stock unchanged',
  pg_temp.requests() = (select n from req_mo)
  and (select status from pick_tasks where id = (select mo from ids4)) = 'PLANNED'
  and pg_temp.qty('CC04A01', '550071397') = 5 and pg_temp.qty('CC04A02', '550071397') = 0);
-- Final review C1: a line with two sources and a Bin To Bin. The split piece goes after the move, so the
-- line's pick and its move stay neighbours; a move is never re-posted from another line's source.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
reset role;
drop table if exists _seen, _replace, _wave_ids;
delete from inventory v using bins b where b.id = v.bin_id and b.bin_code in ('CC06A01','CC06A02','CC07A01');
set role authenticated;
select import_snapshot('[
 {"bin_code":"CC06A01","zone":"CC","rack":"06","level":"A","position":"01","sku":"550070614","batch_lot":"P11","quantity":36,"expiry_date":"2030-09-11"},
 {"bin_code":"CC07A01","zone":"CC","rack":"07","level":"A","position":"01","sku":"550070614","batch_lot":"P12","quantity":36,"expiry_date":"2030-09-12"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-11-09', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH9"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH9","task_type":"PICK","sku":"550070614","from_bin":"CC06A01","batch_lot":"P11","expiry_date":"2030-09-11","quantity":13,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CC06A01","to_bin":"CC06A02","batch_lot":"P11","expiry_date":"2030-09-11","quantity":23,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null
create temp table ids9 as select (select id from waves where planned_date = '2026-11-09') w,
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-09' and t.seq = 1) p,
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-09' and t.seq = 2) m;
create or replace function pg_temp.batches(p_bin text) returns text language sql as $$
  select string_agg(v.batch_lot || ':' || v.quantity, ',' order by v.batch_lot) from inventory v join bins b on b.id = v.bin_id
  join items i on i.id = v.item_id where b.bin_code = p_bin and i.sku = '550070614' $$;
grant execute on function pg_temp.batches(text) to authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

create temp table r9 as select post_pick_line((select w from ids9), pg_temp.row((select p from ids9), (select m from ids9),
  '[{"bin":"CC06A01","batch":"P11","expiry":"2030-09-11","qty":10},{"bin":"CC07A01","batch":"P12","expiry":"2030-09-12","qty":3}]', 'CC06A02', 26),
  'Ani', 'palet terhalang', ' cc06a01 ') as r;
select pg_temp.check('two sources + rest to the pickface: CC06A01 0, CC07A01 33, CC06A02 26 of P11',
  (select r->>'result' = 'posted' from r9) and pg_temp.qty('CC06A01', '550070614') = 0
  and pg_temp.qty('CC07A01', '550070614') = 33 and pg_temp.batches('CC06A02') = 'P11:26');
select pg_temp.check('the split piece goes after the line''s Bin To Bin: pick #1, move #2, second source #3',
  (select string_agg(t.task_type || '@' || t.seq || ':' || coalesce(ab.bin_code, fb.bin_code), ',' order by t.seq)
   from pick_tasks t join bins fb on fb.id = t.from_bin_id left join bins ab on ab.id = t.actual_from_bin_id
   where t.wave_id = (select w from ids9)) = 'PICK@1:CC06A01,REPLENISH@2:CC06A01,PICK@3:CC07A01'
  and (select seq from pick_tasks where id = (select m from ids9)) = 2);
select pg_temp.check('a scanned line is not bulk: the pick from the scanned bin carries it (whitespace removed), the piece from the second bin and the move none',
  (select bool_and(not bulk_posted and coalesce(scanned_code, '-') = case when seq = 1 then 'CC06A01' else '-' end) from pick_tasks
   where wave_id = (select w from ids9) and task_type = 'PICK')
  and (select not bulk_posted and coalesce(scanned_code, '') = '' from pick_tasks where id = (select m from ids9)));

do $$ begin
  perform post_pick_line((select w from ids9), pg_temp.row((select t.id from pick_tasks t where t.wave_id = (select w from ids9) and t.seq = 3),
    (select m from ids9), '[{"bin":"CC07A01","batch":"P12","expiry":"2030-09-12","qty":2}]', 'CC06A02', 26), 'Ani', 'salah ketik', 'CC07A01');
  raise notice 'FAIL the second source''s piece with the line''s posted move is refused';
exception when others then
  if sqlerrm = 'Bin To Bin ini bukan milik baris ini' then raise notice 'PASS the second source''s piece with the line''s posted move is refused';
  else raise notice 'FAIL the second source''s piece with the line''s posted move is refused: %', sqlerrm; end if;
end $$;
select pg_temp.check('that refusal changes no stock',
  pg_temp.qty('CC06A01', '550070614') = 0 and pg_temp.qty('CC07A01', '550070614') = 33 and pg_temp.batches('CC06A02') = 'P11:26');

create temp table r9b as select post_pick_line((select w from ids9), pg_temp.row((select t.id from pick_tasks t where t.wave_id = (select w from ids9) and t.seq = 3),
  null, '[{"bin":"CC07A01","batch":"P12","expiry":"2030-09-12","qty":2}]', null, null), 'Ani', 'salah ketik', 'CC07A01') as r;
select pg_temp.check('Ubah on the second source alone (3 -> 2): CC07A01 34, CC06A01 0, CC06A02 still 26 of P11',
  (select r->>'result' = 'posted' from r9b) and pg_temp.qty('CC06A01', '550070614') = 0
  and pg_temp.qty('CC07A01', '550070614') = 34 and pg_temp.batches('CC06A02') = 'P11:26');

create temp table r9c as select post_pick_line((select w from ids9), pg_temp.row((select p from ids9), (select m from ids9),
  '[{"bin":"CC06A01","batch":"P11","expiry":"2030-09-11","qty":9}]', 'CC06A02', 26), 'Ani', 'salah ketik', 'CC06A01') as r;
select pg_temp.check('Ubah on the pick + move (10 -> 9): CC06A01 1, CC07A01 34, CC06A02 26 of P11, nothing invented',
  (select r->>'result' = 'posted' and (r->>'corrections')::int = 0 from r9c) and pg_temp.qty('CC06A01', '550070614') = 1
  and pg_temp.qty('CC07A01', '550070614') = 34 and pg_temp.batches('CC06A02') = 'P11:26'
  and (select string_agg(coalesce(ab.bin_code, fb.bin_code) || ':' || coalesce(t.actual_batch_lot, t.batch_lot), ',' order by t.seq)
       from pick_tasks t join bins fb on fb.id = t.from_bin_id left join bins ab on ab.id = t.actual_from_bin_id
       where t.wave_id = (select w from ids9)) = 'CC06A01:P11,CC06A01:P11,CC07A01:P12'
  and not exists (select 1 from movements x join bins b on b.id = x.to_bin_id where b.bin_code in ('CC06A01','CC06A02','CC07A01') and x.reason_code = 'FOUND'));
-- Residual N2 / N3: a Berbeda that changed the source bin moves the planned Bin To Bin's source to the
-- new bin while the pick keeps its plan (and records the real bin). Ubah of that line must still be
-- accepted, and a later second source must still go after the line's move.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
reset role;
drop table if exists _seen, _replace, _wave_ids;
delete from inventory v using bins b where b.id = v.bin_id and b.bin_code in ('CC09A01','CC09A02','CC10A01','CC11A01');
set role authenticated;
select import_snapshot('[
 {"bin_code":"CC09A01","zone":"CC","rack":"09","level":"A","position":"01","sku":"550070614","batch_lot":"P11","quantity":36,"expiry_date":"2030-09-11"},
 {"bin_code":"CC10A01","zone":"CC","rack":"10","level":"A","position":"01","sku":"550070614","batch_lot":"P11","quantity":36,"expiry_date":"2030-09-11"},
 {"bin_code":"CC11A01","zone":"CC","rack":"11","level":"A","position":"01","sku":"550070614","batch_lot":"P12","quantity":36,"expiry_date":"2030-09-12"}]'::jsonb, false, 'uji') \g /dev/null
select save_plan('2026-11-10', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH10"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH10","task_type":"PICK","sku":"550070614","from_bin":"CC09A01","batch_lot":"P11","expiry_date":"2030-09-11","quantity":13,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CC09A01","to_bin":"CC09A02","batch_lot":"P11","expiry_date":"2030-09-11","quantity":23,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null
create temp table ids10 as select (select id from waves where planned_date = '2026-11-10') w,
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-10' and t.seq = 1) p,
  (select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-11-10' and t.seq = 2) m;
create or replace function pg_temp.layout10() returns text language sql as $$
  select string_agg(t.task_type || '@' || t.seq || ':' || coalesce(ab.bin_code, fb.bin_code), ',' order by t.seq)
  from pick_tasks t join bins fb on fb.id = t.from_bin_id left join bins ab on ab.id = t.actual_from_bin_id
  where t.wave_id = (select w from ids10) $$;
grant execute on function pg_temp.layout10() to authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

create temp table r10 as select post_pick_line((select w from ids10), pg_temp.row((select p from ids10), (select m from ids10),
  '[{"bin":"CC10A01","batch":"P11","expiry":"2030-09-11","qty":13}]', 'CC09A02', 23), 'Ani', 'palet terhalang', 'CC10A01') as r;
select pg_temp.check('Berbeda from CC10A01: pick planned CC09A01 / actual CC10A01, move planned CC10A01; CC09A01 36, CC10A01 0, CC09A02 23',
  (select r->>'result' = 'posted' from r10)
  and (select fb.bin_code || '/' || ab.bin_code from pick_tasks t join bins fb on fb.id = t.from_bin_id
       join bins ab on ab.id = t.actual_from_bin_id where t.id = (select p from ids10)) = 'CC09A01/CC10A01'
  and (select fb.bin_code from pick_tasks t join bins fb on fb.id = t.from_bin_id where t.id = (select m from ids10)) = 'CC10A01'
  and pg_temp.qty('CC09A01', '550070614') = 36 and pg_temp.qty('CC10A01', '550070614') = 0 and pg_temp.batches('CC09A02') = 'P11:23');

create temp table r10b as select post_pick_line((select w from ids10), pg_temp.row((select p from ids10), (select m from ids10),
  '[{"bin":"CC10A01","batch":"P11","expiry":"2030-09-11","qty":12}]', 'CC09A02', 24), 'Ani', 'salah hitung', 'CC10A01') as r;
select pg_temp.check('N2: Ubah by the same name after that Berbeda (13 -> 12, rest 24) is posted',
  (select r->>'result' = 'posted' and (r->>'corrections')::int = 0 from r10b));
select pg_temp.check('N2: stock after the Ubah: CC09A01 36, CC10A01 0, CC09A02 24 of P11, CC11A01 36, nothing invented',
  pg_temp.qty('CC09A01', '550070614') = 36 and pg_temp.qty('CC10A01', '550070614') = 0
  and pg_temp.batches('CC09A02') = 'P11:24' and pg_temp.qty('CC11A01', '550070614') = 36
  and (select actual_quantity from pick_tasks where id = (select p from ids10)) = 12
  and (select coalesce(actual_quantity, quantity) from pick_tasks where id = (select m from ids10)) = 24
  and not exists (select 1 from movements x join bins b on b.id = x.to_bin_id
                  where b.bin_code in ('CC09A01','CC09A02','CC10A01','CC11A01') and x.reason_code = 'FOUND'));

create temp table r10c as select post_pick_line((select w from ids10), pg_temp.row((select p from ids10), (select m from ids10),
  '[{"bin":"CC10A01","batch":"P11","expiry":"2030-09-11","qty":10},{"bin":"CC11A01","batch":"P12","expiry":"2030-09-12","qty":3}]', 'CC09A02', 26),
  'Ani', 'palet kurang', 'CC10A01') as r;
select pg_temp.check('N3: a second source after that Berbeda goes after the line''s move: pick #1, move #2, piece #3',
  (select r->>'result' = 'posted' from r10c)
  and pg_temp.layout10() = 'PICK@1:CC10A01,REPLENISH@2:CC10A01,PICK@3:CC11A01'
  and (select seq from pick_tasks where id = (select p from ids10)) = 1
  and (select seq from pick_tasks where id = (select m from ids10)) = 2);
select pg_temp.check('N3: stock after the second source: CC09A01 36, CC10A01 0, CC11A01 33, CC09A02 26 of P11',
  pg_temp.qty('CC09A01', '550070614') = 36 and pg_temp.qty('CC10A01', '550070614') = 0
  and pg_temp.qty('CC11A01', '550070614') = 33 and pg_temp.batches('CC09A02') = 'P11:26');
create temp table r10d as select post_pick_line((select w from ids10), pg_temp.row((select p from ids10), (select m from ids10),
  '[{"bin":"CC10A01","batch":"P11","expiry":"2030-09-11","qty":9}]', 'CC09A02', 27), 'Ani', 'salah hitung', 'CC10A01') as r;
select pg_temp.check('N3: the line still pairs: Ubah of pick + move (10 -> 9, rest 27) is posted; CC10A01 0, CC11A01 33, CC09A02 27',
  (select r->>'result' = 'posted' and (r->>'corrections')::int = 0 from r10d)
  and pg_temp.qty('CC09A01', '550070614') = 36 and pg_temp.qty('CC10A01', '550070614') = 0
  and pg_temp.qty('CC11A01', '550070614') = 33 and pg_temp.batches('CC09A02') = 'P11:27'
  and pg_temp.layout10() = 'PICK@1:CC10A01,REPLENISH@2:CC10A01,PICK@3:CC11A01');
do $$ begin
  perform post_pick_line((select w from ids10), pg_temp.row((select t.id from pick_tasks t where t.wave_id = (select w from ids10) and t.seq = 3),
    (select m from ids10), '[{"bin":"CC11A01","batch":"P12","expiry":"2030-09-12","qty":2}]', 'CC09A02', 27), 'Ani', 'salah ketik', 'CC11A01');
  raise notice 'FAIL N2: the piece with the line''s posted move is still refused';
exception when others then
  if sqlerrm = 'Bin To Bin ini bukan milik baris ini' then raise notice 'PASS N2: the piece with the line''s posted move is still refused';
  else raise notice 'FAIL N2: the piece with the line''s posted move is still refused: %', sqlerrm; end if;
end $$;
rollback;
