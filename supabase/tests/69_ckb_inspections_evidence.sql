-- CKB 3PL cargo inspection (0103), evidence (0104) and rebagging customer scope (0106).
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql

-- ---------------------------------------------------------------- checklist templates
set role authenticated;
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a supervisor cannot change a checklist',
  pg_temp.fails($q$select ckb_save_inspection_template('UMUM', 'x', null, '[{"key":"a","label":"Aa","kind":"CHECK","required":true}]')$q$, 'Hanya admin CKB%'));
select pg_temp.as_user(pg_temp.u('adm'));
select pg_temp.check('duplicate item keys are refused',
  pg_temp.fails($q$select ckb_save_inspection_template('UMUM', 'Umum', null, '[{"key":"a","label":"Aa","kind":"CHECK","required":true},{"key":"a","label":"Bb","kind":"TEXT","required":false}]')$q$, 'Butir checklist tidak valid%'));
select pg_temp.check('an unknown item kind is refused',
  pg_temp.fails($q$select ckb_save_inspection_template('UMUM', 'Umum', null, '[{"key":"a","label":"Aa","kind":"PHOTO","required":true}]')$q$, 'Butir checklist tidak valid%'));
select ckb_save_inspection_template('UMUM', 'Inspeksi kargo umum', null,
  '[{"key":"pallet_intact","label":"Palet utuh","category":"Palet","required":true,"kind":"CHECK"},
    {"key":"label_matches","label":"Label sesuai dokumen","category":"Marking","required":true,"kind":"CHECK"},
    {"key":"qty_packages","label":"Jumlah kemasan","category":"Jumlah","required":true,"kind":"NUMBER"},
    {"key":"remarks","label":"Keterangan","category":"Umum","required":false,"kind":"TEXT"}]') as tpl2 \gset
select pg_temp.check('saving writes version 2 and retires version 1',
  (select version = 2 and active from ckb_inspection_templates where id = :'tpl2')
  and (select not active from ckb_inspection_templates where code = 'UMUM' and version = 1));
select id as tpl1 from ckb_inspection_templates where code = 'UMUM' and version = 1 \gset

-- ---------------------------------------------------------------- an inspection with a finding
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('a retired checklist cannot be used',
  pg_temp.fails(format($q$select ckb_create_inspection(%L, 'INBOUND', %L, 'DO-1', current_date, 'Warehouse 5', null, null, null, null, null, null)$q$, :'c_fp', :'tpl1'), '%tidak aktif%'));
select pg_temp.check('an inspection date in the future is refused',
  pg_temp.fails(format($q$select ckb_create_inspection(%L, 'INBOUND', %L, 'DO-1', current_date + 2, 'Warehouse 5', null, null, null, null, null, null)$q$, :'c_fp', :'tpl2'), '%tidak valid%'));
select ckb_create_inspection(:'c_fp', 'INBOUND', :'tpl2', 'DO-7781', current_date, 'Warehouse 5', 'Dock 2', 'M-100', 'Copper bag', 'B1', 'PLT-9', null) as ins \gset
select pg_temp.check('the inspection keeps its own copy of the checklist',
  (select jsonb_array_length(checklist) = 4 and status = 'DRAFT' from ckb_inspections where id = :'ins'));
select pg_temp.check('an answer to an item that is not on the checklist is refused',
  pg_temp.fails(format($q$select ckb_save_inspection_draft(%L, '[{"key":"zzz","result":"OK"}]', null, 'NONE')$q$, :'ins'), '%tidak ada di checklist%'));
select pg_temp.check('a result other than OK/NG/NA is refused',
  pg_temp.fails(format($q$select ckb_save_inspection_draft(%L, '[{"key":"pallet_intact","result":"BAD"}]', null, 'NONE')$q$, :'ins'), '%OK, NG atau NA%'));
select ckb_save_inspection_draft(:'ins', '[{"key":"pallet_intact","result":"NG"}]', null, 'NONE');
select pg_temp.check('required items must be answered before submitting',
  pg_temp.fails(format('select ckb_submit_inspection(%L)', :'ins'), 'Butir wajib belum diisi: Label sesuai dokumen, Jumlah kemasan%'));
