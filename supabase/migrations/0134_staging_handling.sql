-- =====================================================================
-- 0134  Staging: Rekap inbound STAGE-IN rows are booked into STAGING once
--       per arrival day, and moved into a rack from the Staging page
--
-- 3 Nov 2026: the Rekap inbound sheet listed 20 drums of 550046498 (4 EA
-- each) with BIN Location "STAGE-IN": no rack room for drums that day. SAP
-- booked them from the goods receipt, the WMS refused the rows as an
-- unknown bin, so the drums vanished from our stock until someone put them
-- in a rack and SAP vs WMS showed a gap that was not missing stock. The
-- Rekap is never updated when a drum later reaches a rack (still STAGE-IN
-- on 6 Nov), and Pallet IDs are reused across items (540000774460 is a
-- staging drum of 550046498 on 3 Nov and 44 CAR of 550070613 in CE35C01 on
-- 4 Nov), so neither the sheet nor the Pallet ID can tell a re-upload from
-- new drums. The arrival day can: a day's staging line is posted once.
--
--  * staging_receipts: append-only, what was posted into STAGING per arrival
--    day + SKU + batch + expiry. A day's sheet is filled in over several
--    passes, so an upload compares its quantity with the day line's sum:
--    more posts only the difference, the same posts nothing, less posts
--    nothing and is shown with the recorded quantity (staging_less).
--  * putaway_import_arrival (0117): rows into the STAGING bin skip
--    putaway_import's one-bin-one-content conflict checks (staging always
--    holds a mix) and are posted additively; the rest, floor spots STG_xx
--    included, go to putaway_import (0066) unchanged. Both are booked on the
--    arrival day for Buku stok.
--  * staging_stock() / staging_to_rack(...): the Staging page's list and its
--    one move (a transfer into a rack), for Inventory, Admin Inbound,
--    Leader and Admin.
--
-- Staging stays pickable as a last resort (allocator step 6, unchanged).
-- Spec: docs/superpowers/specs/2026-11-08-staging-handling-design.md. SQL test 98.
-- =====================================================================

