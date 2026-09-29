-- Picking audit at the rack (0025). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.task(p_ship text) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-10-07' and t.shipment_number = p_ship $$;
create or replace function pg_temp.line(p_ship text) returns pick_audit_line language sql as $$
  select * from pick_audit_line where task_id = pg_temp.task(p_ship) $$;

-- Fixture: A7 x48 in CF38C01 (two lines: RA1 10, RA2 6), C1 x30 in CF37C01 (RA3 5).
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF37C01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = s), bt, q, (select id from bins where bin_code = b), e::date, 'fixture'
from (values ('CF38C01', '550044709', 'A7', 48, '2031-05-05'), ('CF37C01', '550024919', 'C1', 30, '2031-07-07')) v(b, s, bt, q, e);

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select save_plan('2026-10-07', '{
  "waves":[{"wave_no":"1","shipment_numbers":["RA1","RA2","RA3"]}],
  "tasks":[
    {"wave_no":"1","shipment_number":"RA1","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":10,"seq":1},
    {"wave_no":"1","shipment_number":"RA2","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":6,"seq":2},
    {"wave_no":"1","shipment_number":"RA3","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":5,"seq":3}],
  "outbound":[
    {"wave_no":"1","shipment_number":"RA1","sku":"550044709","quantity_requested":10,"quantity_allocated":10},
    {"wave_no":"1","shipment_number":"RA2","sku":"550044709","quantity_requested":6,"quantity_allocated":6},
    {"wave_no":"1","shipment_number":"RA3","sku":"550024919","quantity_requested":5,"quantity_allocated":5}]}'::jsonb);

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select post_task_by(pg_temp.task('RA1'), p_by_name => 'Budi Santoso');
select post_task_by(pg_temp.task('RA2'), p_by_name => 'Budi Santoso');
select post_task_by(pg_temp.task('RA3'), p_by_name => 'Rina');

-- ---- The rack list -------------------------------------------------------
select pg_temp.check('rack list: one row per bin + SKU, no quantities',
  (select count(*) from pick_audit_rack where planned_date = '2026-10-07') = 2
  and (select lines from pick_audit_rack where planned_date = '2026-10-07' and bin_code = 'CF38C01') = 2);

-- ---- Guards --------------------------------------------------------------
select pg_temp.check('picker cannot count their own bin',
  pg_temp.fails($$select record_rack_audit('2026-10-07', 'CF38C01', '550044709', 'budi  santoso', 32)$$, 'Checker tidak boleh picker%'));
select pg_temp.check('difference needs a note',
  pg_temp.fails($$select record_rack_audit('2026-10-07', 'CF38C01', '550044709', 'Sari', 30)$$, 'Catatan wajib%'));
select pg_temp.check('bin with nothing to audit refused',
  pg_temp.fails($$select record_rack_audit('2026-10-07', 'CF38C02', '550044709', 'Sari', 0)$$, 'Tidak ada baris%'));

-- ---- Less left than the system: the latest line took more (OVER) --------
select pg_temp.check('48 - 10 - 6 = 32 expected, 30 left: mismatch',
  record_rack_audit('2026-10-07', 'CF38C01', '550044709', 'Sari', 30, 'kurang 2 di rak') @> '{"result":"MISMATCH","system":32,"diff":-2,"lines":2}');
select pg_temp.check('difference on the most recent line: RA2 OVER, counted 8',
  (pg_temp.line('RA2')).line_state = 'MISMATCH' and (pg_temp.line('RA2')).errors = '{OVER}'
  and (select counted_qty from pick_audits where task_id = pg_temp.task('RA2')) = 8);
select pg_temp.check('the other line of the bin passes',
  (pg_temp.line('RA1')).line_state = 'OK');
select pg_temp.check('attempt is marked RACK with system and counted',
  (select method = 'RACK' and rack_system = 32 and rack_counted = 30 from pick_audits where task_id = pg_temp.task('RA1')));

-- ---- Floor fix (extra cartons back to the bin), recount: only RA2 left ---
select pg_temp.check('recount 32: OK, only the failed line is counted again',
  record_rack_audit('2026-10-07', 'CF38C01', '550044709', 'Sari', 32) @> '{"result":"OK","lines":1}');
select pg_temp.check('RA2 passes on attempt 2, RA1 untouched',
  (pg_temp.line('RA2')).line_state = 'OK' and (pg_temp.line('RA2')).attempts = 2
  and (pg_temp.line('RA1')).attempts = 1);
select pg_temp.check('bin gone from the rack list once passed',
  not exists (select 1 from pick_audit_rack where planned_date = '2026-10-07' and bin_code = 'CF38C01'));

-- ---- More left than the system: picker took less (SHORT), then accept ----
select pg_temp.check('30 - 5 = 25 expected, 27 left: mismatch',
  record_rack_audit('2026-10-07', 'CF37C01', '550024919', 'Sari', 27, 'lebih 2 di rak') @> '{"result":"MISMATCH","diff":2}');
select pg_temp.check('RA3 SHORT, counted 3',
  (pg_temp.line('RA3')).errors = '{SHORT}'
  and (select counted_qty from pick_audits where task_id = pg_temp.task('RA3')) = 3);
-- ---- Wrong item in the bin (0031), undone after ----------------------------
savepoint wrong_item;
select pg_temp.check('wrong item: unknown barcode refused',
  pg_temp.fails($$select record_rack_audit('2026-10-07', 'CF37C01', '550024919', 'Sari', 0, 'x', '000')$$, '%tidak dikenal%'));
select pg_temp.check('wrong item: note required',
  pg_temp.fails($$select record_rack_audit('2026-10-07', 'CF37C01', '550024919', 'Sari', 25, null, '550044709')$$, '%barang di bin salah%'));
select pg_temp.check('wrong item: scanning the expected SKU is a normal count',
  record_rack_audit('2026-10-07', 'CF37C01', '550024919', 'Sari', 25, null, '550024919') @> '{"result":"OK","found_sku":null}');
rollback to savepoint wrong_item;
select pg_temp.check('wrong item: other SKU found fails every open line with WRONG_SKU',
  record_rack_audit('2026-10-07', 'CF37C01', '550024919', 'Sari', 25, 'isi bin 550044709', ' 550044709 ')
    @> '{"result":"MISMATCH","found_sku":"550044709"}');
select pg_temp.check('wrong item: line records WRONG_SKU and the SKU found',
  (select found_sku = '550044709' and found_scanned_code is null and errors = '{WRONG_SKU}'
       from pick_audits where task_id = pg_temp.task('RA3') order by attempt_no desc limit 1));
rollback to savepoint wrong_item;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select resolve_pick_mismatch((select id from pick_audits where task_id = pg_temp.task('RA3')), 'ACCEPT_SHORT', 'Pak Dedi', 'kirim 3');
select pg_temp.check('Terima kurang puts the 2 back: bin now 27, line resolved',
  (select sum(i.quantity) from inventory i join bins b on b.id = i.bin_id where b.bin_code = 'CF37C01') = 27
  and (pg_temp.line('RA3')).line_state = 'RESOLVED');

-- ---- A cancelled wave leaves the accuracy KPIs (0026) ---------------------
select pg_temp.check('audited lines count in the KPIs',
  (select count(*) from pick_audit_first where planned_date = '2026-10-07') = 3);
select set_wave_status((select id from waves where planned_date = '2026-10-07' and wave_no = '1'), 'CANCELLED', 'uji', null, null);
select pg_temp.check('cancelled wave: its lines drop out of the KPIs',
  (select count(*) from pick_audit_first where planned_date = '2026-10-07') = 0);

rollback;
