-- =====================================================================
-- 0001  Core schema: profiles, bins, items, inventory, movements, logs
-- =====================================================================
create extension if not exists pgcrypto;

create type public.user_role     as enum ('admin', 'supervisor', 'operator');
create type public.bin_status    as enum ('active', 'blocked');
create type public.movement_type as enum ('inbound', 'putaway', 'picking', 'transfer', 'adjustment');

-- One profile per auth user. Role drives every RLS policy.
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  role       public.user_role not null default 'operator',
  created_at timestamptz not null default now()
);

-- Bin = one pallet position. Code format CA01C01 = aisle CA, rack 01, level C, position 01.
create table public.bins (
  id         uuid primary key default gen_random_uuid(),
  bin_code   text not null unique,
  zone       text not null,              -- aisle (CA..CG) or STAGING / QUARANTINE
  rack       text,                       -- 01..40, null for floor locations
  level      text,                       -- A..E
  position   text,                       -- 01/02 (or staging lane number)
  abc_class  text check (abc_class in ('A','B','C')),
  capacity   numeric default 1,          -- pallets; 1 rack bin = 1 pallet (CONFIRM). null = floor area, no limit
  pos_x      numeric, pos_y numeric, pos_z numeric,
  status     public.bin_status not null default 'active',
  created_at timestamptz not null default now()
);
create index bins_zone_rack_idx on public.bins (zone, rack);

create table public.items (
  id          uuid primary key default gen_random_uuid(),
  sku         text not null unique,      -- SAP material number, e.g. 550070612
  description text not null,
  uom         text,                      -- base UoM from Master SKU (CAR / EA)
  upp         numeric,                   -- units per pallet (MASTER DATA.UPP) -> bin utilisation
  volume_l    numeric,                   -- litres per unit (MASTER DATA.VOLUME)
  abc_class   text check (abc_class in ('A','B','C')),
  created_at  timestamptz not null default now()
);

-- Current stock. Written ONLY by the movements trigger (no write policies exist).
create table public.inventory (
  id            uuid primary key default gen_random_uuid(),
  bin_id        uuid not null references public.bins(id),
  item_id       uuid not null references public.items(id),
  batch_lot     text not null default '',   -- '' = batch unknown (kept explicit, never null)
  quantity      numeric not null check (quantity >= 0),
  expiry_date   date,
  received_date date,
  updated_at    timestamptz not null default now(),
  unique (bin_id, item_id, batch_lot)
);
create index inventory_expiry_idx on public.inventory (expiry_date);

-- Immutable ledger. Every stock change is one row here.
create table public.movements (
  id            uuid primary key default gen_random_uuid(),
  type          public.movement_type not null,
  item_id       uuid not null references public.items(id),
  batch_lot     text not null default '',
  quantity      numeric not null,           -- > 0, except adjustment which is signed
  from_bin_id   uuid references public.bins(id),
  to_bin_id     uuid references public.bins(id),
  expiry_date   date,                       -- needed when stock lands in a bin for the first time
  received_date date,
  user_id       uuid references public.profiles(id),  -- null only for system imports/seed
  created_at    timestamptz not null default now(),
  note          text,
  constraint movement_qty_sign check (
    (type = 'adjustment' and quantity <> 0) or (type <> 'adjustment' and quantity > 0)
  ),
  constraint movement_bins check (
    case type
      when 'inbound'    then to_bin_id is not null
      when 'putaway'    then to_bin_id is not null
      when 'picking'    then from_bin_id is not null
      when 'transfer'   then from_bin_id is not null and to_bin_id is not null and from_bin_id <> to_bin_id
      when 'adjustment' then to_bin_id is not null
    end
  )
);
create index movements_created_idx on public.movements (created_at desc);
create index movements_from_idx on public.movements (from_bin_id);
create index movements_to_idx   on public.movements (to_bin_id);

create table public.scan_logs (
  id         bigint generated always as identity primary key,
  bin_id     uuid not null references public.bins(id),
  user_id    uuid not null references public.profiles(id),
  scanned_at timestamptz not null default now()
);

create table public.print_logs (
  id         bigint generated always as identity primary key,
  bin_ids    uuid[] not null,
  user_id    uuid not null references public.profiles(id),
  printed_at timestamptz not null default now(),
  note       text
);

-- Key/value settings (warehouse layout for the 3D view lives here).
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value) values ('layout', '{
  "aisle_order": ["CA","CB","CC","CD","CE","CF","CG"],
  "bay_width_m": 2.7,
  "rack_depth_m": 1.2,
  "level_height_m": 1.6,
  "aisle_width_m": 3.2,
  "positions_per_bay": 2,
  "floor_zone_origin": {"x": 0, "z": -8},
  "_note": "PLACEHOLDER values. Replace with measured WSM SUB 2 dimensions in Admin > Settings."
}'::jsonb);
