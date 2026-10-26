-- CKB 3PL SAP snapshots (0100): validation, duplicate files, immutability, explicit activation,
-- comparison, and who may read them.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql

create or replace function pg_temp.file(sha text) returns jsonb language sql immutable as $$
  select jsonb_build_object('name', 'stok_' || left(sha, 4) || '.xlsx', 'sha256', sha, 'size', 2048, 'sheet', 'Sheet1', 'header_line', 1) $$;
create or replace function pg_temp.sha(n int) returns text language sql immutable as $$ select repeat(to_hex(n), 64 / length(to_hex(n))) $$;

-- Two rows with the same identity (material + bin + batch + expiry + unit) on purpose.
\set rows1 '[{"line":2,"material_code":"M-100","description":"Copper concentrate bag","plant":"1100","storage_location":"WH05","storage_bin":"cg01a01","batch":"B1","expiry_date":null,"uom":"bag","quantity":40,"stock_type":""},{"line":3,"material_code":"M-100","description":"Copper concentrate bag","plant":"1100","storage_location":"WH05","storage_bin":"CG01A01","batch":"B1","expiry_date":null,"uom":"BAG","quantity":2,"stock_type":""},{"line":4,"material_code":"M-200","description":"Drum","plant":"1100","storage_location":"WH05","storage_bin":"CG01A02","batch":"","expiry_date":"2027-03-31","uom":"DR","quantity":0,"stock_type":""}]'
\set rows2 '[{"line":2,"material_code":"M-100","plant":"1100","storage_location":"WH05","storage_bin":"CG01A01","batch":"B1","uom":"BAG","quantity":30},{"line":3,"material_code":"M-300","plant":"1100","storage_location":"WH05","storage_bin":"CG02A01","batch":"","uom":"KG","quantity":12.5}]'

set role authenticated;
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator cannot import',
  pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date, %L, %L, '[]', null)$q$, :'c_fp', pg_temp.file(pg_temp.sha(1)), :'rows1'), 'Hanya supervisor%'));

select pg_temp.as_user(pg_temp.u('sup'));
select ckb_import_sap_snapshot(:'c_fp', date '2026-10-20', pg_temp.file(pg_temp.sha(1)), :'rows1',
  '[{"line":5,"message":"qty kosong"}]', 'stok awal') as imp1 \gset
select pg_temp.check('a supervisor imports a snapshot', (select row_count from ckb_sap_imports where id = :'imp1') = 3);
select pg_temp.check('rows the parser rejected are kept on the import for the report',
  (select rejected_count = 1 and errors->0->>'message' = 'qty kosong' from ckb_sap_imports where id = :'imp1'));
select pg_temp.check('the mapping is recorded as unverified', (select not mapping_verified from ckb_sap_imports where id = :'imp1'));
select pg_temp.check('bin and unit are normalised to upper case, identity is the full key',
  (select count(distinct identity_key) from ckb_sap_snapshot_rows where import_id = :'imp1') = 2
  and (select bool_and(storage_bin = upper(storage_bin) and uom = upper(uom)) from ckb_sap_snapshot_rows where import_id = :'imp1'));
select pg_temp.check('duplicate identity rows are kept as uploaded and counted, not merged',
  (select duplicate_identity_count = 1 and total_qty = 42 from ckb_sap_import_summary where id = :'imp1'));
select pg_temp.check('a zero quantity row is a real row (not dropped)',
  exists (select 1 from ckb_sap_snapshot_rows where import_id = :'imp1' and material_code = 'M-200' and quantity = 0));
select pg_temp.check('the same file for the same customer is refused as a duplicate',
  pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date, %L, %L, '[]', null)$q$, :'c_fp', pg_temp.file(pg_temp.sha(1)), :'rows2'), '%sudah pernah diimpor%SAP%'));
select pg_temp.check('a missing quantity is refused, never read as zero',
  pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date, %L, '[{"line":2,"material_code":"M1","uom":"KG"}]', '[]', null)$q$, :'c_fp', pg_temp.file(pg_temp.sha(2))), 'Baris 2 tidak valid%'));
select pg_temp.check('a quantity given as text is refused',
  pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date, %L, '[{"line":7,"material_code":"M1","uom":"KG","quantity":"12"}]', '[]', null)$q$, :'c_fp', pg_temp.file(pg_temp.sha(2))), 'Baris 7 tidak valid%'));
