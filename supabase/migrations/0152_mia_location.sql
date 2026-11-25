-- =====================================================================
-- 0152  MIA (Missing In Action): a location for stock nobody can find
--
-- Investigasi selisih used to close a gap it could not explain with an
-- immediate adjustment. MIA is the in-between place: stock the system
-- holds (or SAP expects) but the floor cannot show. It sits in the bin
-- `MIA` until a supervisor finds it (MIA -> rack) or clears it.
--
-- Decisions (user, 24 Nov 2026):
--   * MIA is NOT part of the WMS total in the SAP comparison. A rack -> MIA
--     transfer therefore shrinks our side of the gap; stock booked into MIA
--     for a minus gap leaves the gap visible, explained by MIA.
--   * A supervisor clears it.
--
-- This migration is the location only:
--   1. the bin MIA (floor location, zone MIA, shared like RETN / STAGING);
--   2. movements_a_mia_guard: no movement into or out of MIA unless the MIA
--      functions switch app.mia_movement on (they come with the next
--      migration) - so nobody parks stock there by hand;
--   3. MIA is left out of the SAP comparison (wms_stock_by_sku, _at, _day);
--   4. a full import never zeroes MIA stock (the file never lists it).
--
-- MIA is never picked (the allocator only picks rack codes, C[A-Z]dd[A-E]dd),
-- never a putaway target, and is not in config FLOOR_LOCATIONS, so an Excel
-- file that lists a bin called MIA is rejected as an unknown code.
-- Idempotent: safe to re-run on the same state.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1  The bin
-- ---------------------------------------------------------------------
insert into public.bins (bin_code, zone, rack, level, position, status)
values ('MIA', 'MIA', null, null, null, 'active')
on conflict (bin_code) do nothing;

insert into public.bin_changes (change_set, bin_code, field, old_value, new_value, reason, changed_by_name)
select gen_random_uuid(), 'MIA', 'CREATED', null, 'ACTIVE', 'Lokasi MIA (Missing In Action): stok yang belum ketemu', 'migrasi 0152'
where not exists (select 1 from public.bin_changes where bin_code = 'MIA' and field = 'CREATED');

-- ---------------------------------------------------------------------
-- 2  The movement guard
-- ---------------------------------------------------------------------
-- Runs before movements_apply (trigger name order: _a_ < _apply), like movements_a_site_guard.
create or replace function public.movements_mia_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_from text; v_to text;
begin
  if coalesce(current_setting('app.mia_movement', true), '') = 'on' then return new; end if;
  select zone into v_from from public.bins where id = new.from_bin_id;
  select zone into v_to from public.bins where id = new.to_bin_id;
  if v_from = 'MIA' or v_to = 'MIA' then
    raise exception 'Lokasi MIA hanya bisa diisi atau dikosongkan lewat Investigasi selisih (Rekonsiliasi SAP)';
  end if;
  return new;
end $$;

drop trigger if exists movements_a_mia_guard on public.movements;
create trigger movements_a_mia_guard before insert on public.movements
  for each row execute function public.movements_mia_guard();

-- ---------------------------------------------------------------------
-- 3  MIA is not our side of the SAP comparison
-- ---------------------------------------------------------------------
-- 0021 (stock now): MIA stock is left out.
create or replace function public.wms_stock_by_sku()
returns table (item_id uuid, sku text, description text, uom text, physical numeric, unrestricted numeric, blocked numeric)
language sql stable security definer set search_path = public as $$
  with lines as (
    select i.item_id, i.quantity,
           case when b.zone = 'QUARANTINE' then i.quantity
                else public.held_qty(i.bin_id, i.item_id, i.batch_lot, i.expiry_date, i.quantity) end as blocked
    from public.inventory i join public.bins b on b.id = i.bin_id
    where b.zone <> 'MIA'
  )
  select it.id, it.sku, it.description, it.uom, sum(l.quantity), sum(l.quantity - l.blocked), sum(l.blocked)
  from lines l join public.items it on it.id = l.item_id
  group by it.id, it.sku, it.description, it.uom;
