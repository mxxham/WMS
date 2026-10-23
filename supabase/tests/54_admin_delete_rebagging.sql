-- CKB Rebagging: admin delete never-posted job (migration 0087)
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role; set request.jwt.claim.sub = '';

-- Test users (operator, supervisor, admin)
select set_config('t.op',  (select id::text from profiles where role = 'operator'   limit 1), false),
       set_config('t.sup', (select id::text from profiles where role = 'supervisor' limit 1), false),
       set_config('t.adm', (select id::text from profiles where role = 'admin'      limit 1), false);

-- Helper: pg_temp.check(label, ok)
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

-- Helper: fails(sql, regex) -> true if error message matches
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm ~ p_like; end $$;

-- Helper: count ckb_rebagging_deleted_jobs for a job_no
create or replace function pg_temp.tombstone_count(p_job_no text) returns int language sql as $$
  select count(*) from ckb_rebagging_deleted_jobs where job_no = p_job_no $$;

-- Helper: count stock_holds for a job ref_id
create or replace function pg_temp.hold_count(p_job_id uuid) returns int language sql as $$
  select count(*) from stock_holds where ref_id = p_job_id and source = 'REBAGGING' and status = 'ACTIVE' $$;

-- =====================================================================
-- FIXTURES: bins, items, inventory
-- =====================================================================
delete from inventory where bin_id in (select id from bins where bin_code in ('CA01A01','CA01A02','CB01B01','CB01B02'));
delete from ckb_rebagging_jobs where job_no like 'RBTEST%';
delete from ckb_rebagging_deleted_jobs where job_no like 'RBTEST%';

-- Ensure items exist (use existing SKUs from seed)
insert into items (sku, description, uom, upp)
values ('RBTEST001', 'Rebag Test Item 1', 'CAR', 48)
on conflict (sku) do nothing;

-- Stock: CA01A01 has 100 CAR of RBTEST001 batch B1 exp 2030-12-31
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
values ('adjustment',
        (select id from items where sku='RBTEST001'),
        'B1', 100,
        (select id from bins where bin_code='CA01A01'),
        '2030-12-31', 'fixture stock', 'FOUND', 'fixture');

-- Stock: CA01A02 has 50 CAR of RBTEST001 batch B1 exp 2030-12-31
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
values ('adjustment',
        (select id from items where sku='RBTEST001'),
        'B1', 50,
        (select id from bins where bin_code='CA01A02'),
        '2030-12-31', 'fixture stock', 'FOUND', 'fixture');

-- CKB app membership for the three test users (has_ckb_app() gate)
update profiles
set apps = array_append(apps, 'ckb_3pl'), active = true
where id in (current_setting('t.op')::uuid, current_setting('t.sup')::uuid, current_setting('t.adm')::uuid)
  and not ('ckb_3pl' = any(apps));

set role authenticated;

-- =====================================================================
-- TEST 1: Admin deletes a DRAFT job with a source line
--         -> job row gone, sources gone, tombstone row exists with job_no + deleted_by
-- =====================================================================
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

-- 1a. Create job (DRAFT)
select set_config('t.job1', create_rebagging_job(
  'SPLIT', 'Test delete draft', 'Gudang A', 'Freeport', 'WO-DEL1', 'Pagi', 0, 'Draft delete test', 'Operator Satu'
)::text, false);
select pg_temp.check('create_rebagging_job returns uuid', current_setting('t.job1') ~ '^[0-9a-f-]{36}$');

