-- =====================================================================
-- 0120  Level A of bays CF21-CF40 is the CKB 3PL's
--
-- 29 Oct 2026: the level-A bins of CF21-CF40 (CF21A01 ... CF40A02, 40
-- bins) hold goods of the CKB 3PL, which are kept outside our stock books.
-- They must not be offered for picking, Bin To Bin or inbound. Levels B-E
-- of those bays, and level A of CF01-CF20, stay ours.
--
-- The bins are BLOCKED, as aisle CG was (0054): a blocked bin is left out
-- of empty_bins (0043) and of picking, refused as a target by Bin To Bin
-- and the wave edits (0045/0047/0051/0052) and by inbound
-- (record_receipt / record_receipt_check, 0020/0118); the auto putaway
-- only offers active bins (lib/inbound/load.ts). import_snapshot keeps an
-- existing bin's status, so a later import does not reopen them.
--
-- Refuses to run while one of these bins still holds OUR stock, is a
-- pickface, or is used by an open task, naming them: stock we book there
-- would silently become unpickable. Move or correct it first.
-- =====================================================================
do $$
declare v_stock text; v_pf text; v_tasks text;
begin
  select string_agg(distinct b.bin_code || ' (' || it.sku || ' × ' || i.quantity || ')', ', ') into v_stock
  from public.inventory i join public.bins b on b.id = i.bin_id join public.items it on it.id = i.item_id
  where b.bin_code ~ '^CF(2[1-9]|3[0-9]|40)A[0-9]{2}$' and i.quantity > 0;
  if v_stock is not null then
    raise exception 'Bin CF21A-CF40A masih berisi stok kita: %. Pindahkan atau koreksi dulu.', v_stock;
  end if;
  select string_agg(b.bin_code || ' (' || it.sku || ')', ', ') into v_pf
  from public.pickfaces p join public.bins b on b.id = p.bin_id join public.items it on it.id = p.item_id
  where b.bin_code ~ '^CF(2[1-9]|3[0-9]|40)A[0-9]{2}$';
  if v_pf is not null then raise exception 'Bin CF21A-CF40A masih jadi pickface: %. Pindahkan pickface dulu.', v_pf; end if;
  select string_agg(distinct coalesce(fb.bin_code, '') || '→' || coalesce(tb.bin_code, ''), ', ') into v_tasks
  from public.open_pick_tasks t
  left join public.bins fb on fb.id = t.from_bin_id left join public.bins tb on tb.id = t.to_bin_id
  where fb.bin_code ~ '^CF(2[1-9]|3[0-9]|40)A[0-9]{2}$' or tb.bin_code ~ '^CF(2[1-9]|3[0-9]|40)A[0-9]{2}$';
  if v_tasks is not null then raise exception 'Tugas terbuka masih memakai bin CF21A-CF40A: %. Ubah atau batalkan dulu.', v_tasks; end if;
  update public.bins set status = 'blocked' where bin_code ~ '^CF(2[1-9]|3[0-9]|40)A[0-9]{2}$' and status <> 'blocked';
end $$;
