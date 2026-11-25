-- =====================================================================
-- 0147  Block C: floor storage in a second building
--
--  20 Nov 2026. Block C is a new building next to the current warehouse
--  (Oso 5: racks CA-CG, STAGING, ...). Its 40 floor slots FA-01..FA-20 and
--  FB-01..FB-20 each hold ONE dedicated SKU, stacked 2-3 pallets high.
--  Slow-moving SKUs live there and nowhere else: a Block C SKU may never
--  enter an Oso 5 bin, and no other SKU may enter Block C.
--  Spec: docs/superpowers/specs/2026-11-20-block-c-floor-storage-design.md.
--
--  1  Model: bins.site, bins.assigned_sku.
--  2  The movement guard: one rule, on the destination bin.
--  3  Plan the slots and assign SKUs (history in bin_changes).
--  4  Import: the file is physical truth, so a violation is reported, not refused.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1  Model
-- ---------------------------------------------------------------------
alter table public.bins
  add column site         text not null default 'OSO5' check (site in ('OSO5', 'BLOCKC')),
  add column assigned_sku text;
alter table public.bins
  add constraint bins_assigned_sku_ck check (assigned_sku is null or site = 'BLOCKC');
create index bins_assigned_sku_idx on public.bins (assigned_sku) where assigned_sku is not null;

-- bins_normalize (0132) with one more rule: a code like FA-01 is a Block C slot, wherever the row came from
-- (import, seed, RPC). Only on INSERT: a bin never changes building afterwards.
create or replace function public.bins_normalize() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.bin_code ~ '^F[A-Z]-\d{2}$' then new.site := 'BLOCKC'; end if;
  if new.status = 'active' then
    if new.block_kind is not null and (tg_op = 'INSERT' or new.block_kind is distinct from old.block_kind) then
      raise exception 'Bin % aktif tidak bisa berstatus %', new.bin_code, new.block_kind;
    end if;
    new.block_kind := null;
  elsif new.block_kind is null then
    new.block_kind := 'BLOCKED';
  end if;
  if new.rack is null then
    new.owner := null;
  elsif new.owner is null then
    new.owner := 'SHELL';
  end if;
  return new;
end $$;

