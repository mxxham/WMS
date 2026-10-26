-- =====================================================================
-- 0099  CKB 3PL foundation: customers, operational roles, customer
--       assignments, settings, and the append-only audit log
--
-- Three separate concepts (spec docs/CKB_3PL.md §2):
--   app access         profiles.apps contains 'ckb_3pl'   (0080, unchanged)
--   operational role   ckb_user_roles.role                (this file)
--   customer scope     ckb_customer_members               (this file)
-- A Shell role never grants anything in CKB: a Shell supervisor with the
-- ckb_3pl app but no ckb_user_roles row can open /ckb and do nothing.
--
-- Backfill: every account that ALREADY has the ckb_3pl app (granted by an
-- admin through 0080) gets a CKB role equal to its current profile role,
-- so rebagging keeps working for exactly the people who use it today. The
-- shared site account (auth app_metadata.shared, 0072) is excluded: a
-- shared login cannot attribute a CKB operation to an employee.
--
-- has_ckb_app() (0084) is redefined to mean "CKB staff": app access AND an
-- active staff role. Every rebagging policy, storage policy and RPC that
-- already calls it now excludes customer representatives and role-less
-- accounts without being rewritten.
--
-- The 0082/0083 tables (cargo_inspections, stock_takes, ...) were static
-- mockup scaffolding: no runtime code reads or writes them. They are
-- dropped here only when empty; if any row exists they are kept and closed
-- to authenticated reads (their RLS let every CKB account read everything).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------
create table public.ckb_customers (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name                  text not null check (length(trim(name)) between 2 and 100),
  active                boolean not null default true,
  notes                 text,
  -- customer-specific SAP identifiers; optional until the SAP contract is confirmed
  sap_customer_code     text,
  sap_plant             text,
  sap_storage_location  text,
  active_snapshot_id    uuid,              -- fk added in 0100 (ckb_sap_imports)
  created_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles(id)
);

insert into public.ckb_customers (code, name) values
  ('FREEPORT', 'Freeport'), ('CGP', 'CGP'), ('SIP', 'SIP'),
  ('MNE', 'MNE'), ('BOILER', 'Boiler'), ('SSB', 'SSB')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Operational roles and customer assignments
-- ---------------------------------------------------------------------
create type public.ckb_role as enum ('admin', 'supervisor', 'operator', 'customer');

create table public.ckb_user_roles (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  role        public.ckb_role not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);

create table public.ckb_customer_members (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  customer_id  uuid not null references public.ckb_customers(id),
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  primary key (user_id, customer_id)
);
create index ckb_customer_members_customer_idx on public.ckb_customer_members (customer_id);

-- The caller's account exists and is active. Unlike is_active() (0105 narrows that one to
-- accounts allowed to read Shell tables), this is the plain deactivation check CKB policies use.
create or replace function public.account_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;
grant execute on function public.account_active() to authenticated;

-- The shared site account (0072 marks it in auth app_metadata).
create or replace function public.ckb_is_shared_account(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (raw_app_meta_data->>'shared')::boolean from auth.users where id = p_user), false)
$$;

-- The caller's CKB role: null without the app, when inactive, or without a role row.
create or replace function public.ckb_role() returns public.ckb_role
language sql stable security definer set search_path = public as $$
  select r.role
  from public.ckb_user_roles r
  join public.profiles p on p.id = r.user_id
  where r.user_id = auth.uid() and p.active and 'ckb_3pl' = any(p.apps)
$$;

create or replace function public.ckb_has_role(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.ckb_role()::text = any(roles), false)
$$;

create or replace function public.ckb_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.ckb_has_role(array['admin', 'supervisor', 'operator'])
$$;

-- Staff see every customer; a representative sees only the customers assigned to them.
create or replace function public.ckb_can_see_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.ckb_is_staff()
      or (public.ckb_role() = 'customer'
          and exists (select 1 from public.ckb_customer_members m
                      where m.user_id = auth.uid() and m.customer_id = p_customer))
$$;

-- 0084's membership check now means staff (see header).
create or replace function public.has_ckb_app() returns boolean
language sql stable security definer set search_path = public as $$
  select public.ckb_is_staff()
