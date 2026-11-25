-- =====================================================================
-- 0142  Inventory → Stok: add stock to an empty bin from the row itself
--
-- The Stok tab lists every empty Shell rack position with quantity 0
-- (0140), but the row had no action: adding stock found in that bin
-- meant walking to Adjust stok and retyping the bin. The inventory
-- controller asked to add the stock from the row: SKU, batch, expired
-- and quantity typed into one dialog (17 Nov 2026).
--
-- create_stock_in_bin is adjust_stock_line (0140) for a bin without
-- stock: supervisor / admin only, a reason code, a note and a name,
-- posted at once without a second person (the same decision as 0140 —
-- the limit stays everywhere else). The movement is a positive
-- adjustment; apply_movement creates the stock line, so the identity
-- (bin + SKU + batch + expiry), bin usability (0132's movements_bin_guard:
-- no NOT_PRESENT / PLANNED bins, no CKB 3PL racks) and the ledger all
-- go through the engine's own paths. The line is never picked before
-- its expiry: nothing here bypasses FEFO, it only puts stock on the
-- shelves so the ledger matches the floor.
-- =====================================================================

create or replace function public.create_stock_in_bin(
  p_bin_code text, p_sku text, p_batch text, p_expiry date, p_qty numeric,
  p_reason_code text, p_note text, p_by_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name); v_bin uuid; v_item uuid; v_mov uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menambah stok';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah yang ditambahkan harus di atas 0'; end if;
  if p_reason_code is null then raise exception 'Kode alasan wajib dipilih'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Keterangan wajib diisi'; end if;
  select id into v_bin from public.bins where bin_code = upper(trim(p_bin_code));
  if v_bin is null then raise exception 'Bin % tidak ada', p_bin_code; end if;
  select id into v_item from public.items where sku = trim(p_sku);
  if v_item is null then raise exception 'SKU % tidak ada di master item', p_sku; end if;

  perform set_config('app.adjust_approved', 'on', true);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
  values ('adjustment', v_item, coalesce(p_batch, ''), p_qty, v_bin, p_expiry, trim(p_note), p_reason_code, v_name)
  returning id into v_mov;
  perform set_config('app.adjust_approved', '', true);
  return v_mov;
end $$;
revoke execute on function public.create_stock_in_bin(text, text, text, date, numeric, text, text, text) from public, anon;
grant execute on function public.create_stock_in_bin(text, text, text, date, numeric, text, text, text) to authenticated;
