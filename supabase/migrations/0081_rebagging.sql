-- =====================================================================
-- 0081  Rebagging process for CKB 3PL
--
-- Rebagging: replacing damaged packaging (bags, drums, etc.) while keeping
-- the same material. The process captures before/after photos, quantities,
-- operator and checker names, and creates a traceable record.
--
-- Tables
--   rebagging_tasks    header for each rebagging session
--   rebagging_photos   before/after photo evidence
--   rebagging_lines    material lines within a task
--
-- RLS: authenticated users can read; operators/supervisors/admin can write
-- their own tasks; only supervisor/admin can verify.
-- =====================================================================

-- Header table
create table public.rebagging_tasks (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift text not null,                    -- 'Day Shift / 08:00–16:00', etc.
  warehouse text not null,                -- location/warehouse
  wo_number text,                         -- work order / reference number
  operator_name text not null,            -- PIC / operator
  checker_name text,                      -- checker / supervisor
  material_name text not null,            -- material / product description
  quantity numeric not null,              -- quantity
  unit text not null default 'bags',      -- bags, kg, drums, etc.
  status text not null default 'DRAFT',   -- DRAFT, SUBMITTED, VERIFIED, REJECTED
  note text,                              -- additional notes
  result text,                            -- 'SESUAI' | 'PERLU_TINDAK_LANJUT'
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  verified_by uuid references auth.users(id),
  verified_by_name text,
  verified_at timestamptz
);

-- Photo evidence table
create table public.rebagging_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.rebagging_tasks(id) on delete cascade,
  phase text not null,                    -- 'BEFORE' | 'AFTER'
  photo_url text not null,                -- Supabase storage URL
  note text,                              -- condition notes
  uploaded_by uuid not null references auth.users(id),
  uploaded_by_name text not null,
  uploaded_at timestamptz not null default now()
);

-- Material lines (for multiple materials in one task)
create table public.rebagging_lines (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.rebagging_tasks(id) on delete cascade,
  sku text,                               -- material code if available
  material_name text not null,
  quantity numeric not null,
  unit text not null default 'bags',
  batch_lot text,
  expiry_date date,
  bin_code text,
  seq int not null default 1
);

-- Enable RLS
alter table public.rebagging_tasks enable row level security;
alter table public.rebagging_photos enable row level security;
alter table public.rebagging_lines enable row level security;

-- Policies for rebagging_tasks
-- Read: authenticated users with ckb_3pl app
create policy "rebagging_tasks_read" on public.rebagging_tasks
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and 'ckb_3pl' = any(apps) and active)
  );

-- Insert: operators, supervisors, admins can create their own tasks
create policy "rebagging_tasks_insert" on public.rebagging_tasks
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

-- Update: creator can update DRAFT; supervisor/admin can verify
create policy "rebagging_tasks_update" on public.rebagging_tasks
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
      -- Creator can update their own DRAFT tasks
      (created_by = auth.uid() and status = 'DRAFT')
      or
      -- Supervisor/admin can update status to VERIFIED/REJECTED
      (exists (select 1 from public.profiles where id = auth.uid() and role in ('supervisor','admin')) and status in ('SUBMITTED'))
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

-- Policies for rebagging_photos
create policy "rebagging_photos_read" on public.rebagging_photos
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and 'ckb_3pl' = any(apps) and active)
  );

create policy "rebagging_photos_insert" on public.rebagging_photos
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

-- Policies for rebagging_lines
create policy "rebagging_lines_read" on public.rebagging_lines
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and 'ckb_3pl' = any(apps) and active)
  );

create policy "rebagging_lines_insert" on public.rebagging_lines
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

create policy "rebagging_lines_update" on public.rebagging_lines
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

-- Indexes
create index rebagging_tasks_date_idx on public.rebagging_tasks (work_date desc);
create index rebagging_tasks_status_idx on public.rebagging_tasks (status);
create index rebagging_tasks_created_by_idx on public.rebagging_tasks (created_by);
create index rebagging_photos_task_idx on public.rebagging_photos (task_id);
create index rebagging_lines_task_idx on public.rebagging_lines (task_id);

-- Realtime (guarded: plain Postgres has no supabase_realtime publication; 0015 pattern)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
  else
    execute format('alter publication supabase_realtime add table public.rebagging_tasks');
    execute format('alter publication supabase_realtime add table public.rebagging_photos');
    execute format('alter publication supabase_realtime add table public.rebagging_lines');
  end if;
end $$;

-- Grants
grant select, insert, update on public.rebagging_tasks to authenticated;
grant select, insert, update on public.rebagging_photos to authenticated;
grant select, insert, update on public.rebagging_lines to authenticated;