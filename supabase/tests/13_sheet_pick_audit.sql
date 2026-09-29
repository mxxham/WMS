-- Picking audit from the WMS file (0029). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}') on conflict do nothing;

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.line(p_ship text, p_bin text) returns uuid language sql as $$
  select id from sheet_pick_lines where pick_date = '2026-10-07' and shipment_number = p_ship and bin_code = p_bin $$;
create or replace function pg_temp.state(p_ship text, p_bin text) returns text language sql as $$
  select line_state from sheet_pick_line_state where id = pg_temp.line(p_ship, p_bin) $$;

update items set ean = '8994123456789' where sku = '550044709';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- ---- A. Loading ------------------------------------------------------------
select pg_temp.check('load: 3 lines added, blank and zero rows skipped',
  load_sheet_pick_lines('2026-10-07', 'K_ONE', 'WMS.xlsx', '[
    {"shipment_number":"S1","seq":1,"bin_code":"cf38c01","sku":"550044709","batch":" a7 ","expiry":"2031-05-05","qty":10,"picker_name":"Budi Santoso"},
    {"shipment_number":"S1","seq":2,"bin_code":"CF37C01","sku":"550024919","batch":"C1","expiry":"2031-07-07","qty":5},
    {"shipment_number":"S2","seq":1,"bin_code":"CF38C02","sku":"550044709","batch":"B8","qty":4},
    {"shipment_number":"S2","seq":2,"bin_code":"CF38C02","sku":"550044709","batch":"B9","qty":0},
    {"shipment_number":"","seq":3,"bin_code":"CF38C02","sku":"550044709","batch":"B9","qty":2}]'::jsonb)
  = '{"added": 3, "kept": 0, "removed": 0, "skipped": 2}'::jsonb);
select pg_temp.check('load: bin upper-cased, batch normalised',
  exists (select 1 from sheet_pick_lines where bin_code = 'CF38C01' and batch = 'A7'));
select pg_temp.check('state: new lines are TODO', pg_temp.state('S1', 'CF38C01') = 'TODO');
select pg_temp.check('load: empty file refused',
  pg_temp.fails($q$select load_sheet_pick_lines('2026-10-07', 'K_ONE', null, '[]'::jsonb)$q$, '%tidak berisi baris%'));

-- ---- B. Auditing -----------------------------------------------------------
select pg_temp.check('audit: checker = picker refused',
  pg_temp.fails(format($q$select record_sheet_pick_audit(%L, 'budi  santoso', '550044709', 10, 'A7', null, false, null)$q$,
    pg_temp.line('S1', 'CF38C01')), '%Checker tidak boleh picker%'));
select pg_temp.check('audit: unknown barcode refused',
  pg_temp.fails(format($q$select record_sheet_pick_audit(%L, 'Sari Dewi', '000', 10, 'A7', null, false, null)$q$,
    pg_temp.line('S1', 'CF38C01')), '%tidak dikenal%'));
select pg_temp.check('audit: mismatch without note refused',
  pg_temp.fails(format($q$select record_sheet_pick_audit(%L, 'Sari Dewi', '550044709', 8, 'A7', null, false, null)$q$,
    pg_temp.line('S1', 'CF38C01')), '%isi catatan%'));
select pg_temp.check('audit: short by barcode is MISMATCH {SHORT}',
  (record_sheet_pick_audit(pg_temp.line('S1', 'CF38C01'), 'Sari Dewi', '8994123456789', 8, 'a7', null, false, 'kurang 2')
   ->'errors') = '["SHORT"]'::jsonb);
select pg_temp.check('state: MISMATCH after short', pg_temp.state('S1', 'CF38C01') = 'MISMATCH');
select pg_temp.check('audit: re-audit OK is attempt 2',
  (record_sheet_pick_audit(pg_temp.line('S1', 'CF38C01'), 'Sari Dewi', '550044709', 10, 'A7', '2031-05-05', false, null)
   ->>'attempt') = '2');
select pg_temp.check('state: OK with 2 attempts',
  (select line_state = 'OK' and attempts = 2 from sheet_pick_line_state where id = pg_temp.line('S1', 'CF38C01')));
select pg_temp.check('audit: passed line refused',
  pg_temp.fails(format($q$select record_sheet_pick_audit(%L, 'Sari Dewi', '550044709', 10, 'A7', null, false, null)$q$,
    pg_temp.line('S1', 'CF38C01')), '%sudah lolos%'));
select pg_temp.check('audit: wrong SKU',
  (record_sheet_pick_audit(pg_temp.line('S1', 'CF37C01'), 'Sari Dewi', '550044709', 5, 'C1', null, false, 'barang lain')
   ->'errors') = '["WRONG_SKU"]'::jsonb);
