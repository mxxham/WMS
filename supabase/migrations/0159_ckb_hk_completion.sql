-- =====================================================================
-- 0159  CKB housekeeping: finishing phase 1
--
-- Spec: docs/superpowers/specs/2026-11-24-ckb-housekeeping-design.md
--
--   * a wrong photo can be removed while the check-in is STARTED (ckb_hk_withdraw_photo): the row and the
--     file stay for the record, but it no longer counts, no customer sees it, and its file may be used again
--     (the unique SHA-256 now covers live photos only);
--   * a STARTED check-in nobody finishes can be abandoned (CANCELLED) by its owner or a lead, and the day can then be
--     done again as the next attempt; nobody resumes someone else's check-in any more;
--   * a day never submitted can be EXCUSED by a lead (sick, rack empty, closed): it is not expected, like leave, and
--     customers see it as "not scheduled", never the reason;
--   * ckb_hk_start takes an advisory lock per area and day; ckb_hk_grid_core refuses a range over 93 days;
--   * only a customer's view of a photo is audited;
--   * name-free ckb_hk_report, a role-aware ckb_hk_dashboard and a light ckb_hk_badge for the sidebar;
--   * ckb_hk_checkins joins the realtime publication.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1  Schema and guards
-- ---------------------------------------------------------------------
alter table public.ckb_hk_checkins drop constraint ckb_hk_checkins_status_check;
alter table public.ckb_hk_checkins add constraint ckb_hk_checkins_status_check
  check (status in ('STARTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXCUSED'));
alter table public.ckb_hk_checkins
  add column cancelled_by uuid references public.profiles(id), add column cancelled_name text, add column cancelled_at timestamptz, add column cancel_reason text,
  add column excused_by uuid references public.profiles(id), add column excused_name text, add column excused_at timestamptz, add column excuse_reason text;

create or replace function public.ckb_hk_checkins_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Check-in housekeeping tidak bisa dihapus'; end if;
  if (new.area_id, new.customer_id, new.work_date, new.attempt, new.pic_user_id, new.pic_name, new.acted_by, new.started_at, new.late,
      new.on_behalf_by, new.on_behalf_name, new.on_behalf_reason, new.excused_by, new.excused_name, new.excused_at, new.excuse_reason)
     is distinct from
     (old.area_id, old.customer_id, old.work_date, old.attempt, old.pic_user_id, old.pic_name, old.acted_by, old.started_at, old.late,
      old.on_behalf_by, old.on_behalf_name, old.on_behalf_reason, old.excused_by, old.excused_name, old.excused_at, old.excuse_reason) then
    raise exception 'Data check-in tidak bisa diubah';
  end if;
  if new.status = old.status then
    if (new.submitted_at, new.reviewed_by, new.reviewed_at, new.review_note, new.cancelled_by, new.cancelled_name, new.cancelled_at, new.cancel_reason)
       is distinct from
       (old.submitted_at, old.reviewed_by, old.reviewed_at, old.review_note, old.cancelled_by, old.cancelled_name, old.cancelled_at, old.cancel_reason) then
      raise exception 'Check-in tidak bisa diubah';
    end if;
  elsif not ((old.status = 'STARTED' and new.status in ('SUBMITTED', 'CANCELLED'))
          or (old.status = 'SUBMITTED' and new.status in ('ACCEPTED', 'REJECTED'))
          or (old.status = 'EXCUSED' and new.status = 'CANCELLED')) then
    raise exception 'Status check-in tidak bisa berubah dari % ke %', old.status, new.status;
  elsif new.status <> 'CANCELLED' and (new.cancelled_by, new.cancelled_name, new.cancelled_at, new.cancel_reason) is distinct from
        (old.cancelled_by, old.cancelled_name, old.cancelled_at, old.cancel_reason) then
    raise exception 'Check-in tidak bisa diubah';
  end if;
  return new;
end $$;

