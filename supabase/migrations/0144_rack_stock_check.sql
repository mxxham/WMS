-- =====================================================================
-- 0144  Cek stok rak: a rack checked bin by bin, corrected in one save
--
--  The inventory controller checks a rack against the printed list of what
--  the system holds (not blind), writes the real quantity / batch / expiry
--  on the paper, then types it in (17 Nov 2026). Cek stok rak lists one
--  aisle bin by bin; apply_rack_check books everything typed in ONE
--  transaction: either every line is booked or none, so a half-corrected
--  rack never happens.
--
--  Per line (all through movements, the only way stock changes):
--    quantity only        one adjustment of the difference
--    batch and/or expiry  the stock moves to its new identity: -q on the
--                         old, +new quantity on the new (merging into the
--                         identity when the bin already has it), as
--                         correct_stock_identity (0011); refused while an
--                         open wave task still points at the old identity
--    add                  stock found in a bin that the system does not
--                         have: a positive adjustment (expiry required: no
--                         stock without one enters FEFO)
--
--  Safety:
--   - expected_qty: the quantity the page showed. When the system has
--     moved since (a pick was posted during the check) the line is
--     refused and the page is reloaded: a typed figure never overwrites a
--     pick it did not see.
--   - One bin, one SKU: a save that makes a bin hold a second SKU is
--     refused (a bin that already had two is not blocked from being fixed).
--   - Lines of another aisle than the one checked are refused.
--
--  Same decision as 0140 (Inventory → Stok): posted at once, no second
--  person, whatever the quantity (app.adjust_approved), supervisor / admin
--  only, reason code, name; the movement has no approved_by_name so
--  "above the limit, nobody approved" stays visible in the ledger. The
--  limit still holds everywhere else.
--
--  A line that is left short of what open waves promised on it is returned
--  as a warning (the wave shows stok kurang until it is fixed or planned
--  again), not refused: the shelf is what it is.
-- =====================================================================

