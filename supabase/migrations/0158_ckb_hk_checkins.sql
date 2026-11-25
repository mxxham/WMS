-- =====================================================================
-- 0158  CKB 3PL housekeeping, part 2: the daily check-in with before and after photos
--
-- Spec: docs/superpowers/specs/2026-11-24-ckb-housekeeping-design.md (sections 4, 5 and 5.3)
--
-- A check-in is one housekeeping of one area on one working day. The PIC starts it (before photos), adds the
-- after photos and submits. SUBMITTED counts as done at once; a supervisor may ACCEPT or REJECT it, and a
-- rejection takes it back (the PIC then does attempt 2 of that day).
--
-- Photos live in their own table (not ckb_evidence) so that no person's name is stored next to a photo and a
-- customer can never read one by a policy: a customer reads housekeeping ONLY through the functions at the end,
-- which return no pic_*, reviewer or on-behalf names. The files share the private bucket 'ckb-evidence' under
-- {customer}/HOUSEKEEPING/{check-in}/{uuid}.{ext}.
-- =====================================================================

create table public.ckb_hk_checkins (
  id               uuid primary key default gen_random_uuid(),
  area_id          uuid not null references public.ckb_hk_areas(id),
  customer_id      uuid not null references public.ckb_customers(id),
  work_date        date not null,
  attempt          int not null default 1 check (attempt >= 1),
  status           text not null default 'STARTED' check (status in ('STARTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED')),
  pic_user_id      uuid not null references public.profiles(id),
  pic_name         text not null,
  acted_by         uuid not null references public.profiles(id),   -- who started it: the PIC, or a lead on their behalf
  started_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  late             boolean not null default false,
  on_behalf_by     uuid references public.profiles(id),
  on_behalf_name   text,
  on_behalf_reason text,
  reviewed_by      uuid references public.profiles(id),
  reviewed_name    text,
  reviewed_at      timestamptz,
  review_note      text,
  unique (area_id, work_date, attempt)
);
create index ckb_hk_checkins_day_idx on public.ckb_hk_checkins (work_date, area_id);
create index ckb_hk_checkins_pic_idx on public.ckb_hk_checkins (pic_user_id, work_date);
create index ckb_hk_checkins_review_idx on public.ckb_hk_checkins (status) where status = 'SUBMITTED';

create table public.ckb_hk_photos (
  id           uuid primary key default gen_random_uuid(),
  checkin_id   uuid not null references public.ckb_hk_checkins(id),
  customer_id  uuid not null references public.ckb_customers(id),
  kind         text not null check (kind in ('BEFORE', 'AFTER')),
  storage_path text not null unique,
  mime         text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes   bigint not null check (size_bytes > 0),
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by  uuid not null references public.profiles(id),
  uploaded_at  timestamptz not null default now(),
  retain_until date not null,
  archived_at  timestamptz,
  archive_ref  text,
  constraint ckb_hk_photos_sha_key unique (sha256)
);
create index ckb_hk_photos_checkin_idx on public.ckb_hk_photos (checkin_id, kind, uploaded_at);

-- A check-in only moves forward, and what it says about who, when and where never changes.
create or replace function public.ckb_hk_checkins_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Check-in housekeeping tidak bisa dihapus'; end if;
  if (new.area_id, new.customer_id, new.work_date, new.attempt, new.pic_user_id, new.pic_name, new.acted_by, new.started_at, new.late,
      new.on_behalf_by, new.on_behalf_name, new.on_behalf_reason)
     is distinct from
     (old.area_id, old.customer_id, old.work_date, old.attempt, old.pic_user_id, old.pic_name, old.acted_by, old.started_at, old.late,
      old.on_behalf_by, old.on_behalf_name, old.on_behalf_reason) then
    raise exception 'Data check-in tidak bisa diubah';
  end if;
  if new.status = old.status then
    if (new.submitted_at, new.reviewed_by, new.reviewed_at, new.review_note) is distinct from (old.submitted_at, old.reviewed_by, old.reviewed_at, old.review_note) then
      raise exception 'Check-in tidak bisa diubah';
    end if;
  elsif not ((old.status = 'STARTED' and new.status = 'SUBMITTED') or (old.status = 'SUBMITTED' and new.status in ('ACCEPTED', 'REJECTED'))) then
    raise exception 'Status check-in tidak bisa berubah dari % ke %', old.status, new.status;
  end if;
  return new;
