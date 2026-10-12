-- Personal accounts (0071): usernames, active flag, admin-only role/status changes, username lookup.
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

insert into auth.users values ('a1111111-1111-1111-1111-111111111111','site@x','{"name":"Gudang","username":"Gudang"}');
insert into auth.users values ('a2222222-2222-2222-2222-222222222222','ani@pengguna.internal','{"name":"Ani","username":"ani"}');
insert into auth.users values ('a3333333-3333-3333-3333-333333333333','Budi.Santoso@x','{"name":"Budi"}');
insert into auth.users values ('a4444444-4444-4444-4444-444444444444','admin2@pengguna.internal','{"name":"Dewi","username":"dewi"}');
update profiles set role = 'admin' where id in ('a1111111-1111-1111-1111-111111111111','a4444444-4444-4444-4444-444444444444');

select pg_temp.check('username from metadata, lowercased',
  (select username from profiles where id = 'a1111111-1111-1111-1111-111111111111') = 'gudang');
select pg_temp.check('no username in metadata: derived from the email, valid format',
  (select username ~ '^[a-z0-9._-]{3,32}$' and username like 'budi.santoso%' from profiles where id = 'a3333333-3333-3333-3333-333333333333'));
select pg_temp.check('a duplicate username is refused',
  pg_temp.fails($q$update profiles set username = 'ani' where id = 'a3333333-3333-3333-3333-333333333333'$q$, '%duplicate key%'));
select pg_temp.check('capitals are refused by the format check',
  pg_temp.fails($q$update profiles set username = 'Ani2' where id = 'a3333333-3333-3333-3333-333333333333'$q$, '%profiles_username_format%'));

set role authenticated;
select pg_temp.as_user('a2222222-2222-2222-2222-222222222222');
select pg_temp.check('an operator cannot change roles',
  pg_temp.fails($q$select set_user_role('a3333333-3333-3333-3333-333333333333', 'supervisor')$q$, 'Hanya admin%'));
select pg_temp.as_user('a1111111-1111-1111-1111-111111111111');
-- Refused by grant on a fresh Supabase project, or (where table rights are granted, as test 01 does
-- locally) silently a no-op: RLS is on and no update policy is left.
do $$ begin
  begin update profiles set role = 'admin' where id = 'a2222222-2222-2222-2222-222222222222'; exception when insufficient_privilege then null; end;
end $$;
select pg_temp.check('no direct update of profiles any more, not even by an admin',
  (select role from profiles where id = 'a2222222-2222-2222-2222-222222222222') = 'operator'
  and not exists (select 1 from pg_policy where polrelid = 'public.profiles'::regclass and polcmd in ('w', '*')));
select pg_temp.check('an admin cannot change their own role',
  pg_temp.fails($q$select set_user_role('a1111111-1111-1111-1111-111111111111', 'operator')$q$, 'Tidak bisa mengubah akun Anda sendiri%'));
select set_user_role('a3333333-3333-3333-3333-333333333333', 'supervisor');
select pg_temp.check('an admin changes another account''s role',
  (select role from profiles where id = 'a3333333-3333-3333-3333-333333333333') = 'supervisor');
select pg_temp.check('an admin cannot deactivate themselves',
  pg_temp.fails($q$select set_user_active('a1111111-1111-1111-1111-111111111111', false)$q$, 'Tidak bisa mengubah akun Anda sendiri%'));
select set_user_active('a2222222-2222-2222-2222-222222222222', false);
select pg_temp.as_user('a2222222-2222-2222-2222-222222222222');
select pg_temp.check('a deactivated account has no role at once (live token or not)',
  not has_role(array['operator','supervisor','admin']::user_role[]));
select pg_temp.as_user('a1111111-1111-1111-1111-111111111111');
select set_user_role('a4444444-4444-4444-4444-444444444444', 'operator');
select pg_temp.check('an admin demotes another admin; the acting admin stays admin',
  (select role from profiles where id = 'a4444444-4444-4444-4444-444444444444') = 'operator'
  and (select role = 'admin' and active from profiles where id = 'a1111111-1111-1111-1111-111111111111'));
select pg_temp.check('concurrent last-admin guard: both functions go through the locking guard',
  (select prosrc like '%pg_advisory_xact_lock%' from pg_proc where proname = 'accounts_guard')
  and (select count(*) from pg_proc where proname in ('set_user_role','set_user_active') and prosrc like '%accounts_guard%') = 2);

reset role;
select pg_temp.check('account_email finds the auth email by username, whatever the email is',
  account_email(' Gudang ') = 'site@x' and account_email('ani') is null and account_email('nobody') is null);
select pg_temp.check('account_email is for the server only',
  not has_function_privilege('authenticated', 'public.account_email(text)', 'execute')
  and not has_function_privilege('anon', 'public.account_email(text)', 'execute'));
rollback;