select ckb_save_inspection_draft(:'ins', '[{"key":"pallet_intact","result":"NG"},{"key":"label_matches","result":"OK"},{"key":"qty_packages","value_num":24}]', null, 'NONE');
select pg_temp.check('an NG item needs a note', pg_temp.fails(format('select ckb_submit_inspection(%L)', :'ins'), 'Setiap butir NG%'));
select ckb_save_inspection_draft(:'ins', '[{"key":"pallet_intact","result":"NG","note":"palet retak sudut kiri"},{"key":"label_matches","result":"OK"},{"key":"qty_packages","value_num":24}]', 'palet retak', 'MINOR');
select pg_temp.check('an NG item needs a photo before submitting', pg_temp.fails(format('select ckb_submit_inspection(%L)', :'ins'), '%unggah minimal satu foto%'));

-- ---------------------------------------------------------------- evidence registration
create or replace function pg_temp.path(c uuid, t text, e uuid, ext text) returns text language sql as $$
  select c::text || '/' || t || '/' || e::text || '/' || gen_random_uuid()::text || '.' || ext $$;
select pg_temp.check('evidence under another customer''s folder is refused',
  pg_temp.fails(format($q$select ckb_register_evidence('INSPECTION', %L, 'DAMAGE', %L, 'image/jpeg', 1000, null, null)$q$, :'ins', pg_temp.path(:'c_cgp', 'INSPECTION', :'ins', 'jpg')), 'Lokasi file bukti tidak valid%'));
select pg_temp.check('a path that escapes its folder is refused',
  pg_temp.fails(format($q$select ckb_register_evidence('INSPECTION', %L, 'DAMAGE', %L, 'image/jpeg', 1000, null, null)$q$, :'ins', :'c_fp' || '/INSPECTION/' || :'ins' || '/../../x.jpg'), 'Lokasi file bukti tidak valid%'));
select pg_temp.check('an extension that does not match the type is refused',
  pg_temp.fails(format($q$select ckb_register_evidence('INSPECTION', %L, 'DAMAGE', %L, 'image/jpeg', 1000, null, null)$q$, :'ins', pg_temp.path(:'c_fp', 'INSPECTION', :'ins', 'png')), 'Lokasi file bukti tidak valid%'));
select pg_temp.check('a file type that is not allowed is refused',
  pg_temp.fails(format($q$select ckb_register_evidence('INSPECTION', %L, 'DAMAGE', %L, 'image/gif', 1000, null, null)$q$, :'ins', pg_temp.path(:'c_fp', 'INSPECTION', :'ins', 'gif')), 'Tipe file image/gif%'));
select pg_temp.check('a file above the size limit is refused',
  pg_temp.fails(format($q$select ckb_register_evidence('INSPECTION', %L, 'DAMAGE', %L, 'image/jpeg', 99000000, null, null)$q$, :'ins', pg_temp.path(:'c_fp', 'INSPECTION', :'ins', 'jpg')), 'Ukuran file melebihi%'));
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('a representative cannot upload evidence',
  pg_temp.fails(format($q$select ckb_register_evidence('INSPECTION', %L, 'DAMAGE', %L, 'image/jpeg', 1000, null, null)$q$, :'ins', pg_temp.path(:'c_fp', 'INSPECTION', :'ins', 'jpg')), 'Hanya staf CKB%'));
select pg_temp.as_user(pg_temp.u('op'));
select ckb_register_evidence('INSPECTION', :'ins', 'DAMAGE', pg_temp.path(:'c_fp', 'INSPECTION', :'ins', 'jpg'), 'image/jpeg', 120000,
  repeat('e', 64), 'sudut palet') as ev \gset
select pg_temp.check('evidence is linked to the record''s customer and kept two years',
  (select customer_id = :'c_fp'::uuid and retain_until >= current_date + 729 from ckb_evidence where id = :'ev'));
select ckb_submit_inspection(:'ins');
select pg_temp.check('submitted with an NG item: result FAIL', (select status = 'SUBMITTED' and result = 'FAIL' from ckb_inspections where id = :'ins'));
select pg_temp.check('answers cannot change after submitting',
  pg_temp.fails(format($q$select ckb_save_inspection_draft(%L, '[]', null, 'NONE')$q$, :'ins'), '%sudah dikirim%'));
reset role;
select pg_temp.check('answers cannot change after submitting, not even by the database owner',
  pg_temp.fails(format($q$update ckb_inspection_responses set result = 'OK' where inspection_id = %L$q$, :'ins'), '%sudah dikirim%'));
set role authenticated;

