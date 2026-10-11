-- Rack scan confirmation (0068): every posting at the bin is confirmed by the bin's label (scanned or typed),
-- never by an item barcode. Runs in a transaction and rolls back. Every line prints PASS/FAIL.
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
  join items it on it.id = i.item_id where b.bin_code = p_bin and it.sku = '550044709' $$;
create or replace function pg_temp.t(p_date date, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = p_date and t.seq = p_seq $$;
create or replace function pg_temp.wave(p_date date) returns uuid language sql as $$
  select id from waves where planned_date = p_date $$;
create or replace function pg_temp.row(p_pick uuid, p_move uuid, p_sources text, p_to text, p_mq numeric) returns jsonb language sql as $$
  select jsonb_build_object('pick_id', p_pick, 'move_id', p_move, 'sources', p_sources::jsonb, 'move_to', p_to, 'move_qty', p_mq) $$;
create or replace function pg_temp.requests() returns bigint language sql as $$ select count(*) from pick_line_requests $$;
-- plpgsql: checked when called, so the file runs (and fails row by row) before 0068 too.
create or replace function pg_temp.stamp(p_id uuid) returns text language plpgsql as $$
begin return (select coalesce(scanned_code, '-') || '/' || coalesce(scan_method, '-') from pick_tasks where id = p_id); end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.fails(text, text), pg_temp.qty(text), pg_temp.t(date, int),
  pg_temp.wave(date), pg_temp.row(uuid, uuid, text, text, numeric), pg_temp.requests(), pg_temp.stamp(uuid) to authenticated;

-- Fixture: one batch of 550044709 in a few CF35 / CF36 bins (labels are strips of five levels A-E).
delete from inventory where bin_id in (select id from bins where bin_code ~ '^CF3[56]');
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = '550044709'), 'H1', q, (select id from bins where bin_code = b), '2030-08-18', 'fixture'
from (values ('CF35D02', 10), ('CF35D01', 10), ('CF36C01', 10), ('CF36C02', 6), ('CF36D02', 10), ('CF35B01', 4), ('CF35B02', 10),
             ('CF36E01', 8), ('CF35C01', 10), ('CF35C02', 10), ('CF35E01', 10), ('CF36A01', 10), ('CF36B02', 10), ('CF35E02', 5)) v(b, q);

