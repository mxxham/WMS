-- CKB count profile (0161-0162): per-customer mapping and identity, the EMCL seed, the merge of batch codes at session creation,
-- batch as information, found stock, and what an operator may read. Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql

create or replace function pg_temp.file(sha text) returns jsonb language sql immutable as $$
  select jsonb_build_object('name', 'emcl_' || left(sha, 4) || '.xlsx', 'sha256', sha, 'size', 2048, 'sheet', 'Sheet1', 'header_line', 1) $$;
create or replace function pg_temp.sha(n int) returns text language sql immutable as $$ select repeat(to_hex(n), 64 / length(to_hex(n))) $$;

select id as c_emcl from ckb_customers where code = 'EMCL' \gset

-- ---------------------------------------------------------------------
-- 1  The profile and the seed
-- ---------------------------------------------------------------------
select pg_temp.check('the six original customers keep the defaults: full identity, photo per line, the global mapping',
  (select count(*) = 6 and bool_and(count_identity = 'FULL' and photo_scope = 'TASK' and sap_mapping is null)
     from ckb_customers where code in ('FREEPORT', 'CGP', 'SIP', 'MNE', 'BOILER', 'SSB')));
select pg_temp.check('EMCL is seeded: material and bin, photo per bin, its own mapping, not verified',
  (select count_identity = 'MATERIAL_BIN' and photo_scope = 'BIN' and not (sap_mapping->>'verified')::boolean
     and sap_mapping->'columns'->'quantity' ? 'total stoc' and sap_mapping->'columns'->'storage_bin' ? 'storage bi'
     and sap_mapping->'columns'->'stock_type' ? 'mtyp' and sap_mapping->'columns'->'plant' ? 'id1'
     from ckb_customers where id = :'c_emcl'::uuid));

set role authenticated;
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a staff member reads the mapping that applies: the customer''s own, else the global one',
  (ckb_sap_mapping_for(:'c_emcl'::uuid)->'columns'->'quantity') ? 'total stoc'
  and (ckb_sap_mapping_for(:'c_fp'::uuid)->'columns'->'quantity') ? 'unrestricted'
  and not ((ckb_sap_mapping_for(:'c_fp'::uuid)->'columns'->'quantity') ? 'total stoc'));
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('a customer representative cannot read mappings', pg_temp.fails(format($q$select ckb_sap_mapping_for(%L)$q$, :'c_fp'), 'Hanya staf CKB%'));

