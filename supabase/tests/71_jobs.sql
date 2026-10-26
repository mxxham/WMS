-- Flowchart jobs (0109): profiles.job, role derived from job, set_user_job, placeholder mapping.
-- Runs in a transaction and rolls back. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true); end $$;

-- job -> level, all seven
select pg_temp.check('job_level maps all seven jobs',
  public.job_level('admin') = 'admin' and public.job_level('leader') = 'supervisor'
  and public.job_level('admin_inbound') = 'supervisor' and public.job_level('admin_outbound') = 'supervisor'
  and public.job_level('inventory') = 'supervisor' and public.job_level('checker') = 'operator'
  and public.job_level('operator') = 'operator');
-- backfill (seed profiles that exist before the test fixtures)
select pg_temp.check('backfill: supervisor -> leader, operator -> operator, admin -> admin',
  not exists (select 1 from profiles where (role = 'supervisor' and job <> 'leader' and job not in ('admin_inbound','admin_outbound','inventory'))
                                        or (role = 'operator' and job not in ('operator','checker'))
                                        or (role = 'admin' and job <> 'admin')));

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('b1111111-1111-1111-1111-111111111111','adm1@pengguna.internal','{"name":"Adm1"}','{"username":"adm1"}'),
  ('b2222222-2222-2222-2222-222222222222','ops1@pengguna.internal','{"name":"Ops1"}','{"username":"ops1"}'),
  ('b3333333-3333-3333-3333-333333333333','ops2@pengguna.internal','{"name":"Ops2"}','{"username":"ops2"}');
select pg_temp.check('a new account is job operator, role operator',
  (select job = 'operator' and role = 'operator' from profiles where id = 'b2222222-2222-2222-2222-222222222222'));
update profiles set job = 'admin' where id = 'b1111111-1111-1111-1111-111111111111';
select pg_temp.check('setting job admin makes role admin',
  (select role = 'admin' from profiles where id = 'b1111111-1111-1111-1111-111111111111'));
update profiles set job = 'admin_inbound' where id = 'b3333333-3333-3333-3333-333333333333';
select pg_temp.check('job admin_inbound makes role supervisor',
  (select role = 'supervisor' from profiles where id = 'b3333333-3333-3333-3333-333333333333'));
update profiles set job = 'checker' where id = 'b3333333-3333-3333-3333-333333333333';
select pg_temp.check('job checker makes role operator',
  (select role = 'operator' from profiles where id = 'b3333333-3333-3333-3333-333333333333'));
update profiles set role = 'supervisor' where id = 'b2222222-2222-2222-2222-222222222222';
select pg_temp.check('legacy role supervisor sets job leader',
  (select job = 'leader' and role = 'supervisor' from profiles where id = 'b2222222-2222-2222-2222-222222222222'));
update profiles set role = 'operator' where id = 'b2222222-2222-2222-2222-222222222222';
select pg_temp.check('legacy role operator sets job operator',
  (select job = 'operator' and role = 'operator' from profiles where id = 'b2222222-2222-2222-2222-222222222222'));
select pg_temp.check('a job outside the list is refused',
  pg_temp.fails($q$update profiles set job = 'janitor' where id = 'b2222222-2222-2222-2222-222222222222'$q$, '%profiles_job_check%'));

-- make the fixture admin the only active admin
update profiles set active = false where role = 'admin' and id <> 'b1111111-1111-1111-1111-111111111111';
update profiles set apps = array['shell_wms'] where id = 'b1111111-1111-1111-1111-111111111111';

set role authenticated;
select pg_temp.as_user('b2222222-2222-2222-2222-222222222222');
select pg_temp.check('a non-admin cannot set a job',
  pg_temp.fails($q$select set_user_job('b3333333-3333-3333-3333-333333333333', 'leader')$q$, 'Hanya admin%'));
select pg_temp.as_user('b1111111-1111-1111-1111-111111111111');
select set_user_job('b3333333-3333-3333-3333-333333333333', 'inventory');
select pg_temp.check('an admin sets another account''s job; role follows',
  (select job = 'inventory' and role = 'supervisor' from profiles where id = 'b3333333-3333-3333-3333-333333333333'));
select pg_temp.check('an admin cannot set their own job',
  pg_temp.fails($q$select set_user_job('b1111111-1111-1111-1111-111111111111', 'leader')$q$, 'Tidak bisa mengubah akun Anda sendiri%'));
select pg_temp.check('an unknown job is refused by set_user_job',
  pg_temp.fails($q$select set_user_job('b3333333-3333-3333-3333-333333333333', 'janitor')$q$, '%'));
select pg_temp.check('my_job and has_job read the caller''s job',
  public.my_job() = 'admin' and public.has_job(array['admin']) and not public.has_job(array['leader','checker']));
-- Reaching the last-admin rule needs an actor with the admin level but not the admin job: craft it
-- with the derivation trigger off (it cannot happen through the API).
reset role;
alter table profiles disable trigger profiles_job_level;
update profiles set role = 'admin', job = 'leader' where id = 'b2222222-2222-2222-2222-222222222222';
alter table profiles enable trigger profiles_job_level;
set role authenticated;
select pg_temp.as_user('b2222222-2222-2222-2222-222222222222');
select pg_temp.check('the last-admin rule: moving the last active admin job to leader fails',
  pg_temp.fails($q$select set_user_job('b1111111-1111-1111-1111-111111111111', 'leader')$q$, 'Harus ada minimal satu admin aktif%'));
select pg_temp.as_user('b3333333-3333-3333-3333-333333333333');
select pg_temp.check('has_job is false for a job not in the list',
  not public.has_job(array['leader','admin']) and public.has_job(array['inventory']));
select pg_temp.as_user('b9999999-9999-9999-9999-999999999999');
select pg_temp.check('my_job is null and has_job false without an account',
  public.my_job() is null and not public.has_job(array['admin','operator']));
reset role;
select pg_temp.check('set_user_role is not executable by authenticated',
  not has_function_privilege('authenticated', 'public.set_user_role(uuid, public.user_role)', 'execute'));
select pg_temp.check('placeholder_job maps names',
  public.placeholder_job('admin.inbound') = 'admin_inbound' and public.placeholder_job('leader') = 'leader'
  and public.placeholder_job('budi') is null);
rollback;
