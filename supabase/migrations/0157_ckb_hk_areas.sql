-- =====================================================================
-- 0157  CKB 3PL housekeeping, part 1: areas, PICs, holidays and leave
--
-- Spec: docs/superpowers/specs/2026-11-24-ckb-housekeeping-design.md
--
-- Each CKB customer's racks in Oso 5 get housekeeping every working day (Monday to Friday) from one
-- CKB employee, the PIC of that area. An area is a rack (seeded here from the racks CKB owns) or a
-- location an admin adds by hand. A PIC change keeps history: an old check-in still names the right person.
--
-- Isolation (docs/CKB_3PL.md section 2.3): this file reads the Shell table `bins` in exactly two places, the one-time
-- fill below and ckb_hk_sync_racks(); after that housekeeping reads only ckb_hk_areas. It writes nothing of Shell's.
--
-- Same rules as every CKB table: RLS, no write policy, every write a SECURITY DEFINER function that checks the
-- CKB role first and writes an audit event.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.ckb_hk_areas (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9][A-Z0-9 _-]{1,29}$'),
  name        text not null check (length(trim(name)) between 2 and 100),
  kind        text not null check (kind in ('RACK', 'MANUAL')),
  customer_id uuid references public.ckb_customers(id),
  zone        text,
  rack        text,
  pos_x       numeric,
  pos_y       numeric,
  pos_z       numeric,
  active      boolean not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);
create index ckb_hk_areas_customer_idx on public.ckb_hk_areas (customer_id);

-- Who is PIC of an area, from which day. to_date null = the current PIC; at most one per area.
create table public.ckb_hk_assignments (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.ckb_hk_areas(id),
  pic_user_id uuid not null references public.profiles(id),
  pic_name    text not null,
  from_date   date not null,
  to_date     date,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  check (to_date is null or to_date >= from_date)
);
create unique index ckb_hk_assignments_one_open on public.ckb_hk_assignments (area_id) where to_date is null;
create index ckb_hk_assignments_pic_idx on public.ckb_hk_assignments (pic_user_id);
create index ckb_hk_assignments_area_idx on public.ckb_hk_assignments (area_id, from_date);

create table public.ckb_hk_holidays (
  holiday_date date primary key,
  reason       text not null check (length(trim(reason)) >= 2),
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id)
);

-- A PIC on leave is not expected to check in on those days.
create table public.ckb_hk_absences (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id),
  from_date     date not null,
  to_date       date not null,
  reason        text not null check (length(trim(reason)) >= 2),
  recorded_by   uuid references public.profiles(id),
  recorded_name text not null,
  created_at    timestamptz not null default now(),
  check (to_date >= from_date)
);
create index ckb_hk_absences_user_idx on public.ckb_hk_absences (user_id, from_date);

insert into public.ckb_settings (key, value) values
  ('housekeeping', '{"late_window_working_days": 3, "min_gap_minutes": 0, "max_photos_per_kind": 3, "photo_retention_days": 180, "max_edge_px": 1600}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- RLS: leads read everything, a PIC reads their own rows, customers read nothing here
-- (they read housekeeping only through the functions of 0158, which return no names).
-- ---------------------------------------------------------------------
alter table public.ckb_hk_areas enable row level security;
alter table public.ckb_hk_assignments enable row level security;
alter table public.ckb_hk_holidays enable row level security;
alter table public.ckb_hk_absences enable row level security;

create policy "ckb: hk assignments read" on public.ckb_hk_assignments for select to authenticated
  using ((select public.account_active())
         and (public.ckb_has_role(array['admin', 'supervisor']) or (public.ckb_has_role(array['operator']) and pic_user_id = auth.uid())));
create policy "ckb: hk areas read" on public.ckb_hk_areas for select to authenticated
  using ((select public.account_active())
         and (public.ckb_has_role(array['admin', 'supervisor'])
              or (public.ckb_has_role(array['operator'])
                  and exists (select 1 from public.ckb_hk_assignments s where s.area_id = ckb_hk_areas.id and s.pic_user_id = auth.uid()))));
create policy "ckb: hk holidays read" on public.ckb_hk_holidays for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff());
create policy "ckb: hk absences read" on public.ckb_hk_absences for select to authenticated
  using ((select public.account_active())
         and (public.ckb_has_role(array['admin', 'supervisor']) or (public.ckb_has_role(array['operator']) and user_id = auth.uid())));

