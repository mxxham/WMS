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
-- n wrong passwords for a username from an IP (login_result returns void).
create or replace function pg_temp.wrong(u text, ip text, n int) returns boolean language plpgsql as $$
begin for i in 1..n loop perform login_result(u, ip, false); end loop; return true; end $$;
-- A real stock row and another bin, read before switching to an account that may not read them
-- (the stock check runs first, so the transfer must be one the stock allows).
select i.item_id as item_x, i.bin_id as bin_a, i.batch_lot as batch_x, i.expiry_date as exp_x,
       (select b.id from bins b where b.id <> i.bin_id order by b.bin_code limit 1) as bin_b
from inventory i where i.quantity >= 1 order by i.bin_id limit 1 \gset

-- The username comes from app metadata (set only by the server's admin API), never user metadata.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a1111111-1111-1111-1111-111111111111','site@x','{"name":"Gudang"}','{"username":"Gudang"}'),
  ('a2222222-2222-2222-2222-222222222222','ani@pengguna.internal','{"name":"Ani"}','{"username":"ani"}'),
  ('a3333333-3333-3333-3333-333333333333','Budi.Santoso@x','{"name":"Budi","username":"ilham"}','{}'),
  ('a4444444-4444-4444-4444-444444444444','admin2@pengguna.internal','{"name":"Dewi"}','{"username":"dewi"}');
update profiles set role = 'admin' where id in ('a1111111-1111-1111-1111-111111111111','a4444444-4444-4444-4444-444444444444');

select pg_temp.check('username from app metadata, lowercased',
  (select username from profiles where id = 'a1111111-1111-1111-1111-111111111111') = 'gudang');
select pg_temp.check('a username in user metadata (which the user controls) is ignored: derived from the email instead',
  (select username ~ '^[a-z0-9._-]{3,32}$' and username like 'budi.santoso%' from profiles where id = 'a3333333-3333-3333-3333-333333333333'));
-- Supabase's admin API inserts the user, then writes app_metadata in a second step.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('a5555555-5555-5555-5555-555555555555','sementara@x','{"name":"Eka"}','{"provider":"email"}');
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"username":"eka.putri_gudang-surabaya-shift2"}' where id = 'a5555555-5555-5555-5555-555555555555';
select pg_temp.check('a username set in app metadata after the insert (as the admin API does) reaches the profile, all 32 characters',
  (select username from profiles where id = 'a5555555-5555-5555-5555-555555555555') = 'eka.putri_gudang-surabaya-shift2');
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"username":"ani"}' where id = 'a5555555-5555-5555-5555-555555555555';
select pg_temp.check('a later app-metadata username that is already taken leaves the profile as it was',
  (select username from profiles where id = 'a5555555-5555-5555-5555-555555555555') = 'eka.putri_gudang-surabaya-shift2');
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
select pg_temp.check('a deactivated account reads nothing (every read policy checks active)',
  (select count(*) from bins) = 0 and (select count(*) from movements) = 0 and (select count(*) from profiles) = 0);
select pg_temp.check('a deactivated account cannot insert a movement',
  pg_temp.fails(format($q$insert into movements (type, item_id, batch_lot, expiry_date, quantity, from_bin_id, to_bin_id, user_id)
    values ('transfer', %L, %L, %L, 1, %L, %L, 'a2222222-2222-2222-2222-222222222222')$q$, :'item_x', :'batch_x', nullif(:'exp_x', ''), :'bin_a', :'bin_b'), '%row-level security%'));
select pg_temp.check('every request of a deactivated account is refused before it runs (PostgREST pre-request)',
  pg_temp.fails('select public.check_request()', 'Akun ini dinonaktifkan%'));
select pg_temp.as_user('a1111111-1111-1111-1111-111111111111');
select pg_temp.check('an active account and the server (no account) pass the pre-request check',
  not pg_temp.fails('select public.check_request()', '%'));
select pg_temp.as_user('a1111111-1111-1111-1111-111111111111');
select set_user_role('a4444444-4444-4444-4444-444444444444', 'operator');
select pg_temp.check('an admin demotes another admin; the acting admin stays admin',
  (select role from profiles where id = 'a4444444-4444-4444-4444-444444444444') = 'operator'
  and (select role = 'admin' and active from profiles where id = 'a1111111-1111-1111-1111-111111111111'));
select pg_temp.check('concurrent last-admin guard: the lock is taken before the admin check (no stale privilege)',
  (select position('pg_advisory_xact_lock' in prosrc) between 1 and position('has_role' in prosrc) from pg_proc where proname = 'accounts_guard')
  and (select count(*) from pg_proc where proname in ('set_user_role','set_user_active') and prosrc like '%accounts_guard%') = 2);

reset role;
select pg_temp.check('account_email finds the auth email by username, whatever the email is',
  account_email(' Gudang ') = 'site@x' and account_email('ani') is null and account_email('nobody') is null);
-- Each request is its own statement (login_allowed is stable: it sees the statement's snapshot).
select pg_temp.check('a username starts unlocked', login_allowed('gudang', '10.0.0.1') and login_allowed('nobody', '10.0.0.1'));
select pg_temp.wrong('gudang', '10.0.0.1', 5), pg_temp.wrong('nobody', '10.0.0.1', 5), pg_temp.wrong('ani', '10.0.0.1', 4);
select pg_temp.check('5 wrong passwords lock that username from that IP for 15 minutes, existing or not; 4 do not',
  not login_allowed('gudang', '10.0.0.1') and not login_allowed(' GUDANG ', '10.0.0.1') and not login_allowed('nobody', '10.0.0.1')
  and login_allowed('ani', '10.0.0.1'));
select pg_temp.check('someone else''s wrong passwords do not lock you out on your own device',
  login_allowed('gudang', '10.0.0.2'));
select pg_temp.wrong('dewi', '10.0.1.' || n, 5) from generate_series(1, 6) n;
select pg_temp.check('30 wrong passwords across IPs lock the username everywhere (no guessing from many devices)',
  not login_allowed('dewi', '10.9.9.9'));
select login_result('ani', '10.0.0.1', true);
select pg_temp.wrong('ani', '10.0.0.1', 1);
select pg_temp.check('a successful sign-in clears the count (4 wrong, success, 1 wrong: not locked)', login_allowed('ani', '10.0.0.1'));
select pg_temp.check('the sign-in limit is for the server only',
  not has_function_privilege('authenticated', 'public.login_allowed(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.login_result(text, text, boolean)', 'execute'));
select pg_temp.check('account_email is for the server only',
  not has_function_privilege('authenticated', 'public.account_email(text)', 'execute')
  and not has_function_privilege('anon', 'public.account_email(text)', 'execute'));
rollback;
