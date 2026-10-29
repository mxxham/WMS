-- =====================================================================
-- 0116  Buku stok: SAP's book against the WMS book, per day
--
-- The team keeps a hand workbook (Book to Book SHELL_<month>.xlsx) where
-- every day SAP's MB52 / MB51 sit next to the warehouse's own stock,
-- inbound and outbound, and a BOOK TO BOOK sheet shows per SKU
-- awal + inbound - outbound +- block moves = akhir for both books. Its
-- warehouse side was a copy of SAP's numbers (equal on all 1,554 SKU-days
-- of October 2026). This page takes the warehouse side from our own
-- movements instead. Spec: docs/superpowers/specs/2026-10-28-inventory-ledger-design.md
--
--  * ledger_days / ledger_sap_lines: one upload of SAP's daily file = one
--    version of a day, stored per SKU as computed in the browser
--    (lib/ledger/sap-book.ts). Re-uploading makes a new version.
--  * ledger_notes: a note on a SKU from a date; shown while the SKU still
--    differs. A change or a close is a new row.
--  * ledger_inbound_moves(from, to): the movements that bring goods into the
--    warehouse, posted in a window, with the date they ARRIVED. The team enters today's inbound
--    tomorrow, so a putaway (no source bin) arrived the day before it was
--    posted; a receipt (Penerimaan, type inbound) on its own date. This is
--    the only place the rule lives (0117 replaces the assumption with the
--    recorded date).
--  * ledger_wms_book(date): the WMS book of a day, computed live from the
--    append-only movements. akhir = the real stock at the end of the day
--    + goods that arrived by then but were put away later: the stock SAP
--    holds, because SAP books on arrival. Blocked = stock in QUARANTINE.
-- All tables are append-only, read-only to clients, written only by the
-- role-checking functions below.
-- =====================================================================

create table public.ledger_days (
  id          uuid primary key default gen_random_uuid(),
  ledger_date date not null,
  version     int not null check (version >= 1),
  file_name   text not null,
  mb51_count  int not null default 0,
  inbd_total  numeric not null default 0,
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  by_name     text,
  created_at  timestamptz not null default now(),
  unique (ledger_date, version)
);

create table public.ledger_sap_lines (
  day_id        uuid not null references public.ledger_days(id),
  sku           text not null,
  description   text not null default '',
  uom           text not null default '',
  awal_unrest   numeric not null default 0,
  awal_block    numeric not null default 0,
  inbound       numeric not null default 0,
  outbound      numeric not null default 0,
  mv343         numeric not null default 0,
  mv344         numeric not null default 0,
  z55           numeric not null default 0,
  other_unrest  numeric not null default 0,
  other_by_type jsonb not null default '{}'::jsonb,
  akhir_unrest  numeric not null default 0,
  akhir_block   numeric not null default 0,
  inbd          numeric not null default 0,
  primary key (day_id, sku)
);

