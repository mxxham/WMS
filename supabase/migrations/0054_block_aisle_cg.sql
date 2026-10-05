-- =====================================================================
-- 0054  Aisle CG does not exist
--
--  The racks stop at CF (confirmed on the floor, 5 Oct 2026). The WMS
--  sheet carries 400 template rows for CG01-CG40, all with Remain Qty 0,
--  and the import made them 400 active bins: they showed in Bin kosong,
--  and a database plan once proposed CG01A01 as a pickface for a Bin To
--  Bin. README §1 listed "missing aisle CG" as an open assumption; this
--  settles it.
--  The CG bins are BLOCKED, not deleted: blocked bins are left out of
--  empty_bins (0043) and refused as a target by Bin To Bin, Ubah baris and
--  Tambah item (0045/0047/0051/0052); import_snapshot keeps an existing
--  bin's status, so a later import does not bring them back; and any old
--  task or movement that points at a CG bin keeps its reference. The
--  engine leaves CG out too (rackLocationPattern C[A-F], lib/allocator/config.ts).
--  Refuses to run while a CG bin still holds stock or an open task uses
--  one, naming them, so nothing physical is hidden.
-- =====================================================================

do $$
declare v_stock text; v_tasks text;
begin
  select string_agg(distinct b.bin_code, ', ') into v_stock
  from public.inventory i join public.bins b on b.id = i.bin_id
  where b.bin_code like 'CG%' and i.quantity > 0;
  if v_stock is not null then raise exception 'Bin CG masih berisi stok: %. Pindahkan atau koreksi dulu.', v_stock; end if;

  select string_agg(distinct coalesce(fb.bin_code, '') || '→' || coalesce(tb.bin_code, ''), ', ') into v_tasks
  from public.open_pick_tasks t
  left join public.bins fb on fb.id = t.from_bin_id left join public.bins tb on tb.id = t.to_bin_id
  where fb.bin_code like 'CG%' or tb.bin_code like 'CG%';
  if v_tasks is not null then raise exception 'Tugas terbuka masih memakai bin CG: %. Ubah atau batalkan dulu.', v_tasks; end if;

  update public.bins set status = 'blocked' where bin_code like 'CG%' and status <> 'blocked';
end $$;
