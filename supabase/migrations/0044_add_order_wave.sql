-- =====================================================================
-- 0044  A new order added straight to the wave page
--
--  A late order (new shipment number) can be added to a day without the
--  Schedule of the day sheet and without re-running Alokasi for the day:
--  the page allocates it (FEFO) from the stock no wave has claimed and
--  add_order_wave stores it as ONE new wave, NO = the day's highest + 1.
--  save_plan is not used: it replaces the day's untouched waves.
--  planning_stock gets p_keep_all so the preview keeps every reservation,
--  also those of the day's waves nobody has started yet.
-- =====================================================================

drop function public.planning_stock(date, uuid[]);
create function public.planning_stock(p_date date, p_release uuid[] default '{}', p_keep_all boolean default false)
returns table (
  bin_code text, bin_status public.bin_status, sku text, description text, uom text, upp numeric,
  batch_lot text, quantity numeric, expiry_date date, received_date date,
  physical numeric, reserved numeric, incoming numeric, held numeric
) language sql stable security invoker set search_path = public as $$
  with keep_tasks as (
    select * from public.open_pick_tasks
    -- p_keep_all: an order added to a day keeps every reservation, also of the day's untouched waves.
    where (p_keep_all or wave_id not in (select public.replaceable_waves(p_date)))
      and wave_id <> all(coalesce(p_release, '{}'))
  ), deltas as (
    select bin_id, item_id, batch_lot, expiry_date, quantity as phys, 0::numeric as res, 0::numeric as inc, received_date
      from public.inventory
    union all
    select from_bin_id, item_id, batch_lot, expiry_date, 0, quantity, 0, null from keep_tasks
    union all
    select to_bin_id, item_id, batch_lot, expiry_date, 0, 0, quantity, null from keep_tasks where to_bin_id is not null
  ), agg as (
    select bin_id, item_id, batch_lot, expiry_date,
           sum(phys) as physical, sum(res) as reserved, sum(inc) as incoming, max(received_date) as received_date
    from deltas group by bin_id, item_id, batch_lot, expiry_date
  ), held as (
    select a.*, public.held_qty(a.bin_id, a.item_id, a.batch_lot, a.expiry_date, a.physical) as held from agg a
  )
  select b.bin_code, b.status, it.sku, it.description, it.uom, it.upp,
         h.batch_lot, greatest(h.physical - h.held - h.reserved + h.incoming, 0), h.expiry_date, h.received_date,
         h.physical, h.reserved, h.incoming, h.held
  from held h
  join public.bins b on b.id = h.bin_id
  join public.items it on it.id = h.item_id
  where h.physical - h.held - h.reserved + h.incoming > 0 or h.physical > 0
  order by b.bin_code, it.sku, h.batch_lot, h.expiry_date;
$$;
revoke execute on function public.planning_stock(date, uuid[], boolean) from public, anon;
grant execute on function public.planning_stock(date, uuid[], boolean) to authenticated;

create or replace function public.add_order_wave(p_date date, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t jsonb; o jsonb; v_wave uuid; v_item uuid; v_from uuid; v_to uuid; v_no text; v_dup text;
  v_ships text[]; n_tasks int := 0; n_out int := 0; w jsonb := p_plan->'wave';
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menambah order';
  end if;
  if p_date is null then raise exception 'Tanggal wajib diisi'; end if;
  v_ships := coalesce(array(select trim(jsonb_array_elements_text(w->'shipment_numbers'))), '{}');
  if cardinality(v_ships) = 0 or exists (select 1 from unnest(v_ships) s where s = '') then
    raise exception 'Nomor shipment wajib diisi';
  end if;
  if jsonb_array_length(coalesce(p_plan->'outbound', '[]')) = 0 then raise exception 'Order tanpa baris SKU'; end if;

  -- The same shipment twice on one day would be picked twice.
  select string_agg(distinct s, ', ') into v_dup
  from public.waves x, unnest(x.shipment_numbers) s
  where x.planned_date = p_date and x.status <> 'CANCELLED' and s = any(v_ships);
  if v_dup is not null then raise exception 'Shipment % sudah ada di wave tanggal ini', v_dup; end if;

  -- Next NO of the day (numbers only; T-waves and others are skipped).
  select coalesce(max(wave_no::int), 0) + 1 into v_no from public.waves
  where planned_date = p_date and wave_no ~ '^\d+$';

  insert into public.waves (wave_no, planned_date, shipment_numbers, truck, destination, planned_slot, created_by)
  values (v_no, p_date, v_ships, nullif(w->>'truck', ''), coalesce(w->>'destination', ''), nullif(w->>'planned_slot', ''), auth.uid())
  returning id into v_wave;

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
    values (v_wave, nullif(t->>'shipment_number', ''), t->>'task_type', v_item, v_from, v_to,
            coalesce(t->>'batch_lot', ''), (t->>'expiry_date')::date, (t->>'quantity')::numeric,
            nullif(t->>'pick_type', ''), coalesce((t->>'breaks_pallet')::boolean, false), (t->>'seq')::int);
    n_tasks := n_tasks + 1;
  end loop;

  for o in select * from jsonb_array_elements(p_plan->'outbound') loop
    select id into v_item from public.items where sku = o->>'sku';
    if v_item is null then raise exception 'SKU % tidak ada di master item', o->>'sku'; end if;
    insert into public.outbound (outbound_date, wave_id, shipment_number, sku, item_id, description, order_nos,
                                 truck, destination, quantity_requested, quantity_allocated, shortage_reason)
    values (p_date, v_wave, o->>'shipment_number', o->>'sku', v_item, coalesce(o->>'description', ''),
            coalesce(array(select jsonb_array_elements_text(o->'order_nos')), '{}'),
            nullif(o->>'truck', ''), coalesce(o->>'destination', ''),
            (o->>'quantity_requested')::numeric, coalesce((o->>'quantity_allocated')::numeric, 0),
            nullif(o->>'shortage_reason', ''));
    n_out := n_out + 1;
  end loop;

  perform public.log_execution_event('WAVE', v_wave, null, 'PENDING',
    format('order ditambah langsung: shipment %s', array_to_string(v_ships, ', ')));
  return jsonb_build_object('wave_no', v_no, 'wave_id', v_wave, 'tasks', n_tasks, 'outbound', n_out);
end $$;
revoke execute on function public.add_order_wave(date, jsonb) from public, anon;
grant execute on function public.add_order_wave(date, jsonb) to authenticated;