select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('only an admin sets a count profile',
  pg_temp.fails(format($q$select ckb_set_customer_count_profile(%L, 'MATERIAL_BIN', 'BIN', null)$q$, :'c_cgp'), 'Hanya admin CKB%'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator cannot either',
  pg_temp.fails(format($q$select ckb_set_customer_count_profile(%L, 'MATERIAL_BIN', 'BIN', null)$q$, :'c_cgp'), 'Hanya admin CKB%'));

select pg_temp.as_user(pg_temp.u('adm'));
select pg_temp.check('the profile values and the mapping are validated',
  pg_temp.fails(format($q$select ckb_set_customer_count_profile(%L, 'BATCH', 'TASK', null)$q$, :'c_cgp'), 'Identitas hitung tidak dikenal')
  and pg_temp.fails(format($q$select ckb_set_customer_count_profile(%L, 'FULL', 'ROOM', null)$q$, :'c_cgp'), 'Cakupan foto tidak dikenal')
  and pg_temp.fails(format($q$select ckb_set_customer_count_profile(%L, 'FULL', 'TASK', '{"verified": false, "columns": {"material_code": ["m"]}}')$q$, :'c_cgp'), 'Pemetaan SAP butuh%')
  and pg_temp.fails(format($q$select ckb_set_customer_count_profile(%L, 'FULL', 'TASK', '{"columns": {"material_code": ["m"], "quantity": ["q"], "uom": ["u"]}}')$q$, :'c_cgp'), 'Pemetaan SAP butuh%')
  and pg_temp.fails(format($q$select ckb_set_customer_count_profile(%L, 'FULL', 'TASK', null)$q$, gen_random_uuid()), 'Pelanggan tidak ditemukan'));
select ckb_set_customer_count_profile(:'c_cgp'::uuid, 'MATERIAL_BIN', 'BIN',
  '{"verified": false, "columns": {"material_code": ["artikel"], "quantity": ["jumlah"], "uom": ["sat"], "storage_bin": ["lokasi"]}}'::jsonb);
select pg_temp.check('the admin sets it, with a before and after in the audit log',
  (select count_identity = 'MATERIAL_BIN' and photo_scope = 'BIN' and sap_mapping->'columns'->'quantity' ? 'jumlah' from ckb_customers where id = :'c_cgp'::uuid)
  and exists (select 1 from ckb_audit_events where action = 'CUSTOMER_COUNT_PROFILE' and customer_id = :'c_cgp'::uuid
              and details->'before'->>'count_identity' = 'FULL' and details->'after'->>'count_identity' = 'MATERIAL_BIN'));
select ckb_set_customer_count_profile(:'c_cgp'::uuid, 'FULL', 'TASK', null);
select pg_temp.check('and back to the defaults (null mapping = the global one again)',
  (select count_identity = 'FULL' and photo_scope = 'TASK' and sap_mapping is null from ckb_customers where id = :'c_cgp'::uuid));

-- ---------------------------------------------------------------------
-- 2  The import records the mapping that was used
-- ---------------------------------------------------------------------
\set rows_emcl '[{"line":2,"material_code":"4015743","description":"MOBIL DTE 10 EXCEL 32","plant":"ID1","storage_bin":"cml-l-flr","batch":"FC1PMCL01","uom":"pl","quantity":2,"stock_type":"HOLD"},{"line":3,"material_code":"4015743","description":"MOBIL DTE 10 EXCEL 32","plant":"ID1","storage_bin":"CML-L-FLR","batch":"FC2PMCL01","uom":"PL","quantity":5,"stock_type":"HOLD"},{"line":4,"material_code":"4015743","description":"MOBIL DTE 10 EXCEL 32","plant":"ID1","storage_bin":"CML-L-FLR","batch":"FC3PMCL01","uom":"PL","quantity":2,"stock_type":"HOLD"},{"line":5,"material_code":"686277","description":"OIL;TELLUS S2 M 68","plant":"ID1","storage_bin":"CML-YARD","batch":"FC-PMCL01","uom":"DRM","quantity":8,"stock_type":"INV"},{"line":6,"material_code":"686277","description":"OIL;TELLUS S2 M 68","plant":"ID1","storage_bin":"CML-H-FLR","batch":"FC1PMCL01","uom":"DRM","quantity":3,"stock_type":"INV"},{"line":7,"material_code":"1573008","description":"VALVE;CTRL;BAL","plant":"ID1","storage_bin":"CML-FHYARD","batch":"FC-PMCL01","uom":"EA","quantity":1,"stock_type":"CAP"},{"line":8,"material_code":"4041727","description":"COOLANT","plant":"ID1","storage_bin":"CML-P-FLR","batch":"FC1PMCL01","uom":"EA","quantity":30,"stock_type":"HOLD"},{"line":9,"material_code":"4041727","description":"COOLANT","plant":"ID1","storage_bin":"CML-P-FLR","batch":"FC1PMCL01","uom":"EA","quantity":4,"stock_type":"HOLD"}]'
\set rows_fp '[{"line":2,"material_code":"M-100","plant":"1100","storage_location":"WH05","storage_bin":"CG01A01","batch":"B1","uom":"BAG","quantity":40},{"line":3,"material_code":"M-100","plant":"1100","storage_location":"WH05","storage_bin":"CG01A01","batch":"B2","uom":"BAG","quantity":6}]'

select pg_temp.as_user(pg_temp.u('sup'));
select ckb_import_sap_snapshot(:'c_emcl'::uuid, date '2026-11-13', pg_temp.file(pg_temp.sha(11)), :'rows_emcl', '[]', 'contoh') as imp_e \gset
select ckb_import_sap_snapshot(:'c_fp'::uuid, date '2026-11-13', pg_temp.file(pg_temp.sha(12)), :'rows_fp', '[]', null) as imp_f \gset
select pg_temp.check('the EMCL import records EMCL''s own mapping, the Freeport one records the global mapping',
  (select mapping->'quantity' ? 'total stoc' and not mapping_verified from ckb_sap_imports where id = :'imp_e'::uuid)
  and (select mapping->'quantity' ? 'unrestricted' and not mapping->'quantity' ? 'total stoc' from ckb_sap_imports where id = :'imp_f'::uuid));
select pg_temp.check('the snapshot stays faithful: batches kept, full identity keys, the true duplicate (same batch twice) counted',
  (select count(*) = 8 and count(distinct identity_key) = 7 from ckb_sap_snapshot_rows where import_id = :'imp_e'::uuid)
  and (select duplicate_identity_count = 1 from ckb_sap_import_summary where id = :'imp_e'::uuid));

-- ---------------------------------------------------------------------
-- 3  A session counts by the customer's identity (0162)
-- ---------------------------------------------------------------------
select ckb_create_stocktake(:'c_emcl'::uuid, :'imp_e'::uuid, 'FULL', null, 'Warehouse 5', true, array[pg_temp.u('op')]::uuid[], null) as st_e \gset
select ckb_create_stocktake(:'c_fp'::uuid, :'imp_f'::uuid, 'FULL', null, 'Warehouse 5', true, array[pg_temp.u('op')]::uuid[], null) as st_f \gset
reset role;
update ckb_stocktakes set photo_rules = false where id in (:'st_e'::uuid, :'st_f'::uuid);
set role authenticated;
select pg_temp.as_user(pg_temp.u('sup'));

select pg_temp.check('EMCL: 8 lines become 5 count tasks (3 lines of one material and bin are one task); Freeport: 2 lines stay 2 tasks',
  (select count(*) = 5 from ckb_stocktake_tasks(:'st_e'::uuid)) and (select count(*) = 2 from ckb_stocktake_tasks(:'st_f'::uuid)));
select pg_temp.check('the merged task sums the baseline, keeps the stock type, drops batch and expiry, and keeps what it was made of',
  (select baseline_qty = 9 and baseline_rows = 3 and identity_issue is null and batch = '' and expiry_date is null and stock_type = 'HOLD'
          and batch_codes = array['FC1PMCL01', 'FC2PMCL01', 'FC3PMCL01'] and jsonb_array_length(batch_detail) = 3
          and (select sum((x->>'qty')::numeric) = 9 from jsonb_array_elements(batch_detail) x)
     from ckb_stocktake_tasks(:'st_e'::uuid) where material_code = '4015743'));
select pg_temp.check('the same material in two bins is two tasks; INV, HOLD and CAP stay as SAP has them',
  (select count(*) = 2 from ckb_stocktake_tasks(:'st_e'::uuid) where material_code = '686277')
  and (select stock_type = 'CAP' from ckb_stocktake_tasks(:'st_e'::uuid) where material_code = '1573008'));
select pg_temp.check('a real duplicate (the same batch twice) is still ONE flagged task with both rows summed, not hidden by the merge',
  (select identity_issue = 'DUPLICATE_ROWS' and baseline_qty = 34 and baseline_rows = 2 from ckb_stocktake_tasks(:'st_e'::uuid) where material_code = '4041727'));
select pg_temp.check('a FULL customer is unchanged: two batches are two tasks, no flag, no batch list',
  (select bool_and(identity_issue is null and batch_codes is null and batch_detail is null and batch in ('B1', 'B2')) from ckb_stocktake_tasks(:'st_f'::uuid)));

select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a counter reads the batch codes of a merged task but never what SAP holds: no baseline, no per-code quantities',
  (select batch_codes = array['FC1PMCL01', 'FC2PMCL01', 'FC3PMCL01'] and batch_detail is null and baseline_qty is null
     from ckb_stocktake_tasks(:'st_e'::uuid) where material_code = '4015743'));

