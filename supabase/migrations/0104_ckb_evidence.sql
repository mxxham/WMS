-- =====================================================================
-- 0104  CKB 3PL evidence (photos and documents)
--
-- One metadata table for stock-take, count-task and inspection evidence.
-- (Rebagging keeps its own 0084 evidence table and bucket; Arsip foto
-- lists both.)
--
-- Storage: private bucket 'ckb-evidence' with NO storage.objects policy
-- for authenticated users at all. The browser never talks to the bucket:
--   upload    POST /api/ckb/evidence      checks the entity, uploads with
--             the service role to {customer}/{type}/{entity}/{uuid}.{ext},
--             then registers the row here as the user (this RPC re-checks
--             everything and rejects any path that does not match).
--   download  GET /api/ckb/evidence/[id]   ckb_evidence_open() decides,
--             logs the access, and only then is a 60-second signed URL made.
-- So the evidence boundary is exactly the RLS boundary below.
--
-- Retention: retain_until = upload + evidence.retention_days (default 730,
-- two years). Nothing is ever deleted physically. "Hapus" is a soft
-- delete with a reason, only while the record is still open and never on
-- legal hold. Archival to cheaper storage is a recorded manual step
-- (archive_ref) until an archive service is configured.
-- =====================================================================

create table public.ckb_evidence (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.ckb_customers(id),
  entity_type       text not null check (entity_type in ('STOCKTAKE', 'COUNT_TASK', 'INSPECTION')),
  entity_id         uuid not null,
  kind              text not null default 'GENERAL' check (kind in ('GENERAL', 'DAMAGE', 'LABEL', 'DOCUMENT', 'DISCREPANCY')),
  storage_path      text not null unique,
  mime              text not null,
  size_bytes        bigint not null check (size_bytes > 0),
  sha256            text check (sha256 ~ '^[0-9a-f]{64}$'),
  description       text,
  uploaded_by       uuid not null references public.profiles(id),
  uploaded_by_name  text not null,
  uploaded_at       timestamptz not null default now(),
  retain_until      date not null,
  legal_hold        boolean not null default false,
  hold_reason       text,
  archived_at       timestamptz,
  archive_ref       text,
  deleted_at        timestamptz,
  deleted_by_name   text,
  delete_reason     text
);
create index ckb_evidence_entity_idx on public.ckb_evidence (entity_type, entity_id);
create index ckb_evidence_customer_idx on public.ckb_evidence (customer_id, uploaded_at desc);

-- Identity, path, file and uploader are fixed; only hold / archive / soft-delete fields move.
create or replace function public.ckb_evidence_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Bukti tidak bisa dihapus permanen'; end if;
  if (new.customer_id, new.entity_type, new.entity_id, new.storage_path, new.mime, new.size_bytes, new.sha256,
      new.uploaded_by, new.uploaded_at, new.retain_until)
     is distinct from
     (old.customer_id, old.entity_type, old.entity_id, old.storage_path, old.mime, old.size_bytes, old.sha256,
      old.uploaded_by, old.uploaded_at, old.retain_until) then
    raise exception 'Data file bukti tidak bisa diubah';
  end if;
  if old.deleted_at is not null and new.deleted_at is null then raise exception 'Bukti yang dihapus tidak bisa dipulihkan'; end if;
  return new;
end $$;
create trigger ckb_evidence_guard before update or delete on public.ckb_evidence
  for each row execute function public.ckb_evidence_guard();