select pg_temp.check('a missing unit is refused',
  pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date, %L, '[{"line":3,"material_code":"M1","quantity":1}]', '[]', null)$q$, :'c_fp', pg_temp.file(pg_temp.sha(2))), 'Baris 3 tidak valid%'));
select pg_temp.check('a negative quantity is refused',
  pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date, %L, '[{"line":4,"material_code":"M1","uom":"KG","quantity":-1}]', '[]', null)$q$, :'c_fp', pg_temp.file(pg_temp.sha(2))), 'Baris 4 tidak valid%'));
select pg_temp.check('an expiry that is not a date is refused',
  pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date, %L, '[{"line":5,"material_code":"M1","uom":"KG","quantity":1,"expiry_date":"31.03.2027"}]', '[]', null)$q$, :'c_fp', pg_temp.file(pg_temp.sha(2))), 'Baris 5 tidak valid%'));
select pg_temp.check('a file without valid rows is refused',
  pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date, %L, '[]', '[]', null)$q$, :'c_fp', pg_temp.file(pg_temp.sha(2))), 'File tidak berisi%'));
select pg_temp.check('a snapshot date in the future is refused',
  pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date + 3, %L, %L, '[]', null)$q$, :'c_fp', pg_temp.file(pg_temp.sha(2)), :'rows2'), '%masa depan%'));
select pg_temp.check('an invalid checksum is refused',
  pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date, %L, %L, '[]', null)$q$, :'c_fp', pg_temp.file('abc'), :'rows2'), 'Checksum%'));

-- Activation is explicit.
select pg_temp.check('importing does not activate a snapshot', (select active_snapshot_id is null from ckb_customers where id = :'c_fp'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator cannot activate', pg_temp.fails(format('select ckb_activate_snapshot(%L)', :'imp1'), 'Hanya supervisor%'));
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_activate_snapshot(:'imp1');
select pg_temp.check('a supervisor activates it, and it is logged',
  (select active_snapshot_id from ckb_customers where id = :'c_fp') = :'imp1'::uuid
  and exists (select 1 from ckb_audit_events where action = 'SNAPSHOT_ACTIVATE' and entity_id = :'imp1'));

select ckb_import_sap_snapshot(:'c_fp', date '2026-10-25', pg_temp.file(pg_temp.sha(3)), :'rows2', '[]', null) as imp2 \gset
select pg_temp.check('a newer import leaves the earlier snapshot exactly as it was',
  (select count(*) = 3 and sum(quantity) = 42 from ckb_sap_snapshot_rows where import_id = :'imp1'));
select pg_temp.check('the same file may be imported for a different customer',
  not pg_temp.fails(format($q$select ckb_import_sap_snapshot(%L, current_date, %L, %L, '[]', null)$q$, :'c_cgp', pg_temp.file(pg_temp.sha(3)), :'rows2'), '%'));

select pg_temp.check('comparison: one changed, one removed, one added',
  (select count(*) filter (where change = 'CHANGED' and delta = -12) = 1
      and count(*) filter (where change = 'REMOVED' and material_code = 'M-200') = 1
      and count(*) filter (where change = 'ADDED' and material_code = 'M-300' and qty_b = 12.5) = 1
   from ckb_compare_snapshots(:'imp1', :'imp2')));
select pg_temp.check('snapshots of different customers cannot be compared',
  pg_temp.fails(format('select * from ckb_compare_snapshots(%L, (select id from ckb_sap_imports where customer_id = %L))', :'imp1', :'c_cgp'), '%customer yang sama%'));

-- Representatives see results, not raw SAP data.
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('a representative reads no imports or snapshot rows, even of their own customer',
  (select count(*) from ckb_sap_imports) = 0 and (select count(*) from ckb_sap_snapshot_rows) = 0);
select pg_temp.check('a representative cannot compare snapshots',
  pg_temp.fails(format('select * from ckb_compare_snapshots(%L, %L)', :'imp1', :'imp2'), 'Akses ditolak%'));

reset role;
select pg_temp.check('snapshot rows cannot be edited, even by the database owner',
  pg_temp.fails(format('update ckb_sap_snapshot_rows set quantity = 1 where import_id = %L', :'imp1'), '%tidak bisa diubah%'));
select pg_temp.check('snapshot rows cannot be deleted', pg_temp.fails(format('delete from ckb_sap_snapshot_rows where import_id = %L', :'imp1'), '%tidak bisa diubah%'));
select pg_temp.check('an import header cannot be edited', pg_temp.fails(format('update ckb_sap_imports set note = ''x'' where id = %L', :'imp1'), '%tidak bisa diubah%'));

rollback;
