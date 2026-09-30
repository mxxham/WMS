-- =====================================================================
-- 0048  Tambah item: more cartons or a new SKU on an existing wave
--
--  30 Sep NO 8 (SH 109694907): the customer's order grew after the wave
--  was planned, and the only way in was Tambah order (0044), which needs a
--  NEW shipment number and makes a new wave. The wave page now allocates
--  the extra lines (FEFO, from stock no wave has claimed) and
--  add_wave_items appends them to the wave: picks after its last row, a
--  SKU already on the order raises that order line, a new SKU adds one.
-- =====================================================================

create or replace function public.add_wave_items(p_wave_id uuid, p_shipment text, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w public.waves%rowtype; t jsonb; o jsonb; v_item uuid; v_from uuid; v_to uuid; v_base int; v_sh text := trim(p_shipment);
  v_line uuid; n_tasks int := 0; n_raised int := 0; n_added int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menambah item';
  end if;
  select * into w from public.waves where id = p_wave_id for update;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if w.status not in ('PENDING', 'RESCHEDULED') then raise exception 'Wave NO % sudah %', w.wave_no, w.status; end if;
  if v_sh is null or not v_sh = any(w.shipment_numbers) then raise exception 'Shipment % tidak ada di wave NO %', p_shipment, w.wave_no; end if;
  if jsonb_array_length(coalesce(p_plan->'outbound', '[]')) = 0 then raise exception 'Item tanpa baris SKU'; end if;

  -- After the wave's last row; the plan's own order (a pick then its move) is kept.
  select coalesce(max(seq), 0) into v_base from public.pick_tasks where wave_id = w.id;
  for t in select * from jsonb_array_elements(coalesce(p_plan->'tasks', '[]')) loop
    select id into v_item from public.items where sku = t->>'sku';
    if v_item is null then raise exception 'SKU % tidak ada di master item', t->>'sku'; end if;
    select id into v_from from public.bins where bin_code = t->>'from_bin';
    if v_from is null then raise exception 'Bin % tidak ada', t->>'from_bin'; end if;
    v_to := null;
    if coalesce(t->>'to_bin', '') <> '' then
      select id into v_to from public.bins where bin_code = t->>'to_bin';
      if v_to is null then raise exception 'Bin % tidak ada', t->>'to_bin'; end if;
    end if;
    insert into public.pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id,
                                   batch_lot, expiry_date, quantity, pick_type, breaks_pallet, seq)
    values (w.id, case when t->>'task_type' = 'PICK' then v_sh end, t->>'task_type', v_item, v_from, v_to,
            coalesce(t->>'batch_lot', ''), (t->>'expiry_date')::date, (t->>'quantity')::numeric,
            nullif(t->>'pick_type', ''), coalesce((t->>'breaks_pallet')::boolean, false), v_base + (t->>'seq')::int);
    n_tasks := n_tasks + 1;
  end loop;

  for o in select * from jsonb_array_elements(p_plan->'outbound') loop
    select id into v_item from public.items where sku = o->>'sku';
    if v_item is null then raise exception 'SKU % tidak ada di master item', o->>'sku'; end if;
    select id into v_line from public.outbound
    where wave_id = w.id and shipment_number = v_sh and sku = o->>'sku' and status <> 'CANCELLED'
    order by created_at limit 1 for update;
    if v_line is not null then
      update public.outbound set
        quantity_requested = quantity_requested + (o->>'quantity_requested')::numeric,
        quantity_allocated = quantity_allocated + coalesce((o->>'quantity_allocated')::numeric, 0),
        order_nos = array(select distinct x from unnest(order_nos || coalesce(array(select jsonb_array_elements_text(o->'order_nos')), '{}')) x order by 1)
      where id = v_line;
      n_raised := n_raised + 1;
    else
      insert into public.outbound (outbound_date, wave_id, shipment_number, sku, item_id, description, order_nos,
                                   truck, destination, quantity_requested, quantity_allocated, shortage_reason)
      values (w.planned_date, w.id, v_sh, o->>'sku', v_item, coalesce(o->>'description', ''),
              coalesce(array(select jsonb_array_elements_text(o->'order_nos')), '{}'),
              w.truck, w.destination, (o->>'quantity_requested')::numeric, coalesce((o->>'quantity_allocated')::numeric, 0),
              nullif(o->>'shortage_reason', ''));
      n_added := n_added + 1;
    end if;
  end loop;

  perform public.log_execution_event('WAVE', w.id, w.status, w.status,
    format('item ditambah ke shipment %s: %s', v_sh,
           (select string_agg(format('%s +%s', o2->>'sku', o2->>'quantity_requested'), ', ') from jsonb_array_elements(p_plan->'outbound') o2)));
  return jsonb_build_object('wave_no', w.wave_no, 'tasks', n_tasks, 'raised', n_raised, 'added', n_added);
end $$;
revoke execute on function public.add_wave_items(uuid, text, jsonb) from public, anon;
grant execute on function public.add_wave_items(uuid, text, jsonb) to authenticated;
