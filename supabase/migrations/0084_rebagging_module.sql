-- =====================================================================
-- 0084  Rebagging module for CKB 3PL
--
-- Supersedes the naive 0081 tables (rebagging_tasks, rebagging_photos,
-- rebagging_lines) which were static mockup scaffolding never touched by
-- any runtime code. They are dropped here in dependency-safe order.
--
-- Source protection reuses stock_holds with a new 'REBAGGING' value
-- added to both the source and reason_code CHECK constraints via
-- forward-only constraint replacement (no data migration needed).
-- =====================================================================

-- Drop unused 0081 tables (dependency-safe: children first)
drop table if exists public.rebagging_photos;
drop table if exists public.rebagging_lines;
drop table if exists public.rebagging_tasks;

-- Extend stock_holds constraints to allow REBAGGING as a source/reason
-- 0017 defined these as inline unnamed CHECK constraints; PostgreSQL
-- auto-generated the names stock_holds_source_check and
-- stock_holds_reason_code_check (the design doc guessed the second as
-- stock_holds_reason_check; the actual name includes the column name).
alter table public.stock_holds drop constraint if exists stock_holds_source_check;
alter table public.stock_holds add constraint stock_holds_source_check
  check (source in ('MANUAL','RECEIPT','CARRY','RECON','REBAGGING'));

alter table public.stock_holds drop constraint if exists stock_holds_reason_code_check;
alter table public.stock_holds add constraint stock_holds_reason_code_check
  check (reason_code in ('QC_HOLD','DAMAGED','INVESTIGATION','RECALL','EXPIRED','RETURN','REBAGGING'));

-- Sequences for job numbers and package numbers
create sequence public.ckb_rebagging_job_seq;
create sequence public.ckb_package_seq;

