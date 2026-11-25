-- =====================================================================
-- 0160  CKB housekeeping, phase 2: weekly quality
--
-- Spec: docs/superpowers/specs/2026-11-24-ckb-housekeeping-design.md (section 6.2)
--
--   * one shared checklist (admin edits it; a retired item stays on old scores);
--   * a supervisor or admin scores a rack for a week from its photos: every active item is Baik / Perlu perbaikan / Buruk,
--     the week's score is a percentage; a re-score is a new version, nothing is edited (append-only);
--   * a finding points at one photo of a done check-in; the rack's PIC marks it fixed, a DIFFERENT supervisor or admin
--     (not who raised it, not who fixed it) verifies, or sends it back; cancelling is a lead's call with a reason;
--   * customers read only ckb_hk_customer_quality and ckb_hk_customer_findings: pct, item, description, status, dates,
--     photo ids. No person, no fix note, no verification note, no cancelled finding;
--   * dashboard and sidebar badge count findings; the tables join the realtime publication.
-- =====================================================================

create or replace function public.ckb_hk_append_only() returns trigger
language plpgsql as $$
begin raise exception 'Data ini hanya bisa ditambah, tidak diubah atau dihapus'; end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.ckb_hk_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  label      text not null check (length(trim(label)) between 3 and 80),
  sort       int not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
insert into public.ckb_hk_checklist_items (label, sort) values
  ('Lantai bersih dan bebas sampah', 10), ('Palet rapi dan lurus', 20), ('Label dan kode rak terlihat jelas', 30),
  ('Tidak ada karton lepas atau rusak di lantai', 40), ('Lorong bebas hambatan', 50), ('Barang tersusun di dalam batas rak', 60);

create table public.ckb_hk_scores (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.ckb_hk_areas(id),
  customer_id uuid not null references public.ckb_customers(id),
  week_start  date not null check (extract(isodow from week_start) = 1),
  version     int not null default 1 check (version >= 1),
  pct         int not null check (pct between 0 and 100),
  note        text,
  scored_by   uuid not null references public.profiles(id),
  scored_name text not null,
  scored_at   timestamptz not null default now(),
  unique (area_id, week_start, version)
);
create index ckb_hk_scores_week_idx on public.ckb_hk_scores (customer_id, week_start);

create table public.ckb_hk_score_lines (
  score_id   uuid not null references public.ckb_hk_scores(id),
  item_id    uuid not null references public.ckb_hk_checklist_items(id),
  item_label text not null,   -- the wording at scoring time: a later edit never rewrites an old score
  rating     text not null check (rating in ('GOOD', 'FAIR', 'POOR')),
  primary key (score_id, item_id)
);

create table public.ckb_hk_findings (
  id                uuid primary key default gen_random_uuid(),
  area_id           uuid not null references public.ckb_hk_areas(id),
  customer_id       uuid not null references public.ckb_customers(id),
  score_id          uuid references public.ckb_hk_scores(id),
  item_label        text not null check (length(trim(item_label)) >= 3),
  description       text not null check (length(trim(description)) >= 3),
  evidence_photo_id uuid not null references public.ckb_hk_photos(id),
  due_date          date,
  status            text not null default 'OPEN' check (status in ('OPEN', 'FIXED', 'VERIFIED', 'CANCELLED')),
  raised_by         uuid not null references public.profiles(id),
  raised_name       text not null,
  raised_at         timestamptz not null default now(),
  fixed_by          uuid references public.profiles(id),
  fixed_name        text,
  fixed_at          timestamptz,
  fix_note          text,
  fix_photo_id      uuid references public.ckb_hk_photos(id),
  verified_by       uuid references public.profiles(id),
  verified_name     text,
  verified_at       timestamptz,
  verify_note       text,
  reopen_count      int not null default 0,
  reopen_note       text,
  cancelled_by      uuid references public.profiles(id),
  cancelled_name    text,
  cancelled_at      timestamptz,
  cancel_reason     text
);
create index ckb_hk_findings_status_idx on public.ckb_hk_findings (status, customer_id);
create index ckb_hk_findings_area_idx on public.ckb_hk_findings (area_id, status);

