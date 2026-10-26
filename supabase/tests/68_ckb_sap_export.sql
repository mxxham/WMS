-- CKB 3PL SAP export (0102): only approved adjustments, one live export per adjustment, frozen lines,
-- audited re-export and downloads, void returns adjustments, SAP confirmation is a separate step.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql

-- A closed session with three adjustments: one approved (-6), one approved (+2), one rejected.
set role authenticated;
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_import_sap_snapshot(:'c_fp', date '2026-10-24', '{"name":"fp.xlsx","sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","size":10}',
  '[{"line":2,"material_code":"M-1","storage_bin":"CG01A01","uom":"BAG","quantity":10},{"line":3,"material_code":"M-2","storage_bin":"CG01A02","uom":"BAG","quantity":5},{"line":4,"material_code":"M-3","storage_bin":"CG01A03","uom":"BAG","quantity":5}]', '[]', null) as imp \gset
select ckb_create_stocktake(:'c_fp', :'imp', 'FULL', null, 'Warehouse 5', false, null, null) as st \gset
select ckb_start_stocktake(:'st');
select pg_temp.as_user(pg_temp.u('op'));
select ckb_submit_count(t.id, case t.material_code when 'M-1' then 4 when 'M-2' then 7 else 1 end, null, null, null, null, null, gen_random_uuid())
  from ckb_stocktake_tasks(:'st') t;
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_close_counting(:'st');
select ckb_decide_task(t.id, 'ACCEPT', null, 'cek fisik') from ckb_stocktake_tasks(:'st') t;
select id as a1 from ckb_adjustments where material_code = 'M-1' \gset
select id as a2 from ckb_adjustments where material_code = 'M-2' \gset
select id as a3 from ckb_adjustments where material_code = 'M-3' \gset
select ckb_decide_adjustments(array[:'a1', :'a2']::uuid[], true, null);
select ckb_decide_adjustments(array[:'a3']::uuid[], false, 'ditolak');

select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator cannot export', pg_temp.fails(format($q$select ckb_create_sap_export(%L, array[%L]::uuid[])$q$, :'c_fp', :'a1'), 'Hanya supervisor%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a rejected adjustment cannot be exported',
  pg_temp.fails(format($q$select ckb_create_sap_export(%L, array[%L, %L]::uuid[])$q$, :'c_fp', :'a1', :'a3'), '%tidak bisa diekspor (status REJECTED)%'));
select pg_temp.check('... and the failed export left nothing behind (no export, a1 still APPROVED)',
  (select count(*) from ckb_sap_exports) = 0 and (select status from ckb_adjustments where id = :'a1') = 'APPROVED');
select pg_temp.check('an adjustment of another customer cannot be exported under this one',
  pg_temp.fails(format($q$select ckb_create_sap_export(%L, array[%L]::uuid[])$q$, :'c_cgp', :'a1'), '%milik customer lain%'));
select ckb_create_sap_export(:'c_fp', array[:'a1', :'a2']::uuid[]) as e1 \gset
select pg_temp.check('the export freezes two lines with totals: gain 2, loss 6',
  (select line_count = 2 and total_gain = 2 and total_loss = 6 and status = 'GENERATED' and not format_verified from ckb_sap_exports where id = :'e1')
  and (select count(*) from ckb_sap_export_lines where export_id = :'e1') = 2
  and (select data->>'direction' from ckb_sap_export_lines l join ckb_adjustments a on a.id = l.adjustment_id where a.id = :'a1') = 'LOSS');
select pg_temp.check('exported adjustments are EXPORTED and linked', (select bool_and(status = 'EXPORTED' and export_id = :'e1'::uuid) from ckb_adjustments where id in (:'a1', :'a2')));
select pg_temp.check('the same adjustment cannot be exported twice',
  pg_temp.fails(format($q$select ckb_create_sap_export(%L, array[%L]::uuid[])$q$, :'c_fp', :'a1'), '%status EXPORTED%'));

select ckb_log_export_download(:'e1');
select ckb_log_export_download(:'e1');
select pg_temp.check('every download is counted and logged', (select download_count from ckb_sap_exports where id = :'e1') = 2
  and (select count(*) from ckb_audit_events where action = 'SAP_EXPORT_DOWNLOAD' and entity_id = :'e1') = 2);

select pg_temp.check('a re-export needs a reason', pg_temp.fails(format($q$select ckb_reexport_sap(%L, '')$q$, :'e1'), '%wajib diisi%'));
select ckb_reexport_sap(:'e1', 'file pertama hilang') as e2 \gset
select pg_temp.check('a re-export is its own record pointing at the original, with the same frozen lines',
  (select kind = 'REEXPORT' and original_export_id = :'e1'::uuid and reason = 'file pertama hilang' from ckb_sap_exports where id = :'e2')
  and (select count(*) from ckb_sap_export_lines where export_id = :'e2') = 2
  and exists (select 1 from ckb_audit_events where action = 'SAP_REEXPORT' and entity_id = :'e2'));
select pg_temp.check('a re-export does not take the adjustments over', (select bool_and(export_id = :'e1'::uuid) from ckb_adjustments where id in (:'a1', :'a2')));

-- Generating is not posting; SAP's own reference confirms.
select pg_temp.check('confirmation needs the SAP document number', pg_temp.fails(format($q$select ckb_confirm_sap_export(%L, '', null)$q$, :'e1'), '%dokumen SAP%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a supervisor cannot void an export (admin only)', pg_temp.fails(format($q$select ckb_void_sap_export(%L, 'ditolak SAP')$q$, :'e1'), 'Hanya admin CKB%'));
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_void_sap_export(:'e1', 'ditolak SAP: format');
select pg_temp.check('voiding a refused file returns its adjustments to APPROVED for a new export',
  (select status from ckb_sap_exports where id = :'e1') = 'VOIDED'
  and (select bool_and(status = 'APPROVED' and export_id is null) from ckb_adjustments where id in (:'a1', :'a2')));
select pg_temp.check('a voided export cannot be re-exported', pg_temp.fails(format($q$select ckb_reexport_sap(%L, 'lagi')$q$, :'e1'), '%sudah dibatalkan%'));
select ckb_create_sap_export(:'c_fp', array[:'a1', :'a2']::uuid[]) as e3 \gset
select ckb_confirm_sap_export(:'e3', '4900012345', 'diposting MI10');
select pg_temp.check('a new export is confirmed with SAP''s reference', (select status = 'SAP_CONFIRMED' and sap_document_ref = '4900012345' from ckb_sap_exports where id = :'e3'));
select pg_temp.check('a confirmed export cannot be voided', pg_temp.fails(format($q$select ckb_void_sap_export(%L, 'salah')$q$, :'e3'), '%berstatus SAP_CONFIRMED%'));

select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('representatives read no exports', (select count(*) from ckb_sap_exports) = 0 and (select count(*) from ckb_sap_export_lines) = 0);
reset role;
select pg_temp.check('export lines cannot be edited', pg_temp.fails(format('update ckb_sap_export_lines set data = ''{}'' where export_id = %L', :'e3'), '%tidak bisa diubah%'));

rollback;