-- Jobs table FIRST (ckb_packages references it via source_job_id)
create table public.ckb_rebagging_jobs (
  id                    uuid primary key default gen_random_uuid(),
  job_no                text not null unique default ('RB' || lpad(nextval('public.ckb_rebagging_job_seq')::text, 6, '0')),
  job_date              date not null default current_date,
  shift                 text not null,
  warehouse             text not null,
  customer_ref          text,                       -- paper WO / DO reference, user-supplied
  customer              text,                       -- Freeport/CGP/SIP/MNE/Boiler/SSB (optional chip)
  operation_type        text not null check (operation_type in ('DAMAGE_REBAG','SPLIT','RELABEL','COMBINE')),
  reason                text not null,
  priority              int not null default 0,     -- higher = sooner
  note                  text,
  status                text not null default 'DRAFT' check (status in (
    'DRAFT','OPEN','IN_PROGRESS','AWAITING_VERIFICATION','VERIFIED','REJECTED',
    'ON_HOLD','COMPLETED','CANCELLED','REVERSED')),
  status_before_hold    text,                       -- resume point after ON_HOLD
  -- people (typed names; DB enforces segregation)
  creator_name          text not null,
  executor_name         text,
  verifier_name         text,
  approver_name         text,
  -- material identity (all sources must share it) — DERIVED from set_rebagging_sources,
  -- so item_id is nullable at creation; open_rebagging_job raises when identity is
  -- still missing (sources never set), so no OPEN job can have a null identity.
  item_id               uuid references public.items(id),
  batch_lot             text not null default '',
  expiry_date           date,
  -- execution record (planned lives on source/output lines; actual here)
  actual_inputs         jsonb,
  actual_outputs        jsonb,
  checklist             jsonb,                      -- [{item,label,ok}]
  -- variance
  input_qty             numeric,
  output_qty            numeric,
  unit                  text,
  pkg_count_in          int,
  pkg_count_out         int,
  variance_qty          numeric,                    -- input - output
  variance_reason       text,
  variance_note         text,
  variance_decided_by   text,
  variance_decided_at   timestamptz,
  -- posting
  posted_ref            text,
  posted_at             timestamptz,
  last_post_error       text,
  reversal_note         text,
  reversed_by           text,
  reversed_at           timestamptz,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index ckb_rebagging_jobs_status_idx on public.ckb_rebagging_jobs (status, job_no);
create index ckb_rebagging_jobs_item_idx on public.ckb_rebagging_jobs (item_id);

-- Packages registry (every output package gets a unique package_no)
create table public.ckb_packages (
  id                uuid primary key default gen_random_uuid(),
  package_no        text not null unique,
  item_id           uuid not null references public.items(id),
  batch_lot         text not null default '',
  expiry_date       date,
  quantity          numeric not null check (quantity > 0),
  unit              text not null,
  pkg_count         int,
  bin_id            uuid references public.bins(id),
  status            text not null default 'ACTIVE' check (status in ('ACTIVE','RETIRED')),
  source_job_id     uuid references public.ckb_rebagging_jobs(id),
  created_at        timestamptz not null default now(),
  retired_at        timestamptz,
  retired_note      text
);
create index ckb_packages_job_idx on public.ckb_packages (source_job_id);
create index ckb_packages_bin_idx on public.ckb_packages (bin_id);
create index ckb_packages_identity_idx on public.ckb_packages (item_id, batch_lot, expiry_date);

-- Source lines for a job
create table public.ckb_rebagging_sources (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.ckb_rebagging_jobs(id) on delete cascade,
  line_no           int not null,
  source_type       text not null check (source_type in ('STOCK','PACKAGE')),
  package_id        uuid references public.ckb_packages(id),   -- when source_type='PACKAGE'
  bin_id            uuid not null references public.bins(id),  -- physical location (STOCK or package's bin)
  quantity          numeric not null check (quantity > 0),
  unit              text not null,
  pkg_count         int,
  gross_weight      numeric,
  tare_weight       numeric,
  net_weight        numeric,
  weight_unit       text,
  -- physical qty of the identity snapshot at execution start, written by start_rebagging_execution,
  -- compared by approve_post_rebagging
  start_qty         numeric,
  created_at        timestamptz not null default now()
);

-- Idempotent column add (safe if re-run)
alter table public.ckb_rebagging_sources add column if not exists start_qty numeric;
create index ckb_rebagging_sources_job_idx on public.ckb_rebagging_sources (job_id, line_no);

-- Output lines for a job
create table public.ckb_rebagging_outputs (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.ckb_rebagging_jobs(id) on delete cascade,
  line_no           int not null,
  package_id        uuid references public.ckb_packages(id),   -- filled at posting
  to_bin_id         uuid not null references public.bins(id),
  quantity          numeric not null check (quantity > 0),
  unit              text not null,
  pkg_count         int,
  gross_weight      numeric,
  tare_weight       numeric,
  net_weight        numeric,
  weight_unit       text,
  status            text not null default 'PROVISIONAL' check (status in ('PROVISIONAL','ACTIVE')),
  created_at        timestamptz not null default now()
);
create index ckb_rebagging_outputs_job_idx on public.ckb_rebagging_outputs (job_id, line_no);

-- Package lineage across jobs (append-only)
create table public.ckb_package_lineage (
  id                    uuid primary key default gen_random_uuid(),
  source_package_id     uuid references public.ckb_packages(id),
  source_job_id         uuid references public.ckb_rebagging_jobs(id),
  output_package_id     uuid not null references public.ckb_packages(id),
  output_job_id         uuid not null references public.ckb_rebagging_jobs(id),
  quantity              numeric not null,
  created_at            timestamptz not null default now()
);
create index ckb_package_lineage_out_idx on public.ckb_package_lineage (output_package_id);
create index ckb_package_lineage_src_idx on public.ckb_package_lineage (source_package_id);

-- Evidence photos (append-only audit)
create table public.ckb_rebagging_evidence (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.ckb_rebagging_jobs(id) on delete cascade,
  kind              text not null check (kind in ('BEFORE','AFTER','OTHER')),
  storage_path      text not null,              -- {job_id}/{kind}/...
  mime              text not null,
  size_bytes        bigint not null,
  note              text,
  uploader          uuid references public.profiles(id),
  uploader_name     text not null,
  uploaded_at       timestamptz not null default now()
);
create index ckb_rebagging_evidence_job_idx on public.ckb_rebagging_evidence (job_id);

-- Event log (append-only audit trail)
create table public.ckb_rebagging_events (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.ckb_rebagging_jobs(id) on delete cascade,
  event_type        text not null,              -- CREATE / OPEN / START / RECORD / SUBMIT / VERIFY / REJECT / VARIANCE / HOLD / UNHOLD / POST / REVERSE / CANCEL / EVIDENCE
  by_name           text,
  note              text,
  details           jsonb,
  at                timestamptz not null default now()
);
create index ckb_rebagging_events_job_idx on public.ckb_rebagging_events (job_id, at);

-- Helper functions for RLS and storage policies (SECURITY DEFINER so policies can call them)
create or replace function public.has_ckb_app() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select 'ckb_3pl' = any(apps) and active
    from public.profiles
    where id = auth.uid()
  ), false);