-- 1b. Set sources (1 line)
select set_rebagging_sources(current_setting('t.job1')::uuid,
  '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":10,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select pg_temp.check('set_rebagging_sources ok', true);

-- 1c. Admin deletes the job
select set_config('request.jwt.claim.sub', current_setting('t.adm'), false);
select delete_rebagging_job(current_setting('t.job1')::uuid, 'Hapus test draft', 'Admin Satu');
select pg_temp.check('delete_rebagging_job succeeded', true);

-- 1d. Job row is gone
select pg_temp.check('job row deleted', not exists(select 1 from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid));

-- 1e. Sources cascaded deleted
select pg_temp.check('sources cascaded deleted', (select count(*) from ckb_rebagging_sources where job_id = current_setting('t.job1')::uuid) = 0);

-- 1f. Tombstone exists with job_no and deleted_by
select set_config('t.job1_no', (select job_no from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid limit 1)::text, false);
-- job_no was generated, we need to capture it before delete. Let's re-fetch from tombstone.
select pg_temp.check('tombstone row exists', pg_temp.tombstone_count((select job_no from ckb_rebagging_deleted_jobs order by deleted_at desc limit 1)) = 1);
select pg_temp.check('tombstone has job_no', (select job_no from ckb_rebagging_deleted_jobs order by deleted_at desc limit 1) ~ '^RB[0-9]{6}$');
select pg_temp.check('tombstone has deleted_by = Admin Satu', (select deleted_by from ckb_rebagging_deleted_jobs order by deleted_at desc limit 1) = 'Admin Satu');
select pg_temp.check('tombstone has delete_reason', (select delete_reason from ckb_rebagging_deleted_jobs order by deleted_at desc limit 1) = 'Hapus test draft');

-- =====================================================================
-- TEST 2: Operator role -> refused (LAST_ERROR_MESSAGE like 'Hanya admin%')
-- =====================================================================
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

-- 2a. Create another job
select set_config('t.job2', create_rebagging_job(
  'SPLIT', 'Test delete by operator', 'Gudang A', 'Freeport', 'WO-DEL2', 'Pagi', 0, 'Operator delete test', 'Operator Satu'
)::text, false);

-- 2b. Operator tries to delete -> FAILS
select pg_temp.check('operator delete FAILS',
  pg_temp.fails($q$select delete_rebagging_job(current_setting('t.job2')::uuid, 'Operator delete', 'Operator Satu')$q$, 'Hanya admin'));

-- 2c. Job still exists
select pg_temp.check('job still exists after operator attempt', exists(select 1 from ckb_rebagging_jobs where id = current_setting('t.job2')::uuid));

-- =====================================================================
-- TEST 3: Job with posted_at set and status COMPLETED -> refused with 'sudah diposting'
-- =====================================================================
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

-- 3a. Create job and take it all the way to COMPLETED
select set_config('t.job3', create_rebagging_job(
  'SPLIT', 'Test delete completed', 'Gudang A', 'Freeport', 'WO-DEL3', 'Pagi', 0, 'Completed delete test', 'Operator Satu'
)::text, false);

select set_rebagging_sources(current_setting('t.job3')::uuid,
  '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":10,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select set_rebagging_outputs(current_setting('t.job3')::uuid,
  '[{"bin_code":"CB01B01","quantity":10,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select open_rebagging_job(current_setting('t.job3')::uuid, 'Operator Satu');
select start_rebagging_execution(current_setting('t.job3')::uuid, 'Operator Satu');
select record_rebagging_execution(current_setting('t.job3')::uuid,
  '[{"line_no":1,"quantity":10,"unit":"CAR"}]'::jsonb,
  '[{"line_no":1,"quantity":10,"unit":"CAR"}]'::jsonb,
  '[{"item":"Kondisi","label":"OK","ok":true}]'::jsonb,
  'Operator Satu');
select add_rebagging_evidence(current_setting('t.job3')::uuid, 'BEFORE',
  current_setting('t.job3') || '/BEFORE/b.jpg', 'image/jpeg', 1000, 'b', 'Operator Satu');
select add_rebagging_evidence(current_setting('t.job3')::uuid, 'AFTER',
  current_setting('t.job3') || '/AFTER/a.jpg', 'image/jpeg', 1000, 'a', 'Operator Satu');
select submit_rebagging_verification(current_setting('t.job3')::uuid, 'Operator Satu');

select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
select verify_rebagging(current_setting('t.job3')::uuid, true, 'OK', 'Supervisor Dua');
select approve_post_rebagging(current_setting('t.job3')::uuid, 'Posted', 'Supervisor Dua');

-- 3b. Job is now COMPLETED with posted_at set
select pg_temp.check('job3 is COMPLETED', (select status from ckb_rebagging_jobs where id = current_setting('t.job3')::uuid) = 'COMPLETED');
select pg_temp.check('job3 has posted_at', (select posted_at from ckb_rebagging_jobs where id = current_setting('t.job3')::uuid) is not null);

-- 3c. Admin tries to delete -> FAILS with 'sudah diposting'
select set_config('request.jwt.claim.sub', current_setting('t.adm'), false);
select pg_temp.check('delete COMPLETED job FAILS',
  pg_temp.fails($q$select delete_rebagging_job(current_setting('t.job3')::uuid, 'Delete completed', 'Admin Satu')$q$, 'sudah diposting'));

-- 3d. Job still exists
select pg_temp.check('COMPLETED job still exists', exists(select 1 from ckb_rebagging_jobs where id = current_setting('t.job3')::uuid));

-- =====================================================================
-- TEST 4: IN_PROGRESS job with active hold started by start_rebagging_execution
--         -> delete succeeds AND the hold row is released/not present
-- =====================================================================
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

-- 4a. Create job and start execution (places holds)
select set_config('t.job4', create_rebagging_job(
  'SPLIT', 'Test delete in progress', 'Gudang A', 'Freeport', 'WO-DEL4', 'Pagi', 0, 'In progress delete test', 'Operator Satu'
)::text, false);

select set_rebagging_sources(current_setting('t.job4')::uuid,
  '[{"source_type":"STOCK","bin_code":"CA01A02","quantity":20,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select set_rebagging_outputs(current_setting('t.job4')::uuid,
  '[{"bin_code":"CB01B02","quantity":20,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select open_rebagging_job(current_setting('t.job4')::uuid, 'Operator Satu');
select start_rebagging_execution(current_setting('t.job4')::uuid, 'Operator Satu');

-- 4b. Hold exists
select pg_temp.check('hold exists before delete', pg_temp.hold_count(current_setting('t.job4')::uuid) = 1);

-- 4c. Admin deletes the IN_PROGRESS job
select set_config('request.jwt.claim.sub', current_setting('t.adm'), false);
select delete_rebagging_job(current_setting('t.job4')::uuid, 'Hapus in progress', 'Admin Satu');
select pg_temp.check('delete IN_PROGRESS job succeeded', true);

-- 4d. Job row gone
select pg_temp.check('IN_PROGRESS job row deleted', not exists(select 1 from ckb_rebagging_jobs where id = current_setting('t.job4')::uuid));

-- 4e. Hold released (no ACTIVE holds for this job)
select pg_temp.check('hold released after delete', pg_temp.hold_count(current_setting('t.job4')::uuid) = 0);

-- 4f. Tombstone exists
select pg_temp.check('tombstone for IN_PROGRESS delete', pg_temp.tombstone_count((select job_no from ckb_rebagging_deleted_jobs where job_no like 'RB%' order by deleted_at desc limit 1)) = 1);

-- =====================================================================
-- TEST 5: Deleting is idempotent-fail: second delete of same id -> 'Pekerjaan tidak ditemukan'
-- =====================================================================
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

-- 5a. Create job
select set_config('t.job5', create_rebagging_job(
  'SPLIT', 'Test idempotent delete', 'Gudang A', 'Freeport', 'WO-DEL5', 'Pagi', 0, 'Idempotent test', 'Operator Satu'
)::text, false);

select set_rebagging_sources(current_setting('t.job5')::uuid,
  '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":5,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select set_rebagging_outputs(current_setting('t.job5')::uuid,
  '[{"bin_code":"CB01B01","quantity":5,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select open_rebagging_job(current_setting('t.job5')::uuid, 'Operator Satu');

-- 5b. First delete (admin)
select set_config('request.jwt.claim.sub', current_setting('t.adm'), false);
select delete_rebagging_job(current_setting('t.job5')::uuid, 'First delete', 'Admin Satu');
select pg_temp.check('first delete succeeded', true);

-- 5c. Second delete of same id -> FAILS with 'Pekerjaan tidak ditemukan'
select pg_temp.check('second delete FAILS',
  pg_temp.fails($q$select delete_rebagging_job(current_setting('t.job5')::uuid, 'Second delete', 'Admin Satu')$q$, 'Pekerjaan tidak ditemukan'));

-- =====================================================================
-- CLEANUP
-- =====================================================================
reset role; set request.jwt.claim.sub = '';
rollback;