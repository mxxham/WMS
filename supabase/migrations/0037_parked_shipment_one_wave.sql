-- =====================================================================
-- 0037  A parked shipment back with new items: one wave
--
--  Rule (agreed): when a parked (Tunda) shipment comes back on a later
--  schedule, possibly with extra items,
--    · nothing of its wave posted yet -> the wave is cancelled and the whole
--      shipment is planned fresh in one wave. For the preview its reserved
--      stock must count as free: planning_stock takes p_release, the parked
--      waves to leave out (nothing is cancelled before Simpan).
--    · something already posted -> the wave is carried over (0036) and the
--      new items, planned with the rest of the day, are moved into it:
--      merge_into_carried_wave. Their pallet moves go along; the emptied
--      new wave is removed.
-- =====================================================================

drop function public.planning_stock(date);
create function public.planning_stock(p_date date, p_release uuid[] default '{}')
returns table (
  bin_code text, bin_status public.bin_status, sku text, description text, uom text, upp numeric,
  batch_lot text, quantity numeric, expiry_date date, received_date date,
  physical numeric, reserved numeric, incoming numeric, held numeric
) language sql stable security invoker set search_path = public as $$
  with keep_tasks as (
    select * from public.open_pick_tasks
    where wave_id not in (select public.replaceable_waves(p_date))
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
revoke execute on function public.planning_stock(date, uuid[]) from public, anon;
grant execute on function public.planning_stock(date, uuid[]) to authenticated;

create or replace function public.merge_into_carried_wave(p_wave_id uuid, p_shipment text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waves%rowtype; v_next int; n_tasks int := 0; n_out int := 0; v_src uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin';
  end if;
  select * into w from public.waves where id = p_wave_id for update;
  if w.id is null or w.status <> 'PENDING' then raise exception 'Wave tujuan tidak aktif'; end if;
  if not (p_shipment = any(w.shipment_numbers)) then raise exception 'Shipment % tidak ada di wave NO %', p_shipment, w.wave_no; end if;

  -- The shipment's lines in other waves of the day that nobody has started (freshly saved plan).
  drop table if exists _src;
  create temp table _src on commit drop as
  select x.id from public.waves x
  where x.planned_date = w.planned_date and x.id <> w.id and x.status = 'PENDING' and p_shipment = any(x.shipment_numbers)
    and not exists (select 1 from public.pick_tasks t where t.wave_id = x.id and t.status <> 'PLANNED');

  drop table if exists _move;
  create temp table _move on commit drop as
  select t.id, t.seq, t.wave_id from public.pick_tasks t
  where t.wave_id in (select id from _src) and t.shipment_number = p_shipment and t.status = 'PLANNED';
  -- Their pallet moves: the relocation from the same bin / SKU / batch in the same wave.
  insert into _move
  select r.id, r.seq, r.wave_id from public.pick_tasks r
  where r.wave_id in (select id from _src) and r.task_type <> 'PICK' and r.status = 'PLANNED'
    and exists (select 1 from public.pick_tasks p join _move m on m.id = p.id
                where p.wave_id = r.wave_id and p.from_bin_id = r.from_bin_id and p.item_id = r.item_id and p.batch_lot = r.batch_lot);

  select coalesce(max(seq), 0) into v_next from public.pick_tasks where wave_id = w.id;
  update public.pick_tasks t set wave_id = w.id, seq = v_next + o.rn
  from (select id, row_number() over (order by wave_id, seq, id) as rn from _move) o
  where t.id = o.id;
  get diagnostics n_tasks = row_count;
  update public.outbound set wave_id = w.id where wave_id in (select id from _src) and shipment_number = p_shipment;
  get diagnostics n_out = row_count;

  for v_src in select id from _src loop
    update public.waves set shipment_numbers = array_remove(shipment_numbers, p_shipment) where id = v_src;
    delete from public.waves x where x.id = v_src
      and not exists (select 1 from public.pick_tasks where wave_id = x.id)
      and not exists (select 1 from public.outbound where wave_id = x.id);
  end loop;
  if n_tasks + n_out > 0 then
    perform public.log_execution_event('WAVE', w.id, w.status, w.status,
      format('item baru shipment %s digabung: %s tugas, %s baris order', p_shipment, n_tasks, n_out));
  end if;
  return jsonb_build_object('tasks', n_tasks, 'outbound', n_out);
end $$;
revoke execute on function public.merge_into_carried_wave(uuid, text) from public, anon;
grant execute on function public.merge_into_carried_wave(uuid, text) to authenticated;