-- ---------------------------------------------------------------- review
select pg_temp.check('an operator cannot review', pg_temp.fails(format($q$select ckb_review_inspection(%L, true, null)$q$, :'ins'), 'Hanya supervisor%'));
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_create_inspection(:'c_fp', 'STORAGE', :'tpl2', null, current_date, 'Warehouse 5', null, null, null, null, null, null) as own \gset
select ckb_save_inspection_draft(:'own', '[{"key":"pallet_intact","result":"OK"},{"key":"label_matches","result":"OK"},{"key":"qty_packages","value_num":1}]', null, 'NONE');
select ckb_submit_inspection(:'own');
select pg_temp.check('a passing inspection has result PASS', (select result from ckb_inspections where id = :'own') = 'PASS');
select pg_temp.check('the inspector cannot review their own inspection',
  pg_temp.fails(format($q$select ckb_review_inspection(%L, true, null)$q$, :'own'), 'Pemeriksa tidak boleh%'));
select pg_temp.check('rejecting needs a reason', pg_temp.fails(format($q$select ckb_review_inspection(%L, false, '')$q$, :'ins'), 'Alasan penolakan%'));

select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('a representative does not see an inspection awaiting review', (select count(*) from ckb_inspections) = 0);
select pg_temp.check('... nor open its evidence', pg_temp.fails(format('select * from ckb_evidence_open(%L)', :'ev'), 'Bukti tidak ditemukan%'));

select pg_temp.as_user(pg_temp.u('sup'));
select ckb_review_inspection(:'ins', false, 'foto kurang jelas, ulangi');
select pg_temp.check('a supervisor rejects with a reason', (select status = 'REJECTED' and reviewer_name = 'Sari Supervisor' from ckb_inspections where id = :'ins'));
select pg_temp.check('a reviewed inspection cannot be reviewed again', pg_temp.fails(format($q$select ckb_review_inspection(%L, true, null)$q$, :'ins'), '%berstatus REJECTED%'));
select pg_temp.check('evidence cannot be added once the record is closed',
  pg_temp.fails(format($q$select ckb_register_evidence('INSPECTION', %L, 'DAMAGE', %L, 'image/jpeg', 100, null, null)$q$, :'ins', pg_temp.path(:'c_fp', 'INSPECTION', :'ins', 'jpg')), '%sudah ditutup%'));
select pg_temp.as_user(pg_temp.u('op'));
select ckb_create_inspection(:'c_fp', 'INBOUND', :'tpl2', 'DO-7781', current_date, 'Warehouse 5', null, null, null, null, null, :'ins') as ins2 \gset
select pg_temp.check('a re-inspection is a new record pointing at the rejected one; the rejected one stays',
  (select supersedes_id = :'ins'::uuid and status = 'DRAFT' from ckb_inspections where id = :'ins2')
  and (select status from ckb_inspections where id = :'ins') = 'REJECTED');
select pg_temp.check('only a rejected inspection can be superseded',
  pg_temp.fails(format($q$select ckb_create_inspection(%L, 'INBOUND', %L, null, current_date, 'Warehouse 5', null, null, null, null, null, %L)$q$, :'c_fp', :'tpl2', :'own'), 'Inspeksi ulang hanya%'));
select pg_temp.as_user(pg_temp.u('sup2'));
select ckb_review_inspection(:'own', true, null);
select ckb_close_inspection(:'own', null);
select pg_temp.check('accepted then closed', (select status from ckb_inspections where id = :'own') = 'CLOSED');

-- ---------------------------------------------------------------- evidence access after review
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('the representative now sees the reviewed inspections of their customer (rejected + closed), not drafts',
  (select count(*) from ckb_inspections) = 2 and (select count(*) from ckb_inspection_responses where inspection_id = :'ins') = 3);
select pg_temp.check('the representative may open the evidence of a reviewed inspection',
  (select storage_path like :'c_fp' || '/INSPECTION/%' from ckb_evidence_open(:'ev')));
reset role;
select pg_temp.check('the access is logged', exists (select 1 from ckb_audit_events where action = 'EVIDENCE_VIEW' and details->>'evidence_id' = :'ev'));
set role authenticated;
select pg_temp.as_user(pg_temp.u('repcgp'));
select pg_temp.check('another customer''s representative sees neither the inspection nor the evidence',
  (select count(*) from ckb_inspections) = 0 and (select count(*) from ckb_evidence) = 0
  and pg_temp.fails(format('select * from ckb_evidence_open(%L)', :'ev'), 'Bukti tidak ditemukan%'));

