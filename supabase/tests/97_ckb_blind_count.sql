-- CKB blind count (0133): assignment per location, photo rules, evidence ownership, blind reads.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql
create or replace function pg_temp.path(c uuid, e uuid) returns text language sql as $$
  select c::text || '/COUNT_TASK/' || e::text || '/' || gen_random_uuid()::text || '.jpg' $$;
create or replace function pg_temp.photo(c uuid, t uuid) returns uuid language sql as $$
  select ckb_register_evidence('COUNT_TASK', t, 'COUNT', pg_temp.path(c, t), 'image/jpeg', 1000, null, null) $$;
grant execute on function pg_temp.path(uuid, uuid), pg_temp.photo(uuid, uuid) to authenticated;

\set rows '[{"line":2,"material_code":"M-100","storage_bin":"SIP-10","batch":"B1","uom":"DR","quantity":4},{"line":3,"material_code":"M-200","storage_bin":"SIP-11","batch":"","uom":"DR","quantity":2},{"line":4,"material_code":"M-300","storage_bin":"0101NP0104","batch":"","uom":"DR","quantity":1},{"line":5,"material_code":"M-400","storage_bin":"0101NP0105","batch":"","uom":"DR","quantity":3}]'
set role authenticated;
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_import_sap_snapshot(:'c_fp', date '2026-11-08', '{"name":"fp97.xlsx","sha256":"9797979797979797979797979797979797979797979797979797979797979797","size":10}', :'rows', '[]', null) as imp \gset
select ckb_create_stocktake(:'c_fp', :'imp', 'FULL', null, 'Warehouse 5', true, array[pg_temp.u('op'), pg_temp.u('op2')]::uuid[], 'uji 97') as st \gset
select id as t10 from ckb_stocktake_tasks(:'st') where storage_bin = 'SIP-10' \gset
select id as t11 from ckb_stocktake_tasks(:'st') where storage_bin = 'SIP-11' \gset
select id as t04 from ckb_stocktake_tasks(:'st') where storage_bin = '0101NP0104' \gset
select id as t05 from ckb_stocktake_tasks(:'st') where storage_bin = '0101NP0105' \gset
create temp table r97 (k text primary key, v text);
grant all on r97 to authenticated;

-- ---------------------------------------------------------------- Task 1: assignment
select pg_temp.check('a supervisor assigns two locations',
  ckb_assign_count_tasks(:'st', array['SIP-10', 'SIP-11'], pg_temp.u('op'), 'Sari') = 2);
select pg_temp.check('assigning a customer account is refused',
  pg_temp.fails(format($q$select ckb_assign_count_tasks(%L, array['0101NP0104'], %L, 'Sari')$q$, :'st', pg_temp.u('repfp')), 'Penghitung harus staf%'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator cannot assign',
  pg_temp.fails(format($q$select ckb_assign_count_tasks(%L, array['SIP-10'], %L, 'Oki')$q$, :'st', pg_temp.u('op')), 'Hanya supervisor%'));
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_start_stocktake(:'st');
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('an operator cannot count a line assigned to someone else',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 4, true, null, null, null, null, gen_random_uuid())$q$, :'t10'), '%tidak ditugaskan%'));
select ckb_submit_count(:'t04', 1, null, null, null, null, null, gen_random_uuid()) \g /dev/null
reset role;
select pg_temp.check('an unassigned line follows the session counter list',
  (select count(*) from ckb_counts where task_id = :'t04') = 1);
set role authenticated;
select pg_temp.as_user(pg_temp.u('op'));
select ckb_submit_count(:'t10', 4, true, null, null, null, null, gen_random_uuid()) \g /dev/null
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_assign_count_tasks(:'st', array['SIP-10'], pg_temp.u('op2'), 'Sari') \g /dev/null
select ckb_assign_count_tasks(:'st', array['SIP-11'], null, 'Sari') as unassigned \gset
reset role;
select pg_temp.check('reassigning moves the line, keeps earlier counts',
  (select assigned_to = pg_temp.u('op2') from ckb_count_tasks where id = :'t10')
  and (select count(*) = 1 from ckb_counts where task_id = :'t10'));
select pg_temp.check('unassign with null',
  :unassigned = 1
  and (select assigned_to is null from ckb_count_tasks where id = :'t11'));
select pg_temp.check('the assignment is in the audit log',
  exists (select 1 from ckb_audit_events where action = 'COUNT_ASSIGN'));
set role authenticated;
-- ---------------------------------------------------------------- Task 2: photo rules
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('count 0 without a photo is refused',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 0, null, null, null, null, null, gen_random_uuid())$q$, :'t05'), 'Foto wajib: hitungan 0%'));
select pg_temp.photo(:'c_fp', :'t05') \g /dev/null
select pg_temp.check('count 0 with a photo of this round passes',
  ckb_submit_count(:'t05', 0, null, null, null, null, null, gen_random_uuid()) is not null);
reset role;
select pg_temp.check('a matching count needs no photo',
  (select count(*) from ckb_counts where task_id = :'t04') = 1);