-- Append-only: checklist items change only through ckb_hk_checklist_save (no write policy); scores and lines are never changed.
create trigger ckb_hk_scores_append_only before update or delete on public.ckb_hk_scores for each row execute function public.ckb_hk_append_only();
create trigger ckb_hk_scores_no_truncate before truncate on public.ckb_hk_scores for each statement execute function public.ckb_forbid_change();
create trigger ckb_hk_score_lines_append_only before update or delete on public.ckb_hk_score_lines for each row execute function public.ckb_hk_append_only();
create trigger ckb_hk_score_lines_no_truncate before truncate on public.ckb_hk_score_lines for each statement execute function public.ckb_forbid_change();
create trigger ckb_hk_checklist_no_delete before delete on public.ckb_hk_checklist_items for each row execute function public.ckb_hk_append_only();
create trigger ckb_hk_checklist_no_truncate before truncate on public.ckb_hk_checklist_items for each statement execute function public.ckb_forbid_change();

-- A finding moves OPEN -> FIXED -> VERIFIED, FIXED -> OPEN (sent back), OPEN or FIXED -> CANCELLED; its description and evidence never change.
create or replace function public.ckb_hk_findings_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Temuan tidak bisa dihapus'; end if;
  if (new.area_id, new.customer_id, new.score_id, new.item_label, new.description, new.evidence_photo_id, new.due_date, new.raised_by, new.raised_name, new.raised_at)
     is distinct from
     (old.area_id, old.customer_id, old.score_id, old.item_label, old.description, old.evidence_photo_id, old.due_date, old.raised_by, old.raised_name, old.raised_at) then
    raise exception 'Data temuan tidak bisa diubah';
  end if;
  if new.status = old.status then raise exception 'Temuan tidak bisa diubah tanpa mengubah statusnya'; end if;
  if not ((old.status = 'OPEN' and new.status in ('FIXED', 'CANCELLED'))
       or (old.status = 'FIXED' and new.status in ('VERIFIED', 'OPEN', 'CANCELLED'))) then
    raise exception 'Status temuan tidak bisa berubah dari % ke %', old.status, new.status;
  end if;
  if old.status = 'OPEN' and new.status = 'FIXED' and (new.verified_by is not null or new.cancelled_by is not null) then raise exception 'Temuan tidak bisa diubah'; end if;
  if new.status = 'VERIFIED' and (new.fixed_by is null or new.verified_by is null) then raise exception 'Verifikasi butuh pelaku dan perbaikan'; end if;
  if new.status = 'CANCELLED' and (new.cancelled_by is null or new.cancel_reason is null) then raise exception 'Pembatalan butuh pelaku dan alasan'; end if;
  return new;
end $$;
create trigger ckb_hk_findings_guard before update or delete on public.ckb_hk_findings for each row execute function public.ckb_hk_findings_guard();
create trigger ckb_hk_findings_no_truncate before truncate on public.ckb_hk_findings for each statement execute function public.ckb_forbid_change();

-- Is the signed-in person the open PIC of this area today?
create or replace function public.ckb_hk_is_my_area(p_area uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ckb_hk_assignments s
                  where s.area_id = p_area and s.pic_user_id = auth.uid() and s.from_date <= public.ckb_hk_today()
                    and (s.to_date is null or s.to_date >= public.ckb_hk_today()))
$$;

-- RLS: leads read everything; a PIC reads the findings of the racks they hold; customers read nothing here.
alter table public.ckb_hk_checklist_items enable row level security;
alter table public.ckb_hk_scores enable row level security;
alter table public.ckb_hk_score_lines enable row level security;
alter table public.ckb_hk_findings enable row level security;
create policy "ckb: hk checklist read" on public.ckb_hk_checklist_items for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff());
create policy "ckb: hk scores read" on public.ckb_hk_scores for select to authenticated
  using ((select public.account_active()) and public.ckb_has_role(array['admin', 'supervisor']));
create policy "ckb: hk score lines read" on public.ckb_hk_score_lines for select to authenticated
  using ((select public.account_active()) and public.ckb_has_role(array['admin', 'supervisor']));
create policy "ckb: hk findings read" on public.ckb_hk_findings for select to authenticated
  using ((select public.account_active())
         and (public.ckb_has_role(array['admin', 'supervisor']) or (public.ckb_has_role(array['operator']) and public.ckb_hk_is_my_area(area_id))));
grant select on public.ckb_hk_checklist_items, public.ckb_hk_scores, public.ckb_hk_score_lines, public.ckb_hk_findings to authenticated;
grant all on public.ckb_hk_checklist_items, public.ckb_hk_scores, public.ckb_hk_score_lines, public.ckb_hk_findings to service_role;

