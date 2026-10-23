-- CKB Rebagging module integration tests (migration 0084 + RPCs 0085)
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

-- Helper: qty in inventory_detail for a bin+batch
create or replace function pg_temp.qty(p_bin text, p_batch text, p_expiry date default null) returns numeric language sql as $$
  select coalesce(sum(quantity), 0)
  from inventory_detail
  where bin_code = p_bin and batch_lot = p_batch and (p_expiry is null or expiry_date = p_expiry) $$;

-- Helper: count movements for a job ref_id
create or replace function pg_temp.mov_count(p_job_id uuid, p_type text default null) returns int language sql as $$
  select count(*) from movements where ref_id = p_job_id and (p_type is null or type = p_type::movement_type) $$;

-- Helper: count ckb_packages for a job
create or replace function pg_temp.pkg_count(p_job_id uuid) returns int language sql as $$
  select count(*) from ckb_packages where source_job_id = p_job_id $$;

-- Helper: count ckb_package_lineage for a job (as output)
create or replace function pg_temp.lineage_count(p_job_id uuid) returns int language sql as $$
  select count(*) from ckb_package_lineage where output_job_id = p_job_id $$;

-- =====================================================================
-- FIXTURES: bins, items, inventory
-- =====================================================================
delete from inventory where bin_id in (select id from bins where bin_code in ('CA01A01','CA01A02','CB01B01','CB01B02'));
delete from ckb_rebagging_jobs where job_no like 'RBTEST%';

-- Ensure items exist (use existing SKUs from seed)
-- 550044709 = Shell Helix Ultra 5W-40 1L (example)
-- Create a test item if not exists
insert into items (sku, description, uom, upp)
values ('RBTEST001', 'Rebag Test Item 1', 'CAR', 48)
on conflict (sku) do nothing;

insert into items (sku, description, uom, upp)
values ('RBTEST002', 'Rebag Test Item 2', 'CAR', 24)
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

-- Stock: CB01B01 has 30 CAR of RBTEST001 batch B1 exp 2030-12-31
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
values ('adjustment',
        (select id from items where sku='RBTEST001'),
        'B1', 30,
        (select id from bins where bin_code='CB01B01'),
        '2030-12-31', 'fixture stock', 'FOUND', 'fixture');

-- Verify fixture stock
select pg_temp.check('fixture: CA01A01 has 100', pg_temp.qty('CA01A01','B1') = 100);
select pg_temp.check('fixture: CA01A02 has 50', pg_temp.qty('CA01A02','B1') = 50);
select pg_temp.check('fixture: CB01B01 has 30', pg_temp.qty('CB01B01','B1') = 30);

-- CKB app membership for the three test users (has_ckb_app() gate)
update profiles
set apps = array_append(apps, 'ckb_3pl'), active = true
where id in (current_setting('t.op')::uuid, current_setting('t.sup')::uuid, current_setting('t.adm')::uuid)
  and not ('ckb_3pl' = any(apps));

set role authenticated;

-- =====================================================================
-- TEST 1: Happy path create -> open -> start (holds exist, picking that bin now FAILS)
-- =====================================================================
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

-- 1a. Create job
select set_config('t.job1', create_rebagging_job(
  'SPLIT', 'Pecah pallet jadi kemasan kecil', 'Gudang A', 'Freeport', 'WO-001', 'Pagi', 0, 'Test job', 'Operator Satu'
)::text, false);
select pg_temp.check('create_rebagging_job returns uuid', current_setting('t.job1') ~ '^[0-9a-f-]{36}$');