grant select on public.ckb_hk_areas, public.ckb_hk_assignments, public.ckb_hk_holidays, public.ckb_hk_absences to authenticated;
grant all on public.ckb_hk_areas, public.ckb_hk_assignments, public.ckb_hk_holidays, public.ckb_hk_absences to service_role;

-- ---------------------------------------------------------------------
-- The one-time fill: every rack CKB owns becomes an area (zone + rack number, e.g. CG05).
-- The racks of aisles CG and CH and level A of CF21-CF40 are bins.owner = 'CKB' (0132).
-- ---------------------------------------------------------------------
insert into public.ckb_hk_areas (code, name, kind, zone, rack, pos_x, pos_y, pos_z)
select b.zone || b.rack, 'Rak ' || b.zone || b.rack, 'RACK', b.zone, b.rack,
       round(avg(b.pos_x)::numeric, 2), round(min(b.pos_y)::numeric, 2), round(avg(b.pos_z)::numeric, 2)
from public.bins b
where b.owner = 'CKB' and b.rack is not null and b.zone is not null and (b.zone || b.rack) ~ '^[A-Z0-9][A-Z0-9 _-]{1,29}$'
group by b.zone, b.rack
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Jakarta')::date $$;

-- Monday to Friday and not a recorded holiday.
create or replace function public.ckb_hk_is_workday(p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from p_day) between 1 and 5 and not exists (select 1 from public.ckb_hk_holidays h where h.holiday_date = p_day)
$$;

-- Who may be a PIC: an active CKB staff account with a personal login.
create or replace function public.ckb_hk_valid_pic(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join public.ckb_user_roles r on r.user_id = p.id
    where p.id = p_user and p.active and 'ckb_3pl' = any(p.apps) and r.role in ('admin', 'supervisor', 'operator')
      and not public.ckb_is_shared_account(p.id))
$$;

-- ---------------------------------------------------------------------
-- Areas
-- ---------------------------------------------------------------------
-- Racks added to CKB since the first fill. Only ever ADDS areas: nothing an admin edited is touched.
create or replace function public.ckb_hk_sync_racks() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB yang bisa sinkron rak'; end if;
  insert into public.ckb_hk_areas (code, name, kind, zone, rack, pos_x, pos_y, pos_z, created_by)
  select b.zone || b.rack, 'Rak ' || b.zone || b.rack, 'RACK', b.zone, b.rack,
         round(avg(b.pos_x)::numeric, 2), round(min(b.pos_y)::numeric, 2), round(avg(b.pos_z)::numeric, 2), auth.uid()
  from public.bins b
  where b.owner = 'CKB' and b.rack is not null and b.zone is not null and (b.zone || b.rack) ~ '^[A-Z0-9][A-Z0-9 _-]{1,29}$'
  group by b.zone, b.rack
  on conflict (code) do nothing;
  get diagnostics v_n = row_count;
  perform public.ckb_audit('HK_SYNC_RACKS', 'housekeeping_area', null, null, jsonb_build_object('added', v_n));
  return jsonb_build_object('added', v_n);
end $$;