create table public.staging_receipts (
  id           uuid primary key default gen_random_uuid(),
  arrival_date date not null,
  bin_id       uuid not null references public.bins(id),
  item_id      uuid not null references public.items(id),
  batch_lot    text not null,
  expiry_date  date,
  quantity     numeric not null check (quantity > 0),
  movement_id  uuid not null references public.movements(id),
  import_id    uuid not null,
  source       text,
  by_name      text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index staging_receipts_day_line
  on public.staging_receipts (arrival_date, bin_id, item_id, batch_lot, coalesce(expiry_date, 'infinity'::date));
create trigger staging_receipts_forbid_change before update or delete on public.staging_receipts
  for each row execute function public.ledger_forbid_change();
alter table public.staging_receipts enable row level security;
create policy "staging_receipts: read" on public.staging_receipts for select to authenticated using ((select public.is_active()));
grant select on public.staging_receipts to authenticated;

-- ---------------------------------------------------------------------
-- 1  Putaway upload: staging rows posted once per arrival day
-- ---------------------------------------------------------------------
create or replace function public.putaway_import_arrival(p_rows jsonb, p_source text, p_apply boolean,
  p_by_name text default null, p_arrival_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date; v_res jsonb; v_import uuid;
  v_rack jsonb := '[]'::jsonb; v_stage jsonb := '[]'::jsonb; v_out jsonb := '[]'::jsonb;
  r jsonb; v_bin uuid; v_item uuid; v_batch text; v_exp date; v_mov uuid; v_movs uuid[] := '{}';
  v_qty numeric; v_recorded numeric;
  n_staged int := 0; v_name text := nullif(trim(coalesce(p_by_name, '')), '');
begin
  if coalesce(p_apply, false) then
    if p_arrival_date is null then raise exception 'Tanggal barang datang wajib diisi'; end if;
    if p_arrival_date > v_today then raise exception 'Tanggal barang datang tidak boleh di masa depan'; end if;
    if p_arrival_date < v_today - 7 then raise exception 'Tanggal barang datang lebih dari 7 hari yang lalu'; end if;
  end if;

  -- A row into the STAGING bin (a Rekap STAGE-IN row) is a staging row; everything else, floor spots STG_xx
  -- included, goes through putaway_import as before.
  select coalesce(jsonb_agg(e) filter (where e->>'bin_code' is distinct from 'STAGING'), '[]'::jsonb),
         coalesce(jsonb_agg(e) filter (where e->>'bin_code' = 'STAGING'), '[]'::jsonb)
    into v_rack, v_stage
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e;

  if jsonb_array_length(v_rack) > 0 then
    v_res := public.putaway_import(v_rack, p_source, p_apply, p_by_name);
  else
    v_res := jsonb_build_object('rows', '[]'::jsonb, 'movements', 0, 'count_tasks', 0, 'set_over_limit', '[]'::jsonb,
                                'requests', 0, 'import_id', null);
  end if;

  if jsonb_array_length(v_stage) > 0 then
    -- The same rule as putaway_import, which the rack rows have already passed (or are absent).
    if not public.has_role(array['supervisor','admin']::public.user_role[]) then
      raise exception 'Hanya supervisor atau admin yang bisa import putaway';
    end if;
    v_import := coalesce(nullif(v_res ->> 'import_id', '')::uuid, case when p_apply then gen_random_uuid() end);
    for r in select e from jsonb_array_elements(v_stage) e order by (e->>'line')::int loop
      v_bin := (select id from public.bins where bin_code = r->>'bin_code');
      v_item := (select id from public.items where sku = r->>'sku');
      v_batch := coalesce(r->>'batch_lot', '');
      v_exp := nullif(r->>'expiry_date', '')::date;
      v_qty := (r->>'quantity')::numeric;
      if v_item is null then
        v_out := v_out || jsonb_build_object('line', (r->>'line')::int, 'status', 'conflict', 'kind', 'sku_unknown',
                                             'action', null, 'current', '[]'::jsonb);
        continue;
      end if;
      -- Two uploads of the same day line at once wait for each other here, so neither posts what the other did.
      if p_apply then
        perform pg_advisory_xact_lock(hashtext('staging|' || p_arrival_date || '|' || v_item || '|' || v_batch || '|' || coalesce(v_exp::text, '')));
      end if;
      select coalesce(sum(s.quantity), 0) into v_recorded from public.staging_receipts s
      where p_arrival_date is not null and s.arrival_date = p_arrival_date and s.bin_id = v_bin and s.item_id = v_item
        and s.batch_lot = v_batch and s.expiry_date is not distinct from v_exp;
      if v_recorded > 0 and v_qty = v_recorded then
        v_out := v_out || jsonb_build_object('line', (r->>'line')::int, 'status', 'same', 'kind', 'staging_done',
                                             'action', null, 'current', '[]'::jsonb, 'recorded', v_recorded);
      elsif v_qty < v_recorded then
        -- The sheet now says less than was booked for that day: never taken back by an upload (the drums may
        -- have moved on); shown so someone checks, and corrected by a count or Adjust stok if it is real.
        v_out := v_out || jsonb_build_object('line', (r->>'line')::int, 'status', 'conflict', 'kind', 'staging_less',
                                             'action', null, 'current', '[]'::jsonb, 'recorded', v_recorded);
      else
        v_out := v_out || jsonb_build_object('line', (r->>'line')::int, 'status', 'new', 'kind', 'staging',
                                             'action', null, 'current', '[]'::jsonb, 'recorded', v_recorded);
        if p_apply then
          insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note, by_name)
          values ('putaway', v_item, v_batch, v_qty - v_recorded, v_bin, v_exp, p_arrival_date,
                  'Rekap inbound ' || coalesce(p_source, 'file') || ' (STAGE-IN)', v_name)
          returning id into v_mov;
          insert into public.staging_receipts (arrival_date, bin_id, item_id, batch_lot, expiry_date, quantity,
                                               movement_id, import_id, source, by_name)
          values (p_arrival_date, v_bin, v_item, v_batch, v_exp, v_qty - v_recorded, v_mov, v_import, p_source, v_name);
          v_movs := v_movs || v_mov;
          n_staged := n_staged + 1;
        end if;
      end if;
    end loop;
    v_res := v_res || jsonb_build_object(
      'rows', (select coalesce(jsonb_agg(x order by (x->>'line')::int), '[]'::jsonb)
               from jsonb_array_elements((v_res->'rows') || v_out) x),
      'movements', (v_res->>'movements')::int + n_staged,
      'import_id', case when p_apply and (v_res->>'import_id' is not null or n_staged > 0) then v_import end);
  end if;

  v_import := nullif(v_res ->> 'import_id', '')::uuid;
  if coalesce(p_apply, false) and v_import is not null then
    insert into public.putaway_arrivals (import_id, arrival_date, by_name) values (v_import, p_arrival_date, v_name);
    insert into public.putaway_arrival_moves (movement_id, import_id, arrival_date)
    select distinct m.id, v_import, p_arrival_date
    from public.putaway_log l, unnest(l.movement_ids) mid
    join public.movements m on m.id = mid
    where l.import_id = v_import and m.type = 'putaway' and m.from_bin_id is null;
    insert into public.putaway_arrival_moves (movement_id, import_id, arrival_date)
    select unnest(v_movs), v_import, p_arrival_date;
  end if;
  return v_res || jsonb_build_object('arrival_date', case when p_apply then p_arrival_date end, 'staging', n_staged);
end $$;
revoke execute on function public.putaway_import_arrival(jsonb, text, boolean, text, date) from public, anon;
grant execute on function public.putaway_import_arrival(jsonb, text, boolean, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- 2  The Staging page: what waits in staging, and the move into a rack
-- ---------------------------------------------------------------------
-- One row per stock line in a staging bin. arrival_date is what the dashboard staging tally ages on
-- (inventory.received_date: the first posting into the line), so the page and the tally use one rule.
create or replace function public.staging_stock()
returns table (bin_code text, item_id uuid, sku text, description text, uom text, batch_lot text, expiry_date date,
               quantity numeric, reserved numeric, arrival_date date, days_waiting int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_active() and public.has_job(array['inventory','admin_inbound','leader','admin'])) then
    raise exception 'Akses ditolak';
  end if;
  return query
  select x.bin_code, x.item_id, x.sku, x.description, x.uom, x.batch_lot, x.expiry_date, x.quantity, x.reserved,
         x.arrival_date, ((now() at time zone 'Asia/Jakarta')::date - x.arrival_date)::int
  from (
    select b.bin_code, i.item_id, it.sku, it.description, it.uom, i.batch_lot, i.expiry_date, i.quantity,
           coalesce((select sum(t.quantity) from public.open_pick_tasks t
                     where t.from_bin_id = i.bin_id and t.item_id = i.item_id and t.batch_lot = i.batch_lot
                       and t.expiry_date is not distinct from i.expiry_date), 0) as reserved,
           i.received_date as arrival_date
    from public.inventory i
    join public.bins b on b.id = i.bin_id
    join public.items it on it.id = i.item_id
    where b.zone = 'STAGING' and i.quantity > 0
  ) x
  order by x.arrival_date nulls first, x.bin_code, x.sku, x.batch_lot, x.expiry_date;
end $$;
revoke execute on function public.staging_stock() from public, anon;
grant execute on function public.staging_stock() to authenticated;

-- One transfer from a staging bin into a rack. The movements insert policy lets any active user post a
-- transfer, so the job is checked here; reserved quantity is checked here too, for every job, because
-- guard_reserved_stock (0007) lets supervisors through and Inventory is a supervisor-level job.
-- Whether Shell may use the rack (CKB, NOT_PRESENT, PLANNED, blocked) is left to the movement triggers.
create or replace function public.staging_to_rack(p_from_bin text, p_sku text, p_batch text, p_expiry date,
  p_qty numeric, p_to_bin text, p_by_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_from public.bins%rowtype; v_to text := upper(trim(coalesce(p_to_bin, ''))); v_to_id uuid; v_item uuid;
  v_batch text := coalesce(p_batch, ''); v_inv public.inventory%rowtype; v_reserved numeric; v_waves text; v_mov uuid;
begin
  if not (public.is_active() and public.has_job(array['inventory','admin_inbound','leader','admin'])) then
    raise exception 'Akses ditolak';
  end if;
  select * into v_from from public.bins where bin_code = upper(trim(coalesce(p_from_bin, '')));
  if v_from.id is null or v_from.zone is distinct from 'STAGING' then
    raise exception 'Bukan lokasi staging: %', p_from_bin;
  end if;
  if v_to !~ '^C[A-Z][0-9]{2}[A-E][0-9]{2}$' then raise exception 'Tujuan harus lokasi rak: %', p_to_bin; end if;
  select id into v_to_id from public.bins where bin_code = v_to;
  if v_to_id is null then raise exception 'Lokasi rak tidak ditemukan: %', v_to; end if;
  select id into v_item from public.items where sku = trim(coalesce(p_sku, ''));

  select * into v_inv from public.inventory
  where bin_id = v_from.id and item_id = v_item and batch_lot = v_batch and expiry_date is not distinct from p_expiry
  for update;
  if p_qty is null or p_qty <= 0 or p_qty > coalesce(v_inv.quantity, 0) then
    raise exception 'Jumlah melebihi stok di staging (% tersedia)', coalesce(v_inv.quantity, 0);
  end if;

  select coalesce(sum(t.quantity), 0), string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ')
    into v_reserved, v_waves
  from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
  where t.from_bin_id = v_from.id and t.item_id = v_item and t.batch_lot = v_batch
    and t.expiry_date is not distinct from p_expiry;
  if v_inv.quantity - p_qty < v_reserved then
    raise exception 'Stok ini dipesan % unit untuk wave %. Kerjakan lewat halaman Wave.', v_reserved, v_waves;
  end if;

  insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, received_date, note, by_name)
  values ('transfer', v_item, v_batch, p_qty, v_from.id, v_to_id, p_expiry, v_inv.received_date, 'Dari staging',
          nullif(trim(coalesce(p_by_name, '')), ''))
  returning id into v_mov;
  return v_mov;
end $$;
revoke execute on function public.staging_to_rack(text, text, text, date, numeric, text, text) from public, anon;
grant execute on function public.staging_to_rack(text, text, text, date, numeric, text, text) to authenticated;