$$;

-- 0112 (stock at a cut-off time): the stock now, minus what happened since. What MIA did since then is
-- not a change of our side except the transfers: rack -> MIA took stock out of the counted total, MIA -> rack put it back.
create or replace function public.wms_stock_by_sku_at(p_at timestamptz)
returns table (item_id uuid, sku text, description text, uom text, physical numeric, unrestricted numeric, blocked numeric)
language sql stable security definer set search_path = public as $$
  with now_stock as (
    select w.item_id, w.physical, w.blocked from public.wms_stock_by_sku() w
  ), later as (     -- what happened after the cut-off, per item
    select m.item_id,
           sum(case m.type
                 when 'inbound' then m.quantity
                 when 'putaway' then case when m.from_bin_id is null then m.quantity else 0 end
                 when 'picking' then -m.quantity
                 when 'adjustment' then case when tb.zone = 'MIA' then 0 else m.quantity end
                 when 'transfer' then (case when fb.zone = 'MIA' then m.quantity else 0 end)
                                    - (case when tb.zone = 'MIA' then m.quantity else 0 end)
                 else 0 end) as phys,
           sum(case when tb.zone = 'QUARANTINE' and m.type <> 'picking' then m.quantity else 0 end)
         - sum(case when fb.zone = 'QUARANTINE' then m.quantity else 0 end) as blk
    from public.movements m
    left join public.bins tb on tb.id = m.to_bin_id
    left join public.bins fb on fb.id = m.from_bin_id
    where m.created_at > p_at
    group by m.item_id
  ), at_cut as (
    select coalesce(n.item_id, l.item_id) as item_id,
           coalesce(n.physical, 0) - coalesce(l.phys, 0) as physical,
           coalesce(n.blocked, 0) - coalesce(l.blk, 0) as blocked
    from now_stock n full join later l on l.item_id = n.item_id
  )
  select it.id, it.sku, it.description, it.uom, a.physical,
         a.physical - least(greatest(a.blocked, 0), greatest(a.physical, 0)),
         least(greatest(a.blocked, 0), greatest(a.physical, 0))
  from at_cut a join public.items it on it.id = a.item_id
  where a.physical <> 0 or a.blocked <> 0;
$$;

-- 0113 (the daily report's on hand): bins of MIA are left out.
create or replace function public.wms_stock_by_sku_day(p_date date)
returns table (item_id uuid, sku text, description text, uom text, physical numeric, unrestricted numeric, blocked numeric)
language sql stable security definer set search_path = public as $$
  with r as (
    select d.bin_code, d.sku, d.batch_lot, d.expiry_date, d.on_hand from public.wms_day_report(p_date) d where d.on_hand <> 0
  ), b as (
    select it.id as item_id, r.on_hand,
           case when bn.zone = 'QUARANTINE' then r.on_hand
                else least(greatest(public.held_qty(bn.id, it.id, r.batch_lot, r.expiry_date, r.on_hand), 0), greatest(r.on_hand, 0)) end as blocked
    from r join public.bins bn on bn.bin_code = r.bin_code join public.items it on it.sku = r.sku
    where bn.zone <> 'MIA'
  )
  select it.id, it.sku, it.description, it.uom, sum(b.on_hand), sum(b.on_hand - b.blocked), sum(b.blocked)
  from b join public.items it on it.id = b.item_id
  group by it.id, it.sku, it.description, it.uom;
$$;

-- ---------------------------------------------------------------------
-- 4  A full import never zeroes MIA
-- ---------------------------------------------------------------------
-- 0147's import_snapshot, plus: a full sync leaves the stock in MIA alone (the Excel never lists it, and the
-- movement guard would refuse the zeroing anyway). Nothing else changed.
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
  -- (keep_bins: the file is not readable there), CKB 3PL racks and MIA (the file never lists them).
  if full_sync then
    for inv in select i.* from public.inventory i
      join public.bins b on b.id = i.bin_id
      where b.bin_code <> all(keep_bins)
        and b.owner is distinct from 'CKB'
        and b.zone <> 'MIA'
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