$$;

create or replace function public.ckb_actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.profiles where id = auth.uid()), 'sistem')
$$;

-- Backfill (see header): existing CKB members keep what they can do today.
insert into public.ckb_user_roles (user_id, role)
select p.id, p.role::text::public.ckb_role
from public.profiles p
where 'ckb_3pl' = any(p.apps)
  and not public.ckb_is_shared_account(p.id)
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- Settings: a fixed set of keys, written only through ckb_save_setting
-- ---------------------------------------------------------------------
create table public.ckb_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);

insert into public.ckb_settings (key, value) values
  ('warehouses', '["Warehouse 5"]'),
  ('stocktake', '{"blind_default": true}'),
  ('evidence', '{"max_mb": 10, "allowed_mime": ["image/jpeg", "image/png", "image/webp", "application/pdf"], "retention_days": 730}'),
  ('inspection', '{"require_photo_on_ng": true}'),
  -- Header aliases are the SAP stock-list titles this repository already reads for Shell
  -- (lib/sap-stock.ts) plus a storage-bin column. They are NOT a confirmed CKB SAP contract:
  -- verified stays false until a real CKB file has been checked, and every snapshot records it.
  ('sap_import', '{
     "verified": false,
     "columns": {
       "material_code":    ["material", "material number", "sku code", "sku", "item code"],
       "description":      ["material description", "description"],
       "plant":            ["plant"],
       "storage_location": ["storage location", "sloc"],
       "storage_bin":      ["storage bin", "bin"],
       "batch":            ["batch"],
       "expiry_date":      ["sled/bbd", "expiry date", "expiration date"],
       "uom":              ["base unit of measure", "bun", "uom"],
       "quantity":         ["unrestricted", "unrestricted use"],
       "stock_type":       ["stock type", "stock category"]
     }
   }'),
  ('sap_export', '{"verified": false, "format_version": "CKB-INTERNAL-1"}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Audit log: append-only, written only from SECURITY DEFINER functions
-- ---------------------------------------------------------------------
create table public.ckb_audit_events (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  actor_id        uuid,
  actor_name      text not null,
  action          text not null,
  entity_type     text not null,
  entity_id       text,
  customer_id     uuid references public.ckb_customers(id),
  details         jsonb not null default '{}'::jsonb,
  correlation_id  text
);
create index ckb_audit_events_at_idx on public.ckb_audit_events (at desc);
create index ckb_audit_events_entity_idx on public.ckb_audit_events (entity_type, entity_id);
create index ckb_audit_events_customer_idx on public.ckb_audit_events (customer_id, at desc);

create or replace function public.ckb_audit(p_action text, p_entity_type text, p_entity_id text,
  p_customer uuid, p_details jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ckb_audit_events (actor_id, actor_name, action, entity_type, entity_id, customer_id, details)
  values (auth.uid(), public.ckb_actor_name(), p_action, p_entity_type, p_entity_id, p_customer,
          coalesce(p_details, '{}'::jsonb));
end $$;
-- Only other definer functions write the log: nobody calls it over the API.
revoke execute on function public.ckb_audit(text, text, text, uuid, jsonb) from public, anon, authenticated;

-- Append-only, for every role including the service role (a correction is a new event).
create or replace function public.ckb_forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% tidak bisa diubah atau dihapus (%)', tg_table_name, tg_op;
end $$;

create trigger ckb_audit_events_immutable before update or delete on public.ckb_audit_events
  for each row execute function public.ckb_forbid_change();
create trigger ckb_audit_events_no_truncate before truncate on public.ckb_audit_events
  for each statement execute function public.ckb_forbid_change();

-- ---------------------------------------------------------------------
-- RLS: reads by policy, every write through an RPC below
-- ---------------------------------------------------------------------
alter table public.ckb_customers        enable row level security;
alter table public.ckb_user_roles       enable row level security;
alter table public.ckb_customer_members enable row level security;
alter table public.ckb_settings         enable row level security;
alter table public.ckb_audit_events     enable row level security;

create policy "ckb: visible customers" on public.ckb_customers
  for select to authenticated using ((select public.account_active()) and public.ckb_can_see_customer(id));
create policy "ckb: own role or admin" on public.ckb_user_roles
  for select to authenticated using ((select public.account_active()) and (user_id = auth.uid() or public.ckb_has_role(array['admin'])));
create policy "ckb: own assignments or admin" on public.ckb_customer_members
  for select to authenticated using ((select public.account_active()) and (user_id = auth.uid() or public.ckb_has_role(array['admin'])));
create policy "ckb: staff read settings" on public.ckb_settings
  for select to authenticated using ((select public.account_active()) and public.ckb_is_staff());
create policy "ckb: admin and supervisor read audit" on public.ckb_audit_events
  for select to authenticated using ((select public.account_active()) and public.ckb_has_role(array['admin', 'supervisor']));

grant select on public.ckb_customers, public.ckb_user_roles, public.ckb_customer_members,
  public.ckb_settings, public.ckb_audit_events to authenticated;
grant all on public.ckb_customers, public.ckb_user_roles, public.ckb_customer_members,
  public.ckb_settings, public.ckb_audit_events to service_role;

-- ---------------------------------------------------------------------
-- RPCs: access administration
-- ---------------------------------------------------------------------

-- At least one active CKB admin must remain (checked after every change).
create or replace function public.ckb_assert_admin_remains() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.ckb_user_roles r join public.profiles p on p.id = r.user_id
    where r.role = 'admin' and p.active and 'ckb_3pl' = any(p.apps)
  ) then
    raise exception 'Harus ada minimal satu admin CKB aktif';
  end if;
end $$;
revoke execute on function public.ckb_assert_admin_remains() from public, anon, authenticated;

-- First CKB admin: only while none exists, only a Shell admin who already has the CKB app and a
-- personal (not shared) account. After that, CKB admins manage CKB access themselves.
create or replace function public.ckb_bootstrap_admin() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('ckb_access'));
  if exists (
    select 1 from public.ckb_user_roles r join public.profiles p on p.id = r.user_id
    where r.role = 'admin' and p.active and 'ckb_3pl' = any(p.apps)
  ) then
    raise exception 'Admin CKB sudah ada; minta admin CKB untuk mengatur akses';
  end if;
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Hanya admin yang bisa menjadi admin CKB pertama';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and 'ckb_3pl' = any(apps)) then
    raise exception 'Akun ini belum punya akses aplikasi CKB 3PL';
  end if;
  if public.ckb_is_shared_account(auth.uid()) then
    raise exception 'Akun bersama tidak bisa menjadi admin CKB; masuk dengan akun pribadi';
  end if;
  insert into public.ckb_user_roles (user_id, role, updated_by) values (auth.uid(), 'admin', auth.uid())
    on conflict (user_id) do update set role = 'admin', updated_at = now(), updated_by = auth.uid();
  delete from public.ckb_customer_members where user_id = auth.uid();
  perform public.ckb_audit('ACCESS_BOOTSTRAP_ADMIN', 'user', auth.uid()::text, null, '{}'::jsonb);
