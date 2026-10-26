-- CKB 3PL access (0099, 0105): app access vs CKB role vs customer scope, Shell/CKB isolation at the
-- database, access administration, customers, settings and the append-only audit log.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
\ir ckb_fixture.psql

-- ---------------------------------------------------------------- who is what
set role authenticated;
select pg_temp.as_user(pg_temp.u('shell'));
select pg_temp.check('Shell-only account: no CKB role, not CKB staff', ckb_role() is null and not has_ckb_app());
select pg_temp.check('Shell-only account sees no CKB customer', (select count(*) from ckb_customers) = 0);
select pg_temp.check('Shell-only account keeps its Shell role', has_role(array['supervisor']::user_role[]));

select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('CKB-only operator has no Shell role (profile role is operator, app is not)',
  not has_role(array['operator','supervisor','admin']::user_role[]));
select pg_temp.check('CKB-only account cannot call a Shell operator RPC (save_plan)',
  pg_temp.fails($q$select save_plan('2026-10-26', '{"waves":[],"tasks":[],"outbound":[]}'::jsonb)$q$, 'Only supervisors or admins%'));
select pg_temp.check('CKB staff still read Shell bins/items (rebagging needs them)', (select count(*) from bins) > 0);
select pg_temp.check('CKB operator sees all six customers', (select count(*) from ckb_customers) >= 6);

select pg_temp.as_user(pg_temp.u('norole'));
select pg_temp.check('CKB app without a CKB role: no role, not staff, sees no customer',
  ckb_role() is null and not has_ckb_app() and (select count(*) from ckb_customers) = 0);

select pg_temp.as_user(pg_temp.u('noapp'));
select pg_temp.check('no-app account: no CKB role and no Shell role',
  ckb_role() is null and not has_role(array['operator','supervisor','admin']::user_role[]));

-- ---------------------------------------------------------------- representatives
select pg_temp.as_user(pg_temp.u('repfp'));
select pg_temp.check('representative: role customer, not staff', ckb_role() = 'customer' and not ckb_is_staff());
select pg_temp.check('representative sees only their own customer',
  (select array_agg(code) from ckb_customers) = array['FREEPORT']);
select pg_temp.check('representative cannot see another customer', not ckb_can_see_customer(:'c_cgp'));
select pg_temp.check('representative reads no Shell table (bins, inventory, movements, items)',
  (select count(*) from bins) = 0 and (select count(*) from inventory) = 0
  and (select count(*) from movements) = 0 and (select count(*) from items) = 0);
select pg_temp.check('representative reads only their own profile', (select count(*) from profiles) = 1);
select pg_temp.check('representative is not refused by the pre-request gate', not pg_temp.fails('select public.check_request()', '%'));
select pg_temp.check('representative reads no CKB settings, roles or audit',
  (select count(*) from ckb_settings) = 0 and (select count(*) from ckb_audit_events) = 0
  and (select count(*) from ckb_user_roles) = 1);
select pg_temp.check('representative cannot change customers',
  pg_temp.fails(format($q$select ckb_save_customer(%L, '', 'X', true, null, null, null, null)$q$, :'c_fp'), 'Hanya admin CKB%'));
select pg_temp.check('representative cannot manage access',
  pg_temp.fails(format($q$select ckb_set_user_access(%L, 'operator', null)$q$, pg_temp.u('op2')), 'Hanya admin CKB%'));

-- ---------------------------------------------------------------- access administration
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a CKB supervisor cannot manage access',
  pg_temp.fails(format($q$select ckb_set_user_access(%L, 'supervisor', null)$q$, pg_temp.u('op2')), 'Hanya admin CKB%'));

select pg_temp.as_user(pg_temp.u('adm'));
select ckb_set_user_access(pg_temp.u('op2'), 'supervisor', null);
select pg_temp.check('CKB admin promotes an operator', (select role from ckb_user_roles where user_id = pg_temp.u('op2')) = 'supervisor');
select pg_temp.check('the change is in the audit log with before and after',
  exists (select 1 from ckb_audit_events where action = 'ACCESS_SET' and entity_id = pg_temp.u('op2')::text
          and details->'before'->>'role' = 'operator' and details->'after'->>'role' = 'supervisor'));
select pg_temp.check('customer role without a customer is refused',
  pg_temp.fails(format($q$select ckb_set_user_access(%L, 'customer', null)$q$, pg_temp.u('norole')), '%minimal satu customer%'));
