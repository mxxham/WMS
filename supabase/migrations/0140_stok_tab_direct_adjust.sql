-- =====================================================================
-- 0140  Inventory → Stok: an adjustment of any size posts at once
--
--  The Stok tab lists every stock line with an Adjust button. Above
--  inventory_policy.adjust_approval_qty (20) it used to become a request
--  that a second person approves on Inventory → Persetujuan (0018). The
--  inventory controller asked for that tab to post directly: finding a
--  second person for every larger correction held the work up (16 Nov 2026).
--
--  adjust_stock_line posts the adjustment itself, for an existing stock
--  line only. Everything else in guard_adjustment_policy still applies:
--  supervisor / admin, a reason code, a note and a name. The movement has
--  no approved_by_name, so "above the limit, nobody approved" stays
--  visible in the ledger.
--
--  The limit is unchanged everywhere else: a direct insert into movements,
--  Adjust stok, Koreksi picklist, counts, putaway and Investigasi selisih.
-- =====================================================================

create or replace function public.adjust_stock_line(
  p_bin_code text, p_sku text, p_batch text, p_expiry date, p_qty numeric,
  p_reason_code text, p_note text, p_by_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name); v_bin uuid; v_item uuid; v_cur numeric; v_mov uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa adjust stok';
  end if;
  if p_qty is null or p_qty = 0 then raise exception 'Jumlah adjustment tidak boleh 0'; end if;
  if p_reason_code is null then raise exception 'Kode alasan wajib dipilih'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Keterangan wajib diisi'; end if;
  select id into v_bin from public.bins where bin_code = upper(trim(p_bin_code));
  if v_bin is null then raise exception 'Bin % tidak ada', p_bin_code; end if;
  select id into v_item from public.items where sku = trim(p_sku);
  if v_item is null then raise exception 'SKU % tidak ada di master item', p_sku; end if;

  select quantity into v_cur from public.inventory
  where bin_id = v_bin and item_id = v_item and batch_lot = coalesce(p_batch, '') and expiry_date is not distinct from p_expiry
  for update;
  if v_cur is null then
    raise exception 'Baris stok % / % batch % tidak ada lagi: muat ulang halaman', upper(trim(p_bin_code)), trim(p_sku), coalesce(nullif(p_batch, ''), '–');
  end if;
  if v_cur + p_qty < 0 then raise exception 'Stok tinggal %, tidak bisa dikurangi %', v_cur, -p_qty; end if;

  perform set_config('app.adjust_approved', 'on', true);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
  values ('adjustment', v_item, coalesce(p_batch, ''), p_qty, v_bin, p_expiry, trim(p_note), p_reason_code, v_name)
  returning id into v_mov;
  perform set_config('app.adjust_approved', '', true);
  return v_mov;
end $$;
revoke execute on function public.adjust_stock_line(text, text, text, date, numeric, text, text, text) from public, anon;
grant execute on function public.adjust_stock_line(text, text, text, date, numeric, text, text, text) to authenticated;