-- counting: batch is information for EMCL, a check that fails for Freeport
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_start_stocktake(:'st_e'::uuid);
select ckb_start_stocktake(:'st_f'::uuid);
select id as te_m from ckb_stocktake_tasks(:'st_e'::uuid) where material_code = '4015743' \gset
select id as te_d from ckb_stocktake_tasks(:'st_e'::uuid) where material_code = '4041727' \gset
select id as tf_1 from ckb_stocktake_tasks(:'st_f'::uuid) where batch = 'B1' \gset
select pg_temp.as_user(pg_temp.u('op'));
select ckb_submit_count(:'te_m'::uuid, 9, false, false, 'FC9PMCL01', date '2027-01-01', 'kode di label lain', gen_random_uuid());
select ckb_submit_count(:'te_d'::uuid, 34, null, null, null, null, null, gen_random_uuid());
select ckb_submit_count(:'tf_1'::uuid, 40, false, null, 'BX', null, 'label lain', gen_random_uuid());
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('EMCL: a batch or expiry flag sent with the count is ignored, so 9 counted of 9 is MATCH, never BATCH_MISMATCH',
  (select classification = 'MATCH' and variance = 0 from ckb_stocktake_tasks(:'st_e'::uuid) where id = :'te_m'::uuid)
  and (select batch_matches is null and expiry_matches is null and observed_batch is null and observed_expiry is null from ckb_counts where task_id = :'te_m'::uuid));
