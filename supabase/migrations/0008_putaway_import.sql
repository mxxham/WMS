-- =====================================================================
-- 0008  Putaway import: the "data putaway" sheet of the WMS workbook
--
--  Each sheet row says "this pallet now sits in this bin". putaway_import
--  compares every row with current stock and classifies it:
--    new       bin holds nothing                 -> putaway movement
--    same      bin already holds exactly this    -> nothing (re-upload safe)
--    conflict  anything else, with a `kind`:
--      qty_differs   same SKU/batch/expiry, other quantity  (add | set)
--      bin_occupied  bin holds other stock                 (add)
--      bin_unknown, bin_blocked, sku_unknown               (skip only)
--  A conflict is only posted when the caller picked a resolution for it.
--  p_apply = false is a dry run (the preview); p_apply = true posts every
--  row in one transaction and returns the same classification. All rows
--  are judged against stock as it was BEFORE the file, so two rows for one
--  bin get the same verdict in the preview and in the posting.
-- =====================================================================

create or replace function public.putaway_import(p_rows jsonb, p_source text, p_apply boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin public.bins%rowtype; v_item uuid; v_batch text; v_exp date; v_qty numeric;
  v_action text; v_status text; v_kind text; v_current jsonb; v_match numeric; v_others int;
  v_note text; t record; out jsonb := '[]'::jsonb; n_moves int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa import putaway';
  end if;

  drop table if exists _putaway;
  create temp table _putaway (line int, bin_id uuid, item_id uuid, batch_lot text, expiry_date date,
    quantity numeric, current_qty numeric, status text, action text) on commit drop;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_batch := coalesce(r->>'batch_lot', '');
    v_exp := (r->>'expiry_date')::date;
    v_qty := (r->>'quantity')::numeric;
    v_action := r->>'action';               -- null | 'add' | 'set'
    v_kind := null; v_current := '[]'::jsonb; v_item := null;

    select * into v_bin from public.bins where bin_code = r->>'bin_code';
    select id into v_item from public.items where sku = r->>'sku';

    if v_bin.id is null then v_kind := 'bin_unknown';
    elsif v_bin.status = 'blocked' then v_kind := 'bin_blocked';
    elsif v_item is null then v_kind := 'sku_unknown';
    else
      select coalesce(jsonb_agg(jsonb_build_object('sku', it.sku, 'batch_lot', i.batch_lot,
               'expiry_date', i.expiry_date, 'quantity', i.quantity) order by it.sku, i.batch_lot), '[]'::jsonb),
             max(i.quantity) filter (where i.item_id = v_item and i.batch_lot = v_batch
                                       and i.expiry_date is not distinct from v_exp),
             count(*) filter (where not (i.item_id = v_item and i.batch_lot = v_batch
                                           and i.expiry_date is not distinct from v_exp))
        into v_current, v_match, v_others
      from public.inventory i join public.items it on it.id = i.item_id
      where i.bin_id = v_bin.id;

      if v_match is not null and v_match <> v_qty then v_kind := 'qty_differs';
      elsif v_match is null and v_others > 0 then v_kind := 'bin_occupied';
      end if;
    end if;

    v_status := case when v_kind is not null then 'conflict'
                     when v_match is not null then 'same' else 'new' end;

    -- A resolution only counts where it makes sense for that conflict.
    if v_status <> 'conflict' or not (
         (v_kind = 'qty_differs' and v_action in ('add', 'set')) or
         (v_kind = 'bin_occupied' and v_action = 'add')) then
      v_action := null;
    end if;

    insert into _putaway values ((r->>'line')::int, v_bin.id, v_item, v_batch, v_exp, v_qty, v_match, v_status, v_action);
    out := out || jsonb_build_object('line', (r->>'line')::int, 'status', v_status, 'kind', v_kind,
                                     'action', v_action, 'current', v_current);
  end loop;

  if p_apply then
    for t in select * from _putaway where status = 'new' or action is not null order by line loop
      v_note := 'PUTAWAY ' || coalesce(p_source, 'file') || ' baris ' || t.line;
      if t.action = 'set' then
        insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
        values ('adjustment', t.item_id, t.batch_lot, t.quantity - t.current_qty, t.bin_id, t.expiry_date, v_note || ' (disamakan)');
      else
        insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
        values ('putaway', t.item_id, t.batch_lot, t.quantity, t.bin_id, t.expiry_date,
                v_note || case when t.action = 'add' then ' (ditambahkan)' else '' end);
      end if;
      n_moves := n_moves + 1;
    end loop;
  end if;

  return jsonb_build_object('rows', out, 'movements', n_moves);
end $$;

revoke execute on function public.putaway_import(jsonb, text, boolean) from public, anon;
grant execute on function public.putaway_import(jsonb, text, boolean) to authenticated;
