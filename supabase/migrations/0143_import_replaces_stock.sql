-- =====================================================================
-- 0143  Import: "Ganti seluruh stok" replaces the stock, with no hold
--
--  0108 kept a stock row a full import would have zeroed when the app had
--  moved it last and the file no longer listed its SKU in that bin. The
--  row stayed as a hold for an admin. When the same file listed ANOTHER
--  SKU in that bin, the import booked it next to the held one: two SKUs in
--  one bin, against the warehouse's rule of one bin, one SKU.
--  16 Nov 2026: the import of the 14 November file held 76 rows in 73 bins;
--  in 26 of them the file put a different SKU (CC25A02: 550043469 from the
--  file next to the held 550056228). Nobody on the floor could tell which
--  one the system meant, and the bins were corrected by hand through
--  Selisih hitung all day.
--
--  User decision, 17 Nov 2026: a full import follows the Excel sheet. It
--  replaces all stock; nothing is held back.
--
--  import_snapshot (0132 body):
--   - full_sync zeroes every row the file does not list, as before 0108.
--   - holds still open from earlier imports are settled by the file.
--   - returns held = 0 (kept for old clients) and settled.
--  Unchanged: bins with rows rejected by validation (keep_bins) keep their
--  stock, and CKB 3PL racks are never touched. import_holds, its view and
--  resolve_import_holds stay for the history and for holds in such bins.
--
--  What 0108 guarded against comes back by this decision: a move recorded
--  in the app and never booked in the Excel is undone by the next full
--  import. The Excel sheet is the stock of record on an import day.
-- =====================================================================

create or replace function public.import_snapshot(rows jsonb, full_sync boolean, source_name text, keep_bins text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin uuid; v_item uuid; v_cur numeric; v_diff numeric; v_exp date; v_batch text;
  n_bins int := 0; n_items int := 0; n_moves int := 0; n_settled int := 0; inv record;
  v_note text := 'IMPORT ' || coalesce(source_name, 'file');
  v_brow public.bins%rowtype; v_skip jsonb := '[]'::jsonb;
begin
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Only admins can import';
  end if;
  -- Opening balances: the file is the approval; reason OPENING, by the import.
  perform set_config('app.adjust_approved', 'on', true);
  perform set_config('app.adjust_reason', 'OPENING', true);
  perform set_config('app.by_name', 'impor ' || coalesce(source_name, 'file'), true);

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
  return jsonb_build_object('rows', n_bins, 'item_rows', n_items, 'movements', n_moves, 'held', 0, 'settled', n_settled, 'skipped', v_skip);
end $$;

revoke execute on function public.import_snapshot(jsonb, boolean, text, text[]) from public, anon;
grant execute on function public.import_snapshot(jsonb, boolean, text, text[]) to authenticated;