-- 1b. Set sources (2 lines from CA01A01 and CA01A02)
select set_rebagging_sources(current_setting('t.job1')::uuid,
  '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":60,"unit":"CAR","pkg_count":1},
    {"source_type":"STOCK","bin_code":"CA01A02","quantity":40,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select pg_temp.check('set_rebagging_sources ok', true);

-- 1c. Set outputs (2 lines to CB01B01 and CB01B02)
select set_rebagging_outputs(current_setting('t.job1')::uuid,
  '[{"bin_code":"CB01B01","quantity":50,"unit":"CAR","pkg_count":2},
    {"bin_code":"CB01B02","quantity":50,"unit":"CAR","pkg_count":2}]'::jsonb,
  'Operator Satu');
select pg_temp.check('set_rebagging_outputs ok', true);

-- 1d. Open job
select open_rebagging_job(current_setting('t.job1')::uuid, 'Operator Satu');
select pg_temp.check('open_rebagging_job -> OPEN', (select status from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = 'OPEN');

-- 1e. Start execution (places holds)
select start_rebagging_execution(current_setting('t.job1')::uuid, 'Operator Satu');
select pg_temp.check('start_rebagging_execution -> IN_PROGRESS', (select status from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = 'IN_PROGRESS');
select pg_temp.check('executor_name recorded', (select executor_name from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = 'Operator Satu');

-- 1f. Holds exist on source bins (CA01A01 60, CA01A02 40)
select pg_temp.check('hold on CA01A01 qty 60', exists(select 1 from stock_holds where bin_id = (select id from bins where bin_code='CA01A01') and source='REBAGGING' and reason_code='REBAGGING' and quantity = 60 and ref_id = current_setting('t.job1')::uuid));
select pg_temp.check('hold on CA01A02 qty 40', exists(select 1 from stock_holds where bin_id = (select id from bins where bin_code='CA01A02') and source='REBAGGING' and reason_code='REBAGGING' and quantity = 40 and ref_id = current_setting('t.job1')::uuid));

-- 1g. Picking movement digging into held stock NOW FAILS (guard_held_stock):
--     CA01A01 holds 60 of 100; only 40 unheld carts remain, so a 50-cart pick
--     must be refused.
select pg_temp.check('picking held stock in CA01A01 FAILS',
  pg_temp.fails($q$insert into movements (user_id, type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note, by_name) values (current_setting('t.op')::uuid, 'picking', (select id from items where sku='RBTEST001'), 'B1', 50, (select id from bins where bin_code='CA01A01'), '2030-12-31', 'held pick test', 'Picker')$q$, 'ditahan'));

-- =====================================================================
-- TEST 2: Record -> Submit blocked without evidence
-- =====================================================================
-- 2a. Record execution (inputs = planned, outputs = planned)
select record_rebagging_execution(current_setting('t.job1')::uuid,
  '[{"line_no":1,"quantity":60,"unit":"CAR"},{"line_no":2,"quantity":40,"unit":"CAR"}]'::jsonb,
  '[{"line_no":1,"quantity":50,"unit":"CAR"},{"line_no":2,"quantity":50,"unit":"CAR"}]'::jsonb,
  '[{"item":"Kondisi kemasan","label":"Kemasan utuh","ok":true},{"item":"Label terbaca","label":"Label jelas","ok":true}]'::jsonb,
  'Operator Satu');
select pg_temp.check('record_rebagging_execution ok', (select status from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = 'IN_PROGRESS');

-- 2b. Submit verification WITHOUT evidence -> BLOCKED
select pg_temp.check('submit without BEFORE evidence FAILS',
  pg_temp.fails($q$select submit_rebagging_verification(current_setting('t.job1')::uuid, 'Operator Satu')$q$, 'Foto BEFORE wajib'));
select pg_temp.check('submit reports first missing kind (BEFORE)',
  pg_temp.fails($q$select submit_rebagging_verification(current_setting('t.job1')::uuid, 'Operator Satu')$q$, 'Foto BEFORE wajib'));

-- =====================================================================
-- TEST 3: Add evidence via RPC (fake storage path, RPC only validates prefix)
-- =====================================================================
-- 3a. Add BEFORE evidence
select add_rebagging_evidence(current_setting('t.job1')::uuid, 'BEFORE',
  current_setting('t.job1') || '/BEFORE/2026-10-21T08-00-00-test.jpg', 'image/jpeg', 12345, 'Before photo', 'Operator Satu');
select pg_temp.check('add BEFORE evidence ok', (select count(*) from ckb_rebagging_evidence where job_id = current_setting('t.job1')::uuid and kind = 'BEFORE') = 1);

-- 3b. Add AFTER evidence
select add_rebagging_evidence(current_setting('t.job1')::uuid, 'AFTER',
  current_setting('t.job1') || '/AFTER/2026-10-21T09-00-00-test.jpg', 'image/png', 23456, 'After photo', 'Operator Satu');
select pg_temp.check('add AFTER evidence ok', (select count(*) from ckb_rebagging_evidence where job_id = current_setting('t.job1')::uuid and kind = 'AFTER') = 1);

-- 3c. Submit verification NOW OK (variance = 100 - 100 = 0)
select submit_rebagging_verification(current_setting('t.job1')::uuid, 'Operator Satu');
select pg_temp.check('submit with evidence -> AWAITING_VERIFICATION', (select status from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = 'AWAITING_VERIFICATION');
select pg_temp.check('variance = 0 stored', (select variance_qty from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = 0);

-- =====================================================================
-- TEST 4: Verify by another person OK, same person FAILS
-- =====================================================================
-- 4a. Same person as executor (Operator Satu) -> FAILS
select pg_temp.check('verify by same person as executor FAILS',
  pg_temp.fails($q$select verify_rebagging(current_setting('t.job1')::uuid, true, 'OK', 'Operator Satu')$q$, 'Verifikator harus orang lain'));

-- 4b. Same person as creator (Operator Satu) -> FAILS (creator = Operator Satu)
select pg_temp.check('verify by same person as creator FAILS',
  pg_temp.fails($q$select verify_rebagging(current_setting('t.job1')::uuid, true, 'OK', 'Operator Satu')$q$, 'Verifikator harus orang lain'));

-- 4c. Different person (Supervisor) -> OK
select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
select verify_rebagging(current_setting('t.job1')::uuid, true, 'Verified OK', 'Supervisor Dua');
select pg_temp.check('verify by supervisor -> VERIFIED', (select status from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = 'VERIFIED');
select pg_temp.check('verifier_name recorded', (select verifier_name from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = 'Supervisor Dua');

-- =====================================================================
-- TEST 5: Approve_post -> movements exist with ref_id = job_id, transfer + ckb_packages + lineage
-- =====================================================================
-- 5a. Approve_post by supervisor (different from verifier/executor/creator)
select approve_post_rebagging(current_setting('t.job1')::uuid, 'Posting approved', 'Supervisor Dua');
select pg_temp.check('approve_post -> COMPLETED', (select status from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = 'COMPLETED');
select pg_temp.check('posted_ref = job_no', (select posted_ref from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = (select job_no from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid));

-- 5b. Transfer movements exist (2 outputs = 2 sources cross-bin = 3 transfers: 60 from CA01A01→CB01B01, 40 from CA01A02→CB01B01, 50 from CA01A02→CB01B02)
select pg_temp.check('3 transfer movements created', pg_temp.mov_count(current_setting('t.job1')::uuid, 'transfer') = 3);

-- 5c. ckb_packages created (2 output packages)
select pg_temp.check('2 output packages created', pg_temp.pkg_count(current_setting('t.job1')::uuid) = 2);
select pg_temp.check('packages status ACTIVE', (select count(*) from ckb_packages where source_job_id = current_setting('t.job1')::uuid and status = 'ACTIVE') = 2);

-- 5d. Lineage rows created (2 output packages, one from 2 sources, one from 1 source = 3 lineage rows)
select pg_temp.check('lineage rows created', pg_temp.lineage_count(current_setting('t.job1')::uuid) = 3);

-- 5e. Inventory updated: CA01A01 -60, CA01A02 -40, CB01B01 +50, CB01B02 +50
select pg_temp.check('CA01A01 now 40', pg_temp.qty('CA01A01','B1') = 40);
select pg_temp.check('CA01A02 now 10', pg_temp.qty('CA01A02','B1') = 10);
select pg_temp.check('CB01B01 now 80', pg_temp.qty('CB01B01','B1') = 80); -- was 30 + 50
select pg_temp.check('CB01B02 now 50', pg_temp.qty('CB01B02','B1') = 50);

-- 5f. Holds released (no ACTIVE holds left)
select pg_temp.check('holds released', not exists(select 1 from stock_holds where ref_id = current_setting('t.job1')::uuid and source = 'REBAGGING' and status = 'ACTIVE'));

-- 5g. Double approve_post -> 'Sudah diposting', no duplicate movements
select pg_temp.check('double approve_post FAILS',
  pg_temp.fails($q$select approve_post_rebagging(current_setting('t.job1')::uuid, 'Again', 'Supervisor Dua')$q$, 'Sudah diposting'));
select pg_temp.check('still 3 transfers (no duplicates)', pg_temp.mov_count(current_setting('t.job1')::uuid, 'transfer') = 3);

-- =====================================================================
-- TEST 6: Same-bin variant (output bin = source bin) -> only variance adjustment when delta != 0, nothing when delta = 0
-- =====================================================================
reset role; set request.jwt.claim.sub = '';
delete from inventory where bin_id in (select id from bins where bin_code in ('CA01A01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
values ('adjustment',
        (select id from items where sku='RBTEST001'),
        'B1', 100,
        (select id from bins where bin_code='CA01A01'),
        '2030-12-31', 'fixture stock', 'FOUND', 'fixture');
set role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

-- 6a. Create job2: SPLIT same bin, output to SAME bin CA01A01 (re-packaging in place)
select set_config('t.job2', create_rebagging_job(
  'SPLIT', 'Repack same bin', 'Gudang A', 'Freeport', 'WO-002', 'Pagi', 0, 'Same bin test', 'Operator Satu'
)::text, false);

select set_rebagging_sources(current_setting('t.job2')::uuid,
  '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":50,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select set_rebagging_outputs(current_setting('t.job2')::uuid,
  '[{"bin_code":"CA01A01","quantity":50,"unit":"CAR","pkg_count":2}]'::jsonb,
  'Operator Satu');
select open_rebagging_job(current_setting('t.job2')::uuid, 'Operator Satu');
select start_rebagging_execution(current_setting('t.job2')::uuid, 'Operator Satu');
select record_rebagging_execution(current_setting('t.job2')::uuid,
  '[{"line_no":1,"quantity":50,"unit":"CAR"}]'::jsonb,
  '[{"line_no":1,"quantity":50,"unit":"CAR"}]'::jsonb,
  '[{"item":"Kondisi","label":"OK","ok":true}]'::jsonb,
  'Operator Satu');
select add_rebagging_evidence(current_setting('t.job2')::uuid, 'BEFORE',
  current_setting('t.job2') || '/BEFORE/before.jpg', 'image/jpeg', 1000, 'b', 'Operator Satu');
select add_rebagging_evidence(current_setting('t.job2')::uuid, 'AFTER',
  current_setting('t.job2') || '/AFTER/after.jpg', 'image/jpeg', 1000, 'a', 'Operator Satu');
select submit_rebagging_verification(current_setting('t.job2')::uuid, 'Operator Satu');
select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
select verify_rebagging(current_setting('t.job2')::uuid, true, 'OK', 'Supervisor Dua');
select approve_post_rebagging(current_setting('t.job2')::uuid, 'Same bin post', 'Supervisor Dua');

-- 6b. Same bin, delta = 0 -> NO movements at all (no transfer, no adjustment)
select pg_temp.check('same-bin delta=0: zero movements', pg_temp.mov_count(current_setting('t.job2')::uuid) = 0);
select pg_temp.check('same-bin delta=0: inventory unchanged (still 100)', pg_temp.qty('CA01A01','B1') = 100);
select pg_temp.check('same-bin delta=0: 1 package created', pg_temp.pkg_count(current_setting('t.job2')::uuid) = 1);

-- 6c. Job3: Same bin but WITH variance (output 45 vs input 50 -> loss 5)
reset role; set request.jwt.claim.sub = '';
delete from inventory where bin_id in (select id from bins where bin_code in ('CA01A01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
values ('adjustment',
        (select id from items where sku='RBTEST001'),
        'B1', 100,
        (select id from bins where bin_code='CA01A01'),
        '2030-12-31', 'fixture stock', 'FOUND', 'fixture');
set role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

select set_config('t.job3', create_rebagging_job(
  'DAMAGE_REBAG', 'Kemasan rusak, loss 5', 'Gudang A', 'Freeport', 'WO-003', 'Pagi', 0, 'Variance test', 'Operator Satu'
)::text, false);

select set_rebagging_sources(current_setting('t.job3')::uuid,
  '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":50,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select set_rebagging_outputs(current_setting('t.job3')::uuid,
  '[{"bin_code":"CA01A01","quantity":45,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select open_rebagging_job(current_setting('t.job3')::uuid, 'Operator Satu');
select start_rebagging_execution(current_setting('t.job3')::uuid, 'Operator Satu');
select record_rebagging_execution(current_setting('t.job3')::uuid,
  '[{"line_no":1,"quantity":50,"unit":"CAR"}]'::jsonb,
  '[{"line_no":1,"quantity":45,"unit":"CAR"}]'::jsonb,
  '[{"item":"Kondisi","label":"Rusak 5","ok":true}]'::jsonb,
  'Operator Satu');
select add_rebagging_evidence(current_setting('t.job3')::uuid, 'BEFORE',
  current_setting('t.job3') || '/BEFORE/b.jpg', 'image/jpeg', 1000, 'b', 'Operator Satu');
select add_rebagging_evidence(current_setting('t.job3')::uuid, 'AFTER',
  current_setting('t.job3') || '/AFTER/a.jpg', 'image/jpeg', 1000, 'a', 'Operator Satu');
select submit_rebagging_verification(current_setting('t.job3')::uuid, 'Operator Satu');

-- Variance = 5, must resolve before approve_post (verify FIRST: posting needs VERIFIED)
select pg_temp.check('variance = 5 stored', (select variance_qty from ckb_rebagging_jobs where id = current_setting('t.job3')::uuid) = 5);
select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
select verify_rebagging(current_setting('t.job3')::uuid, true, 'OK', 'Supervisor Dua');
select pg_temp.check('approve_post without variance resolution FAILS',
  pg_temp.fails($q$select approve_post_rebagging(current_setting('t.job3')::uuid, 'No variance resolved', 'Supervisor Dua')$q$, 'Varians belum diselesaikan'));

-- Resolve variance
select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
select resolve_rebagging_variance(current_setting('t.job3')::uuid, 'DAMAGED', 'Kemasan sobek 5 karton', 'Supervisor Dua');
select pg_temp.check('variance resolved', (select variance_reason from ckb_rebagging_jobs where id = current_setting('t.job3')::uuid) = 'DAMAGED');
select pg_temp.check('variance_decided_by recorded', (select variance_decided_by from ckb_rebagging_jobs where id = current_setting('t.job3')::uuid) = 'Supervisor Dua');

-- Now approve_post
select approve_post_rebagging(current_setting('t.job3')::uuid, 'Variance posted', 'Supervisor Dua');

-- 6d. Same-bin with variance -> ONLY negative adjustment movement (no transfer)
select pg_temp.check('same-bin variance: 1 adjustment movement', pg_temp.mov_count(current_setting('t.job3')::uuid, 'adjustment') = 1);
select pg_temp.check('same-bin variance: zero transfer movements', pg_temp.mov_count(current_setting('t.job3')::uuid, 'transfer') = 0);
select pg_temp.check('same-bin variance: CA01A01 now 95 (100-5)', pg_temp.qty('CA01A01','B1') = 95);

-- =====================================================================
-- TEST 7: Verify by same person as executor FAILS (already tested in TEST 4, but explicit)
-- =====================================================================
-- Covered in TEST 4

-- =====================================================================
-- TEST 8: Variance unresolved blocks approve_post (covered in TEST 6c)
-- =====================================================================
-- Covered in TEST 6c

-- =====================================================================
-- TEST 9: RLS - non-ckb member sees 0 rows (RLS with select grants returns
-- zero rows for non-member, not 'permission denied')
-- =====================================================================
reset role; set request.jwt.claim.sub = '';
-- Create a profile without ckb_3pl app (insert its auth.users row first —
-- profiles.id has a foreign key to auth.users)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000999', 'nonckb@pengguna.internal')
on conflict (id) do nothing;
insert into profiles (id, username, name, role, apps, active)
values ('00000000-0000-0000-0000-000000000999', 'nonckb', 'Non CKB User', 'operator', '{}', true)
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000999', false);
set role authenticated;

select pg_temp.check('non-ckb member sees 0 rows in ckb_rebagging_jobs',
  (select count(*) from ckb_rebagging_jobs) = 0);
select pg_temp.check('non-ckb member sees 0 rows in ckb_rebagging_sources',
  (select count(*) from ckb_rebagging_sources) = 0);
select pg_temp.check('non-ckb member sees 0 rows in ckb_rebagging_outputs',
  (select count(*) from ckb_rebagging_outputs) = 0);
select pg_temp.check('non-ckb member sees 0 rows in ckb_packages',
  (select count(*) from ckb_packages) = 0);
select pg_temp.check('non-ckb member sees 0 rows in ckb_package_lineage',
  (select count(*) from ckb_package_lineage) = 0);
select pg_temp.check('non-ckb member sees 0 rows in ckb_rebagging_evidence',
  (select count(*) from ckb_rebagging_evidence) = 0);
select pg_temp.check('non-ckb member sees 0 rows in ckb_rebagging_events',
  (select count(*) from ckb_rebagging_events) = 0);

-- =====================================================================
-- TEST 10: Direct UPDATE on ckb_rebagging_jobs as authenticated is a
-- silent no-op (RLS default-deny = row filtered from the update set)
-- =====================================================================
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);
update ckb_rebagging_jobs set status='DRAFT' where id=current_setting('t.job1')::uuid;
select pg_temp.check('direct UPDATE ckb_rebagging_jobs ignored (RLS)',
  (select status from ckb_rebagging_jobs where id = current_setting('t.job1')::uuid) = 'COMPLETED');

-- =====================================================================
-- TEST 11: Reversal restores inventory balances, retires output packages
-- =====================================================================
reset role; set request.jwt.claim.sub = '';
-- Fresh stock for reversal test
delete from inventory where bin_id in (select id from bins where bin_code in ('CA01A01','CB01B01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
values ('adjustment',
        (select id from items where sku='RBTEST001'),
        'B1', 100,
        (select id from bins where bin_code='CA01A01'),
        '2030-12-31', 'fixture stock', 'FOUND', 'fixture');
-- CB01B01 starts at 0 (no fixture movement needed; inventory is 0 by default)
set role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

-- Create job4: cross-bin with variance
select set_config('t.job4', create_rebagging_job(
  'DAMAGE_REBAG', 'Loss 10', 'Gudang A', 'Freeport', 'WO-004', 'Pagi', 0, 'Reversal test', 'Operator Satu'
)::text, false);
select set_rebagging_sources(current_setting('t.job4')::uuid,
  '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":100,"unit":"CAR","pkg_count":2}]'::jsonb,
  'Operator Satu');
select set_rebagging_outputs(current_setting('t.job4')::uuid,
  '[{"bin_code":"CB01B01","quantity":90,"unit":"CAR","pkg_count":2}]'::jsonb,
  'Operator Satu');
select open_rebagging_job(current_setting('t.job4')::uuid, 'Operator Satu');
select start_rebagging_execution(current_setting('t.job4')::uuid, 'Operator Satu');
select record_rebagging_execution(current_setting('t.job4')::uuid,
  '[{"line_no":1,"quantity":100,"unit":"CAR"}]'::jsonb,
  '[{"line_no":1,"quantity":90,"unit":"CAR"}]'::jsonb,
  '[{"item":"Kondisi","label":"Rusak 10","ok":true}]'::jsonb,
  'Operator Satu');
select add_rebagging_evidence(current_setting('t.job4')::uuid, 'BEFORE',
  current_setting('t.job4') || '/BEFORE/b.jpg', 'image/jpeg', 1000, 'b', 'Operator Satu');
select add_rebagging_evidence(current_setting('t.job4')::uuid, 'AFTER',
  current_setting('t.job4') || '/AFTER/a.jpg', 'image/jpeg', 1000, 'a', 'Operator Satu');
select submit_rebagging_verification(current_setting('t.job4')::uuid, 'Operator Satu');
select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
select resolve_rebagging_variance(current_setting('t.job4')::uuid, 'DAMAGED', 'Kemasan sobek', 'Supervisor Dua');
select verify_rebagging(current_setting('t.job4')::uuid, true, 'OK', 'Supervisor Dua');
select approve_post_rebagging(current_setting('t.job4')::uuid, 'Posted', 'Supervisor Dua');

-- Capture pre-reversal state
select pg_temp.check('pre-reversal: CA01A01 = 0', pg_temp.qty('CA01A01','B1') = 0);
select pg_temp.check('pre-reversal: CB01B01 = 90', pg_temp.qty('CB01B01','B1') = 90);
select set_config('t.pkg_ids', (select jsonb_agg(id) from ckb_packages where source_job_id = current_setting('t.job4')::uuid)::text, false);

-- Reversal by supervisor
select reverse_rebagging_posting(current_setting('t.job4')::uuid, 'Reverse test', 'Supervisor Dua');

-- Post-reversal checks
select pg_temp.check('reversal -> REVERSED', (select status from ckb_rebagging_jobs where id = current_setting('t.job4')::uuid) = 'REVERSED');
select pg_temp.check('reversal: CA01A01 restored to 100', pg_temp.qty('CA01A01','B1') = 100);
select pg_temp.check('reversal: CB01B01 back to 0', pg_temp.qty('CB01B01','B1') = 0);
select pg_temp.check('reversal: output packages RETIRED',
  (select count(*) from ckb_packages where source_job_id = current_setting('t.job4')::uuid and status = 'RETIRED') = 1);
select pg_temp.check('reversal: compensating transfer movements (output->source)',
  pg_temp.mov_count(current_setting('t.job4')::uuid, 'transfer') = 2); -- original 1 transfer + 1 reverse transfer
select pg_temp.check('reversal: positive adjustment restoring loss',
  pg_temp.mov_count(current_setting('t.job4')::uuid, 'adjustment') = 2); -- original 1 adjustment (loss) + 1 reverse adjustment = 2 total
-- Actually original post: 1 transfer + 1 adjustment (loss). Reversal: 1 reverse transfer + 1 positive adjustment. Total movements = 4.
select pg_temp.check('reversal: total movements = 4', pg_temp.mov_count(current_setting('t.job4')::uuid) = 4);
select pg_temp.check('reversal: lineage KEPT (not deleted)', pg_temp.lineage_count(current_setting('t.job4')::uuid) = 1);

-- =====================================================================
-- TEST 12: Concurrent second job on same source blocked by holds
-- =====================================================================
reset role; set request.jwt.claim.sub = '';
delete from inventory where bin_id in (select id from bins where bin_code in ('CA01A01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
values ('adjustment',
        (select id from items where sku='RBTEST001'),
        'B1', 100,
        (select id from bins where bin_code='CA01A01'),
        '2030-12-31', 'fixture stock', 'FOUND', 'fixture');
set role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

-- Job5: starts and holds CA01A01
select set_config('t.job5', create_rebagging_job('SPLIT', 'Job 5', 'Gudang A', 'Freeport', 'WO-005', 'Pagi', 0, '', 'Operator Satu')::text, false);
select set_rebagging_sources(current_setting('t.job5')::uuid, '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":50,"unit":"CAR"}]'::jsonb, 'Operator Satu');
select set_rebagging_outputs(current_setting('t.job5')::uuid, '[{"bin_code":"CB01B01","quantity":50,"unit":"CAR"}]'::jsonb, 'Operator Satu');
select open_rebagging_job(current_setting('t.job5')::uuid, 'Operator Satu');
select start_rebagging_execution(current_setting('t.job5')::uuid, 'Operator Satu');

-- Job6: tries to use same source CA01A01 (still held by job5)
select set_config('t.job6', create_rebagging_job('SPLIT', 'Job 6', 'Gudang A', 'Freeport', 'WO-006', 'Pagi', 0, '', 'Operator Dua')::text, false);
select set_rebagging_sources(current_setting('t.job6')::uuid, '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":30,"unit":"CAR"}]'::jsonb, 'Operator Dua');
select set_rebagging_outputs(current_setting('t.job6')::uuid, '[{"bin_code":"CB01B02","quantity":30,"unit":"CAR"}]'::jsonb, 'Operator Dua');
select open_rebagging_job(current_setting('t.job6')::uuid, 'Operator Dua');
-- start_rebagging_execution should FAIL because holds on CA01A01 already exist (qty 50 held, only 50 free, but job6 wants 30 - actually the hold guard is on movement, not on start. start places holds. The second start would try to place overlapping holds. Let's check if the hold placement fails.)
-- Actually the hold placement in start_rebagging_execution should check available qty. Let's test.
select pg_temp.check('second job start on same bin FAILS (overlapping holds)',
  pg_temp.fails($q$select start_rebagging_execution(current_setting('t.job6')::uuid, 'Operator Dua')$q$, 'stok tidak cukup|hold|tidak tersedia'));

-- =====================================================================
-- TEST 13: Inventory changed since execution -> post blocked
-- =====================================================================
reset role; set request.jwt.claim.sub = '';
delete from inventory where bin_id in (select id from bins where bin_code in ('CA01A01'));
-- TEST 12 left job5's hold ACTIVE on this identity; a fresh fixture must clear it
delete from stock_holds where item_id = (select id from items where sku='RBTEST001') and bin_id in (select id from bins where bin_code='CA01A01');
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
values ('adjustment',
        (select id from items where sku='RBTEST001'),
        'B1', 100,
        (select id from bins where bin_code='CA01A01'),
        '2030-12-31', 'fixture stock', 'FOUND', 'fixture');
set role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

select set_config('t.job7', create_rebagging_job('SPLIT', 'Job 7', 'Gudang A', 'Freeport', 'WO-007', 'Pagi', 0, '', 'Operator Satu')::text, false);
select set_rebagging_sources(current_setting('t.job7')::uuid, '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":50,"unit":"CAR"}]'::jsonb, 'Operator Satu');
select set_rebagging_outputs(current_setting('t.job7')::uuid, '[{"bin_code":"CB01B01","quantity":50,"unit":"CAR"}]'::jsonb, 'Operator Satu');
select open_rebagging_job(current_setting('t.job7')::uuid, 'Operator Satu');
select start_rebagging_execution(current_setting('t.job7')::uuid, 'Operator Satu');
select record_rebagging_execution(current_setting('t.job7')::uuid,
  '[{"line_no":1,"quantity":50,"unit":"CAR"}]'::jsonb,
  '[{"line_no":1,"quantity":50,"unit":"CAR"}]'::jsonb,
  '[{"item":"Kondisi","label":"OK","ok":true}]'::jsonb,
  'Operator Satu');
select add_rebagging_evidence(current_setting('t.job7')::uuid, 'BEFORE', current_setting('t.job7') || '/BEFORE/b.jpg', 'image/jpeg', 1000, 'b', 'Operator Satu');
select add_rebagging_evidence(current_setting('t.job7')::uuid, 'AFTER', current_setting('t.job7') || '/AFTER/a.jpg', 'image/jpeg', 1000, 'a', 'Operator Satu');
select submit_rebagging_verification(current_setting('t.job7')::uuid, 'Operator Satu');
select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
select verify_rebagging(current_setting('t.job7')::uuid, true, 'OK', 'Supervisor Dua');

-- Now externally reduce stock on CA01A01 (simulate another movement consuming stock)
reset role; set request.jwt.claim.sub = '';
insert into movements (type, item_id, batch_lot, quantity, from_bin_id, expiry_date, note, by_name)
values ('picking',
        (select id from items where sku='RBTEST001'),
        'B1', 30,
        (select id from bins where bin_code='CA01A01'),
        '2030-12-31', 'external pick', 'External');
set role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);

-- approve_post should now FAIL with 'Stok berubah sejak eksekusi'
select pg_temp.check('approve_post with changed inventory FAILS',
  pg_temp.fails($q$select approve_post_rebagging(current_setting('t.job7')::uuid, 'Should fail', 'Supervisor Dua')$q$, 'Stok berubah sejak eksekusi'));

-- =====================================================================
-- TEST 14: RELABEL - no stock change, package lineage set, no second active package
-- =====================================================================
reset role; set request.jwt.claim.sub = '';
delete from inventory where bin_id in (select id from bins where bin_code in ('CA01A01'));
-- TEST 13 left job7 VERIFIED with ACTIVE holds on this identity; clear them
delete from stock_holds where item_id = (select id from items where sku='RBTEST001') and bin_id in (select id from bins where bin_code='CA01A01');
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
values ('adjustment',
        (select id from items where sku='RBTEST001'),
        'B1', 50,
        (select id from bins where bin_code='CA01A01'),
        '2030-12-31', 'fixture stock', 'FOUND', 'fixture');
set role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.op'), false);

-- Create a source package first (simulate existing package)
-- Actually let's create a package via a job first, then use it as source
select set_config('t.job8a', create_rebagging_job('SPLIT', 'Create source package', 'Gudang A', 'Freeport', 'WO-008a', 'Pagi', 0, '', 'Operator Satu')::text, false);
select set_rebagging_sources(current_setting('t.job8a')::uuid, '[{"source_type":"STOCK","bin_code":"CA01A01","quantity":50,"unit":"CAR","pkg_count":1}]'::jsonb, 'Operator Satu');
select set_rebagging_outputs(current_setting('t.job8a')::uuid, '[{"bin_code":"CA01A01","quantity":50,"unit":"CAR","pkg_count":1}]'::jsonb, 'Operator Satu');
select open_rebagging_job(current_setting('t.job8a')::uuid, 'Operator Satu');
select start_rebagging_execution(current_setting('t.job8a')::uuid, 'Operator Satu');
select record_rebagging_execution(current_setting('t.job8a')::uuid,
  '[{"line_no":1,"quantity":50,"unit":"CAR"}]'::jsonb,
  '[{"line_no":1,"quantity":50,"unit":"CAR"}]'::jsonb,
  '[{"item":"Kondisi","label":"OK","ok":true}]'::jsonb,
  'Operator Satu');
select add_rebagging_evidence(current_setting('t.job8a')::uuid, 'BEFORE', current_setting('t.job8a') || '/BEFORE/b.jpg', 'image/jpeg', 1000, 'b', 'Operator Satu');
select add_rebagging_evidence(current_setting('t.job8a')::uuid, 'AFTER', current_setting('t.job8a') || '/AFTER/a.jpg', 'image/jpeg', 1000, 'a', 'Operator Satu');
select submit_rebagging_verification(current_setting('t.job8a')::uuid, 'Operator Satu');
select set_config('request.jwt.claim.sub', current_setting('t.sup'), false);
select verify_rebagging(current_setting('t.job8a')::uuid, true, 'OK', 'Supervisor Dua');
select approve_post_rebagging(current_setting('t.job8a')::uuid, 'Posted', 'Supervisor Dua');

-- Get the created package_id
select set_config('t.pkg_src_id', (select id::text from ckb_packages where source_job_id = current_setting('t.job8a')::uuid limit 1)::text, false);
select pg_temp.check('source package created', current_setting('t.pkg_src_id') <> '');

-- Now RELABEL job using that package as source
select set_config('t.job8b', create_rebagging_job('RELABEL', 'Ganti label paket', 'Gudang A', 'Freeport', 'WO-008b', 'Pagi', 0, '', 'Operator Satu')::text, false);
select set_config('t.pkg_no', (select package_no from ckb_packages where id = current_setting('t.pkg_src_id')::uuid), false);
select set_rebagging_sources(current_setting('t.job8b')::uuid,
  ('[{"source_type":"PACKAGE","package_no":"' || current_setting('t.pkg_no') || '","quantity":50,"unit":"CAR","pkg_count":1}]')::jsonb,
  'Operator Satu');
select set_rebagging_outputs(current_setting('t.job8b')::uuid,
  '[{"bin_code":"CA01A01","quantity":50,"unit":"CAR","pkg_count":1}]'::jsonb,
  'Operator Satu');
select open_rebagging_job(current_setting('t.job8b')::uuid, 'Operator Satu');
select start_rebagging_execution(current_setting('t.job8b')::uuid, 'Operator Satu');
select record_rebagging_execution(current_setting('t.job8b')::uuid,
  '[{"line_no":1,"quantity":50,"unit":"CAR"}]'::jsonb,
  '[{"line_no":1,"quantity":50,"unit":"CAR"}]'::jsonb,
  '[{"item":"Label","label":"Baru","ok":true}]'::jsonb,
  'Operator Satu');
select add_rebagging_evidence(current_setting('t.job8b')::uuid, 'BEFORE', current_setting('t.job8b') || '/BEFORE/b.jpg', 'image/jpeg', 1000, 'b', 'Operator Satu');
select add_rebagging_evidence(current_setting('t.job8b')::uuid, 'AFTER', current_setting('t.job8b') || '/AFTER/a.jpg', 'image/jpeg', 1000, 'a', 'Operator Satu');
select submit_rebagging_verification(current_setting('t.job8b')::uuid, 'Operator Satu');
select verify_rebagging(current_setting('t.job8b')::uuid, true, 'OK', 'Supervisor Dua');
select approve_post_rebagging(current_setting('t.job8b')::uuid, 'Relabel posted', 'Supervisor Dua');

-- 14a. No stock change (still 50 in CA01A01 from the 50 that remained)
select pg_temp.check('relabel: inventory unchanged (CA01A01=50)', pg_temp.qty('CA01A01','B1') = 50);

-- 14b. Source package RETIRED
select pg_temp.check('relabel: source package RETIRED', (select status from ckb_packages where id = current_setting('t.pkg_src_id')::uuid) = 'RETIRED');

-- 14c. New output package ACTIVE
select pg_temp.check('relabel: 1 new output package ACTIVE', pg_temp.pkg_count(current_setting('t.job8b')::uuid) = 1);

-- 14d. Lineage from source package to new package
select pg_temp.check('relabel: lineage source_pkg -> output_pkg', pg_temp.lineage_count(current_setting('t.job8b')::uuid) = 1);
select pg_temp.check('relabel: lineage row has source_package_id', exists(select 1 from ckb_package_lineage where output_job_id = current_setting('t.job8b')::uuid and source_package_id = current_setting('t.pkg_src_id')::uuid));

-- =====================================================================
-- CLEANUP
-- =====================================================================
reset role; set request.jwt.claim.sub = '';
rollback;