-- =====================================================================
-- 0041  Edit an item's master data (description, UOM, UPP, volume)
--
--  The master item page could only set barcode / shelf life / dispatch
--  minimum (set_item_control). UPP decides what counts as a full pallet
--  in the next Alokasi and bin fill; volume the litres per unit. Existing
--  plans and stock are not changed.
-- =====================================================================

create or replace function public.update_item(
  p_sku text, p_description text, p_uom text, p_upp numeric, p_volume_l numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah master item';
  end if;
  if nullif(trim(p_description), '') is null then raise exception 'Deskripsi wajib diisi'; end if;
  if p_upp is not null and p_upp <= 0 then raise exception 'UPP harus lebih dari 0'; end if;
  if p_volume_l is not null and p_volume_l < 0 then raise exception 'Volume tidak boleh negatif'; end if;
  update public.items set description = trim(p_description), uom = nullif(upper(trim(p_uom)), ''),
         upp = p_upp, volume_l = p_volume_l
  where sku = trim(p_sku) returning id into v_id;
  if v_id is null then raise exception 'SKU % tidak ada', p_sku; end if;
  return jsonb_build_object('result', 'UPDATED', 'sku', trim(p_sku));
end $$;
revoke execute on function public.update_item(text, text, text, numeric, numeric) from public, anon;
grant execute on function public.update_item(text, text, text, numeric, numeric) to authenticated;
