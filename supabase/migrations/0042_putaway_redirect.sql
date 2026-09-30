-- =====================================================================
-- 0042  Putaway from the sheet: the pallet went to another bin
--
--  A sheet row whose bin holds other stock (or is unknown / blocked) can be
--  sent to the bin the pallet really went to ("Pindah ke bin lain" on the
--  putaway page): the row is checked and posted against that bin, and its
--  movement note keeps the bin the sheet said (sheet_bin). Otherwise as
--  0018; the count-task conflict target now matches the one-open-task
--  index of 0019 (OPEN, COUNTED, RECOUNT).
-- =====================================================================

create or replace function public.putaway_import(p_rows jsonb, p_source text, p_apply boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin public.bins%rowtype; v_item uuid; v_batch text; v_exp date; v_qty numeric;
  v_action text; v_status text; v_kind text; v_current jsonb; v_match numeric; v_others int;
  v_note text; t record; out jsonb := '[]'::jsonb; n_moves int := 0; n_counts int := 0;
  v_limit numeric := (public.inventory_policy()->>'adjust_approval_qty')::numeric; v_over jsonb := '[]'::jsonb; v_expected date;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa import putaway';
  end if;
  perform set_config('app.adjust_reason', 'RECEIVING_DIFF', true);
  perform set_config('app.by_name', 'putaway ' || coalesce(p_source, 'file'), true);

  drop table if exists _putaway;
  create temp table _putaway (line int, bin_id uuid, item_id uuid, batch_lot text, expiry_date date,
    quantity numeric, current_qty numeric, status text, action text, sheet_bin text) on commit drop;

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

    if v_action = 'set' and abs(v_qty - v_match) > v_limit then
      -- Above the adjustment limit a sheet cannot overwrite stock: it becomes a count task.
      v_over := v_over || to_jsonb((r->>'line')::int);
      v_action := null;
    end if;
    insert into _putaway values ((r->>'line')::int, v_bin.id, v_item, v_batch, v_exp, v_qty, v_match, v_status, v_action,
      nullif(upper(trim(r->>'sheet_bin')), upper(trim(r->>'bin_code'))));
    -- A date-coded batch whose expiry disagrees with the batch code (warning only).
    v_expected := case when v_item is not null then public.batch_expected_expiry(v_item, v_batch) end;
    out := out || jsonb_build_object('line', (r->>'line')::int, 'status', v_status, 'kind', v_kind,
                                     'action', v_action, 'current', v_current,
                                     'expiry_expected', case when v_expected is distinct from v_exp then v_expected end);
  end loop;

  if p_apply then
    perform set_config('app.adjust_approved', 'on', true);  -- 'set' rows are within the limit (checked above)
    for t in select * from _putaway where status = 'new' or action is not null order by line loop
      v_note := 'PUTAWAY ' || coalesce(p_source, 'file') || ' baris ' || t.line
        || coalesce(' (di sheet ' || t.sheet_bin || ', ditaruh di ' || (select bin_code from public.bins where id = t.bin_id) || ')', '');
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

    perform set_config('app.adjust_approved', '', true);
    -- Unresolved "the sheet and the system disagree about this bin" rows become
    -- count tasks. One open task per bin; later sheet lines are appended to it.
    for t in select p.*, it.sku from _putaway p join public.items it on it.id = p.item_id
             where p.status = 'conflict' and p.action is null and p.bin_id is not null order by p.line loop
      insert into public.count_tasks (bin_id, reason, source, expected, created_by)
      values (t.bin_id, 'Putaway: isi sheet berbeda dengan sistem', 'PUTAWAY',
              jsonb_build_array(jsonb_build_object('source', p_source, 'line', t.line, 'sku', t.sku,
                'batch_lot', t.batch_lot, 'expiry_date', t.expiry_date, 'quantity', t.quantity)), auth.uid())
      on conflict (bin_id) where status in ('OPEN', 'COUNTED', 'RECOUNT')
      do update set expected = public.count_tasks.expected || excluded.expected;
      n_counts := n_counts + 1;
    end loop;
  end if;

  return jsonb_build_object('rows', out, 'movements', n_moves, 'count_tasks', n_counts, 'set_over_limit', v_over);
end $$;