-- Create a manual location (p_id null) or edit an area's name, customer, note and active flag. The code never changes.
create or replace function public.ckb_hk_save_area(p_id uuid, p_code text, p_name text, p_customer uuid, p_active boolean, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_code text := upper(regexp_replace(trim(coalesce(p_code, '')), '\s+', ' ', 'g')); v_id uuid; a public.ckb_hk_areas%rowtype;
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB yang bisa mengubah area'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Nama area wajib diisi'; end if;
  if p_customer is not null and not exists (select 1 from public.ckb_customers c where c.id = p_customer and c.active) then
    raise exception 'Customer tidak ditemukan atau tidak aktif';
  end if;
  if p_id is null then
    if v_code !~ '^[A-Z0-9][A-Z0-9 _-]{1,29}$' then raise exception 'Kode area 2-30 karakter: huruf, angka, spasi, - dan _'; end if;
    if exists (select 1 from public.ckb_hk_areas where code = v_code) then raise exception 'Kode area % sudah dipakai', v_code; end if;
    insert into public.ckb_hk_areas (code, name, kind, customer_id, active, note, created_by, updated_by)
    values (v_code, trim(p_name), 'MANUAL', p_customer, coalesce(p_active, true), nullif(trim(p_note), ''), auth.uid(), auth.uid())
    returning id into v_id;
    perform public.ckb_audit('HK_AREA_ADD', 'housekeeping_area', v_id::text, p_customer, jsonb_build_object('code', v_code));
  else
    select * into a from public.ckb_hk_areas where id = p_id for update;
    if a.id is null then raise exception 'Area tidak ditemukan'; end if;
    update public.ckb_hk_areas set name = trim(p_name), customer_id = p_customer, active = coalesce(p_active, active),
      note = nullif(trim(p_note), ''), updated_at = now(), updated_by = auth.uid() where id = p_id;
    v_id := p_id;
    perform public.ckb_audit('HK_AREA_EDIT', 'housekeeping_area', v_id::text, p_customer,
      jsonb_build_object('code', a.code, 'customer_before', a.customer_id, 'active_before', a.active));
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- PIC of an area, with history
-- ---------------------------------------------------------------------
-- p_pic null = the area has no PIC from p_from on. Otherwise p_pic is the PIC from p_from on; the previous one ends the day before.
create or replace function public.ckb_hk_assign(p_area uuid, p_pic uuid, p_from date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_from date := coalesce(p_from, public.ckb_hk_today()); a public.ckb_hk_areas%rowtype; c public.ckb_hk_assignments%rowtype;
        v_name text; v_id uuid;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin yang bisa mengganti PIC'; end if;
  select * into a from public.ckb_hk_areas where id = p_area for update;
  if a.id is null then raise exception 'Area tidak ditemukan'; end if;
  if p_pic is not null then
    if not public.ckb_hk_valid_pic(p_pic) then raise exception 'PIC harus akun staf CKB yang aktif dan pribadi (bukan akun bersama)'; end if;
    select name into v_name from public.profiles where id = p_pic;
  end if;
  select * into c from public.ckb_hk_assignments where area_id = p_area and to_date is null for update;
  if c.id is not null then
    if p_pic is not distinct from c.pic_user_id then raise exception '% sudah menjadi PIC area ini', c.pic_name; end if;
    if v_from <= c.from_date then
      raise exception 'Tanggal berlaku harus setelah % (PIC sekarang mulai %)', c.from_date, c.from_date;
    end if;
    update public.ckb_hk_assignments set to_date = v_from - 1 where id = c.id;
  elsif p_pic is null then
    raise exception 'Area ini belum punya PIC';
  end if;
  if p_pic is not null then
    insert into public.ckb_hk_assignments (area_id, pic_user_id, pic_name, from_date, created_by)
    values (p_area, p_pic, coalesce(v_name, 'Tanpa nama'), v_from, auth.uid()) returning id into v_id;
  end if;
  perform public.ckb_audit('HK_ASSIGN', 'housekeeping_area', p_area::text, a.customer_id,
    jsonb_build_object('code', a.code, 'from', v_from, 'pic', p_pic, 'previous', c.pic_user_id));
  return v_id;
end $$;

-- CKB staff who can be PIC, for the picker.
create or replace function public.ckb_hk_staff() returns table (user_id uuid, name text, username text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.username, r.role::text
  from public.profiles p join public.ckb_user_roles r on r.user_id = p.id
  where public.ckb_has_role(array['admin', 'supervisor']) and p.active and 'ckb_3pl' = any(p.apps)
    and r.role in ('admin', 'supervisor', 'operator') and not public.ckb_is_shared_account(p.id)
  order by p.name
$$;

-- ---------------------------------------------------------------------
-- Bulk entry: rows {code, name?, customer?, pic?} (the PIC by username, the customer by code or name)
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_import_check(p_rows jsonb, p_create_missing boolean)
returns table (line int, code text, status text, message text, area_id uuid, customer_id uuid, pic_id uuid, create_new boolean, new_name text)
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; i int := 0; v_code text; v_area uuid; v_cust uuid; v_pic uuid; v_cust_txt text; v_pic_txt text; v_msg text; v_seen text[] := '{}';
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then raise exception 'Format baris tidak valid'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_msg := null; v_area := null; v_cust := null; v_pic := null;
    v_code := upper(regexp_replace(trim(coalesce(r->>'code', '')), '\s+', ' ', 'g'));
    v_cust_txt := nullif(trim(coalesce(r->>'customer', '')), '');
    v_pic_txt := nullif(lower(trim(coalesce(r->>'pic', ''))), '');
    if v_code = '' then v_msg := 'Kode area kosong';
    elsif v_code = any(v_seen) then v_msg := 'Kode ' || v_code || ' muncul dua kali di file';
    else
      v_seen := v_seen || v_code;
      select a.id into v_area from public.ckb_hk_areas a where a.code = v_code;
      if v_area is null and not coalesce(p_create_missing, false) then v_msg := 'Area ' || v_code || ' tidak ada (centang "buat lokasi yang belum ada" untuk menambahnya)';
      elsif v_area is null and v_code !~ '^[A-Z0-9][A-Z0-9 _-]{1,29}$' then v_msg := 'Kode area tidak valid';
      end if;
      if v_msg is null and v_cust_txt is not null then
        select c.id into v_cust from public.ckb_customers c where c.active and (upper(c.code) = upper(v_cust_txt) or lower(c.name) = lower(v_cust_txt));
        if v_cust is null then v_msg := 'Customer "' || v_cust_txt || '" tidak ditemukan'; end if;
      end if;
      if v_msg is null and v_pic_txt is not null then
        select p.id into v_pic from public.profiles p where lower(p.username) = v_pic_txt;
        if v_pic is null then v_msg := 'Pengguna "' || v_pic_txt || '" tidak ditemukan';
        elsif not public.ckb_hk_valid_pic(v_pic) then v_msg := 'Pengguna "' || v_pic_txt || '" bukan staf CKB aktif dengan akun pribadi'; end if;
      end if;
    end if;
    line := i; code := nullif(v_code, ''); status := case when v_msg is null then 'OK' else 'REFUSED' end; message := v_msg;
    area_id := v_area; customer_id := v_cust; pic_id := v_pic; create_new := v_msg is null and v_area is null;
    new_name := nullif(trim(coalesce(r->>'name', '')), '');
    return next;
  end loop;
end $$;

create or replace function public.ckb_hk_import_preview(p_rows jsonb, p_create_missing boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('line', c.line, 'code', c.code, 'status', c.status, 'message', c.message,
                      'create_new', c.create_new, 'has_customer', c.customer_id is not null, 'has_pic', c.pic_id is not null) order by c.line)
                   from public.ckb_hk_import_check(p_rows, p_create_missing) c), '[]'::jsonb);
end $$;

-- All or nothing: one refused row stops the whole file.
create or replace function public.ckb_hk_import_apply(p_rows jsonb, p_create_missing boolean default false, p_from date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v_from date := coalesce(p_from, public.ckb_hk_today()); v_area uuid; cur public.ckb_hk_assignments%rowtype;
        n_new int := 0; n_cust int := 0; n_pic int := 0; n_same int := 0; v_bad int; v_changed boolean;
begin
  select count(*) into v_bad from public.ckb_hk_import_check(p_rows, p_create_missing) x where x.status <> 'OK';
  if v_bad > 0 then raise exception '% baris ditolak: perbaiki dulu (lihat pratinjau)', v_bad; end if;
  for c in select * from public.ckb_hk_import_check(p_rows, p_create_missing) loop
    v_area := c.area_id; v_changed := false;
    if c.create_new then
      insert into public.ckb_hk_areas (code, name, kind, customer_id, created_by, updated_by)
      values (c.code, coalesce(c.new_name, c.code), 'MANUAL', c.customer_id, auth.uid(), auth.uid()) returning id into v_area;
      n_new := n_new + 1; v_changed := true;
    elsif c.customer_id is not null and c.customer_id is distinct from (select a.customer_id from public.ckb_hk_areas a where a.id = v_area) then
      update public.ckb_hk_areas set customer_id = c.customer_id, updated_at = now(), updated_by = auth.uid() where id = v_area;
      n_cust := n_cust + 1; v_changed := true;
    end if;
    if c.pic_id is not null then
      select * into cur from public.ckb_hk_assignments where area_id = v_area and to_date is null;
      if cur.id is null or cur.pic_user_id <> c.pic_id then
        if cur.id is not null and v_from <= cur.from_date then raise exception 'Area %: tanggal berlaku harus setelah %', c.code, cur.from_date; end if;
        perform public.ckb_hk_assign(v_area, c.pic_id, v_from);
        n_pic := n_pic + 1; v_changed := true;
      end if;
    end if;
    if not v_changed then n_same := n_same + 1; end if;
  end loop;
  perform public.ckb_audit('HK_IMPORT', 'housekeeping_area', null, null,
    jsonb_build_object('created', n_new, 'customers_set', n_cust, 'pics_set', n_pic, 'unchanged', n_same));
  return jsonb_build_object('created', n_new, 'customers_set', n_cust, 'pics_set', n_pic, 'unchanged', n_same);
end $$;

-- ---------------------------------------------------------------------
-- Holidays and leave
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_set_holiday(p_date date, p_reason text, p_remove boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  if p_date is null then raise exception 'Tanggal wajib diisi'; end if;
  if coalesce(p_remove, false) then
    delete from public.ckb_hk_holidays where holiday_date = p_date;
  else
    if length(trim(coalesce(p_reason, ''))) < 2 then raise exception 'Alasan wajib diisi'; end if;
    insert into public.ckb_hk_holidays (holiday_date, reason, created_by) values (p_date, trim(p_reason), auth.uid())
    on conflict (holiday_date) do update set reason = excluded.reason;
  end if;
  perform public.ckb_audit(case when coalesce(p_remove, false) then 'HK_HOLIDAY_REMOVE' else 'HK_HOLIDAY_SET' end,
    'housekeeping_holiday', p_date::text, null, jsonb_build_object('reason', nullif(trim(p_reason), '')));
end $$;

create or replace function public.ckb_hk_add_absence(p_user uuid, p_from date, p_to date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rentang tanggal cuti tidak valid'; end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then raise exception 'Pengguna tidak ditemukan'; end if;
  if length(trim(coalesce(p_reason, ''))) < 2 then raise exception 'Alasan wajib diisi'; end if;
  insert into public.ckb_hk_absences (user_id, from_date, to_date, reason, recorded_by, recorded_name)
  values (p_user, p_from, p_to, trim(p_reason), auth.uid(), public.ckb_actor_name()) returning id into v_id;
  perform public.ckb_audit('HK_ABSENCE_ADD', 'housekeeping_absence', v_id::text, null, jsonb_build_object('user', p_user, 'from', p_from, 'to', p_to));
  return v_id;
end $$;

create or replace function public.ckb_hk_remove_absence(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  delete from public.ckb_hk_absences where id = p_id;
  if not found then raise exception 'Cuti tidak ditemukan'; end if;
  perform public.ckb_audit('HK_ABSENCE_REMOVE', 'housekeeping_absence', p_id::text, null, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Grants: only the functions the app calls; the helpers stay internal.
-- ---------------------------------------------------------------------
revoke execute on function public.ckb_hk_today(), public.ckb_hk_is_workday(date), public.ckb_hk_valid_pic(uuid),
  public.ckb_hk_sync_racks(), public.ckb_hk_save_area(uuid, text, text, uuid, boolean, text), public.ckb_hk_assign(uuid, uuid, date),
  public.ckb_hk_staff(), public.ckb_hk_import_check(jsonb, boolean), public.ckb_hk_import_preview(jsonb, boolean),
  public.ckb_hk_import_apply(jsonb, boolean, date), public.ckb_hk_set_holiday(date, text, boolean),
  public.ckb_hk_add_absence(uuid, date, date, text), public.ckb_hk_remove_absence(uuid) from public, anon;
grant execute on function public.ckb_hk_today(), public.ckb_hk_is_workday(date), public.ckb_hk_sync_racks(),
  public.ckb_hk_save_area(uuid, text, text, uuid, boolean, text), public.ckb_hk_assign(uuid, uuid, date), public.ckb_hk_staff(),
  public.ckb_hk_import_preview(jsonb, boolean), public.ckb_hk_import_apply(jsonb, boolean, date), public.ckb_hk_set_holiday(date, text, boolean),
  public.ckb_hk_add_absence(uuid, date, date, text), public.ckb_hk_remove_absence(uuid) to authenticated;
-- ckb_hk_valid_pic and ckb_hk_import_check stay callable by the definer functions only (revoked above, not granted back).