-- ---------------------------------------------------------------------
-- The checklist (admin)
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_checklist_save(p_id uuid, p_label text, p_active boolean default true, p_sort int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin yang bisa mengubah checklist'; end if;
  if length(trim(coalesce(p_label, ''))) < 3 then raise exception 'Nama item minimal 3 huruf'; end if;
  if v_id is null then
    insert into public.ckb_hk_checklist_items (label, sort, active, created_by)
    values (trim(p_label), coalesce(p_sort, (select coalesce(max(sort), 0) + 10 from public.ckb_hk_checklist_items)), coalesce(p_active, true), auth.uid()) returning id into v_id;
  else
    update public.ckb_hk_checklist_items set label = trim(p_label), active = coalesce(p_active, active), sort = coalesce(p_sort, sort) where id = v_id;
    if not found then raise exception 'Item tidak ditemukan'; end if;
  end if;
  if not exists (select 1 from public.ckb_hk_checklist_items where active) then raise exception 'Minimal satu item harus aktif'; end if;
  perform public.ckb_audit('HK_CHECKLIST_SAVE', 'housekeeping_checklist', v_id::text, null, jsonb_build_object('label', trim(p_label), 'active', coalesce(p_active, true)));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Score a rack for a week (supervisor or admin), from its photos
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_score_week(p_area uuid, p_week date, p_ratings jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.ckb_hk_areas%rowtype; v_version int; v_id uuid; v_n int; v_points int; v_pct int;
  v_items uuid[]; v_given uuid[]; r jsonb; v_rating text; v_item uuid;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin yang bisa menilai'; end if;
  select * into a from public.ckb_hk_areas where id = p_area;
  if a.id is null or not a.active then raise exception 'Area tidak ditemukan atau tidak aktif'; end if;
  if a.customer_id is null then raise exception 'Area % belum punya customer', a.code; end if;
  if p_week is null or extract(isodow from p_week) <> 1 then raise exception 'Minggu harus dimulai hari Senin'; end if;
  if p_week > public.ckb_hk_today() then raise exception 'Minggu itu belum tiba'; end if;
  if jsonb_typeof(p_ratings) <> 'array' then raise exception 'Penilaian tidak valid'; end if;
  -- the person who holds the rack does not score it
  if exists (select 1 from public.ckb_hk_assignments s where s.area_id = p_area and s.pic_user_id = auth.uid()
               and s.from_date <= p_week + 4 and (s.to_date is null or s.to_date >= p_week)) then
    raise exception 'Anda adalah PIC rak ini pada minggu itu: penilaian dilakukan orang lain';
  end if;
  if not exists (select 1 from public.ckb_hk_checkins k where k.area_id = p_area and k.work_date between p_week and p_week + 4 and k.status in ('SUBMITTED', 'ACCEPTED')) then
    raise exception 'Tidak ada foto yang selesai pada minggu itu untuk dinilai';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('score|' || p_area::text || '|' || p_week::text, 0));
  select array_agg(id order by sort, id) into v_items from public.ckb_hk_checklist_items where active;
  v_n := coalesce(array_length(v_items, 1), 0);
  if v_n = 0 then raise exception 'Checklist belum punya item aktif'; end if;
  select array_agg((x->>'item_id')::uuid) into v_given from jsonb_array_elements(p_ratings) x;
  if coalesce(array_length(v_given, 1), 0) <> v_n or exists (select 1 from unnest(v_items) i where not i = any (v_given))
     or (select count(distinct g) from unnest(v_given) g) <> v_n then
    raise exception 'Setiap item aktif harus dinilai tepat sekali';
  end if;
  v_points := 0;
  for r in select * from jsonb_array_elements(p_ratings) loop
    v_rating := r->>'rating';
    if v_rating not in ('GOOD', 'FAIR', 'POOR') then raise exception 'Nilai harus Baik, Perlu perbaikan atau Buruk'; end if;
    v_points := v_points + case v_rating when 'GOOD' then 2 when 'FAIR' then 1 else 0 end;
  end loop;
  v_pct := round(100.0 * v_points / (2 * v_n));
  select coalesce(max(version), 0) + 1 into v_version from public.ckb_hk_scores where area_id = p_area and week_start = p_week;
  insert into public.ckb_hk_scores (area_id, customer_id, week_start, version, pct, note, scored_by, scored_name)
  values (p_area, a.customer_id, p_week, v_version, v_pct, nullif(trim(p_note), ''), auth.uid(), public.ckb_actor_name()) returning id into v_id;
  for r in select * from jsonb_array_elements(p_ratings) loop
    v_item := (r->>'item_id')::uuid;
    insert into public.ckb_hk_score_lines (score_id, item_id, item_label, rating)
    select v_id, i.id, i.label, r->>'rating' from public.ckb_hk_checklist_items i where i.id = v_item;
  end loop;
  perform public.ckb_audit('HK_SCORE', 'housekeeping_score', v_id::text, a.customer_id,
    jsonb_build_object('area', a.code, 'week', p_week, 'pct', v_pct, 'version', v_version));
  return jsonb_build_object('id', v_id, 'pct', v_pct, 'version', v_version);
end $$;

-- ---------------------------------------------------------------------
-- Findings
-- ---------------------------------------------------------------------
-- A photo may be used as evidence only when it is live and belongs to a done check-in of that area.
create or replace function public.ckb_hk_photo_usable(p_photo uuid, p_area uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ckb_hk_photos p join public.ckb_hk_checkins c on c.id = p.checkin_id
                  where p.id = p_photo and p.withdrawn_at is null and c.area_id = p_area and c.status in ('SUBMITTED', 'ACCEPTED'))
$$;

create or replace function public.ckb_hk_raise_finding(p_area uuid, p_item text, p_description text, p_photo uuid, p_due date default null, p_score uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.ckb_hk_areas%rowtype; v_id uuid;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin yang bisa membuat temuan'; end if;
  select * into a from public.ckb_hk_areas where id = p_area;
  if a.id is null or a.customer_id is null then raise exception 'Area tidak ditemukan atau belum punya customer'; end if;
  if length(trim(coalesce(p_item, ''))) < 3 or length(trim(coalesce(p_description, ''))) < 3 then raise exception 'Item dan uraian temuan wajib diisi'; end if;
  if not public.ckb_hk_photo_usable(p_photo, p_area) then raise exception 'Foto bukti harus foto aktif dari check-in rak ini yang sudah selesai'; end if;
  if p_due is not null and p_due < public.ckb_hk_today() then raise exception 'Batas waktu tidak boleh di masa lalu'; end if;
  if p_score is not null and not exists (select 1 from public.ckb_hk_scores s where s.id = p_score and s.area_id = p_area) then raise exception 'Penilaian itu bukan untuk rak ini'; end if;
  insert into public.ckb_hk_findings (area_id, customer_id, score_id, item_label, description, evidence_photo_id, due_date, raised_by, raised_name)
  values (p_area, a.customer_id, p_score, trim(p_item), trim(p_description), p_photo, p_due, auth.uid(), public.ckb_actor_name()) returning id into v_id;
  perform public.ckb_audit('HK_FINDING_RAISE', 'housekeeping_finding', v_id::text, a.customer_id, jsonb_build_object('area', a.code, 'item', trim(p_item), 'due', p_due));
  return v_id;
end $$;

-- The rack's PIC (or a lead) marks it fixed, with a note and optionally a later photo.
create or replace function public.ckb_hk_fix_finding(p_finding uuid, p_note text, p_photo uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare f public.ckb_hk_findings%rowtype;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  select * into f from public.ckb_hk_findings where id = p_finding for update;
  if f.id is null then raise exception 'Temuan tidak ditemukan'; end if;
  if not (public.ckb_has_role(array['admin', 'supervisor']) or public.ckb_hk_is_my_area(f.area_id)) then raise exception 'Temuan ini bukan untuk rak Anda'; end if;
  if f.status <> 'OPEN' then raise exception 'Hanya temuan yang masih terbuka yang bisa ditandai selesai diperbaiki'; end if;
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Catatan perbaikan wajib diisi'; end if;
  if p_photo is not null then
    if not public.ckb_hk_photo_usable(p_photo, f.area_id) then raise exception 'Foto harus foto aktif dari check-in rak ini yang sudah selesai'; end if;
    if not exists (select 1 from public.ckb_hk_photos p where p.id = p_photo and p.uploaded_at > f.raised_at) then raise exception 'Foto perbaikan harus diambil setelah temuan dibuat'; end if;
  end if;
  update public.ckb_hk_findings set status = 'FIXED', fixed_by = auth.uid(), fixed_name = public.ckb_actor_name(), fixed_at = now(), fix_note = trim(p_note), fix_photo_id = p_photo where id = p_finding;
  perform public.ckb_audit('HK_FINDING_FIX', 'housekeeping_finding', p_finding::text, f.customer_id, jsonb_build_object('note', trim(p_note)));
end $$;

-- A different lead verifies (not who raised it, not who fixed it) or sends it back.
create or replace function public.ckb_hk_verify_finding(p_finding uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare f public.ckb_hk_findings%rowtype;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin yang bisa memverifikasi'; end if;
  select * into f from public.ckb_hk_findings where id = p_finding for update;
  if f.id is null then raise exception 'Temuan tidak ditemukan'; end if;
  if f.status <> 'FIXED' then raise exception 'Hanya temuan yang sudah ditandai diperbaiki yang bisa diverifikasi'; end if;
  if auth.uid() in (f.raised_by, f.fixed_by) then raise exception 'Anda tidak bisa memverifikasi temuan yang Anda buat atau perbaiki sendiri'; end if;
  if not coalesce(p_ok, false) and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Alasan mengembalikan wajib diisi'; end if;
  if coalesce(p_ok, false) then
    update public.ckb_hk_findings set status = 'VERIFIED', verified_by = auth.uid(), verified_name = public.ckb_actor_name(), verified_at = now(), verify_note = nullif(trim(p_note), '') where id = p_finding;
    perform public.ckb_audit('HK_FINDING_VERIFY', 'housekeeping_finding', p_finding::text, f.customer_id, jsonb_build_object('note', nullif(trim(p_note), '')));
  else
    update public.ckb_hk_findings set status = 'OPEN', reopen_count = f.reopen_count + 1, reopen_note = trim(p_note) where id = p_finding;
    perform public.ckb_audit('HK_FINDING_REOPEN', 'housekeeping_finding', p_finding::text, f.customer_id, jsonb_build_object('note', trim(p_note), 'count', f.reopen_count + 1));
  end if;
end $$;

create or replace function public.ckb_hk_cancel_finding(p_finding uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare f public.ckb_hk_findings%rowtype;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin yang bisa membatalkan temuan'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into f from public.ckb_hk_findings where id = p_finding for update;
  if f.id is null then raise exception 'Temuan tidak ditemukan'; end if;
  if f.status not in ('OPEN', 'FIXED') then raise exception 'Temuan ini sudah selesai atau dibatalkan'; end if;
  update public.ckb_hk_findings set status = 'CANCELLED', cancelled_by = auth.uid(), cancelled_name = public.ckb_actor_name(), cancelled_at = now(), cancel_reason = trim(p_reason) where id = p_finding;
  perform public.ckb_audit('HK_FINDING_CANCEL', 'housekeeping_finding', p_finding::text, f.customer_id, jsonb_build_object('reason', trim(p_reason)));
end $$;

-- ---------------------------------------------------------------------
-- What a customer reads: no person, no note, no cancelled finding
-- ---------------------------------------------------------------------
create or replace function public.ckb_hk_customer_quality(p_customer uuid, p_from date, p_to date)
returns table (area_id uuid, area_code text, area_name text, week_start date, pct int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_customer is null or not public.ckb_can_see_customer(p_customer) then raise exception 'Customer tidak ditemukan'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > 190 then raise exception 'Rentang tanggal maksimal 190 hari'; end if;
  return query
    select distinct on (s.area_id, s.week_start) s.area_id, a.code, a.name, s.week_start, s.pct
    from public.ckb_hk_scores s join public.ckb_hk_areas a on a.id = s.area_id
    where s.customer_id = p_customer and s.week_start between p_from - 6 and p_to
    order by s.area_id, s.week_start, s.version desc;
end $$;

create or replace function public.ckb_hk_customer_findings(p_customer uuid)
returns table (id uuid, area_id uuid, area_code text, area_name text, item_label text, description text, status text, raised_on date,
               due_date date, fixed_on date, verified_on date, evidence_photo_id uuid, fix_photo_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_customer is null or not public.ckb_can_see_customer(p_customer) then raise exception 'Customer tidak ditemukan'; end if;
  return query
    select f.id, f.area_id, a.code, a.name, f.item_label, f.description,
           case f.status when 'VERIFIED' then 'DONE' else f.status end,
           (f.raised_at at time zone 'Asia/Jakarta')::date, f.due_date, (f.fixed_at at time zone 'Asia/Jakarta')::date, (f.verified_at at time zone 'Asia/Jakarta')::date,
           f.evidence_photo_id, f.fix_photo_id
    from public.ckb_hk_findings f join public.ckb_hk_areas a on a.id = f.area_id
    where f.customer_id = p_customer and f.status <> 'CANCELLED'
      and (f.status in ('OPEN', 'FIXED') or f.verified_at > now() - interval '90 days')
    order by (f.status in ('OPEN', 'FIXED')) desc, f.raised_at desc
    limit 500;
end $$;

-- ---------------------------------------------------------------------
-- Dashboard and badge, with findings (0159's, plus the lines marked 0160)
-- ---------------------------------------------------------------------
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
  -- quality (0160): findings still to fix or verify
  if public.ckb_has_role(array['admin', 'supervisor']) then
    r := coalesce(r, '{}'::jsonb) || jsonb_build_object(
      'open_findings', (select count(*) from public.ckb_hk_findings f where f.status = 'OPEN' and (p_customer is null or f.customer_id = p_customer)),
      'awaiting_verify', (select count(*) from public.ckb_hk_findings f where f.status = 'FIXED' and (p_customer is null or f.customer_id = p_customer)));
  elsif public.ckb_has_role(array['operator']) then
    r := coalesce(r, '{}'::jsonb) || jsonb_build_object(
      'my_findings', (select count(*) from public.ckb_hk_findings f where f.status = 'OPEN' and public.ckb_hk_is_my_area(f.area_id)));
  else
    r := coalesce(r, '{}'::jsonb) || jsonb_build_object(
      'open_findings', (select count(*) from public.ckb_hk_findings f where f.status in ('OPEN', 'FIXED') and f.customer_id = p_customer));
  end if;
  return coalesce(r, '{}'::jsonb);
end $$;

create or replace function public.ckb_hk_badge() returns int
language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.ckb_hk_today();
begin
  if public.ckb_has_role(array['admin', 'supervisor']) then
    return (select count(*)::int from public.ckb_hk_checkins where status = 'SUBMITTED')
         + (select count(*)::int from public.ckb_hk_findings where status = 'FIXED');
  elsif public.ckb_has_role(array['operator']) and public.ckb_hk_is_workday(v_today) then
    return (select count(*)::int from public.ckb_hk_findings f where f.status = 'OPEN' and public.ckb_hk_is_my_area(f.area_id)) + (select count(*)::int
            from public.ckb_hk_assignments s join public.ckb_hk_areas a on a.id = s.area_id and a.active and a.customer_id is not null
            where s.pic_user_id = auth.uid() and s.from_date <= v_today and (s.to_date is null or s.to_date >= v_today)
              and not exists (select 1 from public.ckb_hk_absences x where x.user_id = s.pic_user_id and v_today between x.from_date and x.to_date)
              and not exists (select 1 from public.ckb_hk_checkins k where k.area_id = a.id and k.work_date = v_today and k.status in ('SUBMITTED', 'ACCEPTED', 'EXCUSED')));
  end if;
  return 0;
end $$;

-- The finding and score tables refresh live (same guard as 0155 and 0159).
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['ckb_hk_findings', 'ckb_hk_scores'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

revoke execute on function public.ckb_hk_checklist_save(uuid, text, boolean, int), public.ckb_hk_score_week(uuid, date, jsonb, text),
  public.ckb_hk_raise_finding(uuid, text, text, uuid, date, uuid), public.ckb_hk_fix_finding(uuid, text, uuid), public.ckb_hk_verify_finding(uuid, boolean, text),
  public.ckb_hk_cancel_finding(uuid, text), public.ckb_hk_customer_quality(uuid, date, date), public.ckb_hk_customer_findings(uuid),
  public.ckb_hk_is_my_area(uuid), public.ckb_hk_photo_usable(uuid, uuid), public.ckb_hk_append_only() from public, anon;
grant execute on function public.ckb_hk_checklist_save(uuid, text, boolean, int), public.ckb_hk_score_week(uuid, date, jsonb, text),
  public.ckb_hk_raise_finding(uuid, text, text, uuid, date, uuid), public.ckb_hk_fix_finding(uuid, text, uuid), public.ckb_hk_verify_finding(uuid, boolean, text),
  public.ckb_hk_cancel_finding(uuid, text), public.ckb_hk_customer_quality(uuid, date, date), public.ckb_hk_customer_findings(uuid),
  public.ckb_hk_is_my_area(uuid) to authenticated;
-- ckb_hk_photo_usable and ckb_hk_append_only stay internal.