set role authenticated;
select pg_temp.as_user(pg_temp.u('op2'));
select ckb_add_found_line(:'st', 'M-900', 'Temuan', 'SIP-12', '', null, 'DR', null) as tf \gset
select pg_temp.check('a found line needs a photo',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 2, null, null, null, null, null, gen_random_uuid())$q$, :'tf'), 'Foto wajib: barang temuan%'));
select pg_temp.check('the old one-step found item path obeys the rule too',
  pg_temp.fails(format($q$select ckb_add_found_item(%L, 'M-901', 'x', 'SIP-13', '', null, 'DR', 1, null, gen_random_uuid())$q$, :'st'), 'Foto wajib%'));
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_close_counting(:'st');
select ckb_decide_task(:'t04', 'RECOUNT', null, 'cek lagi') \g /dev/null
select ckb_assign_count_tasks(:'st', array['0101NP0104'], pg_temp.u('op2'), 'Sari') \g /dev/null
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.photo(:'c_fp', :'t04') as old_photo \gset
reset role;
update ckb_evidence set round = 1 where id = :'old_photo';  -- as if taken in round 1
set role authenticated;
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('a photo from round 1 does not satisfy round 2',
  pg_temp.fails(format($q$select ckb_submit_count(%L, 1, null, null, null, null, null, gen_random_uuid())$q$, :'t04'), 'Foto wajib: hitungan ulang%'));
select pg_temp.photo(:'c_fp', :'t04') \g /dev/null
select ckb_submit_count(:'t04', 1, null, null, null, null, null, 'c9700000-0000-0000-0000-000000000001') as rc \gset
select pg_temp.check('a recount needs a photo taken in the recount, then passes',
  :'rc' is not null);
select pg_temp.check('client_key retry on a photographed recount returns the first count',
  ckb_submit_count(:'t04', 1, null, null, null, null, null, 'c9700000-0000-0000-0000-000000000001') = :'rc'::uuid);
-- Customer setting: every count needs a photo.
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('only an admin sets the customer switch',
  pg_temp.fails(format('select ckb_set_customer_count_photo(%L, true)', :'c_fp'), 'Hanya admin%'));
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_set_customer_count_photo(:'c_fp', true);
select pg_temp.check('customer setting requires a photo on every count',
  ckb_photo_reason(:'t10', 4) = 'wajib untuk pelanggan ini');
reset role;
update ckb_stocktakes set photo_rules = false where id = :'st';
set role authenticated;
select pg_temp.check('sessions from before 0133 keep today''s rules',
  ckb_photo_reason(:'t04', 0) is null);
reset role;
update ckb_stocktakes set photo_rules = true where id = :'st';
set role authenticated;
-- ---------------------------------------------------------------- Task 3: evidence and acceptance
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an unassigned operator cannot add a photo to someone else''s line',
  pg_temp.fails(format('select pg_temp.photo(%L, %L)', :'c_fp', :'t04'), '%tidak ditugaskan%'));
select pg_temp.as_user(pg_temp.u('op2'));
select id as used_photo from ckb_evidence where entity_id = :'t05' and deleted_at is null limit 1 \gset
select pg_temp.check('the counter cannot withdraw a photo their count used',
  pg_temp.fails(format($q$select ckb_withdraw_evidence(%L, 'salah foto')$q$, :'used_photo'), 'Foto ini dipakai%'));
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_withdraw_evidence(:'used_photo', 'foto buram, diganti');
reset role;
select pg_temp.check('a supervisor can withdraw it with a reason',
  exists (select 1 from ckb_evidence where id = :'used_photo' and deleted_at is not null and delete_reason = 'foto buram, diganti'));
set role authenticated;
select pg_temp.as_user(pg_temp.u('sup'));
select id as c05 from ckb_counts where task_id = :'t05' order by entry_no desc limit 1 \gset
select pg_temp.check('accepting a variance without a photo is refused',
  pg_temp.fails(format($q$select ckb_decide_task(%L, 'ACCEPT', %L, 'hilang')$q$, :'t05', :'c05'), '%perlu minimal satu foto%'));
select id as c04 from ckb_counts where task_id = :'t04' order by entry_no desc limit 1 \gset
select ckb_decide_task(:'t04', 'ACCEPT', :'c04', null) \g /dev/null
select pg_temp.check('accepting a match needs no photo',
  (select status = 'ACCEPTED' from ckb_stocktake_tasks(:'st') where id = :'t04'));
-- ---------------------------------------------------------------- Task 4: blind reads
select ckb_activate_snapshot(:'imp');
select ckb_decide_task(:'t10', 'RECOUNT', null, 'hitung lagi, angka meragukan') \g /dev/null
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('an operator reads no snapshot rows, adjustments, counts or notes',
  (select count(*) from ckb_sap_snapshot_rows) = 0 and (select count(*) from ckb_adjustments) = 0
  and (select count(*) from ckb_counts) = 0 and (select count(*) from ckb_task_notes) = 0);
