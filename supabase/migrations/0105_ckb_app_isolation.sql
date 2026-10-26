-- =====================================================================
-- 0105  App isolation at the database: Shell roles act only in Shell,
--       customer representatives never read Shell tables
--
-- Found while building CKB 3PL (26 Oct 2026). Two gaps existed since 0080
-- because app access was checked only in the Next.js layouts:
--
--   1. has_role() looked at profiles.role alone. Every new account gets
--      role 'operator' (handle_new_user), so a CKB-only account could call
--      any Shell RPC that operators may call (posting picks, putaways ...)
--      straight through the REST API.
--   2. Every Shell read policy is (select is_active()) — any active
--      account reads bins, inventory, movements, waves ... A CKB customer
--      representative is an external person: they must not.
--
-- Changes (all narrow, Shell users are unaffected — 0080 gave every
-- existing account shell_wms):
--   * has_role(): additionally requires the shell_wms app.
--   * is_active(): additionally false for a customer-only account (CKB
--     role 'customer' without the Shell app). Every Shell policy follows.
--     Internal CKB staff keep Shell reads: rebagging reads items/bins/stock.
--   * check_request() keeps its exact meaning (deactivated = PT403) via
--     account_active(), so representatives are not refused wholesale.
--   * profiles: everyone can read their own row (sign-in reads it).
--   * profiles: a change may not remove the last active admin who has the
--     Shell app, or no one could administer Shell (has_role refuses them).
-- =====================================================================

create or replace function public.has_role(roles public.user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active and 'shell_wms' = any(apps) and role = any(roles)
                   from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and ('shell_wms' = any(p.apps)
           or not exists (select 1 from public.ckb_user_roles r where r.user_id = p.id and r.role = 'customer'))
  )
$$;

create or replace function public.check_request() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.account_active() then
    raise sqlstate 'PT403' using message = 'Akun ini dinonaktifkan';
  end if;
end $$;

create policy "profiles: own row" on public.profiles
  for select to authenticated using (id = auth.uid() and (select public.account_active()));

create or replace function public.profiles_keep_shell_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- API requests run as the authenticated role (PostgREST sets it; definer functions keep it).
  -- Maintenance as the database owner (SQL editor, migrations, fixtures) is not checked.
  if coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon') then return null; end if;
  if not exists (select 1 from public.profiles where role = 'admin' and active and 'shell_wms' = any(apps)) then
    raise exception 'Minimal satu admin aktif harus tetap punya akses Shell WMS';
  end if;
  return null;
end $$;
-- Only a change that takes away an active Shell admin is checked (a fresh install has none yet).
create trigger profiles_keep_shell_admin after update of apps, role, active on public.profiles
  for each row
  when (old.role = 'admin' and old.active and 'shell_wms' = any(old.apps)
        and not (new.role = 'admin' and new.active and 'shell_wms' = any(new.apps)))
  execute function public.profiles_keep_shell_admin();
