-- =====================================================================
-- 0083  Stock take and recounting for CKB 3PL
--
-- Stock take: periodic counting of warehouse stock. Supports monthly,
-- quarterly, annual periods. Automatic discrepancy detection triggers
-- recounting workflow.
--
-- Tables
--   stock_takes          header for each stock take session
--   stock_take_lines     counted lines (system qty vs physical qty)
--   recountings          recounting for discrepant items
--
-- RLS: authenticated users can read; operators/supervisors/admin can write
-- their own stock takes; only supervisor/admin can verify recounting.
-- =====================================================================

create type public.stock_take_period as enum ('BULANAN', 'TRIWULANAN', 'TAHUNAN');
create type public.stock_take_status as enum ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY_FOUND', 'RECOUNTING', 'VERIFIED');
create type public.recounting_status as enum ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'REJECTED');
create type public.discrepancy_cause as enum (
  'DATA_ENTRY_ERROR',       -- Kesalahan pencatatan
  'ITEM_NOT_FOUND',         -- Barang tidak ditemukan
  'ITEM_DAMAGED',           -- Kerusakan barang
  'RECEIVING_ISSUE_ERROR',  -- Kesalahan penerimaan/pengeluaran
  'OTHER'                   -- Lainnya
);

-- Header table
create table public.stock_takes (
  id uuid primary key default gen_random_uuid(),
  take_date date not null,
  warehouse text not null,                -- gudang / lokasi
  pic_name text not null,                 -- penanggung jawab gudang
  team_name text,                         -- tim stock take
  period public.stock_take_period not null,
  status public.stock_take_status not null default 'DRAFT',
  total_items int not null default 0,
  matched_items int not null default 0,
  discrepancy_items int not null default 0,
  unchecked_items int not null default 0,
  note text,
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  verified_by uuid references auth.users(id),
  verified_by_name text,
  verified_at timestamptz
);

-- Lines: system qty vs physical qty per material
create table public.stock_take_lines (
  id uuid primary key default gen_random_uuid(),
  stock_take_id uuid not null references public.stock_takes(id) on delete cascade,
  seq int not null,
  material_code text not null,
  material_name text not null,
  system_qty numeric not null,
  physical_qty numeric,
  difference numeric generated always as (physical_qty - system_qty) stored,
  note text,
  has_discrepancy boolean generated always as (physical_qty is not null and physical_qty <> system_qty) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Recounting for discrepant items
create table public.recountings (
  id uuid primary key default gen_random_uuid(),
  stock_take_id uuid not null references public.stock_takes(id) on delete cascade,
  stock_take_line_id uuid not null references public.stock_take_lines(id) on delete cascade,
  material_code text not null,
  material_name text not null,
  bin_location text,
  system_qty numeric not null,
  initial_physical_qty numeric not null,
  initial_difference numeric not null,
  recount_qty numeric,
  recount_difference numeric generated always as (recount_qty - system_qty) stored,
  recount_by_name text,
  cause public.discrepancy_cause,
  cause_note text,
  evidence_url text,                      -- photo/document evidence
  status public.recounting_status not null default 'PENDING',
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  verified_by uuid references auth.users(id),
  verified_by_name text,
  verified_at timestamptz
);

-- Enable RLS
alter table public.stock_takes enable row level security;
alter table public.stock_take_lines enable row level security;
alter table public.recountings enable row level security;

-- Policies for stock_takes
create policy "stock_takes_read" on public.stock_takes
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and 'ckb_3pl' = any(apps) and active)
  );

create policy "stock_takes_insert" on public.stock_takes
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

create policy "stock_takes_update" on public.stock_takes
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
      (created_by = auth.uid() and status in ('DRAFT', 'IN_PROGRESS'))
      or
      (exists (select 1 from public.profiles where id = auth.uid() and role in ('supervisor','admin')) and status in ('COMPLETED', 'DISCREPANCY_FOUND'))
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

-- Policies for stock_take_lines
create policy "stock_take_lines_read" on public.stock_take_lines
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and 'ckb_3pl' = any(apps) and active)
  );

create policy "stock_take_lines_insert" on public.stock_take_lines
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

create policy "stock_take_lines_update" on public.stock_take_lines
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

-- Policies for recountings
create policy "recountings_read" on public.recountings
  for select to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and 'ckb_3pl' = any(apps) and active)
  );

create policy "recountings_insert" on public.recountings
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

create policy "recountings_update" on public.recountings
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
      (created_by = auth.uid() and status in ('PENDING', 'IN_PROGRESS'))
      or
      (exists (select 1 from public.profiles where id = auth.uid() and role in ('supervisor','admin')) and status = 'COMPLETED')
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

-- Indexes
create index stock_takes_date_idx on public.stock_takes (take_date desc);
create index stock_takes_status_idx on public.stock_takes (status);
create index stock_takes_created_by_idx on public.stock_takes (created_by);
create index stock_take_lines_stock_take_idx on public.stock_take_lines (stock_take_id);
create index stock_take_lines_discrepancy_idx on public.stock_take_lines (has_discrepancy) where has_discrepancy;
create index recountings_stock_take_idx on public.recountings (stock_take_id);
create index recountings_line_idx on public.recountings (stock_take_line_id);
create index recountings_status_idx on public.recountings (status);

-- Updated_at trigger for stock_take_lines
create or replace function public.update_stock_take_lines_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger stock_take_lines_updated_at
  before update on public.stock_take_lines
  for each row execute function public.update_stock_take_lines_updated_at();

-- Realtime
-- Realtime (guarded: plain Postgres has no supabase_realtime publication; 0015 pattern)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
  else
    execute format('alter publication supabase_realtime add table public.stock_takes');
    execute format('alter publication supabase_realtime add table public.stock_take_lines');
    execute format('alter publication supabase_realtime add table public.recountings');
  end if;
end $$;

-- Grants
grant select, insert, update on public.stock_takes to authenticated;
grant select, insert, update on public.stock_take_lines to authenticated;
grant select, insert, update on public.recountings to authenticated;