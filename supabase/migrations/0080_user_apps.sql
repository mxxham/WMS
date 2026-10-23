-- =====================================================================
-- 0080  User app access: shell_wms / ckb_3pl
--
-- Two apps share the same user table. Every person starts with exactly
-- the Shell WMS app (current behaviour preserved); nobody auto-gets
-- the 3PL app. An admin grants the second app via set_user_apps.
--
-- Columns
--   apps         text[]   not null, default '{shell_wms}'
--   default_app  text     nullable, must be null or one of apps
--
-- Constraints
--   profiles_apps_allowed:
--     apps <@ array['shell_wms','ckb_3pl']::text[]
--     (unknown ids rejected at write time)
--   profiles_default_app_allowed:
--     default_app is null or default_app = any(apps)
--     (stale default rejected at write time)
--
-- Backfill
--   Every existing profile gets apps = '{shell_wms}', default_app = 'shell_wms'.
--   This deliberately preserves today's Shell access. No profile is given
--   ckb_3pl automatically — an admin must grant it explicitly.
--
-- RPC: set_user_apps(p_user uuid, p_apps text[], p_default_app text)
--   SECURITY DEFINER, plpgsql, search_path = public.
--   Guard:
--     (a) Advisory lock on 'accounts' + has_role('{admin}') — same as
--         0071's accounts_guard. Non-admin gets Indonesian error.
--     (b) Target profile must exist.
--     (c) NO not-on-yourself check (exception approved 2026-10-20).
--         The one-active-admin invariant is protected by the role/status
--         RPCs (set_user_role, set_user_active), not by app access.
--         An admin changing their own apps cannot demote themselves.
--   Normalisation:
--     Trim, lowercase, dedupe every app id in p_apps.
--   Validation:
--     Every id must be in {'shell_wms','ckb_3pl'}.
--     p_default_app must be null or in the normalised apps array.
--     When apps has 2 elements, p_default_app MUST be set (not null).
--     When revoking an app that was the default, or when only one app
--     remains, default_app is repaired explicitly:
--       1 app  -> default_app = that app
--       0 apps -> default_app = null
--   Write: update profiles set apps = ..., default_app = ... where id = p_user.
--   All errors are Indonesian, like 0071.
--
-- Grants
--   Follow 0005 + 0071 patterns:
--     revoke execute on set_user_apps from public, anon, authenticated
--     grant  execute on set_user_apps to authenticated
--   Column grants are inherited via the table's existing grants in 0005;
--   no new explicit column grants needed.
-- =====================================================================

alter table public.profiles
  add column apps text[] not null default array['shell_wms'],
  add column default_app text;

-- Allow only known app ids.
alter table public.profiles
  add constraint profiles_apps_allowed check (apps <@ array['shell_wms','ckb_3pl']::text[]);

-- Default must be null or one of the granted apps.
alter table public.profiles
  add constraint profiles_default_app_allowed check (default_app is null or default_app = any(apps));

-- Explicit idempotent backfill (same values as the defaults, for clarity).
update public.profiles
set apps = array['shell_wms'], default_app = 'shell_wms'
where apps is null or default_app is null;

create or replace function public.set_user_apps(p_user uuid, p_apps text[], p_default_app text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_norm_apps text[];
  v_default text;
  v_count int;
begin
  -- (a) Advisory lock + admin guard (same pattern as accounts_guard in 0071)
  perform pg_advisory_xact_lock(hashtext('accounts'));
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Hanya admin yang bisa mengubah akses aplikasi';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Pengguna tidak ditemukan';
  end if;

  -- (c) NO not-on-yourself check — approved exception. The one-active-admin
  -- invariant is enforced by set_user_role / set_user_active, not here.

  -- (d) Normalise: trim, lowercase, dedupe
  select coalesce(array_agg(distinct lower(trim(a))), '{}'::text[]) into v_norm_apps
  from unnest(coalesce(p_apps, '{}'::text[])) as a
  where trim(a) <> '';

  -- (e) Validate: every id must be known
  if exists (
    select 1 from unnest(v_norm_apps) as a(app)
    where a.app not in ('shell_wms','ckb_3pl')
  ) then
    raise exception 'ID aplikasi tidak dikenal';
  end if;

  -- Validate default_app
  v_default := lower(trim(coalesce(p_default_app, '')));
  if v_default = '' then v_default := null; end if;

  if v_default is not null and v_default not in (select unnest(v_norm_apps)) then
    raise exception 'Aplikasi default harus termasuk dalam daftar aplikasi';
  end if;

  -- When both apps are granted, a default MUST be set
  if array_length(v_norm_apps, 1) = 2 and v_default is null then
    raise exception 'Dua aplikasi memerlukan default_app yang ditentukan';
  end if;

  -- Repair default when revoking the current default or when only one app remains
  v_count := array_length(v_norm_apps, 1);
  if v_count = 1 then
    v_default := v_norm_apps[1];
  elsif v_count = 0 then
    v_default := null;
  end if;

  -- (f) Write
  update public.profiles
  set apps = v_norm_apps, default_app = v_default
  where id = p_user;
end $$;

revoke execute on function public.set_user_apps(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.set_user_apps(uuid, text[], text) to authenticated;