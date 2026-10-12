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
declare v text := lower(trim(coalesce(new.raw_user_meta_data->>'username', '')));
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
  if not public.has_role(array['admin']::public.user_role[]) then raise exception 'Hanya admin yang bisa mengubah pengguna'; end if;
  if p_user = auth.uid() then raise exception 'Tidak bisa mengubah akun Anda sendiri'; end if;
  -- One change to accounts at a time: two admins demoting each other cannot leave no admin.
  perform pg_advisory_xact_lock(hashtext('accounts'));
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

-- Sign-in: username -> the account's auth email (active accounts only). Server only.
create or replace function public.account_email(p_username text) returns text
language sql stable security definer set search_path = public as $$
  select u.email from auth.users u join public.profiles p on p.id = u.id
  where p.username = lower(trim(p_username)) and p.active
$$;

revoke execute on function public.accounts_guard(uuid), public.derive_username(text, uuid) from public, anon, authenticated;
revoke execute on function public.account_email(text) from public, anon, authenticated;
grant execute on function public.account_email(text) to service_role;
revoke execute on function public.set_user_role(uuid, public.user_role), public.set_user_active(uuid, boolean) from public, anon;
grant execute on function public.set_user_role(uuid, public.user_role), public.set_user_active(uuid, boolean) to authenticated;