select pg_temp.check('an operator''s task list has only their lines',
  (select array_agg(storage_bin order by storage_bin) from ckb_stocktake_tasks(:'st')) = array['0101NP0104', '0101NP0105', 'SIP-10', 'SIP-11', 'SIP-12']);
select pg_temp.check('a recount is blind: the operator does not see the earlier count',
  (select latest_qty is null and latest_counter is null and baseline_qty is null and variance is null
   from ckb_stocktake_tasks(:'st') where id = :'t10'));
select pg_temp.check('the operator does not see accepted numbers or decision text',
  (select accepted_qty is null and decision_reason is null from ckb_stocktake_tasks(:'st') where id = :'t04'));
select pg_temp.check('the operator sees their current-round count',
  (select latest_qty = 0 from ckb_stocktake_tasks(:'st') where id = :'t05'));
select pg_temp.check('the operator dashboard has no discrepancy count',
  ckb_dashboard()->'discrepancies_awaiting_review' = 'null'::jsonb);
select pg_temp.check('an operator cannot read the assignment overview',
  pg_temp.fails(format('select * from ckb_assignment_overview(%L)', :'st'), 'Hanya supervisor%'));
select pg_temp.check('the operator inventory has locations and no quantities',
  exists (select 1 from ckb_inventory_locations(:'c_fp') where storage_bin = 'SIP-10'));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('another operator sees only their own assigned lines (and unassigned ones)',
  not exists (select 1 from ckb_stocktake_tasks(:'st') where storage_bin in ('SIP-10', '0101NP0104')));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('the assignment overview: one row per location with lines, counted and counter',
  (select lines = 1 and counted = 0 and assigned_name = 'Odi Operator' from ckb_assignment_overview(:'st') where storage_bin = 'SIP-10')  -- waiting for its recount
  and (select assigned_to is null from ckb_assignment_overview(:'st') where storage_bin = '0101NP0105'));
select pg_temp.check('a supervisor still reads them',
  (select count(*) from ckb_sap_snapshot_rows) > 0 and (select count(*) from ckb_counts) > 0
  and (select count(*) from ckb_stocktake_tasks(:'st')) = 5
  and (select baseline_qty = 1 from ckb_stocktake_tasks(:'st') where id = :'t04'));
-- ---------------------------------------------------------------- final review fixes
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_set_customer_count_photo(:'c_fp', false);
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_register_evidence('STOCKTAKE', :'st', 'DOCUMENT', :'c_fp' || '/STOCKTAKE/' || :'st' || '/' || gen_random_uuid() || '.jpg', 'image/jpeg', 1000, null, 'cetakan SAP') \g /dev/null
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('an operator cannot compare SAP snapshots',
  pg_temp.fails(format('select * from ckb_compare_snapshots(%L, %L)', :'imp', :'imp'), 'Akses ditolak: hanya supervisor%'));
select pg_temp.check('an operator reads no SAP export or export line (policy)',
  (select bool_and(qual like '%operator%') from pg_policies where tablename in ('ckb_sap_exports', 'ckb_sap_export_lines')));
select pg_temp.check('an operator sees only this round''s photos of their own lines',
  (select count(*) from ckb_evidence where entity_id = :'t04' and round = 1) = 0
  and (select count(*) from ckb_evidence where entity_id = :'t04' and round = 2) >= 1);
select pg_temp.check('an operator cannot open an earlier-round photo',
  pg_temp.fails(format('select * from ckb_evidence_open(%L)', :'old_photo'), 'Bukti tidak ditemukan%'));
select pg_temp.check('an operator does not see session documents',
  (select count(*) from ckb_evidence where entity_type = 'STOCKTAKE') = 0);
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('an operator sees no photo of a line that is not theirs',
  (select count(*) from ckb_evidence where entity_id = :'t04') = 0);
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a supervisor sees every round',
  (select count(*) from ckb_evidence where entity_id = :'t04') >= 2);
-- A session without a counter list: assigning one location must not lock the rest.
select ckb_create_stocktake(:'c_fp', :'imp', 'FULL', null, 'Warehouse 5', true, null, 'uji 97b') as st2 \gset
select id as u11 from ckb_stocktake_tasks(:'st2') where storage_bin = 'SIP-11' \gset
select ckb_start_stocktake(:'st2');
select ckb_assign_count_tasks(:'st2', array['SIP-10'], pg_temp.u('op'), 'Sari') \g /dev/null
select pg_temp.as_user(pg_temp.u('op2'));
select pg_temp.check('assigning one location does not lock other operators out of unassigned lines',
  ckb_submit_count(:'u11', 2, null, null, null, null, null, gen_random_uuid()) is not null);
select pg_temp.as_user(pg_temp.u('sup'));
select ckb_assign_count_tasks(:'st2', array['SIP-11'], pg_temp.u('op'), 'Sari') \g /dev/null
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('after a reassignment the new counter does not see the old counter''s number',
  (select latest_qty is null from ckb_stocktake_tasks(:'st2') where id = :'u11'));
rollback;