alter table public.ckb_hk_photos add column withdrawn_at timestamptz, add column withdrawn_by uuid references public.profiles(id), add column withdrawn_reason text;
alter table public.ckb_hk_photos drop constraint ckb_hk_photos_sha_key;
create unique index ckb_hk_photos_sha_live on public.ckb_hk_photos (sha256) where withdrawn_at is null;

create or replace function public.ckb_hk_photos_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Foto housekeeping tidak bisa dihapus'; end if;
  if (new.checkin_id, new.customer_id, new.kind, new.storage_path, new.mime, new.size_bytes, new.sha256, new.uploaded_by, new.uploaded_at, new.retain_until)
     is distinct from
     (old.checkin_id, old.customer_id, old.kind, old.storage_path, old.mime, old.size_bytes, old.sha256, old.uploaded_by, old.uploaded_at, old.retain_until) then
    raise exception 'Data foto tidak bisa diubah';
  end if;
  -- Withdrawing is allowed once, from "not withdrawn", and never undone.
  if old.withdrawn_at is not null and (new.withdrawn_at, new.withdrawn_by, new.withdrawn_reason) is distinct from (old.withdrawn_at, old.withdrawn_by, old.withdrawn_reason) then
    raise exception 'Foto yang sudah ditarik tidak bisa diubah';
  end if;
  if old.withdrawn_at is null and new.withdrawn_at is not null and (new.withdrawn_by is null or new.withdrawn_reason is null) then
    raise exception 'Penarikan foto butuh pelaku dan alasan';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2  Functions that change (0158's, with only the edits listed in the header)
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

  -- Two people opening the same day at once: one waits for the other instead of hitting the unique key.
  perform pg_advisory_xact_lock(hashtextextended(p_area::text || '|' || v_day::text, 0));
  select * into v_last from public.ckb_hk_checkins where area_id = p_area and work_date = v_day order by attempt desc limit 1;
  if v_last.id is not null then
    if v_last.status = 'STARTED' then
      -- Nobody resumes someone else's check-in (not even a lead: the photos are theirs): abandon it, then record on behalf.
      if v_last.acted_by <> v_actor then raise exception 'Check-in tanggal % sedang dikerjakan orang lain: batalkan dulu bila macet', v_day; end if;
      return jsonb_build_object('id', v_last.id, 'attempt', v_last.attempt, 'late', v_last.late, 'on_behalf', v_last.on_behalf_by is not null, 'resumed', true);
    elsif v_last.status in ('SUBMITTED', 'ACCEPTED') then
      raise exception 'Housekeeping % tanggal % sudah selesai', a.code, v_day;
    elsif v_last.status = 'EXCUSED' then
      raise exception 'Hari % dibebaskan: batalkan pembebasannya dulu', v_day;
    end if;
    v_attempt := v_last.attempt + 1;   -- the last one was rejected or cancelled
  end if;

  begin
    insert into public.ckb_hk_checkins (area_id, customer_id, work_date, attempt, pic_user_id, pic_name, acted_by, late,
                                         on_behalf_by, on_behalf_name, on_behalf_reason)
    values (p_area, a.customer_id, v_day, v_attempt, v_pic, v_pic_name, v_actor, v_late,
            case when v_behalf then v_actor end, case when v_behalf then v_actor_name end, case when v_behalf then trim(p_reason) end)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Housekeeping % tanggal % baru saja dibuka orang lain: muat ulang halaman', a.code, v_day;
  end;
  perform public.ckb_audit('HK_START', 'housekeeping_checkin', v_id::text, a.customer_id,
    jsonb_build_object('area', a.code, 'day', v_day, 'attempt', v_attempt, 'late', v_late, 'on_behalf', v_behalf));
  return jsonb_build_object('id', v_id, 'attempt', v_attempt, 'late', v_late, 'on_behalf', v_behalf, 'resumed', false);
end $$;

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
  select count(*) into v_n from public.ckb_hk_photos where checkin_id = p_checkin and kind = p_kind and withdrawn_at is null;
  if v_n >= v_max then raise exception 'Maksimal % foto % per check-in', v_max, case p_kind when 'BEFORE' then 'sebelum' else 'sesudah' end; end if;
  if p_kind = 'AFTER' then
    select min(uploaded_at) into v_first from public.ckb_hk_photos where checkin_id = p_checkin and kind = 'BEFORE' and withdrawn_at is null;
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

create or replace function public.ckb_hk_submit(p_checkin uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.ckb_hk_checkins%rowtype;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  select * into c from public.ckb_hk_checkins where id = p_checkin for update;
  if c.id is null then raise exception 'Check-in tidak ditemukan'; end if;
  if c.acted_by <> auth.uid() then raise exception 'Check-in ini bukan milik Anda'; end if;
  if c.status <> 'STARTED' then raise exception 'Check-in ini sudah dikirim'; end if;
  if not exists (select 1 from public.ckb_hk_photos where checkin_id = p_checkin and kind = 'BEFORE' and withdrawn_at is null) then raise exception 'Foto sebelum belum ada'; end if;
  if not exists (select 1 from public.ckb_hk_photos where checkin_id = p_checkin and kind = 'AFTER' and withdrawn_at is null) then raise exception 'Foto sesudah belum ada'; end if;
  update public.ckb_hk_checkins set status = 'SUBMITTED', submitted_at = now() where id = p_checkin;
  perform public.ckb_audit('HK_SUBMIT', 'housekeeping_checkin', p_checkin::text, c.customer_id,
    jsonb_build_object('day', c.work_date, 'attempt', c.attempt, 'late', c.late));
end $$;

create or replace function public.ckb_hk_grid_core(p_customer uuid, p_from date, p_to date)
returns table (area_id uuid, area_code text, area_name text, customer_id uuid, day date, state text, late boolean, on_behalf boolean,
               checkin_id uuid, attempt int, pic_user_id uuid, pic_name text, review_note text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > 92 then raise exception 'Rentang tanggal maksimal 93 hari'; end if;
  return query
  with t as (select public.ckb_hk_today() as today),
  days as (select g::date as day from generate_series(p_from, p_to, interval '1 day') g where extract(isodow from g) between 1 and 5),
  areas as (select a.id, a.code, a.name, a.customer_id from public.ckb_hk_areas a where a.active and (p_customer is null or a.customer_id = p_customer)),
  cells as (select a.id as area_id, a.code, a.name, a.customer_id, d.day from areas a cross join days d)
  select c.area_id, c.code, c.name, c.customer_id, c.day,
         case
           when exists (select 1 from public.ckb_hk_holidays h where h.holiday_date = c.day) then 'HOLIDAY'
           when s.pic_user_id is null then 'NA'
           when exists (select 1 from public.ckb_hk_absences x where x.user_id = s.pic_user_id and c.day between x.from_date and x.to_date) then 'LEAVE'
           when k.status = 'EXCUSED' then 'EXCUSED'
           when k.status in ('SUBMITTED', 'ACCEPTED') then 'DONE'
           when c.day > t.today then 'FUTURE'
           when c.day = t.today then case when k.status = 'STARTED' then 'STARTED' when k.status = 'REJECTED' then 'REJECTED' else 'PENDING' end
           else 'MISSED'
         end,
         coalesce(k.late, false), k.on_behalf_by is not null, k.id, k.attempt, s.pic_user_id, s.pic_name, k.review_note
  from cells c cross join t
  left join lateral (select x.pic_user_id, x.pic_name from public.ckb_hk_assignments x
                      where x.area_id = c.area_id and x.from_date <= c.day and (x.to_date is null or x.to_date >= c.day) limit 1) s on true
  left join lateral (select * from public.ckb_hk_checkins y where y.area_id = c.area_id and y.work_date = c.day order by y.attempt desc limit 1) k on true;
end $$;

create or replace function public.ckb_hk_my_days(p_from date, p_to date)
returns table (area_id uuid, area_code text, area_name text, customer_code text, day date, state text, late boolean,
               checkin_id uuid, attempt int, before_count int, after_count int, review_note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  return query select g.area_id, g.area_code, g.area_name, (select c.code from public.ckb_customers c where c.id = g.customer_id), g.day, g.state,
                      g.late, g.checkin_id, g.attempt,
                      (select count(*)::int from public.ckb_hk_photos p where p.checkin_id = g.checkin_id and p.kind = 'BEFORE' and p.withdrawn_at is null),
                      (select count(*)::int from public.ckb_hk_photos p where p.checkin_id = g.checkin_id and p.kind = 'AFTER' and p.withdrawn_at is null),
                      case when g.state in ('REJECTED', 'MISSED') then g.review_note end
               from public.ckb_hk_grid_core(null, p_from, p_to) g
               where g.pic_user_id = auth.uid() order by g.area_code, g.day;
end $$;

create or replace function public.ckb_hk_customer_week(p_customer uuid, p_from date, p_to date)
returns table (area_id uuid, area_code text, area_name text, day date, state text, late boolean, on_behalf boolean, checkin_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_customer is null or not public.ckb_can_see_customer(p_customer) then raise exception 'Customer tidak ditemukan'; end if;
  return query select g.area_id, g.area_code, g.area_name, g.day,
                      case g.state when 'LEAVE' then 'NA' when 'EXCUSED' then 'NA' when 'STARTED' then 'PENDING' when 'REJECTED' then 'PENDING' else g.state end,
                      g.late, g.on_behalf, case when g.state = 'DONE' then g.checkin_id end
               from public.ckb_hk_grid_core(p_customer, p_from, p_to) g order by g.area_code, g.day;
end $$;

create or replace function public.ckb_hk_customer_day(p_area uuid, p_day date)
returns table (checkin_id uuid, late boolean, on_behalf boolean, photo_id uuid, kind text, uploaded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_customer uuid;
begin
  select a.customer_id into v_customer from public.ckb_hk_areas a where a.id = p_area;
  if v_customer is null or not public.ckb_can_see_customer(v_customer) then raise exception 'Area tidak ditemukan'; end if;
  return query select k.id, k.late, k.on_behalf_by is not null, p.id, p.kind, p.uploaded_at
               from (select * from public.ckb_hk_checkins y where y.area_id = p_area and y.work_date = p_day order by y.attempt desc limit 1) k
               join public.ckb_hk_photos p on p.checkin_id = k.id and p.withdrawn_at is null
               where k.status in ('SUBMITTED', 'ACCEPTED') order by p.kind, p.uploaded_at;
end $$;

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
  elsif public.ckb_has_role(array['customer']) then v_ok := p.withdrawn_at is null and c.status in ('SUBMITTED', 'ACCEPTED') and public.ckb_can_see_customer(p.customer_id);
  end if;
  if not v_ok then raise exception 'Foto tidak ditemukan'; end if;
  -- Staff can already read these tables, so only a customer's view is worth a log line (a queue of 100 days would otherwise write hundreds).
  if public.ckb_has_role(array['customer']) then
    perform public.ckb_audit('HK_PHOTO_VIEW', 'housekeeping_checkin', c.id::text, p.customer_id, jsonb_build_object('photo_id', p.id));
  end if;
  return query select p.storage_path, p.mime;
end $$;

-- ---------------------------------------------------------------------
-- 3  New functions
-- ---------------------------------------------------------------------
-- A wrong photo: only while the check-in is STARTED, by its owner or a lead.
create or replace function public.ckb_hk_withdraw_photo(p_photo uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.ckb_hk_photos%rowtype; c public.ckb_hk_checkins%rowtype; v_reason text := coalesce(nullif(trim(p_reason), ''), 'foto salah');
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  select * into p from public.ckb_hk_photos where id = p_photo for update;
  if p.id is null then raise exception 'Foto tidak ditemukan'; end if;
  select * into c from public.ckb_hk_checkins where id = p.checkin_id for update;
  if c.acted_by <> auth.uid() and not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Foto ini bukan milik Anda'; end if;
  if c.status <> 'STARTED' then raise exception 'Foto hanya bisa ditarik sebelum check-in dikirim'; end if;
  if p.withdrawn_at is not null then raise exception 'Foto ini sudah ditarik'; end if;
  update public.ckb_hk_photos set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_reason = v_reason where id = p_photo;
  perform public.ckb_audit('HK_PHOTO_WITHDRAW', 'housekeeping_checkin', c.id::text, c.customer_id, jsonb_build_object('photo_id', p_photo, 'kind', p.kind, 'reason', v_reason));
end $$;

-- A STARTED check-in nobody will finish: its owner or a lead cancels it; the day can then be done again (next attempt).
create or replace function public.ckb_hk_abandon(p_checkin uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.ckb_hk_checkins%rowtype;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into c from public.ckb_hk_checkins where id = p_checkin for update;
  if c.id is null then raise exception 'Check-in tidak ditemukan'; end if;
  if c.acted_by <> auth.uid() and not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Check-in ini bukan milik Anda'; end if;
  if c.status <> 'STARTED' then raise exception 'Hanya check-in yang belum dikirim yang bisa dibatalkan'; end if;
  update public.ckb_hk_checkins set status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_name = public.ckb_actor_name(),
    cancelled_at = now(), cancel_reason = trim(p_reason) where id = p_checkin;
  perform public.ckb_audit('HK_ABANDON', 'housekeeping_checkin', p_checkin::text, c.customer_id,
    jsonb_build_object('day', c.work_date, 'attempt', c.attempt, 'reason', trim(p_reason)));
end $$;

-- A day that cannot or need not be done (sick, rack empty, closed): a lead excuses it. It is not expected, like leave.
create or replace function public.ckb_hk_excuse(p_area uuid, p_day date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.ckb_hk_areas%rowtype; v_pic uuid; v_pic_name text; v_last public.ckb_hk_checkins%rowtype; v_id uuid;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin yang bisa membebaskan hari'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into a from public.ckb_hk_areas where id = p_area;
  if a.id is null or not a.active then raise exception 'Area tidak ditemukan atau tidak aktif'; end if;
  if a.customer_id is null then raise exception 'Area % belum punya customer', a.code; end if;
  if p_day is null or p_day > public.ckb_hk_today() then raise exception 'Hanya hari yang sudah tiba yang bisa dibebaskan'; end if;
  if not public.ckb_hk_is_workday(p_day) then raise exception '% bukan hari kerja', p_day; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_area::text || '|' || p_day::text, 0));
  select s.pic_user_id, s.pic_name into v_pic, v_pic_name from public.ckb_hk_assignments s
   where s.area_id = p_area and s.from_date <= p_day and (s.to_date is null or s.to_date >= p_day) limit 1;
  if v_pic is null then raise exception 'Area % belum punya PIC pada %: tidak ada yang perlu dibebaskan', a.code, p_day; end if;
  select * into v_last from public.ckb_hk_checkins where area_id = p_area and work_date = p_day order by attempt desc limit 1;
  if v_last.id is not null and v_last.status in ('SUBMITTED', 'ACCEPTED') then raise exception 'Hari ini sudah selesai: tidak perlu dibebaskan'; end if;
  if v_last.id is not null and v_last.status = 'STARTED' then raise exception 'Ada check-in yang belum dikirim: batalkan dulu'; end if;
  if v_last.id is not null and v_last.status = 'EXCUSED' then raise exception 'Hari ini sudah dibebaskan'; end if;
  insert into public.ckb_hk_checkins (area_id, customer_id, work_date, attempt, status, pic_user_id, pic_name, acted_by, excused_by, excused_name, excused_at, excuse_reason)
  values (p_area, a.customer_id, p_day, coalesce(v_last.attempt, 0) + 1, 'EXCUSED', v_pic, v_pic_name, auth.uid(), auth.uid(), public.ckb_actor_name(), now(), trim(p_reason))
  returning id into v_id;
  perform public.ckb_audit('HK_EXCUSE', 'housekeeping_checkin', v_id::text, a.customer_id, jsonb_build_object('area', a.code, 'day', p_day, 'reason', trim(p_reason)));
  return v_id;
end $$;

create or replace function public.ckb_hk_revoke_excuse(p_checkin uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.ckb_hk_checkins%rowtype;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into c from public.ckb_hk_checkins where id = p_checkin for update;
  if c.id is null or c.status <> 'EXCUSED' then raise exception 'Hanya hari yang dibebaskan yang bisa dibatalkan pembebasannya'; end if;
  update public.ckb_hk_checkins set status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_name = public.ckb_actor_name(), cancelled_at = now(),
    cancel_reason = trim(p_reason) where id = p_checkin;
  perform public.ckb_audit('HK_EXCUSE_REVOKE', 'housekeeping_checkin', p_checkin::text, c.customer_id, jsonb_build_object('day', c.work_date, 'reason', trim(p_reason)));
end $$;

-- The report a customer is handed (and a lead can run): one row per area and day, no person, no note, no reason.
create or replace function public.ckb_hk_report(p_customer uuid, p_from date, p_to date)
returns table (area_code text, area_name text, day date, state text, late boolean, on_behalf boolean, before_count int, after_count int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_customer is null then
    if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Customer tidak ditemukan'; end if;
  elsif not public.ckb_can_see_customer(p_customer) then raise exception 'Customer tidak ditemukan';
  end if;
  return query
    select g.area_code, g.area_name, g.day,
           case g.state when 'LEAVE' then 'NA' when 'EXCUSED' then 'NA' when 'STARTED' then 'PENDING' when 'REJECTED' then 'PENDING' else g.state end,
           g.late, g.on_behalf,
           case when g.state = 'DONE' then (select count(*)::int from public.ckb_hk_photos p where p.checkin_id = g.checkin_id and p.kind = 'BEFORE' and p.withdrawn_at is null) else 0 end,
           case when g.state = 'DONE' then (select count(*)::int from public.ckb_hk_photos p where p.checkin_id = g.checkin_id and p.kind = 'AFTER' and p.withdrawn_at is null) else 0 end
    from public.ckb_hk_grid_core(p_customer, p_from, p_to) g
    order by g.area_code, g.day;
end $$;

-- Dashboard numbers, by role. A lead: the whole day and the last working day; a PIC: their own racks; a customer: their racks.
create or replace function public.ckb_hk_dashboard(p_customer uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.ckb_hk_today(); v_last date; r jsonb;
begin
  if public.ckb_role() is null then raise exception 'Akses ditolak'; end if;
  select max(g::date) into v_last from generate_series(v_today - 10, v_today - 1, interval '1 day') g where public.ckb_hk_is_workday(g::date);
  if public.ckb_has_role(array['admin', 'supervisor']) then
    select jsonb_build_object(
      'areas', (select count(*) from public.ckb_hk_areas a where a.active and (p_customer is null or a.customer_id = p_customer)),
      'without_pic', (select count(*) from public.ckb_hk_areas a where a.active and (p_customer is null or a.customer_id = p_customer)
                       and not exists (select 1 from public.ckb_hk_assignments s where s.area_id = a.id and s.to_date is null)),
      'expected_today', count(*) filter (where g.day = v_today and g.state in ('DONE', 'STARTED', 'PENDING', 'REJECTED')),
      'done_today', count(*) filter (where g.day = v_today and g.state = 'DONE'),
      'started_today', count(*) filter (where g.day = v_today and g.state = 'STARTED'),
      'missed_last', count(*) filter (where g.day = v_last and g.state = 'MISSED'),
      'missed_week', count(*) filter (where g.day >= v_today - 6 and g.state = 'MISSED'),
      'late_week', count(*) filter (where g.day >= v_today - 6 and g.state = 'DONE' and g.late),
      'awaiting_review', (select count(*) from public.ckb_hk_checkins k where k.status = 'SUBMITTED'
                           and (p_customer is null or k.customer_id = p_customer))) into r
    from public.ckb_hk_grid_core(p_customer, v_today - 6, v_today) g;
  elsif public.ckb_has_role(array['operator']) then
    select jsonb_build_object(
      'mine_today', count(*) filter (where g.day = v_today and g.state in ('DONE', 'STARTED', 'PENDING', 'REJECTED')),
      'done_today', count(*) filter (where g.day = v_today and g.state = 'DONE'),
      'missed_week', count(*) filter (where g.day >= v_today - 6 and g.state = 'MISSED')) into r
    from public.ckb_hk_grid_core(null, v_today - 6, v_today) g where g.pic_user_id = auth.uid();
  else
    if p_customer is null or not public.ckb_can_see_customer(p_customer) then raise exception 'Customer tidak ditemukan'; end if;
    select jsonb_build_object(
      'areas', (select count(*) from public.ckb_hk_areas a where a.active and a.customer_id = p_customer),
      'expected_today', count(*) filter (where g.day = v_today and g.state in ('DONE', 'STARTED', 'PENDING', 'REJECTED')),
      'done_today', count(*) filter (where g.day = v_today and g.state = 'DONE'),
      'missed_week', count(*) filter (where g.day >= v_today - 6 and g.state = 'MISSED')) into r
    from public.ckb_hk_grid_core(p_customer, v_today - 6, v_today) g;
  end if;
  return coalesce(r, '{}'::jsonb);
end $$;

-- The sidebar badge: a lead sees what waits for review, a PIC how many racks are not done today. No grid, two cheap queries.
create or replace function public.ckb_hk_badge() returns int
language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.ckb_hk_today();
begin
  if public.ckb_has_role(array['admin', 'supervisor']) then
    return (select count(*)::int from public.ckb_hk_checkins where status = 'SUBMITTED');
  elsif public.ckb_has_role(array['operator']) and public.ckb_hk_is_workday(v_today) then
    return (select count(*)::int
            from public.ckb_hk_assignments s join public.ckb_hk_areas a on a.id = s.area_id and a.active and a.customer_id is not null
            where s.pic_user_id = auth.uid() and s.from_date <= v_today and (s.to_date is null or s.to_date >= v_today)
              and not exists (select 1 from public.ckb_hk_absences x where x.user_id = s.pic_user_id and v_today between x.from_date and x.to_date)
              and not exists (select 1 from public.ckb_hk_checkins k where k.area_id = a.id and k.work_date = v_today and k.status in ('SUBMITTED', 'ACCEPTED', 'EXCUSED')));
  end if;
  return 0;
end $$;

-- The check-in list refreshes live (same guard as 0015 and 0155).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ckb_hk_checkins') then
    execute 'alter publication supabase_realtime add table public.ckb_hk_checkins';
  end if;
end $$;

revoke execute on function public.ckb_hk_withdraw_photo(uuid, text), public.ckb_hk_abandon(uuid, text), public.ckb_hk_excuse(uuid, date, text),
  public.ckb_hk_revoke_excuse(uuid, text), public.ckb_hk_report(uuid, date, date), public.ckb_hk_dashboard(uuid), public.ckb_hk_badge() from public, anon;
grant execute on function public.ckb_hk_withdraw_photo(uuid, text), public.ckb_hk_abandon(uuid, text), public.ckb_hk_excuse(uuid, date, text),
  public.ckb_hk_revoke_excuse(uuid, text), public.ckb_hk_report(uuid, date, date), public.ckb_hk_dashboard(uuid), public.ckb_hk_badge() to authenticated;