create or replace function public.apply_rack_check(p_aisle text, p_lines jsonb, p_reason_code text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_aisle text := upper(trim(coalesce(p_aisle, '')));
  l jsonb; v_code text; v_sku text; v_bin uuid; v_item uuid; src public.inventory%rowtype;
  v_batch text; v_exp date; v_nb text; v_ne date; v_nq numeric; v_expected numeric; v_changed boolean;
  v_note text; v_waves text; v_res numeric;
  v_bins uuid[] := '{}'; v_before jsonb; b record;
  n_lines int := 0; n_added int := 0; n_mov int := 0; v_warn jsonb := '[]'::jsonb;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menyimpan hasil cek stok';
  end if;
  v_name := public.person_name(p_by_name);
  if v_aisle !~ '^[A-Z]{2}$' then raise exception 'Rak % tidak dikenal', p_aisle; end if;
  if p_reason_code is null then raise exception 'Kode alasan wajib dipilih'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Tidak ada perubahan untuk disimpan';
  end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'Maksimal 500 baris sekali simpan'; end if;

  -- The bins touched, and how many SKUs each held before: the one-bin-one-SKU rule is judged on the difference.
  for l in select * from jsonb_array_elements(p_lines) loop
    v_code := upper(trim(coalesce(l->>'bin_code', '')));
    if v_code not like v_aisle || '%' then raise exception 'Bin % bukan di rak %', v_code, v_aisle; end if;
    select id into v_bin from public.bins where bin_code = v_code;
    if v_bin is null then raise exception 'Bin % tidak ada', v_code; end if;
    v_bins := v_bins || v_bin;
  end loop;
  select coalesce(jsonb_object_agg(x.bin_id::text, x.n), '{}'::jsonb) into v_before
  from (select i.bin_id, count(distinct i.item_id) as n from public.inventory i
        where i.bin_id = any(v_bins) and i.quantity > 0 group by i.bin_id) x;

  perform set_config('app.adjust_approved', 'on', true);

  for l in select * from jsonb_array_elements(p_lines) loop
    v_code := upper(trim(l->>'bin_code'));
    v_sku := trim(coalesce(l->>'sku', ''));
    select id into v_bin from public.bins where bin_code = v_code;
    select id into v_item from public.items where sku = v_sku;
    if v_item is null then raise exception 'SKU % tidak ada di master item', v_sku; end if;
    v_nq := nullif(l->>'new_qty', '')::numeric;
    if v_nq is not null and v_nq < 0 then raise exception '% / %: jumlah tidak boleh negatif', v_code, v_sku; end if;

    if coalesce((l->>'add')::boolean, false) then
      -- Stock found that the system does not have.
      v_nb := upper(trim(coalesce(l->>'new_batch', '')));
      v_ne := nullif(l->>'new_expiry', '')::date;
      if v_nq is null or v_nq <= 0 then raise exception '%: jumlah stok tambahan wajib di atas 0', v_code; end if;
      if v_ne is null then raise exception '%: tanggal expired wajib diisi untuk stok tambahan', v_code; end if;
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
      values ('adjustment', v_item, v_nb, v_nq, v_bin, v_ne,
              format('Cek stok rak %s: stok ditemukan di %s, tidak ada di sistem', v_aisle, v_code), p_reason_code, v_name);
      n_added := n_added + 1; n_mov := n_mov + 1;
      continue;
    end if;

    v_batch := coalesce(l->>'batch_lot', '');
    v_exp := nullif(l->>'expiry_date', '')::date;
    select * into src from public.inventory
    where bin_id = v_bin and item_id = v_item and batch_lot = v_batch and expiry_date is not distinct from v_exp
    for update;
    if not found then
      raise exception 'Baris stok % / % batch % sudah berubah atau tidak ada lagi: muat ulang halaman', v_code, v_sku, coalesce(nullif(v_batch, ''), '–');
    end if;
    v_expected := nullif(l->>'expected_qty', '')::numeric;
    if v_expected is not null and v_expected <> src.quantity then
      raise exception '% / % batch %: stok di sistem sekarang % (saat halaman dimuat %). Muat ulang halaman, lalu cek lagi.',
        v_code, v_sku, coalesce(nullif(v_batch, ''), '–'), src.quantity, v_expected;
    end if;

    v_nb := upper(trim(coalesce(l->>'new_batch', v_batch)));
    v_ne := coalesce(nullif(l->>'new_expiry', '')::date, v_exp);
    v_nq := coalesce(v_nq, src.quantity);
    -- Emptying a line needs no new identity.
    v_changed := v_nq > 0 and (v_nb <> v_batch or v_ne is distinct from v_exp);

    if v_changed then
      select string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ') into v_waves
      from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
      where t.from_bin_id = v_bin and t.item_id = v_item and t.batch_lot = src.batch_lot
        and t.expiry_date is not distinct from src.expiry_date;
      if v_waves is not null then
        raise exception '% / %: stok ini dipakai tugas wave %. Batch dan expired tidak bisa diubah sebelum wave selesai atau dihitung ulang.', v_code, v_sku, v_waves;
      end if;
      v_note := format('Cek stok rak %s %s: identitas dikoreksi', v_aisle, v_code);
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note, reason_code, by_name)
      values ('adjustment', v_item, src.batch_lot, -src.quantity, v_bin, src.expiry_date, src.received_date,
              v_note || format(' (identitas lama, batch %s)', coalesce(nullif(src.batch_lot, ''), '–')), p_reason_code, v_name);
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note, reason_code, by_name)
      values ('adjustment', v_item, v_nb, v_nq, v_bin, v_ne, src.received_date,
              v_note || format(' (identitas baru, batch %s)', coalesce(nullif(v_nb, ''), '–')), p_reason_code, v_name);
      n_mov := n_mov + 2; n_lines := n_lines + 1;
    elsif v_nq <> src.quantity then
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note, reason_code, by_name)
      values ('adjustment', v_item, src.batch_lot, v_nq - src.quantity, v_bin, src.expiry_date,
              format('Cek stok rak %s %s: jumlah %s → %s', v_aisle, v_code, src.quantity, v_nq), p_reason_code, v_name);
      n_mov := n_mov + 1; n_lines := n_lines + 1;
    else
      continue;  -- nothing changed on this line
    end if;

    -- What open waves promised on the line it ends as: warn when the shelf now holds less.
    select coalesce(sum(t.quantity), 0), string_agg(distinct w.wave_no, ', ') into v_res, v_waves
    from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
    where t.from_bin_id = v_bin and t.item_id = v_item and t.batch_lot = case when v_changed then v_nb else src.batch_lot end
      and t.expiry_date is not distinct from case when v_changed then v_ne else src.expiry_date end;
    if v_res > v_nq then
      v_warn := v_warn || jsonb_build_object('bin_code', v_code, 'sku', v_sku, 'qty', v_nq, 'reserved', v_res, 'waves', v_waves);
    end if;
  end loop;

  -- One bin, one SKU: refuse a save that makes a bin hold a second one.
  for b in
    select i.bin_id, bn.bin_code, string_agg(distinct it.sku, ', ' order by it.sku) as skus
    from public.inventory i join public.bins bn on bn.id = i.bin_id join public.items it on it.id = i.item_id
    where i.bin_id = any(v_bins) and i.quantity > 0
    group by i.bin_id, bn.bin_code having count(distinct i.item_id) > 1
  loop
    if coalesce((v_before->>b.bin_id::text)::int, 0) <= 1 then
      raise exception 'Bin % akan berisi lebih dari satu SKU (%). Satu bin satu SKU: kosongkan SKU yang lama di simpan yang sama, atau pilih bin lain.', b.bin_code, b.skus;
    end if;
  end loop;

  perform set_config('app.adjust_approved', '', true);
  return jsonb_build_object('lines', n_lines, 'added', n_added, 'movements', n_mov, 'warnings', v_warn);
end $$;

revoke execute on function public.apply_rack_check(text, jsonb, text, text) from public, anon;
grant execute on function public.apply_rack_check(text, jsonb, text, text) to authenticated;
