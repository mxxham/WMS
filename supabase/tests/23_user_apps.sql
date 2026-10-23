-- User app access (0080): backfill, CHECK constraints, set_user_apps RPC.
-- Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;

insert into auth.users (id, email, raw_user_meta_data) values ('22222222-2222-2222-2222-222222222222','testadmin@x','{"name":"Test Admin"}') on conflict do nothing;
update profiles set role = 'admin', active = true, apps = array['shell_wms'], default_app = 'shell_wms' where id = '22222222-2222-2222-2222-222222222222';

insert into auth.users (id, email, raw_user_meta_data) values ('33333333-3333-3333-3333-333333333333','testop@x','{"name":"Test Op"}') on conflict do nothing;
update profiles set role = 'operator', active = true, apps = array['shell_wms'], default_app = 'shell_wms' where id = '33333333-3333-3333-3333-333333333333';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;

-- -------------------------------------------------------------------
-- Backfill on seeded profiles: every profile has apps = {shell_wms},
-- default_app = shell_wms
-- -------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select pg_temp.check('backfill: seeded admin has shell_wms only',
  (select apps = array['shell_wms'] and default_app = 'shell_wms' from profiles where id = '22222222-2222-2222-2222-222222222222'));

select pg_temp.check('backfill: seeded operator has shell_wms only',
  (select apps = array['shell_wms'] and default_app = 'shell_wms' from profiles where id = '33333333-3333-3333-3333-333333333333'));

-- -------------------------------------------------------------------
-- CHECK constraints (run as superuser to bypass RLS)
-- -------------------------------------------------------------------
reset role;
select pg_temp.check('CHECK rejects unknown app id',
  pg_temp.fails($q$insert into profiles (id, name, role, username, apps, default_app)
    values ('44444444-4444-4444-4444-444444444444','X','operator','x1', array['shell_wms','unknown'], 'shell_wms')$q$, '%profiles_apps_allowed%'));

select pg_temp.check('CHECK rejects default not in apps',
  pg_temp.fails($q$insert into profiles (id, name, role, username, apps, default_app)
    values ('55555555-5555-5555-5555-555555555555','Y','operator','y1', array['shell_wms'], 'ckb_3pl')$q$, '%profiles_default_app_allowed%'));

-- -------------------------------------------------------------------
-- RPC: non-admin refused
-- -------------------------------------------------------------------
update profiles set role = 'operator' where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select pg_temp.check('non-admin refused',
  pg_temp.fails($q$select set_user_apps('33333333-3333-3333-3333-333333333333', array['shell_wms','ckb_3pl'], 'shell_wms')$q$, '%Hanya admin%'));

-- -------------------------------------------------------------------
-- RPC: admin can set both apps + default
-- -------------------------------------------------------------------
reset role;
update profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select set_user_apps('33333333-3333-3333-3333-333333333333', array['shell_wms','ckb_3pl'], 'shell_wms');
select pg_temp.check('admin sets both apps with default',
  (select apps @> array['shell_wms','ckb_3pl'] and default_app = 'shell_wms' from profiles where id = '33333333-3333-3333-3333-333333333333'));

-- -------------------------------------------------------------------
-- RPC: admin CAN self-grant (approved exception to not-on-yourself)
-- -------------------------------------------------------------------
select set_user_apps('22222222-2222-2222-2222-222222222222', array['shell_wms','ckb_3pl'], 'ckb_3pl');
select pg_temp.check('admin self-grants both apps (exception)',
  (select apps @> array['shell_wms','ckb_3pl'] and default_app = 'ckb_3pl' from profiles where id = '22222222-2222-2222-2222-222222222222'));

-- -------------------------------------------------------------------
-- RPC: both apps without default rejected
-- -------------------------------------------------------------------
select pg_temp.check('both apps without default rejected',
  pg_temp.fails($q$select set_user_apps('33333333-3333-3333-3333-333333333333', array['shell_wms','ckb_3pl'], null)$q$, '%Dua aplikasi memerlukan default_app%'));

-- -------------------------------------------------------------------
-- RPC: revoking an app clears a stale default
-- -------------------------------------------------------------------
-- First give the operator both apps with shell_wms default
select set_user_apps('33333333-3333-3333-3333-333333333333', array['shell_wms','ckb_3pl'], 'shell_wms');
-- Now revoke ckb_3pl — default was shell_wms, so it stays shell_wms
select set_user_apps('33333333-3333-3333-3333-333333333333', array['shell_wms'], null);
select pg_temp.check('revoking non-default app keeps default',
  (select apps = array['shell_wms'] and default_app = 'shell_wms' from profiles where id = '33333333-3333-3333-3333-333333333333'));

-- Now give both with ckb_3pl as default, then revoke ckb_3pl — default must repair to shell_wms
select set_user_apps('33333333-3333-3333-3333-333333333333', array['shell_wms','ckb_3pl'], 'ckb_3pl');
select set_user_apps('33333333-3333-3333-3333-333333333333', array['shell_wms'], null);
select pg_temp.check('revoking default app repairs to remaining app',
  (select apps = array['shell_wms'] and default_app = 'shell_wms' from profiles where id = '33333333-3333-3333-3333-333333333333'));

-- -------------------------------------------------------------------
-- RPC: zero-access row is legal (apps = {}, default_app = null)
-- -------------------------------------------------------------------
select set_user_apps('33333333-3333-3333-3333-333333333333', array[]::text[], null);
select pg_temp.check('zero apps allowed, default null',
  (select apps = array[]::text[] and default_app is null from profiles where id = '33333333-3333-3333-3333-333333333333'));

-- -------------------------------------------------------------------
-- RPC: single app implies repaired default (even if null passed)
-- -------------------------------------------------------------------
select set_user_apps('33333333-3333-3333-3333-333333333333', array['ckb_3pl'], null);
select pg_temp.check('single app forces default to that app',
  (select apps = array['ckb_3pl'] and default_app = 'ckb_3pl' from profiles where id = '33333333-3333-3333-3333-333333333333'));

-- -------------------------------------------------------------------
-- RPC: unknown app id rejected
-- -------------------------------------------------------------------
select pg_temp.check('unknown app id rejected',
  pg_temp.fails($q$select set_user_apps('33333333-3333-3333-3333-333333333333', array['shell_wms','bad'], 'shell_wms')$q$, '%ID aplikasi tidak dikenal%'));

-- -------------------------------------------------------------------
-- RPC: default not in apps rejected
-- -------------------------------------------------------------------
select pg_temp.check('default not in apps rejected',
  pg_temp.fails($q$select set_user_apps('33333333-3333-3333-3333-333333333333', array['shell_wms'], 'ckb_3pl')$q$, '%Aplikasi default harus termasuk%'));

rollback;