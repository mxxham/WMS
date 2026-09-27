-- =====================================================================
-- 0013  Wrong item in a bin, and bins whose contents swapped places
--       (Adjust stok page)
--
--  replace_stock_item   The system says bin X holds SKU A, the bin really
--                       holds SKU B (or another batch / expiry / qty).
--                       One step: -old line, +new line, as adjustments.
--  swap_bin_contents    Everything recorded in bin X is really in bin Y
--                       and the other way round. Every line of both bins
--                       moves across as a transfer, so the ledger shows
--                       where the stock went, not a write-off.
--  Both: supervisor/admin, reason required, one transaction, refused while
--  open pick tasks still point at the stock (re-plan first), like 0011.
-- =====================================================================

create or replace function public.replace_stock_item(
  p_bin_code text, p_sku text, p_batch text, p_expiry date,
  p_new_sku text, p_new_batch text, p_new_expiry date, p_new_qty numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bin uuid; v_item uuid; v_new_item uuid; src public.inventory%rowtype;
  v_new_batch text := trim(coalesce(p_new_batch, '')); v_qty numeric; v_waves text; v_note text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengganti item';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Alasan wajib diisi'; end if;
  if p_new_expiry is null then raise exception 'Tanggal expired item yang benar wajib diisi (FEFO)'; end if;

  select id into v_bin from public.bins where bin_code = upper(trim(p_bin_code));
  select id into v_item from public.items where sku = p_sku;
  select * into src from public.inventory
  where bin_id = v_bin and item_id = v_item and batch_lot = coalesce(p_batch, '') and expiry_date is not distinct from p_expiry
  for update;
  if src.id is null then raise exception 'Stok % / % / batch % tidak ditemukan (mungkin sudah berubah)', p_bin_code, p_sku, p_batch; end if;

  select id into v_new_item from public.items where sku = trim(p_new_sku);
  if v_new_item is null then raise exception 'SKU % tidak ada di master item', p_new_sku; end if;
  v_qty := coalesce(p_new_qty, src.quantity);
  if v_qty <= 0 then raise exception 'Jumlah item yang benar harus lebih dari 0'; end if;
  if v_new_item = src.item_id and v_new_batch = src.batch_lot and p_new_expiry is not distinct from src.expiry_date and v_qty = src.quantity then
    raise exception 'Tidak ada yang berubah';
  end if;

  select string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ') into v_waves
  from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
  where t.from_bin_id = v_bin and t.item_id = src.item_id and t.batch_lot = src.batch_lot
    and t.expiry_date is not distinct from src.expiry_date;
  if v_waves is not null then
    raise exception 'Stok ini dipakai tugas wave %. Selesaikan atau hitung ulang wave dulu.', v_waves;
  end if;

  v_note := 'GANTI ITEM ' || upper(trim(p_bin_code)) || ': ' || trim(p_reason);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note)
  values ('adjustment', src.item_id, src.batch_lot, -src.quantity, v_bin, src.expiry_date, src.received_date, v_note || ' (item lama)');
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note)
  values ('adjustment', v_new_item, v_new_batch, v_qty, v_bin, p_new_expiry, src.received_date, v_note || ' (item benar)');

  return jsonb_build_object('old_sku', p_sku, 'old_qty', src.quantity, 'new_sku', trim(p_new_sku), 'new_qty', v_qty);
end $$;

create or replace function public.swap_bin_contents(p_bin_a text, p_bin_b text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.bins%rowtype; b public.bins%rowtype; r record; v_waves text; v_note text;
  n_ab int := 0; n_ba int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menukar isi bin';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Alasan wajib diisi'; end if;

  select * into a from public.bins where bin_code = upper(trim(p_bin_a));
  select * into b from public.bins where bin_code = upper(trim(p_bin_b));
  if a.id is null then raise exception 'Bin % tidak ditemukan', p_bin_a; end if;
  if b.id is null then raise exception 'Bin % tidak ditemukan', p_bin_b; end if;
  if a.id = b.id then raise exception 'Pilih dua bin yang berbeda'; end if;
  if a.status = 'blocked' or b.status = 'blocked' then
    raise exception 'Bin % diblokir: buka blokir dulu', case when a.status = 'blocked' then a.bin_code else b.bin_code end;
  end if;

  select string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ') into v_waves
  from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
  where t.from_bin_id in (a.id, b.id) or t.to_bin_id in (a.id, b.id);
  if v_waves is not null then
    raise exception 'Bin ini dipakai tugas wave %. Selesaikan atau hitung ulang wave dulu.', v_waves;
  end if;

  -- Snapshot both bins before anything moves: A's lines go to B, then B's
  -- original lines go to A. A line with the same identity in both bins is
  -- merged in B by the first pass and split back by the second.
  perform 1 from public.inventory where bin_id in (a.id, b.id) for update;
  drop table if exists _swap;
  create temp table _swap on commit drop as
    select i.bin_id, i.item_id, i.batch_lot, i.quantity, i.expiry_date, i.received_date
    from public.inventory i where i.bin_id in (a.id, b.id);
  if not exists (select 1 from _swap) then raise exception 'Kedua bin kosong: tidak ada yang ditukar'; end if;

  v_note := 'TUKAR ' || a.bin_code || ' <-> ' || b.bin_code || ': ' || trim(p_reason);
  for r in select * from _swap where bin_id = a.id loop
    insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, received_date, note)
    values ('transfer', r.item_id, r.batch_lot, r.quantity, a.id, b.id, r.expiry_date, r.received_date, v_note);
    n_ab := n_ab + 1;
  end loop;
  for r in select * from _swap where bin_id = b.id loop
    insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, received_date, note)
    values ('transfer', r.item_id, r.batch_lot, r.quantity, b.id, a.id, r.expiry_date, r.received_date, v_note);
    n_ba := n_ba + 1;
  end loop;

  return jsonb_build_object('moved_a_to_b', n_ab, 'moved_b_to_a', n_ba);
end $$;

revoke execute on function public.replace_stock_item(text, text, text, date, text, text, date, numeric, text) from public, anon;
grant execute on function public.replace_stock_item(text, text, text, date, text, text, date, numeric, text) to authenticated;
revoke execute on function public.swap_bin_contents(text, text, text) from public, anon;
grant execute on function public.swap_bin_contents(text, text, text) to authenticated;