select pg_temp.check('a staff role with customer assignments is refused',
  pg_temp.fails(format($q$select ckb_set_user_access(%L, 'operator', array[%L]::uuid[])$q$, pg_temp.u('norole'), :'c_fp'), '%hanya untuk perwakilan%'));
select pg_temp.check('a role for an account without the CKB app is refused',
  pg_temp.fails(format($q$select ckb_set_user_access(%L, 'operator', null)$q$, pg_temp.u('shell')), '%akses aplikasi CKB%'));
select pg_temp.check('the shared site account is never given a CKB role',
  pg_temp.fails(format($q$select ckb_set_user_access(%L, 'operator', null)$q$, pg_temp.u('shared')), 'Akun bersama%'));
select pg_temp.check('an admin cannot change their own CKB access',
  pg_temp.fails(format($q$select ckb_set_user_access(%L, 'operator', null)$q$, pg_temp.u('adm')), '%akun Anda sendiri%'));
select ckb_set_user_access(pg_temp.u('norole'), 'customer', array[:'c_fp', :'c_cgp']::uuid[]);
select pg_temp.check('a representative can be assigned to two customers',
  (select count(*) from ckb_customer_members where user_id = pg_temp.u('norole')) = 2);
select ckb_set_user_access(pg_temp.u('norole'), 'customer', array[:'c_cgp']::uuid[]);
select pg_temp.check('reassigning replaces the customer list',
  (select array_agg(customer_id) from ckb_customer_members where user_id = pg_temp.u('norole')) = array[:'c_cgp']::uuid[]);
select ckb_set_user_access(pg_temp.u('norole'), null, null);
select pg_temp.check('removing the role removes the assignments too',
  not exists (select 1 from ckb_user_roles where user_id = pg_temp.u('norole'))
  and not exists (select 1 from ckb_customer_members where user_id = pg_temp.u('norole')));

-- App access through CKB administration touches only ckb_3pl.
select ckb_set_app_access(pg_temp.u('noapp'), true);
select pg_temp.check('CKB admin grants the CKB app only, never Shell',
  (select apps = array['ckb_3pl'] and default_app = 'ckb_3pl' from profiles where id = pg_temp.u('noapp')));
select pg_temp.check('granting the CKB app grants no CKB role',
  not exists (select 1 from ckb_user_roles where user_id = pg_temp.u('noapp')));
select ckb_set_app_access(pg_temp.u('shell'), true);
select pg_temp.check('adding the CKB app to a Shell user keeps their Shell access and default',
  (select apps = array['shell_wms','ckb_3pl'] and default_app = 'shell_wms' from profiles where id = pg_temp.u('shell')));
reset role;
update profiles set apps = array['shell_wms'], default_app = 'shell_wms' where id = pg_temp.u('shell');
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"shared":true}' where id = pg_temp.u('noapp');
set role authenticated;
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_set_app_access(pg_temp.u('noapp'), false);
select pg_temp.check('revoking the CKB app leaves no app and no default', (select apps = array[]::text[] and default_app is null from profiles where id = pg_temp.u('noapp')));
select pg_temp.check('a shared account is refused the CKB app',
  pg_temp.fails(format($q$select ckb_set_app_access(%L, true)$q$, pg_temp.u('noapp')), 'Akun bersama%'));
select ckb_set_app_access(pg_temp.u('op'), false);
select pg_temp.check('revoking the CKB app also removes the CKB role',
  not exists (select 1 from ckb_user_roles where user_id = pg_temp.u('op')));
select pg_temp.as_user(pg_temp.u('op'));
select pg_temp.check('revoked access applies on the next request (no CKB role)', ckb_role() is null and (select count(*) from ckb_customers) = 0);

-- ---------------------------------------------------------------- one admin remains / bootstrap
reset role;
delete from ckb_user_roles where role = 'admin' and user_id <> pg_temp.u('adm');
set role authenticated;
select pg_temp.as_user(pg_temp.u('adm'));
select pg_temp.check('a Shell admin cannot bootstrap while a CKB admin exists',
  pg_temp.fails('select ckb_bootstrap_admin()', 'Admin CKB sudah ada%'));