-- ---------------------------------------------------------------- withdrawing, hold, archive
select pg_temp.as_user(pg_temp.u('op'));
select ckb_register_evidence('INSPECTION', :'ins2', 'GENERAL', pg_temp.path(:'c_fp', 'INSPECTION', :'ins2', 'pdf'), 'application/pdf', 5000, null, 'surat jalan') as ev2 \gset
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('another operator cannot withdraw someone''s upload', pg_temp.fails(format($q$select ckb_withdraw_evidence(%L, 'salah foto')$q$, :'ev2'), 'Hanya pengunggah%'));
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_set_evidence_hold(:'ev2', true, 'sengketa customer');
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('evidence on hold cannot be withdrawn', pg_temp.fails(format($q$select ckb_withdraw_evidence(%L, 'salah')$q$, :'ev2'), 'Bukti ditahan%'));
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_set_evidence_hold(:'ev2', false, null);
select pg_temp.as_user(pg_temp.u('op'));
select ckb_withdraw_evidence(:'ev2', 'salah dokumen');
select pg_temp.check('a withdrawn upload is hidden from staff but kept', (select count(*) from ckb_evidence where id = :'ev2') = 0);
select pg_temp.as_user(pg_temp.u('adm'));
select pg_temp.check('... and still readable by the admin with its reason', (select delete_reason from ckb_evidence where id = :'ev2') = 'salah dokumen');
select pg_temp.check('evidence of a closed record cannot be withdrawn', pg_temp.fails(format($q$select ckb_withdraw_evidence(%L, 'x y z')$q$, :'ev'), '%sudah ditutup%'));
select pg_temp.check('evidence cannot be archived inside its retention period', pg_temp.fails(format($q$select ckb_record_evidence_archive(%L, 'glacier/2028')$q$, :'ev'), 'Masa simpan aktif%'));
reset role;
select pg_temp.check('evidence file data cannot be changed', pg_temp.fails(format($q$update ckb_evidence set storage_path = 'x' where id = %L$q$, :'ev'), '%tidak bisa diubah%'));
select pg_temp.check('evidence rows cannot be deleted', pg_temp.fails(format('delete from ckb_evidence where id = %L', :'ev'), '%tidak bisa dihapus%'));
select pg_temp.check('a withdrawn upload cannot be restored', pg_temp.fails(format('update ckb_evidence set deleted_at = null where id = %L', :'ev2'), '%tidak bisa dipulihkan%'));

-- ---------------------------------------------------------------- rebagging and customers (0106)
set role authenticated;
select pg_temp.as_user(pg_temp.u('op'));
select create_rebagging_job('DAMAGE_REBAG', 'karung sobek', 'Warehouse 5', 'Freeport', 'WO-1', 'Pagi', 0, null, 'Oki Operator') as rb \gset
select pg_temp.check('a rebagging job is linked to its customer by name', (select customer_id from ckb_rebagging_jobs where id = :'rb') = :'c_fp'::uuid);
reset role;
select pg_temp.check('rebagging events land in the CKB activity log',
  exists (select 1 from ckb_audit_events where entity_type = 'rebagging' and entity_id = :'rb' and customer_id = :'c_fp'));
set role authenticated;
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('a representative does not see an unfinished rebagging job', (select count(*) from ckb_rebagging_jobs) = 0);
select pg_temp.check('... and cannot act on rebagging', pg_temp.fails(format($q$select cancel_rebagging(%L, 'x', 'Rina')$q$, :'rb'), '%'));
reset role;
update ckb_rebagging_jobs set status = 'COMPLETED' where id = :'rb';
set role authenticated;
select pg_temp.check('the representative sees their customer''s finished job', (select count(*) from ckb_rebagging_jobs) = 1);
select pg_temp.as_user(pg_temp.u('repcgp'));
select pg_temp.check('another customer''s representative does not', (select count(*) from ckb_rebagging_jobs) = 0);
select pg_temp.as_user(pg_temp.u('shell'));
select pg_temp.check('a Shell supervisor without a CKB role cannot cancel rebagging (CKB role, not Shell role)',
  pg_temp.fails(format($q$select cancel_rebagging(%L, 'x', 'Sigit')$q$, :'rb'), 'Hanya supervisor%'));

rollback;
