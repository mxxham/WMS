-- =====================================================================
-- 0040  New SKUs into the item master from the WMS file
--
--  A putaway sheet can hold a SKU the master does not have yet (30 Sep:
--  550027044 Gadus S3 V220C 3, 4 rows refused). The putaway page reads the
--  file's MASTER DATA / Master SKU sheets and adds the missing SKUs here.
--  Only new SKUs are inserted; an existing item is never changed.
-- =====================================================================

create or replace function public.add_items(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v_added int := 0; v_skipped int := 0; v_sku text; v_n int;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menambah item';
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Format item tidak valid'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    v_sku := trim(r->>'sku');
    if v_sku !~ '^\d{6,12}$' then raise exception 'SKU % tidak valid', coalesce(v_sku, '(kosong)'); end if;
    if nullif(trim(r->>'description'), '') is null then raise exception 'Deskripsi SKU % kosong', v_sku; end if;
    insert into public.items (sku, description, uom, upp, volume_l)
    values (v_sku, trim(r->>'description'), nullif(trim(r->>'uom'), ''),
            nullif(r->>'upp', '')::numeric, nullif(r->>'volume_l', '')::numeric)
    on conflict (sku) do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_added := v_added + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped);
end $$;
revoke execute on function public.add_items(jsonb) from public, anon;
grant execute on function public.add_items(jsonb) to authenticated;