select pg_temp.check('audit: no direct writes',
  pg_temp.fails($q$insert into sheet_pick_audits (line_id, attempt_no, checker_name, found_sku, counted_qty, expected_sku, expected_qty, result)
                   values (pg_temp.line('S2', 'CF38C02'), 9, 'x', 'x', 1, 'x', 1, 'OK')$q$, '%') -- RLS or missing grant
  and not exists (select 1 from sheet_pick_audits where attempt_no = 9));

-- ---- C. Uploading again ----------------------------------------------------
select pg_temp.check('reload: audited lines kept, unaudited replaced',
  load_sheet_pick_lines('2026-10-07', 'ALLOCATOR', 'WMS2.xlsx', '[
    {"shipment_number":"S1","seq":1,"bin_code":"CF38C01","sku":"550044709","batch":"A7","qty":12},
    {"shipment_number":"S3","seq":1,"bin_code":"CF38C02","sku":"550044709","batch":"B8","qty":3}]'::jsonb)
  = '{"added": 1, "kept": 2, "removed": 1, "skipped": 1}'::jsonb);
select pg_temp.check('reload: audited line keeps its original qty',
  (select qty from sheet_pick_lines where id = pg_temp.line('S1', 'CF38C01')) = 10);
select pg_temp.check('reload: line gone from the new file is removed', pg_temp.line('S2', 'CF38C02') is null);
select pg_temp.check('reload: new line added', pg_temp.state('S3', 'CF38C02') = 'TODO');

-- ---- D. At the rack (0030) --------------------------------------------------
select load_sheet_pick_lines('2026-10-08', 'ALLOCATOR', 'WMS3.xlsx', '[
  {"shipment_number":"R1","seq":1,"bin_code":"CF38C01","sku":"550044709","batch":"A7","qty":10,"bin_remaining":30,"picker_name":"Budi Santoso"},
  {"shipment_number":"R2","seq":2,"bin_code":"CF38C01","sku":"550044709","batch":"A7","qty":8,"bin_remaining":22},
  {"shipment_number":"R3","seq":1,"bin_code":"CF37C01","sku":"550024919","batch":"C1","qty":5,"bin_remaining":0},
  {"shipment_number":"R4","seq":1,"bin_code":"STAGING","sku":"550024919","batch":"C1","qty":3}]'::jsonb);
create or replace function pg_temp.rline(p_ship text) returns sheet_pick_line_state language sql as $$
  select * from sheet_pick_line_state where pick_date = '2026-10-08' and shipment_number = p_ship $$;
select pg_temp.check('rack: checker = picker of a line in the bin refused',
  pg_temp.fails($q$select record_sheet_rack_audit('2026-10-08', 'cf38c01', '550044709', 'Budi Santoso', 22, null)$q$, '%Checker tidak boleh picker%'));
select pg_temp.check('rack: difference needs a note',
  pg_temp.fails($q$select record_sheet_rack_audit('2026-10-08', 'CF38C01', '550044709', 'Sari Dewi', 24, null)$q$, '%Catatan wajib%'));
select pg_temp.check('rack: 2 more left than the file -> short on the last line only',
  record_sheet_rack_audit('2026-10-08', 'CF38C01', '550044709', 'Sari Dewi', 24, 'sisa lebih 2')
  = '{"result":"MISMATCH","system":22,"counted":24,"diff":2,"lines":2}'::jsonb);
select pg_temp.check('rack: first line OK, last line SHORT counted 6',
  (pg_temp.rline('R1')).line_state = 'OK' and (pg_temp.rline('R2')).line_state = 'MISMATCH'
  and (select counted_qty = 6 and errors = '{SHORT}' and method = 'RACK' and rack_system = 22
       from sheet_pick_audits where line_id = (pg_temp.rline('R2')).id));
select pg_temp.check('rack: recount after the fix passes the rest',
  (record_sheet_rack_audit('2026-10-08', 'CF38C01', '550044709', 'Sari Dewi', 22, null)->>'lines') = '1'
  and (pg_temp.rline('R2')).line_state = 'OK');
select pg_temp.check('rack: nothing left to audit in the bin',
  pg_temp.fails($q$select record_sheet_rack_audit('2026-10-08', 'CF38C01', '550044709', 'Sari Dewi', 22, null)$q$, '%Tidak ada baris%'));
select pg_temp.check('rack: count equal to the file is OK',
  (record_sheet_rack_audit('2026-10-08', 'CF37C01', '550024919', 'Sari Dewi', 0, null)->>'result') = 'OK');
select pg_temp.check('rack: negative remaining refused on load',
  pg_temp.fails($q$select load_sheet_pick_lines('2026-10-09', 'K_ONE', null, '[{"shipment_number":"X","bin_code":"CA01A01","sku":"550024919","qty":1,"bin_remaining":-1}]'::jsonb)$q$, '%bin_remaining%'));
select pg_temp.check('rack: bin without remaining in the file refused',
  pg_temp.fails($q$select record_sheet_rack_audit('2026-10-08', 'STAGING', '550024919', 'Sari Dewi', 3, null)$q$, '%tidak mencatat sisa%'));

rollback;