end $$;
create trigger ckb_hk_checkins_guard before update or delete on public.ckb_hk_checkins
  for each row execute function public.ckb_hk_checkins_guard();
create trigger ckb_hk_checkins_no_truncate before truncate on public.ckb_hk_checkins
  for each statement execute function public.ckb_forbid_change();

-- A photo is never edited or removed; only its archive note can be set once the retention has passed.
create or replace function public.ckb_hk_photos_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Foto housekeeping tidak bisa dihapus'; end if;
  if (new.checkin_id, new.customer_id, new.kind, new.storage_path, new.mime, new.size_bytes, new.sha256, new.uploaded_by, new.uploaded_at, new.retain_until)
     is distinct from
     (old.checkin_id, old.customer_id, old.kind, old.storage_path, old.mime, old.size_bytes, old.sha256, old.uploaded_by, old.uploaded_at, old.retain_until) then
    raise exception 'Data foto tidak bisa diubah';
  end if;
  return new;
end $$;
create trigger ckb_hk_photos_guard before update or delete on public.ckb_hk_photos
  for each row execute function public.ckb_hk_photos_guard();
create trigger ckb_hk_photos_no_truncate before truncate on public.ckb_hk_photos
  for each statement execute function public.ckb_forbid_change();

-- RLS: leads read all, a PIC reads what they started; customers read nothing here (section 5.3).
alter table public.ckb_hk_checkins enable row level security;
alter table public.ckb_hk_photos enable row level security;
create policy "ckb: hk checkins read" on public.ckb_hk_checkins for select to authenticated
  using ((select public.account_active())
         and (public.ckb_has_role(array['admin', 'supervisor'])
              or (public.ckb_has_role(array['operator']) and (pic_user_id = auth.uid() or acted_by = auth.uid()))));
create policy "ckb: hk photos read" on public.ckb_hk_photos for select to authenticated
  using ((select public.account_active())
         and (public.ckb_has_role(array['admin', 'supervisor'])
              or (public.ckb_has_role(array['operator'])
                  and exists (select 1 from public.ckb_hk_checkins c where c.id = checkin_id and (c.pic_user_id = auth.uid() or c.acted_by = auth.uid())))));
grant select on public.ckb_hk_checkins, public.ckb_hk_photos to authenticated;
grant all on public.ckb_hk_checkins, public.ckb_hk_photos to service_role;

-- ---------------------------------------------------------------------
-- Working days between a past day and today (yesterday = 1), for the late window
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_late_rank(p_day date, p_today date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from generate_series(p_day, p_today - 1, interval '1 day') g where public.ckb_hk_is_workday(g::date)
$$;

create or replace function public.ckb_hk_setting(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>p_key)::numeric from public.ckb_settings where key = 'housekeeping'), p_default)
$$;