end $$;

-- Role + customer assignments for one account. p_role null removes the CKB role.
-- Staff roles see every customer, so they take no assignments; 'customer' needs at least one.
create or replace function public.ckb_set_user_access(p_user uuid, p_role text, p_customers uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_role public.ckb_role;
  v_customers uuid[] := coalesce((select array_agg(distinct c) from unnest(p_customers) c where c is not null), '{}');
begin
  perform pg_advisory_xact_lock(hashtext('ckb_access'));
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB yang bisa mengatur akses'; end if;
  if p_user = auth.uid() then raise exception 'Tidak bisa mengubah akses CKB akun Anda sendiri'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Pengguna tidak ditemukan'; end if;

  select jsonb_build_object('role', r.role,
    'customers', coalesce((select jsonb_agg(m.customer_id) from public.ckb_customer_members m where m.user_id = p_user), '[]'))
    into v_before from public.ckb_user_roles r where r.user_id = p_user;

  if p_role is null or trim(p_role) = '' then
    delete from public.ckb_customer_members where user_id = p_user;
    delete from public.ckb_user_roles where user_id = p_user;
  else
    if lower(trim(p_role)) not in ('admin', 'supervisor', 'operator', 'customer') then
      raise exception 'Peran CKB tidak dikenal: %', p_role;
    end if;
    v_role := lower(trim(p_role))::public.ckb_role;
    if not exists (select 1 from public.profiles where id = p_user and 'ckb_3pl' = any(apps)) then
      raise exception 'Beri akses aplikasi CKB 3PL dulu sebelum memberi peran';
    end if;
    if public.ckb_is_shared_account(p_user) then
      raise exception 'Akun bersama tidak bisa diberi peran CKB: operasi CKB harus tercatat atas nama orangnya';
    end if;
    if v_role = 'customer' and cardinality(v_customers) = 0 then
      raise exception 'Perwakilan customer harus ditugaskan ke minimal satu customer';
    end if;
    if v_role <> 'customer' and cardinality(v_customers) > 0 then
      raise exception 'Staf CKB melihat semua customer; penugasan customer hanya untuk perwakilan customer';
    end if;
    if exists (select 1 from unnest(v_customers) c where not exists (select 1 from public.ckb_customers k where k.id = c)) then
      raise exception 'Customer tidak ditemukan';
    end if;

    insert into public.ckb_user_roles (user_id, role, updated_by) values (p_user, v_role, auth.uid())
      on conflict (user_id) do update set role = excluded.role, updated_at = now(), updated_by = auth.uid();
    delete from public.ckb_customer_members where user_id = p_user and not (customer_id = any(v_customers));
    insert into public.ckb_customer_members (user_id, customer_id, created_by)
      select p_user, c, auth.uid() from unnest(v_customers) c
      on conflict do nothing;
  end if;

  perform public.ckb_assert_admin_remains();
  perform public.ckb_audit('ACCESS_SET', 'user', p_user::text, null,
    jsonb_build_object('before', v_before, 'after',
      case when p_role is null or trim(p_role) = '' then null
           else jsonb_build_object('role', lower(trim(p_role)), 'customers', to_jsonb(v_customers)) end));
end $$;

-- Grant or revoke ONLY the ckb_3pl app. Shell access is never touched here (that stays with the
-- Shell admins on Pengguna). Revoking also removes the CKB role and assignments.
create or replace function public.ckb_set_app_access(p_user uuid, p_grant boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_apps text[];
  v_default text;
begin
  perform pg_advisory_xact_lock(hashtext('accounts'));
  perform pg_advisory_xact_lock(hashtext('ckb_access'));
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB yang bisa mengatur akses'; end if;
  if p_user = auth.uid() then raise exception 'Tidak bisa mengubah akses CKB akun Anda sendiri'; end if;
  select apps, default_app into v_apps, v_default from public.profiles where id = p_user for update;
  if v_apps is null then raise exception 'Pengguna tidak ditemukan'; end if;

  if p_grant then
    if public.ckb_is_shared_account(p_user) then
      raise exception 'Akun bersama tidak diberi akses CKB 3PL';
    end if;
    if 'ckb_3pl' = any(v_apps) then return; end if;
    v_apps := array_append(v_apps, 'ckb_3pl');
    v_default := coalesce(v_default, 'ckb_3pl');
  else
    if not ('ckb_3pl' = any(v_apps)) then return; end if;
    v_apps := array_remove(v_apps, 'ckb_3pl');
    if v_default = 'ckb_3pl' or v_default is null then v_default := v_apps[1]; end if;
    delete from public.ckb_customer_members where user_id = p_user;
    delete from public.ckb_user_roles where user_id = p_user;
  end if;

  update public.profiles set apps = v_apps, default_app = v_default where id = p_user;
  perform public.ckb_assert_admin_remains();
  perform public.ckb_audit(case when p_grant then 'APP_GRANT' else 'APP_REVOKE' end, 'user', p_user::text, null,
    jsonb_build_object('apps', to_jsonb(v_apps), 'default_app', v_default));
end $$;

-- Supabase Auth owns passwords (the server sets them with the Auth admin API); this records that a
-- CKB admin did so, for a CKB-only account (the server checks the same before resetting).
create or replace function public.ckb_note_password_reset(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB'; end if;
  if not exists (select 1 from public.profiles where id = p_user and apps = array['ckb_3pl']) then
    raise exception 'Hanya akun khusus CKB';
  end if;
  perform public.ckb_audit('ACCESS_PASSWORD_RESET', 'user', p_user::text, null, '{}'::jsonb);
end $$;
revoke execute on function public.ckb_note_password_reset(uuid) from public, anon;
grant execute on function public.ckb_note_password_reset(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RPCs: customers and settings
-- ---------------------------------------------------------------------

-- p_id null creates; otherwise updates. The code is the customer's stable key: fixed once created.
create or replace function public.ckb_save_customer(p_id uuid, p_code text, p_name text, p_active boolean,
  p_notes text, p_sap_customer_code text, p_sap_plant text, p_sap_storage_location text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_before public.ckb_customers%rowtype;
  v_id uuid;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB yang bisa mengubah customer'; end if;
  if length(v_name) < 2 then raise exception 'Nama customer wajib diisi'; end if;

  if p_id is null then
    if v_code !~ '^[A-Z0-9_-]{2,20}$' then raise exception 'Kode customer 2-20 huruf besar/angka'; end if;
    if exists (select 1 from public.ckb_customers where code = v_code) then
      raise exception 'Kode customer % sudah dipakai', v_code;
    end if;
    insert into public.ckb_customers (code, name, active, notes, sap_customer_code, sap_plant, sap_storage_location, created_by, updated_by)
    values (v_code, v_name, coalesce(p_active, true), nullif(trim(p_notes), ''), nullif(trim(p_sap_customer_code), ''),
            nullif(trim(p_sap_plant), ''), nullif(trim(p_sap_storage_location), ''), auth.uid(), auth.uid())
    returning id into v_id;
    perform public.ckb_audit('CUSTOMER_CREATE', 'customer', v_id::text, v_id,
      jsonb_build_object('code', v_code, 'name', v_name, 'active', coalesce(p_active, true)));
    return v_id;
  end if;

  select * into v_before from public.ckb_customers where id = p_id for update;
  if v_before.id is null then raise exception 'Customer tidak ditemukan'; end if;
  if v_code <> '' and v_code <> v_before.code then raise exception 'Kode customer tidak bisa diubah'; end if;
  update public.ckb_customers set
    name = v_name, active = coalesce(p_active, active), notes = nullif(trim(p_notes), ''),
    sap_customer_code = nullif(trim(p_sap_customer_code), ''), sap_plant = nullif(trim(p_sap_plant), ''),
    sap_storage_location = nullif(trim(p_sap_storage_location), ''), updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  perform public.ckb_audit('CUSTOMER_UPDATE', 'customer', p_id::text, p_id, jsonb_build_object(
    'before', jsonb_build_object('name', v_before.name, 'active', v_before.active, 'notes', v_before.notes,
      'sap_customer_code', v_before.sap_customer_code, 'sap_plant', v_before.sap_plant, 'sap_storage_location', v_before.sap_storage_location),
    'after', (select jsonb_build_object('name', name, 'active', active, 'notes', notes,
      'sap_customer_code', sap_customer_code, 'sap_plant', sap_plant, 'sap_storage_location', sap_storage_location)
      from public.ckb_customers where id = p_id)));
  return p_id;
end $$;

-- Only the known keys, each with a minimal shape check.
create or replace function public.ckb_save_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB yang bisa mengubah pengaturan'; end if;
  select value into v_before from public.ckb_settings where key = p_key for update;
  if v_before is null then raise exception 'Pengaturan tidak dikenal: %', p_key; end if;
  if p_value is null then raise exception 'Nilai pengaturan kosong'; end if;

  if p_key = 'warehouses' and (jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0) then
    raise exception 'Daftar gudang minimal satu';
  elsif p_key = 'stocktake' and jsonb_typeof(p_value->'blind_default') <> 'boolean' then
    raise exception 'blind_default harus true/false';
  elsif p_key = 'evidence' and (
      jsonb_typeof(p_value->'max_mb') <> 'number' or (p_value->>'max_mb')::numeric <= 0 or (p_value->>'max_mb')::numeric > 50
      or jsonb_typeof(p_value->'allowed_mime') <> 'array'
      or jsonb_typeof(p_value->'retention_days') <> 'number' or (p_value->>'retention_days')::numeric < 365) then
    raise exception 'Bukti: ukuran 1-50 MB, daftar tipe file, retensi minimal 365 hari';
  elsif p_key = 'inspection' and jsonb_typeof(p_value->'require_photo_on_ng') <> 'boolean' then
    raise exception 'require_photo_on_ng harus true/false';
  elsif p_key = 'sap_import' and (jsonb_typeof(p_value->'columns') <> 'object'
      or jsonb_typeof(p_value->'verified') <> 'boolean'
      or jsonb_typeof(p_value->'columns'->'material_code') <> 'array'
      or jsonb_typeof(p_value->'columns'->'quantity') <> 'array'
      or jsonb_typeof(p_value->'columns'->'uom') <> 'array') then
    raise exception 'Pemetaan SAP butuh kolom material_code, quantity dan uom';
  elsif p_key = 'sap_export' and (jsonb_typeof(p_value->'verified') <> 'boolean' or coalesce(p_value->>'format_version', '') = '') then
    raise exception 'Format ekspor SAP butuh verified dan format_version';
  end if;

  update public.ckb_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform public.ckb_audit('SETTING_UPDATE', 'setting', p_key, null, jsonb_build_object('before', v_before, 'after', p_value));
end $$;

revoke execute on function public.ckb_bootstrap_admin(), public.ckb_set_user_access(uuid, text, uuid[]),
  public.ckb_set_app_access(uuid, boolean),
  public.ckb_save_customer(uuid, text, text, boolean, text, text, text, text),
  public.ckb_save_setting(text, jsonb) from public, anon;
grant execute on function public.ckb_bootstrap_admin(), public.ckb_set_user_access(uuid, text, uuid[]),
  public.ckb_set_app_access(uuid, boolean),
  public.ckb_save_customer(uuid, text, text, boolean, text, text, text, text),
  public.ckb_save_setting(text, jsonb) to authenticated;
revoke execute on function public.ckb_role(), public.ckb_has_role(text[]), public.ckb_is_staff(),
  public.ckb_can_see_customer(uuid), public.ckb_is_shared_account(uuid), public.ckb_actor_name() from public, anon;
grant execute on function public.ckb_role(), public.ckb_has_role(text[]), public.ckb_is_staff(),
  public.ckb_can_see_customer(uuid), public.ckb_actor_name() to authenticated;

-- ---------------------------------------------------------------------
-- Legacy 0082/0083 mockup tables (see header)
-- ---------------------------------------------------------------------
do $$
declare
  v_rows bigint := 0;
  t text;
begin
  foreach t in array array['cargo_inspection_photos', 'cargo_inspection_lines', 'cargo_inspections',
                           'recountings', 'stock_take_lines', 'stock_takes'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into v_rows;
      if v_rows > 0 then
        raise notice 'ckb legacy table % has % rows: kept, authenticated reads revoked', t, v_rows;
        execute format('revoke all on public.%I from authenticated', t);
        -- Not dropping anything that holds data.
        v_rows := -1;
        exit;
      end if;
    end if;
  end loop;
  if v_rows >= 0 then
    drop table if exists public.cargo_inspection_photos, public.cargo_inspection_lines, public.cargo_inspections,
      public.recountings, public.stock_take_lines, public.stock_takes;
    drop function if exists public.update_stock_take_lines_updated_at();
    drop type if exists public.cargo_inspection_status, public.cargo_check_result, public.stock_take_period,
      public.stock_take_status, public.recounting_status, public.discrepancy_cause;
  else
    foreach t in array array['cargo_inspection_photos', 'cargo_inspection_lines', 'cargo_inspections',
                             'recountings', 'stock_take_lines', 'stock_takes'] loop
      if to_regclass('public.' || t) is not null then execute format('revoke all on public.%I from authenticated', t); end if;
    end loop;
  end if;
end $$;
