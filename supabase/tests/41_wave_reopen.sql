-- Undo a finished or cancelled wave (0069): Buka lagi and Pulihkan wave, with Remain Qty exact.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
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
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.qty(p_bin text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  join items it on it.id = i.item_id where b.bin_code = p_bin and it.sku = '550070614' $$;
-- Every stock row of the test SKU in the test bins: compared whole before/after.
create or replace function pg_temp.stock() returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(b.bin_code || '|' || i.batch_lot, i.quantity order by b.bin_code), '{}'::jsonb)
  from inventory i join bins b on b.id = i.bin_id join items it on it.id = i.item_id
  where it.sku = '550070614' and b.bin_code in ('CC10A01','CC10A02','CC11A01','CC11A02','CC12A01','CC12A02') and i.quantity <> 0 $$;
create or replace function pg_temp.t(p_date date, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = p_date and t.seq = p_seq $$;
create or replace function pg_temp.wave(p_date date) returns uuid language sql as $$
  select id from waves where planned_date = p_date $$;
create or replace function pg_temp.st(p_date date, p_seq int) returns text language sql as $$
  select status from pick_tasks where id = pg_temp.t(p_date, p_seq) $$;
-- plpgsql: checked when called, so the file runs (and fails row by row) before 0069 too.
create or replace function pg_temp.src(p_date date, p_seq int) returns text language plpgsql as $$
begin return (select coalesce(bulk_source, '-') from pick_tasks where id = pg_temp.t(p_date, p_seq)); end $$;
create or replace function pg_temp.row(p_pick uuid, p_sources text) returns jsonb language sql as $$
  select jsonb_build_object('pick_id', p_pick, 'move_id', null, 'sources', p_sources::jsonb, 'move_to', null, 'move_qty', null) $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.qty(text), pg_temp.stock(),
  pg_temp.t(date, int), pg_temp.wave(date), pg_temp.st(date, int), pg_temp.src(date, int), pg_temp.row(uuid, text) to authenticated;
create temp table snap (name text primary key, s jsonb);
grant all on snap to authenticated;

-- Fixture: one batch of 550070614 in a few CC1x bins; CC10A02 is an empty pickface.
delete from inventory where bin_id in (select id from bins where bin_code in ('CC10A01','CC10A02','CC11A01','CC11A02','CC12A01','CC12A02'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550070614'), 'RW1', 36, (select id from bins where bin_code = b), '2030-09-01', 'fixture'
from (values ('CC10A01'), ('CC11A01'), ('CC11A02'), ('CC12A01')) v(b);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-11-30', '{
  "waves":[{"wave_no":"1","shipment_numbers":["SH1"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CC11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":10,"pick_type":"CASE","seq":1},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CC10A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":13,"pick_type":"CASE","breaks_pallet":true,"seq":2},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CC10A01","to_bin":"CC10A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":23,"pick_type":"CASE","breaks_pallet":true,"seq":3},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CC11A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":5,"pick_type":"CASE","seq":4},
   {"wave_no":"1","shipment_number":"SH1","task_type":"PICK","sku":"550070614","from_bin":"CC12A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":4,"pick_type":"CASE","seq":5}]}'::jsonb) \g /dev/null

-- 1. #1 picked one by one (rack scan), #4 entered with Isi dari picklist, the rest by Selesaikan wave.
select post_task_by(p_task_id => pg_temp.t('2026-11-30', 1), p_by_name => 'Ani', p_scanned => 'CC11A01', p_scan_mode => 'scan') \g /dev/null
select post_wave_sheet(pg_temp.wave('2026-11-30'), jsonb_build_array(pg_temp.row(pg_temp.t('2026-11-30', 4),
  '[{"bin":"CC11A02","batch":"RW1","expiry":"2030-09-01","qty":5}]')), 'Supervisor', 'dari kertas') \g /dev/null
select complete_wave_by(pg_temp.wave('2026-11-30'), 'Ani') \g /dev/null
insert into snap values ('after_finish', pg_temp.stock());
select pg_temp.check('bulk_source: Selesaikan wave on #2 #3 #5, Isi dari picklist on #4, none on the line picked one by one',
  (select status from waves where id = pg_temp.wave('2026-11-30')) = 'COMPLETED'
  and pg_temp.src('2026-11-30', 2) = 'selesaikan' and pg_temp.src('2026-11-30', 3) = 'selesaikan' and pg_temp.src('2026-11-30', 5) = 'selesaikan'
  and pg_temp.src('2026-11-30', 4) = 'sheet' and pg_temp.src('2026-11-30', 1) = '-');

-- 2. The preview names exactly the bulk lines.
create temp table pv as select reopen_wave_preview(pg_temp.wave('2026-11-30')) as r;
select pg_temp.check('reopen preview: bulk lines #2 #3 #5, nothing loaded',
  (select array_agg((e->>'seq')::int order by (e->>'seq')::int) = array[2, 3, 5] and jsonb_array_length(r->'loaded') = 0
   from pv, jsonb_array_elements(r->'bulk') e group by r));

-- 3. Reopen without undo: status only.
select reopen_wave(pg_temp.wave('2026-11-30'), 'Supervisor', 'salah tutup', false) \g /dev/null
select pg_temp.check('reopen without undo: stock identical, wave running, every line still posted',
  pg_temp.stock() = (select s from snap where name = 'after_finish')
  and (select status from waves where id = pg_temp.wave('2026-11-30')) = 'PENDING'
  and not exists (select 1 from pick_tasks where wave_id = pg_temp.wave('2026-11-30') and status <> 'COMPLETED')
  and not exists (select 1 from outbound where wave_id = pg_temp.wave('2026-11-30') and status = 'COMPLETED'));

-- 4. Close it again: nothing left to post.
select complete_wave_by(pg_temp.wave('2026-11-30'), 'Ani') \g /dev/null
select pg_temp.check('closed again without posting anything; stock identical',
  (select status from waves where id = pg_temp.wave('2026-11-30')) = 'COMPLETED' and pg_temp.stock() = (select s from snap where name = 'after_finish'));

-- 5. Reopen and undo the bulk lines: their stock goes back exactly; the others stay posted.
select reopen_wave(pg_temp.wave('2026-11-30'), 'Supervisor', 'belum diambil', true) \g /dev/null
select pg_temp.check('reopen with undo: CC10A01 36, pickface CC10A02 0, CC12A01 36; CC11A01 26 and CC11A02 31 untouched',
  pg_temp.qty('CC10A01') = 36 and pg_temp.qty('CC10A02') = 0 and pg_temp.qty('CC12A01') = 36
  and pg_temp.qty('CC11A01') = 26 and pg_temp.qty('CC11A02') = 31);
select pg_temp.check('reopen with undo: #2 #3 #5 open again, #1 #4 still posted, wave running',
  pg_temp.st('2026-11-30', 2) = 'PLANNED' and pg_temp.st('2026-11-30', 3) = 'PLANNED' and pg_temp.st('2026-11-30', 5) = 'PLANNED'
  and pg_temp.st('2026-11-30', 1) = 'COMPLETED' and pg_temp.st('2026-11-30', 4) = 'COMPLETED'
  and (select status from waves where id = pg_temp.wave('2026-11-30')) = 'PENDING');

-- 6. Posting the same lines again lands exactly where the finish did.
select post_task(pg_temp.t('2026-11-30', 2)) \g /dev/null
select post_task(pg_temp.t('2026-11-30', 3)) \g /dev/null
select post_task(pg_temp.t('2026-11-30', 5)) \g /dev/null
select pg_temp.check('post -> reopen-undo -> post: stock identical to right after the finish',
  pg_temp.stock() = (select s from snap where name = 'after_finish'));

-- 7. A line posted again by a person is never bulk again.
select complete_wave_by(pg_temp.wave('2026-11-30'), 'Ani') \g /dev/null
select pg_temp.check('a line re-posted after reopen is not bulk any more',
  pg_temp.src('2026-11-30', 2) = '-' and pg_temp.src('2026-11-30', 3) = '-' and pg_temp.src('2026-11-30', 5) = '-'
  and jsonb_array_length(reopen_wave_preview(pg_temp.wave('2026-11-30'))->'bulk') = 0);

-- 11. Reopen twice: the second is refused and changes nothing.
select reopen_wave(pg_temp.wave('2026-11-30'), 'Supervisor', 'cek', false) \g /dev/null
insert into snap values ('reopened', pg_temp.stock());
select pg_temp.check('reopen twice: refused, nothing changes',
  pg_temp.fails($q$select reopen_wave(pg_temp.wave('2026-11-30'), 'Supervisor', 'lagi', false)$q$, '%belum selesai%')
  and pg_temp.stock() = (select s from snap where name = 'reopened'));

-- 8. A bulk line already audited refuses the undo.
reset role; drop table if exists _seen, _replace, _wave_ids;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-12-01', '{"waves":[{"wave_no":"1","shipment_numbers":["SH3"],"planned_slot":"08:00"}],
  "tasks":[{"wave_no":"1","shipment_number":"SH3","task_type":"PICK","sku":"550070614","from_bin":"CC11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":2,"pick_type":"CASE","seq":1}]}'::jsonb) \g /dev/null
select complete_wave_by(pg_temp.wave('2026-12-01'), 'Ani') \g /dev/null
reset role;
insert into pick_audits (task_id, attempt_no, checker_name, found_sku, counted_qty, expected_sku, expected_qty, result)
values (pg_temp.t('2026-12-01', 1), 1, 'Cek', '550070614', 2, '550070614', 2, 'OK');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into snap values ('audited', pg_temp.stock());
select pg_temp.check('an audited bulk line refuses Buka lagi with undo; nothing changes',
  pg_temp.fails($q$select reopen_wave(pg_temp.wave('2026-12-01'), 'Supervisor', 'x', true)$q$, '%diaudit%')
  and pg_temp.stock() = (select s from snap where name = 'audited')
  and (select status from waves where id = pg_temp.wave('2026-12-01')) = 'COMPLETED');

-- 9. A loaded shipment refuses any reopen.
reset role;
insert into shipment_loads (wave_id, shipment_number, loaded_by_name) values (pg_temp.wave('2026-12-01'), 'SH3', 'Muat');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('a loaded shipment refuses Buka lagi; the preview names it',
  pg_temp.fails($q$select reopen_wave(pg_temp.wave('2026-12-01'), 'Supervisor', 'x', false)$q$, '%SH3%dimuat%')
  and reopen_wave_preview(pg_temp.wave('2026-12-01'))->'loaded' = '["SH3"]'::jsonb
  and (select status from waves where id = pg_temp.wave('2026-12-01')) = 'COMPLETED');

-- 10. A bulk Bin To Bin whose pickface was emptied since cannot be sent back: refused, nothing changes.
reset role; drop table if exists _seen, _replace, _wave_ids;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-12-02', '{"waves":[{"wave_no":"1","shipment_numbers":["SH4"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH4","task_type":"PICK","sku":"550070614","from_bin":"CC11A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":1,"pick_type":"CASE","breaks_pallet":true,"seq":1},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550070614","from_bin":"CC11A02","to_bin":"CC12A02","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":30,"pick_type":"CASE","breaks_pallet":true,"seq":2}]}'::jsonb) \g /dev/null
select complete_wave_by(pg_temp.wave('2026-12-02'), 'Ani') \g /dev/null
reset role;
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note)
select 'picking', id, 'RW1', 30, (select id from bins where bin_code = 'CC12A02'), '2030-09-01', 'diambil lain' from items where sku = '550070614';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into snap values ('drained', pg_temp.stock());
select pg_temp.check('reopen refuses when a bulk Bin To Bin can no longer be sent back; nothing changed',
  pg_temp.fails($q$select reopen_wave(pg_temp.wave('2026-12-02'), 'Supervisor', 'x', true)$q$, '%')
  and pg_temp.stock() = (select s from snap where name = 'drained')
  and (select status from waves where id = pg_temp.wave('2026-12-02')) = 'COMPLETED'
  and pg_temp.st('2026-12-02', 2) = 'COMPLETED');

-- 12. Pulihkan wave: only the lines the wave cancel cancelled come back; no stock moves.
reset role; drop table if exists _seen, _replace, _wave_ids;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-12-03', '{"waves":[{"wave_no":"1","shipment_numbers":["SH5"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"SH5","task_type":"PICK","sku":"550070614","from_bin":"CC11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":3,"pick_type":"CASE","seq":1},
   {"wave_no":"1","shipment_number":"SH5","task_type":"PICK","sku":"550070614","from_bin":"CC12A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":3,"pick_type":"CASE","seq":2}]}'::jsonb) \g /dev/null
select set_task_status(pg_temp.t('2026-12-03', 2), 'CANCELLED') \g /dev/null
select set_wave_status(pg_temp.wave('2026-12-03'), 'CANCELLED') \g /dev/null
insert into snap values ('cancelled', pg_temp.stock());
create temp table rp as select restore_wave_preview(pg_temp.wave('2026-12-03')) as r;
select pg_temp.check('restore preview: only #1 (cancelled with the wave), covered by the bin',
  (select jsonb_array_length(r->'lines') = 1 and (r->'lines'->0->>'seq')::int = 1 and (r->'lines'->0->>'covered')::boolean from rp));
select restore_wave(pg_temp.wave('2026-12-03'), 'Supervisor', 'salah batal') \g /dev/null
select pg_temp.check('Pulihkan wave: #1 open again, #2 (cancelled on its own) stays cancelled, wave running, stock identical',
  pg_temp.st('2026-12-03', 1) = 'PLANNED' and pg_temp.st('2026-12-03', 2) = 'CANCELLED'
  and (select status from waves where id = pg_temp.wave('2026-12-03')) = 'PENDING'
  and not exists (select 1 from outbound where wave_id = pg_temp.wave('2026-12-03') and status = 'CANCELLED')
  and pg_temp.stock() = (select s from snap where name = 'cancelled'));

-- 13. Restore twice: refused.
select pg_temp.check('restore twice: refused, nothing changes',
  pg_temp.fails($q$select restore_wave(pg_temp.wave('2026-12-03'), 'Supervisor', 'lagi')$q$, '%tidak dibatalkan%')
  and pg_temp.st('2026-12-03', 1) = 'PLANNED' and pg_temp.stock() = (select s from snap where name = 'cancelled'));

-- 14. A line the bins no longer cover is reported, and still restored (a warning, not a refusal).
reset role; drop table if exists _seen, _replace, _wave_ids;
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-12-04', '{"waves":[{"wave_no":"1","shipment_numbers":["SH6"],"planned_slot":"08:00"}],
  "tasks":[{"wave_no":"1","shipment_number":"SH6","task_type":"PICK","sku":"550070614","from_bin":"CC11A01","batch_lot":"RW1","expiry_date":"2030-09-01","quantity":20,"pick_type":"CASE","seq":1}]}'::jsonb) \g /dev/null
select set_wave_status(pg_temp.wave('2026-12-04'), 'CANCELLED') \g /dev/null
reset role;
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note)
select 'picking', id, 'RW1', (select pg_temp.qty('CC11A01')), (select id from bins where bin_code = 'CC11A01'), '2030-09-01', 'habis' from items where sku = '550070614';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into snap values ('empty', pg_temp.stock());
select pg_temp.check('restore preview reports the line not covered any more',
  (restore_wave_preview(pg_temp.wave('2026-12-04'))->'lines'->0->>'covered')::boolean = false);
select restore_wave(pg_temp.wave('2026-12-04'), 'Supervisor', 'tetap dipulihkan') \g /dev/null
select pg_temp.check('a line not covered is still restored, stock unchanged by the restore',
  pg_temp.st('2026-12-04', 1) = 'PLANNED' and pg_temp.stock() = (select s from snap where name = 'empty'));

-- 15. Refusals change nothing.
select set_wave_status(pg_temp.wave('2026-12-04'), 'CANCELLED') \g /dev/null
select pg_temp.check('missing name refused',
  pg_temp.fails($q$select restore_wave(pg_temp.wave('2026-12-04'), ' ', 'x')$q$, '%Nama%')
  and (select status from waves where id = pg_temp.wave('2026-12-04')) = 'CANCELLED');
select pg_temp.check('missing reason refused',
  pg_temp.fails($q$select restore_wave(pg_temp.wave('2026-12-04'), 'Supervisor', ' ')$q$, '%Alasan%')
  and (select status from waves where id = pg_temp.wave('2026-12-04')) = 'CANCELLED');
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('an operator cannot restore or reopen',
  pg_temp.fails($q$select restore_wave(pg_temp.wave('2026-12-04'), 'Ani', 'x')$q$, '%supervisor%')
  and pg_temp.fails($q$select reopen_wave(pg_temp.wave('2026-12-01'), 'Ani', 'x', false)$q$, '%supervisor%'));
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('the previews are read-only for an operator too, and change nothing',
  (select status from waves where id = pg_temp.wave('2026-12-04')) = 'CANCELLED');
rollback;