select pg_temp.check('EMCL: a flagged duplicate is AMBIGUOUS even when counted, as for every customer',
  (select classification = 'AMBIGUOUS' from ckb_stocktake_tasks(:'st_e'::uuid) where id = :'te_d'::uuid));
select pg_temp.check('Freeport: the batch check still works (BATCH_MISMATCH)',
  (select classification = 'BATCH_MISMATCH' from ckb_stocktake_tasks(:'st_f'::uuid) where id = :'tf_1'::uuid));

-- found stock
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('EMCL: stock found under another batch code is not "found": the material and bin are already on the list',
  pg_temp.fails(format($q$select ckb_add_found_line(%L, '4015743', 'x', 'cml-l-flr', 'FC9PMCL01', null, 'PL', 'temuan')$q$, :'st_e'), '%ada di daftar hitung%'));
select ckb_add_found_line(:'st_e'::uuid, '4999999', 'Barang baru', 'cml-l-flr', 'FC7PMCL01', date '2027-05-05', 'EA', 'tidak ada di SAP') as tf_new \gset
select ckb_add_found_line(:'st_e'::uuid, '4999999', 'Barang baru', 'CML-L-FLR', 'FC8PMCL01', null, 'EA', null) as tf_again \gset
reset role;
select pg_temp.check('EMCL: new found stock is keyed without batch and expiry, so the same material and bin is the same found line',
  :'tf_new' = :'tf_again' and (select batch = '' and expiry_date is null and origin = 'FOUND' from ckb_count_tasks where id = :'tf_new'::uuid));
set role authenticated;
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('Freeport: the same two batches of found stock are two lines (batch still part of the identity)',
  (select ckb_add_found_line(:'st_f'::uuid, 'M-999', 'x', 'CG09A01', 'B1', null, 'KG', null)) <> (select ckb_add_found_line(:'st_f'::uuid, 'M-999', 'x', 'CG09A01', 'B2', null, 'KG', null)));

-- the counting rules of 0163 (photo per bin) are tested in 122

rollback;