-- The customer an operational record belongs to (null = no such record). Staff only: a
-- representative must not be able to probe record ids for customer ids.
create or replace function public.ckb_entity_customer(p_type text, p_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when not public.ckb_is_staff() then null else case p_type
    when 'STOCKTAKE' then (select customer_id from public.ckb_stocktakes where id = p_id)
    when 'COUNT_TASK' then (select s.customer_id from public.ckb_count_tasks t join public.ckb_stocktakes s on s.id = t.stocktake_id where t.id = p_id)
    when 'INSPECTION' then (select customer_id from public.ckb_inspections where id = p_id)
  end end
$$;

-- Still being worked on: evidence may be added (and a wrong upload withdrawn).
create or replace function public.ckb_entity_open(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case p_type
    when 'STOCKTAKE' then (select status in ('DRAFT', 'COUNTING', 'REVIEW') from public.ckb_stocktakes where id = p_id)
    when 'COUNT_TASK' then (select s.status in ('COUNTING', 'REVIEW') from public.ckb_count_tasks t
                            join public.ckb_stocktakes s on s.id = t.stocktake_id where t.id = p_id)
    when 'INSPECTION' then (select status in ('DRAFT', 'SUBMITTED') from public.ckb_inspections where id = p_id)
  end, false)
$$;

-- Who may see a record's evidence: staff always; a representative of that customer once the record
-- itself is visible to them (closed stock take, reviewed inspection).
create or replace function public.ckb_entity_visible(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.ckb_is_staff() then public.ckb_entity_customer(p_type, p_id) is not null
    when public.ckb_role() = 'customer' then coalesce(case p_type
      when 'STOCKTAKE' then (select status = 'CLOSED' and public.ckb_can_see_customer(customer_id) from public.ckb_stocktakes where id = p_id)
      when 'COUNT_TASK' then (select s.status = 'CLOSED' and public.ckb_can_see_customer(s.customer_id)
                              from public.ckb_count_tasks t join public.ckb_stocktakes s on s.id = t.stocktake_id where t.id = p_id)
      when 'INSPECTION' then (select status in ('ACCEPTED', 'REJECTED', 'CLOSED') and public.ckb_can_see_customer(customer_id)
                              from public.ckb_inspections where id = p_id)
    end, false)
    else false
  end
$$;

alter table public.ckb_evidence enable row level security;
create policy "ckb: evidence follows its record" on public.ckb_evidence for select to authenticated
  using ((select public.account_active()) and deleted_at is null and public.ckb_entity_visible(entity_type, entity_id));
-- Deleted rows stay readable to admins for the audit trail.
create policy "ckb: admin reads withdrawn evidence" on public.ckb_evidence for select to authenticated
  using ((select public.account_active()) and deleted_at is not null and public.ckb_has_role(array['admin']));
grant select on public.ckb_evidence to authenticated;
grant all on public.ckb_evidence to service_role;

-- Private bucket, no client policies (see header). Guarded: plain Postgres has no storage schema.
do $$
begin
  if to_regnamespace('storage') is null then
    raise notice 'storage schema not found; skipping ckb-evidence bucket';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('ckb-evidence', 'ckb-evidence', false, 52428800,
          array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do update set public = false;
end $$;

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
create or replace function public.ckb_register_evidence(p_entity_type text, p_entity_id uuid, p_kind text,
  p_path text, p_mime text, p_size bigint, p_sha256 text, p_description text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid := public.ckb_entity_customer(p_entity_type, p_entity_id);
  v_cfg jsonb;
  v_id uuid;
  v_ext text;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB yang bisa mengunggah bukti'; end if;
  if v_customer is null then raise exception 'Data yang dilampiri bukti tidak ditemukan'; end if;
  if not public.ckb_entity_open(p_entity_type, p_entity_id) then
    raise exception 'Data ini sudah ditutup; bukti tidak bisa ditambah';
  end if;
  select value into v_cfg from public.ckb_settings where key = 'evidence';
  if not (v_cfg->'allowed_mime') ? p_mime then raise exception 'Tipe file % tidak diizinkan', p_mime; end if;
  if p_size is null or p_size <= 0 or p_size > (v_cfg->>'max_mb')::numeric * 1048576 then
    raise exception 'Ukuran file melebihi % MB', v_cfg->>'max_mb';
  end if;
  v_ext := case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
                       when 'application/pdf' then 'pdf' end;
  if v_ext is null or p_path is distinct from
     (v_customer::text || '/' || p_entity_type || '/' || p_entity_id::text || '/' || split_part(split_part(p_path, '/', 4), '.', 1) || '.' || v_ext)
     or split_part(split_part(p_path, '/', 4), '.', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Lokasi file bukti tidak valid';
  end if;

  insert into public.ckb_evidence (customer_id, entity_type, entity_id, kind, storage_path, mime, size_bytes, sha256,
    description, uploaded_by, uploaded_by_name, retain_until)
  values (v_customer, p_entity_type, p_entity_id, coalesce(nullif(p_kind, ''), 'GENERAL'), p_path, p_mime, p_size,
    nullif(p_sha256, ''), nullif(trim(p_description), ''), auth.uid(), public.ckb_actor_name(),
    ((now() at time zone 'Asia/Jakarta')::date + coalesce((v_cfg->>'retention_days')::int, 730)))
  returning id into v_id;
  perform public.ckb_audit('EVIDENCE_UPLOAD', lower(p_entity_type), p_entity_id::text, v_customer, jsonb_build_object(
    'evidence_id', v_id, 'kind', coalesce(nullif(p_kind, ''), 'GENERAL'), 'mime', p_mime, 'size', p_size));
  return v_id;
end $$;

-- The download gate: returns the object path only when the caller may see it, and logs the view.
create or replace function public.ckb_evidence_open(p_id uuid) returns table (storage_path text, mime text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare e public.ckb_evidence%rowtype;
begin
  select * into e from public.ckb_evidence where id = p_id;
  if e.id is null then raise exception 'Bukti tidak ditemukan'; end if;
  if e.deleted_at is not null and not public.ckb_has_role(array['admin']) then raise exception 'Bukti tidak ditemukan'; end if;
  if not public.ckb_entity_visible(e.entity_type, e.entity_id) then raise exception 'Bukti tidak ditemukan'; end if;
  perform public.ckb_audit('EVIDENCE_VIEW', lower(e.entity_type), e.entity_id::text, e.customer_id,
    jsonb_build_object('evidence_id', e.id));
  return query select e.storage_path, e.mime;
end $$;

create or replace function public.ckb_withdraw_evidence(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.ckb_evidence%rowtype;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan wajib diisi'; end if;
  select * into e from public.ckb_evidence where id = p_id for update;
  if e.id is null or e.deleted_at is not null then raise exception 'Bukti tidak ditemukan'; end if;
  if e.uploaded_by <> auth.uid() and not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya pengunggah atau supervisor yang bisa menarik bukti ini';
  end if;
  if e.legal_hold then raise exception 'Bukti ditahan (%): tidak bisa ditarik', coalesce(e.hold_reason, 'legal hold'); end if;
  if not public.ckb_entity_open(e.entity_type, e.entity_id) then
    raise exception 'Datanya sudah ditutup; bukti menjadi bagian dari riwayat';
  end if;
  update public.ckb_evidence set deleted_at = now(), deleted_by_name = public.ckb_actor_name(), delete_reason = trim(p_reason)
    where id = p_id;
  perform public.ckb_audit('EVIDENCE_WITHDRAW', lower(e.entity_type), e.entity_id::text, e.customer_id,
    jsonb_build_object('evidence_id', p_id, 'reason', trim(p_reason)));
end $$;

create or replace function public.ckb_set_evidence_hold(p_id uuid, p_hold boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.ckb_evidence%rowtype;
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB'; end if;
  if p_hold and length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan penahanan wajib diisi'; end if;
  select * into e from public.ckb_evidence where id = p_id for update;
  if e.id is null then raise exception 'Bukti tidak ditemukan'; end if;
  update public.ckb_evidence set legal_hold = p_hold, hold_reason = case when p_hold then trim(p_reason) end where id = p_id;
  perform public.ckb_audit(case when p_hold then 'EVIDENCE_HOLD' else 'EVIDENCE_RELEASE' end, lower(e.entity_type),
    e.entity_id::text, e.customer_id, jsonb_build_object('evidence_id', p_id, 'reason', nullif(trim(p_reason), '')));
end $$;

-- Records that a file was copied to the archive store (manual until an archive service is configured).
create or replace function public.ckb_record_evidence_archive(p_id uuid, p_archive_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.ckb_evidence%rowtype;
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB'; end if;
  if length(trim(coalesce(p_archive_ref, ''))) < 3 then raise exception 'Referensi arsip wajib diisi'; end if;
  select * into e from public.ckb_evidence where id = p_id for update;
  if e.id is null then raise exception 'Bukti tidak ditemukan'; end if;
  if e.archived_at is not null then raise exception 'Bukti sudah diarsipkan'; end if;
  if e.retain_until > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Masa simpan aktif sampai %; belum bisa diarsipkan', e.retain_until;
  end if;
  update public.ckb_evidence set archived_at = now(), archive_ref = trim(p_archive_ref) where id = p_id;
  perform public.ckb_audit('EVIDENCE_ARCHIVE', lower(e.entity_type), e.entity_id::text, e.customer_id,
    jsonb_build_object('evidence_id', p_id, 'archive_ref', trim(p_archive_ref)));
end $$;

revoke execute on function public.ckb_entity_customer(text, uuid), public.ckb_entity_open(text, uuid),
  public.ckb_entity_visible(text, uuid) from public, anon;
grant execute on function public.ckb_entity_customer(text, uuid), public.ckb_entity_open(text, uuid),
  public.ckb_entity_visible(text, uuid) to authenticated;
revoke execute on function public.ckb_register_evidence(text, uuid, text, text, text, bigint, text, text),
  public.ckb_evidence_open(uuid), public.ckb_withdraw_evidence(uuid, text),
  public.ckb_set_evidence_hold(uuid, boolean, text), public.ckb_record_evidence_archive(uuid, text) from public, anon;
grant execute on function public.ckb_register_evidence(text, uuid, text, text, text, bigint, text, text),
  public.ckb_evidence_open(uuid), public.ckb_withdraw_evidence(uuid, text),
  public.ckb_set_evidence_hold(uuid, boolean, text), public.ckb_record_evidence_archive(uuid, text) to authenticated;