-- ---------------------------------------------------------------------
-- Start (or resume) the check-in of an area for a working day
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_start(p_area uuid, p_date date default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.ckb_hk_today(); v_day date := coalesce(p_date, public.ckb_hk_today());
  v_actor uuid := auth.uid(); v_lead boolean; a public.ckb_hk_areas%rowtype;
  v_pic uuid; v_pic_name text; v_late boolean; v_window int; v_last public.ckb_hk_checkins%rowtype;
  v_attempt int := 1; v_behalf boolean; v_id uuid; v_actor_name text := public.ckb_actor_name();
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB yang bisa mengisi housekeeping'; end if;
  v_lead := public.ckb_has_role(array['admin', 'supervisor']);
  select * into a from public.ckb_hk_areas where id = p_area;
  if a.id is null or not a.active then raise exception 'Area tidak ditemukan atau tidak aktif'; end if;
  if a.customer_id is null then raise exception 'Area % belum punya customer: minta admin mengisinya', a.code; end if;
  if v_day > v_today then raise exception 'Tanggal % belum tiba', v_day; end if;
  if not public.ckb_hk_is_workday(v_day) then raise exception '% bukan hari kerja (Sabtu, Minggu atau libur)', v_day; end if;
  select s.pic_user_id, s.pic_name into v_pic, v_pic_name from public.ckb_hk_assignments s
   where s.area_id = p_area and s.from_date <= v_day and (s.to_date is null or s.to_date >= v_day) limit 1;
  if v_pic is null then raise exception 'Area % belum punya PIC pada %', a.code, v_day; end if;
  if exists (select 1 from public.ckb_hk_absences x where x.user_id = v_pic and v_day between x.from_date and x.to_date) then
    raise exception 'PIC area % sedang cuti pada %: tidak perlu diisi', a.code, v_day;
  end if;
  v_behalf := v_actor <> v_pic;
  if v_behalf and not v_lead then raise exception 'Area % bukan milik Anda', a.code; end if;
  if v_behalf and length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan wajib diisi saat mencatat atas nama PIC'; end if;

  v_late := v_day < v_today;
  if v_late and not v_behalf then
    v_window := public.ckb_hk_setting('late_window_working_days', 3)::int;
    if public.ckb_hk_late_rank(v_day, v_today) > v_window then
      raise exception 'Lewat batas terlambat (% hari kerja): minta supervisor mencatat atas nama Anda', v_window;
    end if;
  end if;

  select * into v_last from public.ckb_hk_checkins where area_id = p_area and work_date = v_day order by attempt desc limit 1;
  if v_last.id is not null then
    if v_last.status = 'STARTED' then
      if v_last.acted_by <> v_actor and not v_lead then raise exception 'Check-in tanggal % sedang dikerjakan orang lain', v_day; end if;
      return jsonb_build_object('id', v_last.id, 'attempt', v_last.attempt, 'late', v_last.late, 'on_behalf', v_last.on_behalf_by is not null, 'resumed', true);
    elsif v_last.status in ('SUBMITTED', 'ACCEPTED') then
      raise exception 'Housekeeping % tanggal % sudah selesai', a.code, v_day;
    end if;
    v_attempt := v_last.attempt + 1;   -- the last one was rejected
  end if;

  insert into public.ckb_hk_checkins (area_id, customer_id, work_date, attempt, pic_user_id, pic_name, acted_by, late,
                                       on_behalf_by, on_behalf_name, on_behalf_reason)
  values (p_area, a.customer_id, v_day, v_attempt, v_pic, v_pic_name, v_actor, v_late,
          case when v_behalf then v_actor end, case when v_behalf then v_actor_name end, case when v_behalf then trim(p_reason) end)
  returning id into v_id;
  perform public.ckb_audit('HK_START', 'housekeeping_checkin', v_id::text, a.customer_id,
    jsonb_build_object('area', a.code, 'day', v_day, 'attempt', v_attempt, 'late', v_late, 'on_behalf', v_behalf));
  return jsonb_build_object('id', v_id, 'attempt', v_attempt, 'late', v_late, 'on_behalf', v_behalf, 'resumed', false);
end $$;

-- ---------------------------------------------------------------------
-- A photo of a started check-in (the file is already in storage; the upload route calls this as the user)
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_register_photo(p_checkin uuid, p_kind text, p_path text, p_mime text, p_size bigint, p_sha256 text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c public.ckb_hk_checkins%rowtype; v_cfg jsonb; v_ext text; v_id uuid; v_n int; v_max int; v_gap numeric; v_first timestamptz;
  v_retention int;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB yang bisa mengunggah foto'; end if;
  select * into c from public.ckb_hk_checkins where id = p_checkin for update;
  if c.id is null then raise exception 'Check-in tidak ditemukan'; end if;
  if c.acted_by <> auth.uid() then raise exception 'Check-in ini bukan milik Anda'; end if;
  if c.status <> 'STARTED' then raise exception 'Foto hanya bisa ditambah sebelum check-in dikirim'; end if;
  if p_kind not in ('BEFORE', 'AFTER') then raise exception 'Jenis foto harus sebelum atau sesudah'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Sidik jari foto tidak valid'; end if;

  select value into v_cfg from public.ckb_settings where key = 'evidence';
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'Foto harus JPG, PNG atau WebP'; end if;
  if p_size is null or p_size <= 0 or p_size > (v_cfg->>'max_mb')::numeric * 1048576 then raise exception 'Ukuran foto melebihi % MB', v_cfg->>'max_mb'; end if;
  v_ext := case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if p_path is distinct from (c.customer_id::text || '/HOUSEKEEPING/' || c.id::text || '/' || split_part(split_part(p_path, '/', 4), '.', 1) || '.' || v_ext)
     or split_part(split_part(p_path, '/', 4), '.', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Lokasi file foto tidak valid';
  end if;

  v_max := public.ckb_hk_setting('max_photos_per_kind', 3)::int;
  select count(*) into v_n from public.ckb_hk_photos where checkin_id = p_checkin and kind = p_kind;
  if v_n >= v_max then raise exception 'Maksimal % foto % per check-in', v_max, case p_kind when 'BEFORE' then 'sebelum' else 'sesudah' end; end if;
  if p_kind = 'AFTER' then
    select min(uploaded_at) into v_first from public.ckb_hk_photos where checkin_id = p_checkin and kind = 'BEFORE';
    if v_first is null then raise exception 'Ambil foto sebelum dulu, baru foto sesudah'; end if;
    v_gap := public.ckb_hk_setting('min_gap_minutes', 0);
    if v_gap > 0 and now() < v_first + make_interval(mins => v_gap::int) then
      raise exception 'Foto sesudah baru bisa diambil % menit setelah foto sebelum', v_gap;
    end if;
  end if;

  v_retention := public.ckb_hk_setting('photo_retention_days', 180)::int;
  begin
    insert into public.ckb_hk_photos (checkin_id, customer_id, kind, storage_path, mime, size_bytes, sha256, uploaded_by, retain_until)
    values (p_checkin, c.customer_id, p_kind, p_path, p_mime, p_size, p_sha256, auth.uid(), public.ckb_hk_today() + v_retention)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Foto ini sudah pernah dipakai (file yang sama). Ambil foto baru.';
  end;
  perform public.ckb_audit('HK_PHOTO', 'housekeeping_checkin', p_checkin::text, c.customer_id,
    jsonb_build_object('photo_id', v_id, 'kind', p_kind, 'size', p_size));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Submit: needs at least one before and one after photo; counts as done from here
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_submit(p_checkin uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.ckb_hk_checkins%rowtype;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  select * into c from public.ckb_hk_checkins where id = p_checkin for update;
  if c.id is null then raise exception 'Check-in tidak ditemukan'; end if;
  if c.acted_by <> auth.uid() then raise exception 'Check-in ini bukan milik Anda'; end if;
  if c.status <> 'STARTED' then raise exception 'Check-in ini sudah dikirim'; end if;
  if not exists (select 1 from public.ckb_hk_photos where checkin_id = p_checkin and kind = 'BEFORE') then raise exception 'Foto sebelum belum ada'; end if;
  if not exists (select 1 from public.ckb_hk_photos where checkin_id = p_checkin and kind = 'AFTER') then raise exception 'Foto sesudah belum ada'; end if;
  update public.ckb_hk_checkins set status = 'SUBMITTED', submitted_at = now() where id = p_checkin;
  perform public.ckb_audit('HK_SUBMIT', 'housekeeping_checkin', p_checkin::text, c.customer_id,
    jsonb_build_object('day', c.work_date, 'attempt', c.attempt, 'late', c.late));
end $$;

-- ---------------------------------------------------------------------
-- Review: a supervisor accepts or rejects; never their own work
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_review(p_checkin uuid, p_accept boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.ckb_hk_checkins%rowtype;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin yang bisa meninjau'; end if;
  select * into c from public.ckb_hk_checkins where id = p_checkin for update;
  if c.id is null then raise exception 'Check-in tidak ditemukan'; end if;
  if c.status <> 'SUBMITTED' then raise exception 'Hanya check-in yang sudah dikirim dan belum ditinjau yang bisa ditinjau'; end if;
  if auth.uid() in (c.pic_user_id, c.acted_by) then raise exception 'Anda tidak bisa meninjau pekerjaan sendiri'; end if;
  if not coalesce(p_accept, false) and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Alasan penolakan wajib diisi'; end if;
  update public.ckb_hk_checkins set status = case when p_accept then 'ACCEPTED' else 'REJECTED' end,
    reviewed_by = auth.uid(), reviewed_name = public.ckb_actor_name(), reviewed_at = now(), review_note = nullif(trim(p_note), '')
  where id = p_checkin;
  perform public.ckb_audit(case when p_accept then 'HK_ACCEPT' else 'HK_REJECT' end, 'housekeeping_checkin', p_checkin::text, c.customer_id,
    jsonb_build_object('day', c.work_date, 'attempt', c.attempt, 'note', nullif(trim(p_note), '')));
end $$;

-- ---------------------------------------------------------------------
-- The day by day state of every area (internal; it carries names, so the wrappers below decide who gets what)
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_grid_core(p_customer uuid, p_from date, p_to date)
returns table (area_id uuid, area_code text, area_name text, customer_id uuid, day date, state text, late boolean, on_behalf boolean,
               checkin_id uuid, attempt int, pic_user_id uuid, pic_name text, review_note text)
language sql stable security definer set search_path = public as $$
  with t as (select public.ckb_hk_today() as today),
  days as (select g::date as day from generate_series(p_from, p_to, interval '1 day') g where extract(isodow from g) between 1 and 5),
  areas as (select a.id, a.code, a.name, a.customer_id from public.ckb_hk_areas a where a.active and (p_customer is null or a.customer_id = p_customer)),
  cells as (select a.id as area_id, a.code, a.name, a.customer_id, d.day from areas a cross join days d)
  select c.area_id, c.code, c.name, c.customer_id, c.day,
         case
           when exists (select 1 from public.ckb_hk_holidays h where h.holiday_date = c.day) then 'HOLIDAY'
           when s.pic_user_id is null then 'NA'
           when exists (select 1 from public.ckb_hk_absences x where x.user_id = s.pic_user_id and c.day between x.from_date and x.to_date) then 'LEAVE'
           when k.status in ('SUBMITTED', 'ACCEPTED') then 'DONE'
           when c.day > t.today then 'FUTURE'
           when c.day = t.today then case when k.status = 'STARTED' then 'STARTED' when k.status = 'REJECTED' then 'REJECTED' else 'PENDING' end
           else 'MISSED'
         end,
         coalesce(k.late, false), k.on_behalf_by is not null, k.id, k.attempt, s.pic_user_id, s.pic_name, k.review_note
  from cells c cross join t
  left join lateral (select x.pic_user_id, x.pic_name from public.ckb_hk_assignments x
                      where x.area_id = c.area_id and x.from_date <= c.day and (x.to_date is null or x.to_date >= c.day) limit 1) s on true
  left join lateral (select * from public.ckb_hk_checkins y where y.area_id = c.area_id and y.work_date = c.day order by y.attempt desc limit 1) k on true
$$;

-- Supervisors and admins: the recap with names.
create or replace function public.ckb_hk_recap(p_from date, p_to date, p_customer uuid default null)
returns table (area_id uuid, area_code text, area_name text, customer_code text, pic_user_id uuid, pic_name text, day date, state text,
               late boolean, on_behalf boolean, checkin_id uuid, attempt int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  return query select g.area_id, g.area_code, g.area_name, (select c.code from public.ckb_customers c where c.id = g.customer_id),
                      g.pic_user_id, g.pic_name, g.day, g.state, g.late, g.on_behalf, g.checkin_id, g.attempt
               from public.ckb_hk_grid_core(p_customer, p_from, p_to) g order by g.area_code, g.day;
end $$;

-- A PIC: their own areas and days (a supervisor who is a PIC sees theirs too). No other person's data.
create or replace function public.ckb_hk_my_days(p_from date, p_to date)
returns table (area_id uuid, area_code text, area_name text, customer_code text, day date, state text, late boolean,
               checkin_id uuid, attempt int, before_count int, after_count int, review_note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  return query select g.area_id, g.area_code, g.area_name, (select c.code from public.ckb_customers c where c.id = g.customer_id), g.day, g.state,
                      g.late, g.checkin_id, g.attempt,
                      (select count(*)::int from public.ckb_hk_photos p where p.checkin_id = g.checkin_id and p.kind = 'BEFORE'),
                      (select count(*)::int from public.ckb_hk_photos p where p.checkin_id = g.checkin_id and p.kind = 'AFTER'),
                      case when g.state in ('REJECTED', 'MISSED') then g.review_note end
               from public.ckb_hk_grid_core(null, p_from, p_to) g
               where g.pic_user_id = auth.uid() order by g.area_code, g.day;
end $$;

-- A customer's week: states with no names. Leave and "no PIC yet" read as "not scheduled"; a day still open reads as pending.
create or replace function public.ckb_hk_customer_week(p_customer uuid, p_from date, p_to date)
returns table (area_id uuid, area_code text, area_name text, day date, state text, late boolean, on_behalf boolean, checkin_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_customer is null or not public.ckb_can_see_customer(p_customer) then raise exception 'Customer tidak ditemukan'; end if;
  return query select g.area_id, g.area_code, g.area_name, g.day,
                      case g.state when 'LEAVE' then 'NA' when 'STARTED' then 'PENDING' when 'REJECTED' then 'PENDING' else g.state end,
                      g.late, g.on_behalf, case when g.state = 'DONE' then g.checkin_id end
               from public.ckb_hk_grid_core(p_customer, p_from, p_to) g order by g.area_code, g.day;
end $$;

-- Compliance per area over a period: days done / days expected (a day not over yet counts only once done).
create or replace function public.ckb_hk_compliance(p_customer uuid, p_from date, p_to date)
returns table (area_id uuid, area_code text, area_name text, expected int, done int, late int)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_customer is null then
    if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Customer tidak ditemukan'; end if;
  elsif not public.ckb_can_see_customer(p_customer) then raise exception 'Customer tidak ditemukan';
  end if;
  return query select g.area_id, g.area_code, g.area_name,
                      (count(*) filter (where g.state in ('DONE', 'MISSED')))::int,
                      (count(*) filter (where g.state = 'DONE'))::int,
                      (count(*) filter (where g.state = 'DONE' and g.late))::int
               from public.ckb_hk_grid_core(p_customer, p_from, p_to) g group by g.area_id, g.area_code, g.area_name order by g.area_code;
end $$;

-- A customer's photos of one day of one area: only a done (submitted, not rejected) check-in; no names.
create or replace function public.ckb_hk_customer_day(p_area uuid, p_day date)
returns table (checkin_id uuid, late boolean, on_behalf boolean, photo_id uuid, kind text, uploaded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_customer uuid;
begin
  select a.customer_id into v_customer from public.ckb_hk_areas a where a.id = p_area;
  if v_customer is null or not public.ckb_can_see_customer(v_customer) then raise exception 'Area tidak ditemukan'; end if;
  return query select k.id, k.late, k.on_behalf_by is not null, p.id, p.kind, p.uploaded_at
               from (select * from public.ckb_hk_checkins y where y.area_id = p_area and y.work_date = p_day order by y.attempt desc limit 1) k
               join public.ckb_hk_photos p on p.checkin_id = k.id
               where k.status in ('SUBMITTED', 'ACCEPTED') order by p.kind, p.uploaded_at;
end $$;

-- The download gate for a photo: leads any, a PIC their own, a customer only a done check-in of their customer. Logs the view.
create or replace function public.ckb_hk_photo_open(p_id uuid) returns table (storage_path text, mime text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare p public.ckb_hk_photos%rowtype; c public.ckb_hk_checkins%rowtype; v_ok boolean := false;
begin
  select * into p from public.ckb_hk_photos where id = p_id;
  if p.id is null then raise exception 'Foto tidak ditemukan'; end if;
  select * into c from public.ckb_hk_checkins where id = p.checkin_id;
  if public.ckb_has_role(array['admin', 'supervisor']) then v_ok := true;
  elsif public.ckb_has_role(array['operator']) then v_ok := auth.uid() in (c.pic_user_id, c.acted_by);
  elsif public.ckb_has_role(array['customer']) then v_ok := c.status in ('SUBMITTED', 'ACCEPTED') and public.ckb_can_see_customer(p.customer_id);
  end if;
  if not v_ok then raise exception 'Foto tidak ditemukan'; end if;
  perform public.ckb_audit('HK_PHOTO_VIEW', 'housekeeping_checkin', c.id::text, p.customer_id, jsonb_build_object('photo_id', p.id));
  return query select p.storage_path, p.mime;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.ckb_hk_late_rank(date, date), public.ckb_hk_setting(text, numeric),
  public.ckb_hk_start(uuid, date, text), public.ckb_hk_register_photo(uuid, text, text, text, bigint, text), public.ckb_hk_submit(uuid),
  public.ckb_hk_review(uuid, boolean, text), public.ckb_hk_grid_core(uuid, date, date), public.ckb_hk_recap(date, date, uuid),
  public.ckb_hk_my_days(date, date), public.ckb_hk_customer_week(uuid, date, date), public.ckb_hk_compliance(uuid, date, date),
  public.ckb_hk_customer_day(uuid, date), public.ckb_hk_photo_open(uuid) from public, anon;
grant execute on function public.ckb_hk_start(uuid, date, text), public.ckb_hk_register_photo(uuid, text, text, text, bigint, text),
  public.ckb_hk_submit(uuid), public.ckb_hk_review(uuid, boolean, text), public.ckb_hk_recap(date, date, uuid),
  public.ckb_hk_my_days(date, date), public.ckb_hk_customer_week(uuid, date, date), public.ckb_hk_compliance(uuid, date, date),
  public.ckb_hk_customer_day(uuid, date), public.ckb_hk_photo_open(uuid) to authenticated;
-- ckb_hk_late_rank, ckb_hk_setting and ckb_hk_grid_core stay internal: the grid carries names.