create table public.ledger_notes (
  id         uuid primary key default gen_random_uuid(),
  sku        text not null,
  from_date  date not null,
  note       text not null default '',
  closed     boolean not null default false,
  by_name    text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index ledger_notes_sku_idx on public.ledger_notes (sku, from_date);

create or replace function public.ledger_forbid_change() returns trigger language plpgsql as $$
begin raise exception 'Buku stok tidak bisa diubah atau dihapus: upload versi baru atau tulis catatan baru'; end $$;
create trigger ledger_days_forbid_change before update or delete on public.ledger_days
  for each row execute function public.ledger_forbid_change();
create trigger ledger_sap_lines_forbid_change before update or delete on public.ledger_sap_lines
  for each row execute function public.ledger_forbid_change();
create trigger ledger_notes_forbid_change before update or delete on public.ledger_notes
  for each row execute function public.ledger_forbid_change();

alter table public.ledger_days enable row level security;
alter table public.ledger_sap_lines enable row level security;
alter table public.ledger_notes enable row level security;
create policy "ledger_days: read" on public.ledger_days for select to authenticated using ((select public.is_active()));
create policy "ledger_sap_lines: read" on public.ledger_sap_lines for select to authenticated using ((select public.is_active()));
create policy "ledger_notes: read" on public.ledger_notes for select to authenticated using ((select public.is_active()));
grant select on public.ledger_days, public.ledger_sap_lines, public.ledger_notes to authenticated;

create view public.ledger_latest_days with (security_invoker = true) as
select distinct on (ledger_date) * from public.ledger_days order by ledger_date, version desc;
grant select on public.ledger_latest_days to authenticated;

-- ---------------------------------------------------------------------
-- Inbound by arrival date
-- ---------------------------------------------------------------------
-- The inbound movements POSTED in [p_from, p_to), with their arrival date. Callers pass a window: an
-- arrival is at most 7 days before its posting (the putaway page's limit, 0117; 1 day when assumed),
-- so a day never needs more than the 8 days of postings from its start. That keeps every call on
-- movements_created_idx instead of the whole history.
create or replace function public.ledger_inbound_moves(p_from timestamptz, p_to timestamptz)
returns table (movement_id uuid, item_id uuid, to_bin_id uuid, quantity numeric, posted_date date, arrival_date date, assumed boolean)
language sql stable security invoker set search_path = public as $$
  select m.id, m.item_id, m.to_bin_id, m.quantity,
         (m.created_at at time zone 'Asia/Jakarta')::date,
         case when m.type = 'inbound' then (m.created_at at time zone 'Asia/Jakarta')::date
              else (m.created_at at time zone 'Asia/Jakarta')::date - 1 end,
         m.type = 'putaway'
  from public.movements m
  where m.created_at >= p_from and m.created_at < p_to
    and (m.type = 'inbound' or (m.type = 'putaway' and m.from_bin_id is null));
$$;

-- ---------------------------------------------------------------------
-- The WMS book of a day
-- ---------------------------------------------------------------------
create type public.ledger_wms_book_row as (
  sku text, description text, uom text,
  awal_unrest numeric, awal_block numeric,
  inbound numeric, inbound_block numeric, inbound_assumed numeric,
  outbound numeric, q_in numeric, q_out numeric,
  other_unrest numeric, other_block numeric,
  akhir_unrest numeric, akhir_block numeric
);

-- Stock per item at the end of p_date as SAP should hold it: the real stock then
-- + goods that had arrived by then but were put away later. Split by quarantine.
create or replace function public.ledger_wms_end(p_date date)
returns table (item_id uuid, unrest numeric, block numeric)
language sql stable security invoker set search_path = public as $$
  with b as (select ((p_date + 1)::timestamp at time zone 'Asia/Jakarta') as t1),
  legs as (
    select i.item_id, bn.zone = 'QUARANTINE' as q, i.quantity as qty
      from public.inventory i join public.bins bn on bn.id = i.bin_id
    union all  -- undo every movement after the day
    select m.item_id, bn.zone = 'QUARANTINE', m.quantity
      from public.movements m join public.bins bn on bn.id = m.from_bin_id, b where m.created_at >= b.t1
    union all
    select m.item_id, bn.zone = 'QUARANTINE', -m.quantity
      from public.movements m join public.bins bn on bn.id = m.to_bin_id, b where m.created_at >= b.t1
    union all  -- arrived by then, put away later (at most 7 days later)
    select im.item_id, bn.zone = 'QUARANTINE', im.quantity
      from b, public.ledger_inbound_moves(b.t1, b.t1 + interval '7 days') im join public.bins bn on bn.id = im.to_bin_id
     where im.arrival_date <= p_date
  )
  select item_id, coalesce(sum(qty) filter (where not q), 0), coalesce(sum(qty) filter (where q), 0)
  from legs group by item_id;
$$;

create or replace function public.ledger_wms_book(p_date date)
returns setof public.ledger_wms_book_row
language sql stable security invoker set search_path = public as $$
  with b as (
    select (p_date::timestamp at time zone 'Asia/Jakarta') as t0, ((p_date + 1)::timestamp at time zone 'Asia/Jakarta') as t1
  ), awal as (select * from public.ledger_wms_end(p_date - 1)),
  akhir as (select * from public.ledger_wms_end(p_date)),
  inb as (
    select im.item_id, sum(im.quantity) as qty,
           coalesce(sum(im.quantity) filter (where bn.zone = 'QUARANTINE'), 0) as qty_block,
           coalesce(sum(im.quantity) filter (where im.assumed), 0) as qty_assumed
      from b, public.ledger_inbound_moves(b.t0, b.t0 + interval '8 days') im join public.bins bn on bn.id = im.to_bin_id
     where im.arrival_date = p_date group by im.item_id
  ), mv as (  -- the day's movements other than inbound ones (those are filed by arrival date above)
    select m.*, fb.zone = 'QUARANTINE' as from_q, tb.zone = 'QUARANTINE' as to_q,
           (m.type = 'adjustment' and exists (select 1 from public.pick_tasks pt where pt.id = m.ref_id and pt.task_type = 'PICK')) as unpick
      from public.movements m
      left join public.bins fb on fb.id = m.from_bin_id
      left join public.bins tb on tb.id = m.to_bin_id, b
     where m.created_at >= b.t0 and m.created_at < b.t1
       and not (m.type = 'inbound' or (m.type = 'putaway' and m.from_bin_id is null))
  ), flows as (
    select item_id,
      coalesce(sum(quantity) filter (where type = 'picking'), 0)
        - coalesce(sum(quantity) filter (where unpick), 0) as outbound,
      coalesce(sum(quantity) filter (where type = 'transfer' and not coalesce(from_q, false) and coalesce(to_q, false)), 0) as q_in,
      coalesce(sum(quantity) filter (where type = 'transfer' and coalesce(from_q, false) and not coalesce(to_q, false)), 0) as q_out,
      -- everything else, as signed legs by zone (adjustments, and any other kind of movement)
      coalesce(sum(case when to_bin_id is not null and not to_q then quantity else 0 end
                  - case when from_bin_id is not null and not from_q then quantity else 0 end)
               filter (where type not in ('picking', 'transfer') and not unpick), 0) as other_unrest,
      coalesce(sum(case when to_bin_id is not null and to_q then quantity else 0 end
                  - case when from_bin_id is not null and from_q then quantity else 0 end)
               filter (where type not in ('picking', 'transfer') and not unpick), 0) as other_block
    from mv group by item_id
  ), ids as (
    select item_id from awal union select item_id from akhir union select item_id from inb union select item_id from flows
  )
  select it.sku, it.description, coalesce(it.uom, ''),
         coalesce(a.unrest, 0), coalesce(a.block, 0),
         coalesce(i.qty, 0), coalesce(i.qty_block, 0), coalesce(i.qty_assumed, 0),
         coalesce(f.outbound, 0), coalesce(f.q_in, 0), coalesce(f.q_out, 0),
         coalesce(f.other_unrest, 0), coalesce(f.other_block, 0),
         coalesce(z.unrest, 0), coalesce(z.block, 0)
  from ids
  join public.items it on it.id = ids.item_id
  left join awal a on a.item_id = ids.item_id
  left join akhir z on z.item_id = ids.item_id
  left join inb i on i.item_id = ids.item_id
  left join flows f on f.item_id = ids.item_id
  where coalesce(a.unrest, 0) <> 0 or coalesce(a.block, 0) <> 0 or coalesce(z.unrest, 0) <> 0 or coalesce(z.block, 0) <> 0
     or coalesce(i.qty, 0) <> 0 or coalesce(f.outbound, 0) <> 0 or coalesce(f.q_in, 0) <> 0 or coalesce(f.q_out, 0) <> 0
     or coalesce(f.other_unrest, 0) <> 0 or coalesce(f.other_block, 0) <> 0
  order by it.sku;
$$;

grant execute on function public.ledger_inbound_moves(timestamptz, timestamptz), public.ledger_wms_end(date),
  public.ledger_wms_book(date) to authenticated;

-- ---------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------
create or replace function public.ledger_save_day(p_date date, p_file_name text, p_by_name text,
  p_mb51_count int, p_inbd_total numeric, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_version int;
begin
  if not public.has_job(array['inventory','leader','admin']) then
    raise exception 'Hanya Inventory, Leader atau Admin yang bisa mengupload Buku stok';
  end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal % di masa depan', p_date;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'File tidak berisi stok WHS1';
  end if;
  perform pg_advisory_xact_lock(hashtext('ledger_day:' || p_date::text));
  select coalesce(max(version), 0) + 1 into v_version from public.ledger_days where ledger_date = p_date;
  insert into public.ledger_days (ledger_date, version, file_name, mb51_count, inbd_total, by_name)
  values (p_date, v_version, coalesce(nullif(trim(p_file_name), ''), 'file'), coalesce(p_mb51_count, 0), coalesce(p_inbd_total, 0),
          nullif(trim(p_by_name), ''))
  returning id into v_id;
  insert into public.ledger_sap_lines (day_id, sku, description, uom, awal_unrest, awal_block, inbound, outbound,
    mv343, mv344, z55, other_unrest, other_by_type, akhir_unrest, akhir_block, inbd)
  select v_id, l.sku, coalesce(l.description, ''), coalesce(l.uom, ''), coalesce(l.awal_unrest, 0), coalesce(l.awal_block, 0),
         coalesce(l.inbound, 0), coalesce(l.outbound, 0), coalesce(l.mv343, 0), coalesce(l.mv344, 0), coalesce(l.z55, 0),
         coalesce(l.other_unrest, 0), coalesce(l.other_by_type, '{}'::jsonb), coalesce(l.akhir_unrest, 0), coalesce(l.akhir_block, 0),
         coalesce(l.inbd, 0)
  from jsonb_to_recordset(p_lines) as l(sku text, description text, uom text, awal_unrest numeric, awal_block numeric,
       inbound numeric, outbound numeric, mv343 numeric, mv344 numeric, z55 numeric, other_unrest numeric,
       other_by_type jsonb, akhir_unrest numeric, akhir_block numeric, inbd numeric)
  where nullif(trim(l.sku), '') is not null;
  return jsonb_build_object('day_id', v_id, 'version', v_version);
end $$;

create or replace function public.ledger_add_note(p_sku text, p_from_date date, p_note text, p_closed boolean, p_by_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_job(array['inventory','leader','admin']) then
    raise exception 'Hanya Inventory, Leader atau Admin yang bisa menulis catatan Buku stok';
  end if;
  if nullif(trim(p_sku), '') is null or p_from_date is null then raise exception 'SKU dan tanggal wajib diisi'; end if;
  if not coalesce(p_closed, false) and nullif(trim(p_note), '') is null then raise exception 'Catatan wajib diisi'; end if;
  insert into public.ledger_notes (sku, from_date, note, closed, by_name)
  values (trim(p_sku), p_from_date, coalesce(trim(p_note), ''), coalesce(p_closed, false), nullif(trim(p_by_name), ''))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.ledger_save_day(date, text, text, int, numeric, jsonb),
  public.ledger_add_note(text, date, text, boolean, text) from public, anon;
grant execute on function public.ledger_save_day(date, text, text, int, numeric, jsonb),
  public.ledger_add_note(text, date, text, boolean, text) to authenticated;

-- Realtime: the page refreshes when another person uploads a day or writes a note.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['ledger_days', 'ledger_notes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