select pg_temp.check('the item has no barcode: the old item scan could never confirm a line',
  (select ean is null from items where sku = '550044709'));

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-11-20', '{
  "waves":[{"wave_no":"1","shipment_numbers":["RS1"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"RS1","task_type":"PICK","sku":"550044709","from_bin":"CF35D02","batch_lot":"H1","expiry_date":"2030-08-18","quantity":5,"pick_type":"CASE","seq":1},
   {"wave_no":"1","shipment_number":"RS1","task_type":"PICK","sku":"550044709","from_bin":"CF35D01","batch_lot":"H1","expiry_date":"2030-08-18","quantity":4,"pick_type":"CASE","seq":2},
   {"wave_no":"1","shipment_number":"RS1","task_type":"PICK","sku":"550044709","from_bin":"CF36C01","batch_lot":"H1","expiry_date":"2030-08-18","quantity":3,"pick_type":"CASE","seq":3},
   {"wave_no":"1","shipment_number":"RS1","task_type":"PICK","sku":"550044709","from_bin":"CF36C02","batch_lot":"H1","expiry_date":"2030-08-18","quantity":6,"pick_type":"CASE","seq":4},
   {"wave_no":"1","shipment_number":"RS1","task_type":"PICK","sku":"550044709","from_bin":"CF35B01","batch_lot":"H1","expiry_date":"2030-08-18","quantity":4,"pick_type":"CASE","seq":5},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF36E01","to_bin":"CF36E02","batch_lot":"H1","expiry_date":"2030-08-18","quantity":8,"pick_type":"CASE","seq":6}]}'::jsonb) \g /dev/null
-- save_plan's temp tables, once per transaction.
reset role; drop table if exists _replace, _wave_ids; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select save_plan('2026-11-21', '{
  "waves":[{"wave_no":"1","shipment_numbers":["RS2"],"planned_slot":"08:00"}],
  "tasks":[
   {"wave_no":"1","shipment_number":"RS2","task_type":"PICK","sku":"550044709","from_bin":"CF35C01","batch_lot":"H1","expiry_date":"2030-08-18","quantity":2,"pick_type":"CASE","seq":1},
   {"wave_no":"1","shipment_number":"RS2","task_type":"PICK","sku":"550044709","from_bin":"CF35C02","batch_lot":"H1","expiry_date":"2030-08-18","quantity":2,"pick_type":"CASE","seq":2},
   {"wave_no":"1","shipment_number":"RS2","task_type":"PICK","sku":"550044709","from_bin":"CF36A01","batch_lot":"H1","expiry_date":"2030-08-18","quantity":4,"pick_type":"CASE","breaks_pallet":true,"seq":3},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF36A01","to_bin":"CF36A02","batch_lot":"H1","expiry_date":"2030-08-18","quantity":6,"pick_type":"CASE","breaks_pallet":true,"seq":4},
   {"wave_no":"1","shipment_number":"RS2","task_type":"PICK","sku":"550044709","from_bin":"CF36B01","batch_lot":"H1","expiry_date":"2030-08-18","quantity":3,"pick_type":"CASE","seq":5},
   {"wave_no":"1","task_type":"REPLENISH","sku":"550044709","from_bin":"CF35E02","to_bin":"CF35A02","batch_lot":"H1","expiry_date":"2030-08-18","quantity":5,"pick_type":"CASE","seq":6}]}'::jsonb) \g /dev/null
create temp table a as select pg_temp.wave('2026-11-20') w, pg_temp.t('2026-11-20', 1) p1, pg_temp.t('2026-11-20', 2) p2,
  pg_temp.t('2026-11-20', 3) p3, pg_temp.t('2026-11-20', 4) p4, pg_temp.t('2026-11-20', 5) p5, pg_temp.t('2026-11-20', 6) m6;
create temp table b as select pg_temp.wave('2026-11-21') w, pg_temp.t('2026-11-21', 1) p1, pg_temp.t('2026-11-21', 2) p2,
  pg_temp.t('2026-11-21', 3) p3, pg_temp.t('2026-11-21', 4) m4, pg_temp.t('2026-11-21', 5) p5, pg_temp.t('2026-11-21', 6) m6;
grant select on a, b to authenticated;
reset role;
select pg_temp.check('pick_tasks.scan_method only takes scan / ketik',
  pg_temp.fails($q$update pick_tasks set scan_method = 'kamera' where id = (select p1 from a)$q$, '%pick_tasks_scan_method_check%'));
set role authenticated;

-- From here on: the operator.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- ---- post_pick_line -------------------------------------------------------
create temp table req0 as select pg_temp.requests() n;
select pg_temp.check('post_pick_line: no scan is refused',
  pg_temp.fails($q$select post_pick_line((select w from a), pg_temp.row((select p1 from a), null,
    '[{"bin":"CF35D02","batch":"H1","expiry":"2030-08-18","qty":5}]', null, null), 'Ani', 'sesuai')$q$, 'Scan label bin dulu (atau ketik kodenya)'));
select pg_temp.check('post_pick_line: a blank scan is refused',
  pg_temp.fails($q$select post_pick_line((select w from a), pg_temp.row((select p1 from a), null,
    '[{"bin":"CF35D02","batch":"H1","expiry":"2030-08-18","qty":5}]', null, null), 'Ani', 'sesuai', '  ', 'scan')$q$, 'Scan label bin dulu (atau ketik kodenya)'));
select pg_temp.check('post_pick_line: the neighbouring level (CF35C02 for CF35D02) is refused, naming both bins',
  pg_temp.fails($q$select post_pick_line((select w from a), pg_temp.row((select p1 from a), null,
    '[{"bin":"CF35D02","batch":"H1","expiry":"2030-08-18","qty":5}]', null, null), 'Ani', 'sesuai', 'CF35C02', 'scan')$q$,
    'Bin salah: kamu scan CF35C02, baris ini CF35D02'));
select pg_temp.check('post_pick_line: an item barcode / SKU is not a bin confirmation',
  pg_temp.fails($q$select post_pick_line((select w from a), pg_temp.row((select p1 from a), null,
    '[{"bin":"CF35D02","batch":"H1","expiry":"2030-08-18","qty":5}]', null, null), 'Ani', 'sesuai', '550044709', 'scan')$q$,
    'Bin salah: kamu scan 550044709, baris ini CF35D02'));
select pg_temp.check('post_pick_line: an unknown confirmation mode is refused',
  pg_temp.fails($q$select post_pick_line((select w from a), pg_temp.row((select p1 from a), null,
    '[{"bin":"CF35D02","batch":"H1","expiry":"2030-08-18","qty":5}]', null, null), 'Ani', 'sesuai', 'CF35D02', 'kamera')$q$, '%scan atau ketik%'));
select pg_temp.check('refused inputs write no request, post nothing, take no stock',
  pg_temp.requests() = (select n from req0) and (select status from pick_tasks where id = (select p1 from a)) = 'PLANNED'
  and pg_temp.qty('CF35D02') = 10);

create temp table r1 as select post_pick_line((select w from a), pg_temp.row((select p1 from a), null,
  '[{"bin":"CF35D02","batch":"H1","expiry":"2030-08-18","qty":5}]', null, null), 'Ani', 'sesuai', ' cf35 d02 ', 'scan') as r;
select pg_temp.check('the right bin (case and spaces ignored) posts: CF35D02 10 -> 5, scanned_code CF35D02, method scan',
  (select r->>'result' = 'posted' from r1) and pg_temp.qty('CF35D02') = 5
  and pg_temp.stamp((select p1 from a)) = 'CF35D02/scan'
  and (select not bulk_posted from pick_tasks where id = (select p1 from a)));

create temp table r2 as select post_pick_line((select w from a), pg_temp.row((select p2 from a), null,
  '[{"bin":"CF35D01","batch":"H1","expiry":"2030-08-18","qty":4}]', null, null), 'Ani', 'sesuai', 'CF35D01', 'ketik') as r;
select pg_temp.check('a typed bin code posts and is recorded as typed (ketik)',
  (select r->>'result' = 'posted' from r2) and pg_temp.qty('CF35D01') = 6 and pg_temp.stamp((select p2 from a)) = 'CF35D01/ketik');

create temp table r3 as select post_pick_line(p_wave_id => (select w from a), p_row => pg_temp.row((select p3 from a), null,
  '[{"bin":"CF36C01","batch":"H1","expiry":"2030-08-18","qty":3}]', null, null), p_by_name => 'Ani', p_reason => 'sesuai', p_scanned => 'CF36C01') as r;
select pg_temp.check('the 5-argument call of the deployed app (no p_scan_mode) still posts with the right bin, recorded as scan',
  (select r->>'result' = 'posted' from r3) and pg_temp.qty('CF36C01') = 7 and pg_temp.stamp((select p3 from a)) = 'CF36C01/scan');

select pg_temp.check('Berbeda: the planned bin is no confirmation when the row takes from another bin',
  pg_temp.fails($q$select post_pick_line((select w from a), pg_temp.row((select p4 from a), null,
    '[{"bin":"CF36D02","batch":"H1","expiry":"2030-08-18","qty":6}]', null, null), 'Ani', 'palet terhalang', 'CF36C02', 'scan')$q$,
    'Bin salah: kamu scan CF36C02, baris ini CF36D02'));
create temp table r4 as select post_pick_line((select w from a), pg_temp.row((select p4 from a), null,
  '[{"bin":"CF36D02","batch":"H1","expiry":"2030-08-18","qty":6}]', null, null), 'Ani', 'palet terhalang', 'CF36D02', 'scan') as r;
select pg_temp.check('Berbeda: the row''s own first source confirms it: CF36D02 10 -> 4, CF36C02 untouched',
  (select r->>'result' = 'posted' from r4) and pg_temp.qty('CF36D02') = 4 and pg_temp.qty('CF36C02') = 6
  and pg_temp.stamp((select p4 from a)) = 'CF36D02/scan');

select pg_temp.check('a first source with 0 cartons is not where the picker stands: the engine''s first source (CF35B02) is',
  pg_temp.fails($q$select post_pick_line((select w from a), pg_temp.row((select p5 from a), null,
    '[{"bin":"CF35B01","batch":"H1","expiry":"2030-08-18","qty":0},{"bin":"CF35B02","batch":"H1","expiry":"2030-08-18","qty":4}]', null, null),
    'Ani', 'bin kosong / kurang', 'CF35B01', 'scan')$q$, 'Bin salah: kamu scan CF35B01, baris ini CF35B02'));
create temp table r5 as select post_pick_line((select w from a), pg_temp.row((select p5 from a), null,
  '[{"bin":"CF35B01","batch":"H1","expiry":"2030-08-18","qty":0},{"bin":"CF35B02","batch":"H1","expiry":"2030-08-18","qty":4}]', null, null),
  'Ani', 'bin kosong / kurang', 'CF35B02', 'scan') as r;
select pg_temp.check('... and posts with CF35B02: CF35B02 10 -> 6, CF35B01 untouched',
  (select r->>'result' = 'posted' from r5) and pg_temp.qty('CF35B02') = 6 and pg_temp.qty('CF35B01') = 4);

select pg_temp.check('move-only line: the destination is no confirmation',
  pg_temp.fails($q$select post_pick_line((select w from a), pg_temp.row(null, (select m6 from a),
    '[{"bin":"CF36E01","batch":"H1","expiry":"2030-08-18","qty":0}]', 'CF36E02', 8), 'Ani', 'sesuai', 'CF36E02', 'scan')$q$,
    'Bin salah: kamu scan CF36E02, baris ini CF36E01'));
create temp table r6 as select post_pick_line((select w from a), pg_temp.row(null, (select m6 from a),
  '[{"bin":"CF36E01","batch":"H1","expiry":"2030-08-18","qty":0}]', 'CF36E02', 8), 'Ani', 'sesuai', 'CF36E01', 'scan') as r;
select pg_temp.check('move-only line confirmed against its source (the pallet): CF36E01 8 -> 0, CF36E02 0 -> 8',
  (select r->>'result' = 'posted' from r6) and pg_temp.qty('CF36E01') = 0 and pg_temp.qty('CF36E02') = 8);

select pg_temp.check('Ubah of one''s own posted line needs the bin again',
  pg_temp.fails($q$select post_pick_line((select w from a), pg_temp.row((select p1 from a), null,
    '[{"bin":"CF35D02","batch":"H1","expiry":"2030-08-18","qty":4}]', null, null), 'Ani', 'salah hitung')$q$, 'Scan label bin dulu (atau ketik kodenya)'));
create temp table r1b as select post_pick_line((select w from a), pg_temp.row((select p1 from a), null,
  '[{"bin":"CF35D02","batch":"H1","expiry":"2030-08-18","qty":4}]', null, null), 'Ani', 'salah hitung', 'CF35D02', 'ketik') as r;
select pg_temp.check('... and the re-post records the new confirmation: 4 taken, CF35D02 6, typed',
  (select r->>'result' = 'posted' from r1b) and pg_temp.qty('CF35D02') = 6 and pg_temp.stamp((select p1 from a)) = 'CF35D02/ketik');
select pg_temp.check('a confirmation does not leak: nothing of this wave is left with a method but no bin',
  not exists (select 1 from pick_tasks where wave_id = (select w from a) and scan_method is not null and scanned_code is null));
select pg_temp.check('the settings are reset after post_pick_line',
  coalesce(current_setting('app.pick_scanned', true), '') = '' and coalesce(current_setting('app.pick_scan_method', true), '') = '');

-- ---- post_task_by -----------------------------------------------------------
select pg_temp.check('post_task_by: no scan is refused',
  pg_temp.fails($q$select post_task_by((select p1 from b), p_by_name => 'Budi')$q$, 'Scan label bin dulu (atau ketik kodenya)'));
select pg_temp.check('post_task_by: the neighbouring level is refused',
  pg_temp.fails($q$select post_task_by((select p1 from b), p_by_name => 'Budi', p_scanned => 'CF35D01')$q$, 'Bin salah: kamu scan CF35D01, baris ini CF35C01'));
select pg_temp.check('post_task_by: the right bin posts, scanned_code CF35C01, method scan',
  (post_task_by((select p1 from b), p_by_name => 'Budi', p_scanned => 'cf35c01')->>'result') = 'POSTED'
  and pg_temp.qty('CF35C01') = 8 and pg_temp.stamp((select p1 from b)) = 'CF35C01/scan');
select pg_temp.check('post_task_by from another bin (Berbeda): the planned bin is refused',
  pg_temp.fails($q$select post_task_by((select p2 from b), 2, 'CF35E01', 'H1', '2030-08-18', 'palet terhalang', 'Budi', 'CF35C02', 'scan')$q$,
    'Bin salah: kamu scan CF35C02, baris ini CF35E01'));
select pg_temp.check('post_task_by from another bin, typed: posts from CF35E01, recorded ketik',
  (post_task_by((select p2 from b), 2, 'CF35E01', 'H1', '2030-08-18', 'palet terhalang', 'Budi', 'CF35E01', 'ketik')->>'result') = 'POSTED'
  and pg_temp.qty('CF35E01') = 8 and pg_temp.qty('CF35C02') = 10 and pg_temp.stamp((select p2 from b)) = 'CF35E01/ketik');

-- ---- post_pick_with_move ----------------------------------------------------
select pg_temp.check('post_pick_with_move: the pickface (destination) is refused',
  pg_temp.fails($q$select post_pick_with_move((select p3 from b), (select m4 from b), null, null, null, 'Budi', 'CF36A02', 'scan')$q$,
    'Bin salah: kamu scan CF36A02, baris ini CF36A01'));
select pg_temp.check('post_pick_with_move: no scan is refused',
  pg_temp.fails($q$select post_pick_with_move((select p3 from b), (select m4 from b), null, null, null, 'Budi')$q$, 'Scan label bin dulu (atau ketik kodenya)'));
select pg_temp.check('post_pick_with_move: the pallet bin posts both; the pick carries the bin, the move no scan',
  (post_pick_with_move((select p3 from b), (select m4 from b), null, null, null, 'Budi', 'CF36A01', 'scan')->'move'->>'result') = 'POSTED'
  and pg_temp.qty('CF36A01') = 0 and pg_temp.qty('CF36A02') = 6
  and pg_temp.stamp((select p3 from b)) = 'CF36A01/scan' and pg_temp.stamp((select m4 from b)) = '-/-');

-- ---- post_task_found_elsewhere ----------------------------------------------
select pg_temp.check('found elsewhere: the planned bin is refused (the cartons are taken from CF36B02)',
  pg_temp.fails($q$select post_task_found_elsewhere((select p5 from b), 'CF36B02', 3, 'barang ada di CF36B02', 'Budi', 'CF36B01', 'scan')$q$,
    'Bin salah: kamu scan CF36B01, baris ini CF36B02'));
select pg_temp.check('found elsewhere: no scan is refused',
  pg_temp.fails($q$select post_task_found_elsewhere((select p5 from b), 'CF36B02', 3, 'barang ada di CF36B02', 'Budi')$q$, 'Scan label bin dulu (atau ketik kodenya)'));
select pg_temp.check('found elsewhere: the other bin posts, CF36B02 10 -> 7, scanned_code CF36B02',
  post_task_found_elsewhere((select p5 from b), 'cf36b02', 3, 'barang ada di CF36B02', 'Budi', 'CF36B02', 'scan') @> '{"result":"POSTED","moved_on_books":0}'
  and pg_temp.qty('CF36B02') = 7 and pg_temp.stamp((select p5 from b)) = 'CF36B02/scan');

-- ---- unchanged paths --------------------------------------------------------
select pg_temp.check('Posting Bin To Bin saja (post_move_early) still posts without a scan',
  (post_move_early((select m6 from b), 'Budi')->>'result') = 'POSTED' and pg_temp.qty('CF35A02') = 5);

-- ---- unpost and audit -------------------------------------------------------
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select unpost_task((select p1 from b), 'Supervisor', 'salah posting') \g /dev/null
select pg_temp.check('unpost clears the bin confirmation and its method',
  (select status = 'PLANNED' and scanned_code is null and scan_method is null from pick_tasks where id = (select p1 from b)));
select pg_temp.check('pick_audit_line carries scan_method as its last column',
  (select attname = 'scan_method' from pg_attribute where attrelid = 'public.pick_audit_line'::regclass and attnum > 0 and not attisdropped
   order by attnum desc limit 1)
  and (select scan_method = 'ketik' from pick_audit_line where task_id = (select p2 from a)));

reset role;
select pg_temp.check('grants: post_pick_line takes 6 arguments only, callable by authenticated and not by anon',
  not exists (select 1 from pg_proc where proname = 'post_pick_line' and pronargs <> 6)
  and has_function_privilege('authenticated', 'public.post_pick_line(uuid, jsonb, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.post_pick_line(uuid, jsonb, text, text, text, text)', 'execute'));
select pg_temp.check('grants: post_task_by / post_pick_with_move / found_elsewhere take the trailing mode, not anon',
  has_function_privilege('authenticated', 'public.post_task_by(uuid, numeric, text, text, date, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.post_task_by(uuid, numeric, text, text, date, text, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.post_pick_with_move(uuid, uuid, numeric, numeric, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.post_pick_with_move(uuid, uuid, numeric, numeric, text, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.post_task_found_elsewhere(uuid, text, numeric, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.post_task_found_elsewhere(uuid, text, numeric, text, text, text, text)', 'execute')
  and not exists (select 1 from pg_proc where proname in ('post_task_by', 'post_pick_with_move', 'post_task_found_elsewhere')
                  and pronargs in (8, 7, 6) and pronamespace = 'public'::regnamespace
                  and (proname, pronargs) in (('post_task_by', 8), ('post_pick_with_move', 7), ('post_task_found_elsewhere', 6))));
select pg_temp.check('the internal posting core is not callable by clients',
  not has_function_privilege('authenticated', 'public.post_task_core(uuid, numeric, text, text, date, text, text, text, text)', 'execute'));
rollback;
