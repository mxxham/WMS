-- =====================================================================
-- 0071  Personal accounts: username, active, admin-managed roles
--
--  Until now every visitor was signed in as one shared account (Gudang).
--  Each person now has their own account (spec 2026-10-12 login):
--   · profiles.username: what people type to sign in (lowercase,
--     3–32 of a-z 0-9 . _ -). New accounts' auth email is
--     <username>@pengguna.internal; account_email() resolves a username to
--     whatever auth email the account has, so the existing Gudang account
--     (signed in by its old email until now) works as `gudang` unchanged.
--   · profiles.active: a deactivated account has no role at all
--     (has_role), even with a token that has not expired yet.
--   · roles and status change only through set_user_role /
--     set_user_active (admin, never on yourself, always one active admin
--     left). The direct "admin update" policy goes: it bypassed those rules.
--   · deactivation is closed everywhere at once, not only in has_role:
--     PostgREST runs check_request() before every request (tables, views,
--     RPCs alike) and refuses an inactive account; every read policy and
--     the insert policies also require is_active() (Realtime goes through
--     the policies, not PostgREST). A live token does not help.
--   · the username comes from app metadata (set only by the server's admin
--     API), never user metadata, which the account holder controls.
--   · sign-in runs on the server, so Supabase's per-IP limit sees one IP:
--     login_allowed / login_result lock a username + client IP for 15
--     minutes after 5 wrong passwords, and a username everywhere after 30
--     across IPs (any username, existing or not).
-- =====================================================================

alter table public.profiles add column username text, add column active boolean not null default true;

-- The shared site account becomes the first admin, `gudang`.
update public.profiles set username = 'gudang', role = 'admin' where id = '5e853334-8d85-4466-b14c-4a1837afd92b';

-- Everyone else: from their email's local part, made valid and unique.
create or replace function public.derive_username(p_email text, p_id uuid) returns text
language plpgsql stable set search_path = public as $$
declare v text := left(regexp_replace(lower(split_part(coalesce(p_email, ''), '@', 1)), '[^a-z0-9._-]', '', 'g'), 24);
begin
  if length(v) < 3 then v := 'user'; end if;
  if exists (select 1 from public.profiles where username = v and id <> p_id) then
    v := v || '-' || left(replace(p_id::text, '-', ''), 6);
  end if;
  return v;
end $$;

do $$
declare r record;
begin
  for r in select p.id, u.email from public.profiles p join auth.users u on u.id = p.id where p.username is null order by p.created_at loop
    update public.profiles set username = public.derive_username(r.email, r.id) where id = r.id;
  end loop;
end $$;

alter table public.profiles alter column username set not null,
  add constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,32}$');
create unique index profiles_username_uq on public.profiles (username);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v text := lower(trim(coalesce(new.raw_app_meta_data->>'username', '')));
begin
  if v !~ '^[a-z0-9._-]{3,32}$' then v := public.derive_username(new.email, new.id); end if;
  insert into public.profiles (id, name, role, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), 'operator', v)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.has_role(roles public.user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active and role = any(roles) from public.profiles where id = auth.uid()), false)
$$;

-- All role / status changes go through the functions below.
drop policy if exists "profiles: admin update" on public.profiles;
revoke update on public.profiles from authenticated;