-- A Block C SKU is a SKU assigned to a Block C slot. The slot is the only list.
create or replace function public.is_block_c_sku(p_sku text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bins where site = 'BLOCKC' and assigned_sku = p_sku)
$$;
grant execute on function public.is_block_c_sku(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2  The movement guard
-- ---------------------------------------------------------------------
-- Stock may enter a bin only if the SKU belongs there:
--   * a Block C slot takes only its own SKU, and only up to `capacity` pallets (the stack height, stored when the
--     slot is assigned; pallets = ceil(carton / UPP));
--   * every other bin (Oso 5) refuses a Block C SKU.
-- Leaving is never refused: a Block C SKU still sitting in Oso 5 can only be moved out. The old "one way" rule
-- (Block C -> Oso 5 refused) is this same check seen from the other side. SECURITY DEFINER so it can read the
-- stock whichever role posts. Runs before movements_apply (trigger name order: _a_ < _apply).
create or replace function public.movements_site_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.bins%rowtype; v_sku text; v_upp numeric; v_have numeric;
begin
  if coalesce(current_setting('app.site_guard', true), '') = 'off' then return new; end if;
  if new.to_bin_id is null
     or not (new.type in ('inbound', 'putaway', 'transfer') or (new.type = 'adjustment' and new.quantity > 0)) then
    return new;
  end if;
  select * into t from public.bins where id = new.to_bin_id;
  select sku, upp into v_sku, v_upp from public.items where id = new.item_id;

  if t.site = 'BLOCKC' then
    if t.assigned_sku is null then
      raise exception 'Slot % belum punya SKU: tentukan SKU slotnya dulu', t.bin_code;
    elsif t.assigned_sku <> v_sku then
      raise exception 'Slot % khusus SKU %, bukan %', t.bin_code, t.assigned_sku, v_sku;
    end if;
    if t.capacity is not null and coalesce(v_upp, 0) > 0 then
      select coalesce(sum(quantity), 0) into v_have from public.inventory where bin_id = t.id and item_id = new.item_id;
      if ceil((v_have + new.quantity) / v_upp) > t.capacity then
        raise exception 'Slot % penuh: maksimal % palet, jadi % karton akan jadi % palet',
          t.bin_code, t.capacity, new.quantity, ceil((v_have + new.quantity) / v_upp);
      end if;
    end if;
  elsif public.is_block_c_sku(v_sku) then
    raise exception 'SKU % hanya untuk Block C: tidak bisa masuk bin % (Oso 5)', v_sku, t.bin_code;
  end if;
  return new;
end $$;
create trigger movements_a_site_guard before insert on public.movements
  for each row execute function public.movements_site_guard();

-- ---------------------------------------------------------------------
-- 3  Plan the slots, assign SKUs
-- ---------------------------------------------------------------------
-- Slots are created as PLANNED (0132) and activated with activate_planned once the floor is marked.
-- Capacity stays null until a SKU is assigned.
create or replace function public.plan_block_c_slots(p_lanes text[], p_slots int, p_reason text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_name text; v_set uuid := gen_random_uuid();
  v_l text; v_lanes text[]; n_new int := 0; n_old int := 0;
begin
  if not public.has_role(array['admin']::public.user_role[]) then raise exception 'Hanya admin yang bisa merencanakan slot Block C'; end if;
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  if p_slots is null or p_slots not between 1 and 99 then raise exception 'Jumlah slot per jalur harus 1-99'; end if;
  select array_agg(distinct upper(trim(x))) into v_lanes from unnest(p_lanes) x where trim(coalesce(x, '')) <> '';
  if v_lanes is null then raise exception 'Isi minimal satu jalur (FA, FB, ...)'; end if;
  foreach v_l in array v_lanes loop
    if v_l !~ '^F[A-Z]$' then raise exception 'Jalur % tidak valid: harus seperti FA (F + satu huruf)', v_l; end if;
  end loop;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  with want as (
    select l || '-' || to_char(s, 'FM00') as code, l as lane, to_char(s, 'FM00') as pos
    from unnest(v_lanes) l, generate_series(1, p_slots) s),
  ins as (
    insert into public.bins (bin_code, zone, rack, level, position, status, block_kind, block_reason, capacity, site)
    select code, lane, null, null, pos, 'blocked', 'PLANNED', v_reason, null, 'BLOCKC' from want
    on conflict (bin_code) do nothing
    returning bin_code),
  lg as (
    insert into public.bin_changes (change_set, bin_code, field, old_value, new_value, reason, changed_by, changed_by_name)
    select v_set, bin_code, 'CREATED', null, 'PLANNED BLOCKC', v_reason, auth.uid(), v_name from ins returning 1)
  select (select count(*) from ins), (select count(*) from want) - (select count(*) from ins) into n_new, n_old;
  if n_new = 0 then raise exception 'Semua % slot itu sudah ada', n_old; end if;
  return jsonb_build_object('change_set', v_set, 'created', n_new, 'existing', n_old);
end $$;

-- Assign (or clear, with an empty SKU) the dedicated SKU of Block C slots. p_pallets is the stack height of that
-- SKU's pack type, worked out by the app from config/warehouse.ts (PALLETS_PER_SLOT) and stored on the slot so the
-- database can enforce it. A slot holding another SKU's stock keeps it: clear the stock first.
create or replace function public.assign_block_c_slots(p_codes text[], p_sku text, p_pallets int, p_reason text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_name text; v_set uuid := gen_random_uuid();
  v_sku text := nullif(trim(coalesce(p_sku, '')), ''); b public.bins%rowtype; n int := 0; v_refused jsonb := '[]'::jsonb;
  v_other text; v_old text;
begin
  if not public.has_role(array['supervisor', 'admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menentukan SKU slot';
  end if;
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  if v_sku is not null then
    if p_pallets is null or p_pallets < 1 then raise exception 'Tinggi tumpukan (palet per slot) harus 1 atau lebih'; end if;
    if not exists (select 1 from public.items where sku = v_sku) then raise exception 'SKU % tidak dikenal', v_sku; end if;
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  for b in select * from public.bins where bin_code = any (select upper(trim(x)) from unnest(p_codes) x) order by bin_code for update loop
    if b.site <> 'BLOCKC' then
      v_refused := v_refused || jsonb_build_object('bin_code', b.bin_code, 'reason', 'bukan slot Block C'); continue;
    end if;
    select string_agg(distinct it.sku, ', ') into v_other from public.inventory i join public.items it on it.id = i.item_id
      where i.bin_id = b.id and i.quantity > 0 and it.sku is distinct from v_sku;
    if v_other is not null then
      v_refused := v_refused || jsonb_build_object('bin_code', b.bin_code, 'reason', 'masih berisi SKU ' || v_other); continue;
    end if;
    v_old := b.assigned_sku;
    update public.bins set assigned_sku = v_sku, capacity = case when v_sku is null then null else p_pallets end where id = b.id;
    perform public.log_bin_change(v_set, b.bin_code, 'ATTR',
      'SKU ' || coalesce(v_old, '-') || ' · tumpukan ' || coalesce(b.capacity::text, '-'),
      'SKU ' || coalesce(v_sku, '-') || ' · tumpukan ' || coalesce(case when v_sku is null then null else p_pallets::text end, '-'),
      v_reason, v_name);
    n := n + 1;
  end loop;
  return jsonb_build_object('change_set', case when n > 0 then v_set end, 'changed', n, 'refused', v_refused);
end $$;

revoke execute on function public.plan_block_c_slots(text[], int, text, text), public.assign_block_c_slots(text[], text, int, text, text)
  from public, anon;
grant execute on function public.plan_block_c_slots(text[], int, text, text), public.assign_block_c_slots(text[], text, int, text, text)
  to authenticated;

-- ---------------------------------------------------------------------
-- 4  Import
-- ---------------------------------------------------------------------
-- 0143's import_snapshot, plus: the movement guard is switched off for the import (the Excel is the stock of record,
-- the goods are physically there) and every row that breaks the Block C rule is returned in `site_warnings`
-- (reason BLOCKC_DI_OSO5, SLOT_LAIN or SLOT_TANPA_SKU) for the page to show and for Kualitas data.
create or replace function public.import_snapshot(rows jsonb, full_sync boolean, source_name text, keep_bins text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin uuid; v_item uuid; v_cur numeric; v_diff numeric; v_exp date; v_batch text;
  n_bins int := 0; n_items int := 0; n_moves int := 0; n_settled int := 0; inv record;
  v_note text := 'IMPORT ' || coalesce(source_name, 'file');
  v_brow public.bins%rowtype; v_skip jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb; v_why text;
begin
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Only admins can import';
  end if;
  -- Opening balances: the file is the approval; reason OPENING, by the import.
  perform set_config('app.adjust_approved', 'on', true);
  perform set_config('app.adjust_reason', 'OPENING', true);
  perform set_config('app.by_name', 'impor ' || coalesce(source_name, 'file'), true);
  perform set_config('app.site_guard', 'off', true);

  -- Dropped first: a second import in the same transaction (tests, scripts) reuses the name.
  drop table if exists _seen;
  create temp table _seen (bin_id uuid, item_id uuid, batch_lot text, expiry_date date) on commit drop;

  for r in select * from jsonb_array_elements(rows) loop
    insert into public.bins (bin_code, zone, rack, level, position, status)
    values (r->>'bin_code', r->>'zone', r->>'rack', r->>'level', r->>'position',
            coalesce(r->>'status','active')::public.bin_status)
    on conflict (bin_code) do update set zone = excluded.zone, rack = excluded.rack,
      level = excluded.level, position = excluded.position
    returning id into v_bin;
    n_bins := n_bins + 1;

    continue when coalesce(r->>'sku','') = '';

    -- 0132: the WMS file is Shell's. A CKB 3PL rack is not Shell's to book, and stock cannot sit in a
    -- bin that does not exist or is not built yet: the row is skipped and reported, never guessed.
    select * into v_brow from public.bins where id = v_bin;
    if v_brow.owner = 'CKB' or v_brow.block_kind in ('NOT_PRESENT', 'PLANNED') then
      -- Only a row with stock is worth a report line (the sheet lists CKB aisles with Remain Qty 0, 0086).
      if coalesce(nullif(r->>'quantity', '')::numeric, 0) > 0 then
      v_skip := v_skip || jsonb_build_object('bin_code', v_brow.bin_code, 'sku', r->>'sku',
        'quantity', nullif(r->>'quantity', '')::numeric,
        'reason', case when v_brow.owner = 'CKB' then 'CKB' when v_brow.block_kind = 'NOT_PRESENT' then 'TIDAK_ADA' else 'RENCANA' end);
      end if;
      continue;
    end if;

    -- 0147: stock the Block C rule would refuse is still booked (it is on the floor) and reported.
    if coalesce(nullif(r->>'quantity', '')::numeric, 0) > 0 then
      v_why := case
        when v_brow.site = 'BLOCKC' and v_brow.assigned_sku is null then 'SLOT_TANPA_SKU'
        when v_brow.site = 'BLOCKC' and v_brow.assigned_sku <> r->>'sku' then 'SLOT_LAIN'
        when v_brow.site = 'OSO5' and public.is_block_c_sku(r->>'sku') then 'BLOCKC_DI_OSO5'
      end;
      if v_why is not null then
        v_warn := v_warn || jsonb_build_object('bin_code', v_brow.bin_code, 'sku', r->>'sku',
          'quantity', nullif(r->>'quantity', '')::numeric, 'reason', v_why);
      end if;
    end if;

    insert into public.items (sku, description, uom, upp, volume_l)
    values (r->>'sku', coalesce(r->>'description', r->>'sku'), r->>'uom',
            nullif(r->>'upp','')::numeric, nullif(r->>'volume_l','')::numeric)
    on conflict (sku) do update set
      description = coalesce(nullif(excluded.description, ''), public.items.description),
      uom  = coalesce(excluded.uom, public.items.uom),
      upp  = coalesce(excluded.upp, public.items.upp),
      volume_l = coalesce(excluded.volume_l, public.items.volume_l)
    returning id into v_item;
    n_items := n_items + 1;

    v_batch := coalesce(r->>'batch_lot','');
    v_exp := nullif(r->>'expiry_date','')::date;
    v_cur := null;
    select quantity into v_cur from public.inventory
      where bin_id = v_bin and item_id = v_item and batch_lot = v_batch
        and expiry_date is not distinct from v_exp;
    if v_cur is null and v_exp is null then
      -- Same fallback as the trigger: a row without expiry in the file
      -- matches the batch's only row in this bin.
      select quantity, expiry_date into v_cur, v_exp from public.inventory
        where bin_id = v_bin and item_id = v_item and batch_lot = v_batch
          and (select count(*) from public.inventory
               where bin_id = v_bin and item_id = v_item and batch_lot = v_batch) = 1;
    end if;
    insert into _seen values (v_bin, v_item, v_batch, v_exp);
    v_diff := (r->>'quantity')::numeric - coalesce(v_cur, 0);
    if v_diff <> 0 then
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note)
      values ('adjustment', v_item, v_batch, v_diff, v_bin, v_exp,
              nullif(r->>'received_date','')::date, v_note);
      n_moves := n_moves + 1;
    end if;
  end loop;

  -- Full snapshot: the file is the stock. Every stock row the file does not list is zeroed, with a
  -- ledger entry, whoever moved it last (0143). Left alone: bins whose rows validation rejected
  -- (keep_bins: the file is not readable there) and CKB 3PL racks (the file never lists them).
  if full_sync then
    for inv in select i.* from public.inventory i
      join public.bins b on b.id = i.bin_id
      where b.bin_code <> all(keep_bins)
        and b.owner is distinct from 'CKB'
        and not exists (select 1 from _seen s where s.bin_id = i.bin_id and s.item_id = i.item_id
                          and s.batch_lot = i.batch_lot and s.expiry_date is not distinct from i.expiry_date)
    loop
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
      values ('adjustment', inv.item_id, inv.batch_lot, -inv.quantity, inv.bin_id, inv.expiry_date,
              v_note || ' (not in file)');
      n_moves := n_moves + 1;
    end loop;

    -- Holds left open by earlier imports (0108) are settled by this file: the stock it lists stays
    -- (KEPT), the rest was just zeroed (ZEROED).
    with c as (
      update public.import_holds h
         set resolution = case when exists (
                 select 1 from public.inventory i
                 where i.bin_id = h.bin_id and i.item_id = h.item_id and i.batch_lot = h.batch_lot
                   and i.expiry_date is not distinct from h.expiry_date and i.quantity > 0) then 'KEPT' else 'ZEROED' end,
             resolved_at = now(), resolved_by = auth.uid()
        from public.bins hb
       where hb.id = h.bin_id and h.resolution is null
         and hb.bin_code <> all(keep_bins) and hb.owner is distinct from 'CKB'
      returning 1)
    select count(*) into n_settled from c;
  end if;

  perform set_config('app.adjust_approved', '', true);
  perform set_config('app.adjust_reason', '', true);
  perform set_config('app.by_name', '', true);
  perform set_config('app.site_guard', '', true);
  return jsonb_build_object('rows', n_bins, 'item_rows', n_items, 'movements', n_moves, 'held', 0, 'settled', n_settled,
                            'skipped', v_skip, 'site_warnings', v_warn);
end $$;

revoke execute on function public.import_snapshot(jsonb, boolean, text, text[]) from public, anon;
grant execute on function public.import_snapshot(jsonb, boolean, text, text[]) to authenticated;