$$;

create or replace function public.ckb_job_exists(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ckb_rebagging_jobs where id = p_id);
$$;

-- RLS: select-only, gated on CKB membership; all writes go through SECURITY DEFINER RPCs
alter table public.ckb_rebagging_jobs      enable row level security;
alter table public.ckb_rebagging_sources   enable row level security;
alter table public.ckb_rebagging_outputs   enable row level security;
alter table public.ckb_packages            enable row level security;
alter table public.ckb_package_lineage     enable row level security;
alter table public.ckb_rebagging_evidence  enable row level security;
alter table public.ckb_rebagging_events    enable row level security;

create policy "ckb: ckb members read" on public.ckb_rebagging_jobs
  for select to authenticated using (public.has_ckb_app());
create policy "ckb: ckb members read" on public.ckb_rebagging_sources
  for select to authenticated using (public.has_ckb_app());
create policy "ckb: ckb members read" on public.ckb_rebagging_outputs
  for select to authenticated using (public.has_ckb_app());
create policy "ckb: ckb members read" on public.ckb_packages
  for select to authenticated using (public.has_ckb_app());
create policy "ckb: ckb members read" on public.ckb_package_lineage
  for select to authenticated using (public.has_ckb_app());
create policy "ckb: ckb members read" on public.ckb_rebagging_evidence
  for select to authenticated using (public.has_ckb_app());
create policy "ckb: ckb members read" on public.ckb_rebagging_events
  for select to authenticated using (public.has_ckb_app());

-- Storage bucket (private) + policies
-- Read: any CKB member
-- Insert: CKB member + path root must be an existing job uuid + second segment in ('BEFORE','AFTER','OTHER')
-- No UPDATE/DELETE policy: evidence is append-only audit
-- NOTE: storage.objects policies depend on has_ckb_app() and ckb_job_exists() being SECURITY DEFINER
-- Guarded: plain Postgres (supabase/tests) has no storage schema; 0015 pattern.
do $$
begin
  if to_regnamespace('storage') is null then
    raise notice 'storage schema not found; skipping bucket + storage policies';
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('ckb-rebagging','ckb-rebagging', false)
    on conflict (id) do nothing;

  execute 'create policy "ckb-rebagging: read" on storage.objects
    for select to authenticated
    using (bucket_id = ''ckb-rebagging'' and public.has_ckb_app())';

  execute 'create policy "ckb-rebagging: insert" on storage.objects
    for insert to authenticated
    with check (
      bucket_id = ''ckb-rebagging''
      and public.has_ckb_app()
      and public.ckb_job_exists(nullif((storage.foldername(name))[1], '''')::uuid)
      and (storage.foldername(name))[2] in (''BEFORE'',''AFTER'',''OTHER'')
    )';
end $$;

-- Realtime: add the four tables that need live updates
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array[
    'ckb_rebagging_jobs',
    'ckb_rebagging_outputs',
    'ckb_rebagging_evidence',
    'ckb_rebagging_events'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Grants per 0005/0017/0020 convention
grant select on public.ckb_rebagging_jobs, public.ckb_rebagging_sources, public.ckb_rebagging_outputs,
  public.ckb_packages, public.ckb_package_lineage, public.ckb_rebagging_evidence,
  public.ckb_rebagging_events to authenticated;

grant all on public.ckb_rebagging_jobs, public.ckb_rebagging_sources, public.ckb_rebagging_outputs,
  public.ckb_packages, public.ckb_package_lineage, public.ckb_rebagging_evidence,
  public.ckb_rebagging_events to service_role;

grant usage on public.ckb_rebagging_job_seq, public.ckb_package_seq to service_role;