reset role;
delete from ckb_user_roles where user_id = pg_temp.u('adm');
set role authenticated;
select pg_temp.as_user(pg_temp.u('shared'));
select pg_temp.check('the shared account cannot become the first CKB admin', pg_temp.fails('select ckb_bootstrap_admin()', 'Akun bersama%'));
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a non-admin cannot bootstrap', pg_temp.fails('select ckb_bootstrap_admin()', 'Hanya admin%'));
select pg_temp.as_user(pg_temp.u('adm'));
select ckb_bootstrap_admin();
select pg_temp.check('a personal Shell admin with the CKB app becomes the first CKB admin', ckb_role() = 'admin');

-- ---------------------------------------------------------------- customers
select ckb_save_customer(null, 'tst-1', 'Pelanggan Uji', true, 'catatan', 'SAP001', '1100', 'WH05') as new_cust \gset
select pg_temp.check('admin creates a customer (code uppercased)', (select code from ckb_customers where id = :'new_cust') = 'TST-1');
select pg_temp.check('duplicate customer code refused',
  pg_temp.fails($q$select ckb_save_customer(null, 'TST-1', 'Lagi', true, null, null, null, null)$q$, '%sudah dipakai%'));
select pg_temp.check('customer code cannot be changed',
  pg_temp.fails(format($q$select ckb_save_customer(%L, 'TST-2', 'Pelanggan Uji', true, null, null, null, null)$q$, :'new_cust'), '%tidak bisa diubah%'));
select ckb_save_customer(:'new_cust', '', 'Pelanggan Uji Baru', false, null, null, null, null);
select pg_temp.check('customer update recorded with before/after',
  exists (select 1 from ckb_audit_events where action = 'CUSTOMER_UPDATE' and entity_id = :'new_cust'
          and details->'before'->>'name' = 'Pelanggan Uji' and details->'after'->>'active' = 'false'));

-- ---------------------------------------------------------------- settings
select pg_temp.check('unknown setting key refused', pg_temp.fails($q$select ckb_save_setting('nope', '{}')$q$, 'Pengaturan tidak dikenal%'));
select pg_temp.check('evidence retention below one year refused',
  pg_temp.fails($q$select ckb_save_setting('evidence', '{"max_mb":10,"allowed_mime":["image/jpeg"],"retention_days":30}')$q$, '%retensi%'));
select ckb_save_setting('stocktake', '{"blind_default": false}');
select pg_temp.check('admin saves a setting', (select value->>'blind_default' from ckb_settings where key = 'stocktake') = 'false');
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a supervisor cannot change settings',
  pg_temp.fails($q$select ckb_save_setting('stocktake', '{"blind_default": true}')$q$, 'Hanya admin CKB%'));

-- ---------------------------------------------------------------- audit log
select pg_temp.check('a supervisor reads the audit log', (select count(*) from ckb_audit_events) > 0);
select pg_temp.as_user(pg_temp.u('op2'));
reset role;
update ckb_user_roles set role = 'operator' where user_id = pg_temp.u('op2');
set role authenticated;
select pg_temp.check('an operator does not read the audit log', (select count(*) from ckb_audit_events) = 0);
select pg_temp.check('nobody calls the audit writer over the API',
  pg_temp.fails($q$select ckb_audit('X', 'x', '1', null, '{}')$q$, '%permission denied%'));
reset role;
select pg_temp.check('audit events cannot be edited, not even by the database owner',
  pg_temp.fails('update ckb_audit_events set action = ''X''', '%tidak bisa diubah%'));
select pg_temp.check('audit events cannot be deleted', pg_temp.fails('delete from ckb_audit_events', '%tidak bisa diubah%'));

-- ---------------------------------------------------------------- deactivation and the last Shell admin
update profiles set active = false where id = pg_temp.u('sup');
set role authenticated;
select pg_temp.as_user(pg_temp.u('sup'));
select pg_temp.check('a deactivated CKB account has no CKB role and reads no CKB data',
  ckb_role() is null and (select count(*) from ckb_customers) = 0);
select pg_temp.check('a deactivated account is still refused by the pre-request gate',
  pg_temp.fails('select public.check_request()', 'Akun ini dinonaktifkan%'));
reset role;
update profiles set role = 'operator' where role = 'admin' and id <> pg_temp.u('adm');
set role authenticated;
select pg_temp.as_user(pg_temp.u('adm'));
select pg_temp.check('the last Shell admin cannot remove their own Shell access',
  pg_temp.fails(format($q$select set_user_apps(%L, array['ckb_3pl'], 'ckb_3pl')$q$, pg_temp.u('adm')), '%admin aktif harus tetap%'));

rollback;
