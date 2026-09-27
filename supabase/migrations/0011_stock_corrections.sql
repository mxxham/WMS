-- =====================================================================
-- 0011  Stock identity corrections (data quality page)
--
--  Fixes a wrong batch or expiry on stock that is physically right: the
--  row is moved to its correct identity with two adjustments (-q old,
--  +q new) so the ledger shows what changed and who did it. Refused while
--  open pick tasks still point at the old identity: re-plan first.
-- =====================================================================

create or replace function public.correct_stock_identity(
  p_bin_code text, p_sku text, p_batch text, p_expiry date,
  p_new_batch text, p_new_expiry date, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bin uuid; v_item uuid; src public.inventory%rowtype; v_new_batch text; v_new_exp date; v_waves text; v_note text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengoreksi stok';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Alasan wajib diisi'; end if;

  select id into v_bin from public.bins where bin_code = p_bin_code;
  select id into v_item from public.items where sku = p_sku;
  select * into src from public.inventory
  where bin_id = v_bin and item_id = v_item and batch_lot = coalesce(p_batch, '') and expiry_date is not distinct from p_expiry
  for update;
  if src.id is null then raise exception 'Stok % / % / batch % tidak ditemukan (mungkin sudah berubah)', p_bin_code, p_sku, p_batch; end if;

  v_new_batch := trim(coalesce(p_new_batch, src.batch_lot));
  v_new_exp := coalesce(p_new_expiry, src.expiry_date);
  if v_new_batch = src.batch_lot and v_new_exp is not distinct from src.expiry_date then
    raise exception 'Tidak ada yang berubah';
  end if;

  select string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ') into v_waves
  from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
  where t.from_bin_id = v_bin and t.item_id = v_item and t.batch_lot = src.batch_lot
    and t.expiry_date is not distinct from src.expiry_date;
  if v_waves is not null then
    raise exception 'Stok ini dipakai tugas wave %. Selesaikan atau hitung ulang wave dulu.', v_waves;
  end if;

  v_note := 'KOREKSI ' || p_bin_code || ': ' || trim(p_reason);
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note)
  values ('adjustment', v_item, src.batch_lot, -src.quantity, v_bin, src.expiry_date, src.received_date, v_note || ' (identitas lama)');
  insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note)
  values ('adjustment', v_item, v_new_batch, src.quantity, v_bin, v_new_exp, src.received_date, v_note || ' (identitas baru)');

  return jsonb_build_object('quantity', src.quantity, 'batch_lot', v_new_batch, 'expiry_date', v_new_exp);
end $$;

revoke execute on function public.correct_stock_identity(text, text, text, date, text, date, text) from public, anon;
grant execute on function public.correct_stock_identity(text, text, text, date, text, date, text) to authenticated;