create or replace function public.accounts_guard(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- One change to accounts at a time, and the lock first: the admin check below then sees any
  -- change committed while waiting (an admin demoted a moment ago cannot act once more).
  perform pg_advisory_xact_lock(hashtext('accounts'));
  if not public.has_role(array['admin']::public.user_role[]) then raise exception 'Hanya admin yang bisa mengubah pengguna'; end if;
  if p_user = auth.uid() then raise exception 'Tidak bisa mengubah akun Anda sendiri'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Pengguna tidak ditemukan'; end if;
end $$;

create or replace function public.set_user_role(p_user uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.accounts_guard(p_user);
  update public.profiles set role = p_role where id = p_user;
  if not exists (select 1 from public.profiles where role = 'admin' and active) then raise exception 'Harus ada minimal satu admin aktif'; end if;
end $$;

create or replace function public.set_user_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.accounts_guard(p_user);
  update public.profiles set active = p_active where id = p_user;
  if not exists (select 1 from public.profiles where role = 'admin' and active) then raise exception 'Harus ada minimal satu admin aktif'; end if;
end $$;

-- Deactivation, closed everywhere. is_active(): the caller's account is active (the server and
-- anon have no account: not active, but they never pass the authenticated policies anyway).
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

-- PostgREST pre-request: runs before every API request with the caller's JWT.
create or replace function public.check_request() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_active() then
    raise sqlstate 'PT403' using message = 'Akun ini dinonaktifkan';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.check_request';
    notify pgrst, 'reload config';
  end if;
end $$;

-- Every read policy that let any signed-in account read ("true") now requires an active one, and
-- so does every insert policy. (select ...) runs it once per query, not once per row.
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and cmd = 'SELECT' and qual = 'true' and roles @> '{authenticated}' loop
    execute format('alter policy %I on public.%I using ((select public.is_active()))', r.policyname, r.tablename);
  end loop;
  for r in select tablename, policyname, with_check from pg_policies
           where schemaname = 'public' and cmd = 'INSERT' and roles @> '{authenticated}' loop
    execute format('alter policy %I on public.%I with check ((%s) and (select public.is_active()))', r.policyname, r.tablename, r.with_check);
  end loop;
end $$;

-- Sign-in limit (the server signs in for everyone, so Supabase's per-IP limit sees one IP). Keyed
-- by username and the client's IP: 5 wrong passwords lock that pair for 15 minutes, so one person
-- cannot lock a colleague out from their own device; 30 wrong across all IPs within 15 minutes lock
-- the username everywhere, so guessing from many devices is still stopped. Any username is
-- tracked, existing or not, so the answers reveal nothing.
create table public.login_failures (
  username     text not null,
  ip           text not null,
  failures     int not null default 0,
  last_failed  timestamptz not null default now(),
  locked_until timestamptz,
  primary key (username, ip)
);
alter table public.login_failures enable row level security;
revoke all on public.login_failures from anon, authenticated;

create or replace function public.login_allowed(p_username text, p_ip text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.login_failures where username = lower(trim(p_username)) and ip = coalesce(p_ip, '') and locked_until > now())
     and coalesce((select sum(failures) from public.login_failures
                   where username = lower(trim(p_username)) and last_failed > now() - interval '15 minutes'), 0) < 30
$$;

create or replace function public.login_result(p_username text, p_ip text, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v text := lower(trim(p_username)); k text := coalesce(p_ip, '');
begin
  if p_ok then delete from public.login_failures where username = v and ip = k; return; end if;
  insert into public.login_failures as f (username, ip, failures) values (v, k, 1)
  on conflict (username, ip) do update
    set failures = case when f.last_failed > now() - interval '15 minutes' then f.failures + 1 else 1 end,
        last_failed = now();
  update public.login_failures set locked_until = now() + interval '15 minutes'
  where username = v and ip = k and failures >= 5 and (locked_until is null or locked_until <= now());
end $$;

-- Sign-in: username -> the account's auth email (active accounts only). Server only.
create or replace function public.account_email(p_username text) returns text
language sql stable security definer set search_path = public as $$
  select u.email from auth.users u join public.profiles p on p.id = u.id
  where p.username = lower(trim(p_username)) and p.active
$$;

revoke execute on function public.accounts_guard(uuid), public.derive_username(text, uuid) from public, anon, authenticated;
revoke execute on function public.account_email(text), public.login_allowed(text, text), public.login_result(text, text, boolean) from public, anon, authenticated;
grant execute on function public.account_email(text), public.login_allowed(text, text), public.login_result(text, text, boolean) to service_role;
grant execute on function public.check_request(), public.is_active() to anon, authenticated;
revoke execute on function public.set_user_role(uuid, public.user_role), public.set_user_active(uuid, boolean) from public, anon;
grant execute on function public.set_user_role(uuid, public.user_role), public.set_user_active(uuid, boolean) to authenticated;
