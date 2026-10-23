-- =====================================================================
-- 0082  Cargo inspection for CKB 3PL
--
-- Cargo inspection: checking pallet condition, wrapping, marking & labelling
-- for incoming/outgoing cargo. Captures checklist with OK/NG/NA per item,
-- photo evidence, findings, and verification workflow.
--
-- Tables
--   cargo_inspections    header for each inspection session
--   cargo_inspection_lines  checklist lines per category (pallet, wrapping, marking)
--   cargo_inspection_photos  photo evidence
--
-- RLS: authenticated users can read; operators/supervisors/admin can write
-- their own inspections; only supervisor/admin can verify.
-- =====================================================================

create type public.cargo_inspection_status as enum ('DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED');
create type public.cargo_check_result as enum ('OK', 'NG', 'NA');

-- Header table
create table public.cargo_inspections (
  id uuid primary key default gen_random_uuid(),
  inspection_date date not null,
  shift text not null,                    -- 'Day Shift / 08:00–16:00', etc.
  warehouse text not null,                -- location/warehouse
  doc_number text,                        -- DO / WO reference number
  inspector_name text not null,           -- inspector / PIC
  checker_name text,                      -- checker / supervisor
  cargo_name text not null,               -- cargo / material description
  status public.cargo_inspection_status not null default 'DRAFT',
  pallet_status public.cargo_check_result,
  wrapping_status public.cargo_check_result,
  marking_status public.cargo_check_result,
  findings text,                          -- catatan temuan / tindakan
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  verified_by uuid references auth.users(id),
  verified_by_name text,
  verified_at timestamptz
);

-- Checklist lines - detailed checks per category
create table public.cargo_inspection_lines (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.cargo_inspections(id) on delete cascade,
  category text not null,                 -- 'PALLET' | 'WRAPPING' | 'MARKING'
  check_item text not null,               -- specific check description
  result public.cargo_check_result not null,
  note text,
  seq int not null default 1
);

-- Photo evidence
create table public.cargo_inspection_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.cargo_inspections(id) on delete cascade,
  category text not null,                 -- 'PALLET' | 'WRAPPING' | 'MARKING' | 'GENERAL'
  photo_url text not null,
  note text,
  uploaded_by uuid not null references auth.users(id),
  uploaded_by_name text not null,
  uploaded_at timestamptz not null default now()
);

-- Enable RLS
alter table public.cargo_inspections enable row level security;
alter table public.cargo_inspection_lines enable row level security;
alter table public.cargo_inspection_photos enable row level security;

-- Policies for cargo_inspections
create policy "cargo_inspections_read" on public.cargo_inspections
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and 'ckb_3pl' = any(apps) and active)
  );

create policy "cargo_inspections_insert" on public.cargo_inspections
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and 'ckb_3pl' = any(apps)
      and active
      and role in ('operator','supervisor','admin')
    )
    and created_by = auth.uid()
  );

create policy "cargo_inspections_update" on public.cargo_inspections
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and 'ckb_3pl' = any(apps)
      and active
      and role in ('operator','supervisor','admin')
    )
    and (
      (created_by = auth.uid() and status = 'DRAFT')
      or
      (exists (select 1 from public.profiles where id = auth.uid() and role in ('supervisor','admin')) and status = 'SUBMITTED')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and 'ckb_3pl' = any(apps)
      and active
      and role in ('operator','supervisor','admin')
    )
  );

-- Policies for cargo_inspection_lines
create policy "cargo_inspection_lines_read" on public.cargo_inspection_lines
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and 'ckb_3pl' = any(apps) and active)
  );

create policy "cargo_inspection_lines_insert" on public.cargo_inspection_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and 'ckb_3pl' = any(apps)
      and active
      and role in ('operator','supervisor','admin')
    )
  );

create policy "cargo_inspection_lines_update" on public.cargo_inspection_lines
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and 'ckb_3pl' = any(apps)
      and active
      and role in ('operator','supervisor','admin')
    )
  );

-- Policies for cargo_inspection_photos
create policy "cargo_inspection_photos_read" on public.cargo_inspection_photos
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and 'ckb_3pl' = any(apps) and active)
  );

create policy "cargo_inspection_photos_insert" on public.cargo_inspection_photos
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and 'ckb_3pl' = any(apps)
      and active
      and role in ('operator','supervisor','admin')
    )
    and uploaded_by = auth.uid()
  );

-- Indexes
create index cargo_inspections_date_idx on public.cargo_inspections (inspection_date desc);
create index cargo_inspections_status_idx on public.cargo_inspections (status);
create index cargo_inspections_created_by_idx on public.cargo_inspections (created_by);
create index cargo_inspection_lines_inspection_idx on public.cargo_inspection_lines (inspection_id);
create index cargo_inspection_photos_inspection_idx on public.cargo_inspection_photos (inspection_id);

-- Realtime
-- Realtime (guarded: plain Postgres has no supabase_realtime publication; 0015 pattern)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
  else
    execute format('alter publication supabase_realtime add table public.cargo_inspections');
    execute format('alter publication supabase_realtime add table public.cargo_inspection_lines');
    execute format('alter publication supabase_realtime add table public.cargo_inspection_photos');
  end if;
end $$;

-- Grants
grant select, insert, update on public.cargo_inspections to authenticated;
grant select, insert, update on public.cargo_inspection_lines to authenticated;
grant select, insert, update on public.cargo_inspection_photos to authenticated;