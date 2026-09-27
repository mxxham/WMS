-- =====================================================================
-- 0007  Rolling execution: reservations, re-planning, actual confirmation
--
--  1. Reservation   Stock promised to open tasks (PLANNED tasks of PENDING
--                   or RESCHEDULED waves) is not free for new plans.
--                   planning_stock(date) = physical - reserved + incoming.
--  2. Re-planning   save_plan replaces only the UNTOUCHED waves of a date
--                   (PENDING, every task still PLANNED). Waves that have
--                   been worked on, paused or cancelled are kept as-is.
--  3. Actuals       post_task records what the picker really did: quantity,
--                   source bin/batch/expiry, and a reason when it differs.
--  4. Guard         An operator cannot move reserved stock by hand
--                   (bin page transfer/pick). Supervisors can; the plan
--                   then shows up in task_shortfalls until re-planned.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columns for actuals
-- ---------------------------------------------------------------------
alter table public.pick_tasks
  add column actual_quantity    numeric check (actual_quantity >= 0),
  add column actual_from_bin_id uuid references public.bins(id),
  add column actual_batch_lot   text,
  add column actual_expiry_date date,
  add column deviation_reason   text;

alter table public.outbound add column quantity_picked numeric not null default 0 check (quantity_picked >= 0);

-- ---------------------------------------------------------------------
-- Which waves of a date a new plan may replace
-- ---------------------------------------------------------------------
create or replace function public.replaceable_waves(p_date date)
returns setof uuid language sql stable security invoker set search_path = public as $$
  select w.id from public.waves w
  where w.planned_date = p_date and w.status = 'PENDING'
    and not exists (select 1 from public.pick_tasks t where t.wave_id = w.id and t.status <> 'PLANNED');
$$;

-- Open tasks = tasks that will still move stock (their wave is not closed).
create or replace view public.open_pick_tasks with (security_invoker = true) as
select t.* from public.pick_tasks t
join public.waves w on w.id = t.wave_id
where t.status = 'PLANNED' and w.status in ('PENDING','RESCHEDULED');

-- ---------------------------------------------------------------------
-- 1. Stock a new plan for p_date may use:
--    physical - out(open tasks) + in(open tasks), excluding the tasks of
--    the waves that this plan will replace. Rows with nothing left drop out.
-- ---------------------------------------------------------------------
create or replace function public.planning_stock(p_date date)
returns table (
  bin_code text, bin_status public.bin_status, sku text, description text, uom text, upp numeric,
  batch_lot text, quantity numeric, expiry_date date, received_date date,
  physical numeric, reserved numeric, incoming numeric
) language sql stable security invoker set search_path = public as $$
  with keep_tasks as (
    select * from public.open_pick_tasks
    where wave_id not in (select public.replaceable_waves(p_date))
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
  )
  select b.bin_code, b.status, it.sku, it.description, it.uom, it.upp,
         a.batch_lot, greatest(a.physical - a.reserved + a.incoming, 0), a.expiry_date, a.received_date,
         a.physical, a.reserved, a.incoming
  from agg a
  join public.bins b on b.id = a.bin_id
  join public.items it on it.id = a.item_id
  where a.physical - a.reserved + a.incoming > 0 or a.physical > 0
  order by b.bin_code, it.sku, a.batch_lot, a.expiry_date;
$$;

-- Tasks the current stock can no longer satisfy (someone moved the stock,
-- a picker took from elsewhere, a count was corrected...). Per source
-- identity: physical + planned incoming < planned outgoing.
create or replace view public.task_shortfalls with (security_invoker = true) as
with outq as (
  select from_bin_id as bin_id, item_id, batch_lot, expiry_date, sum(quantity) as reserved
  from public.open_pick_tasks group by 1, 2, 3, 4
), inq as (
  select to_bin_id as bin_id, item_id, batch_lot, expiry_date, sum(quantity) as incoming
  from public.open_pick_tasks where to_bin_id is not null group by 1, 2, 3, 4
)
select t.id as task_id, t.wave_id, w.planned_date, w.wave_no, b.bin_code as from_bin, it.sku,
       t.batch_lot, t.expiry_date, o.reserved,
       coalesce((select sum(i.quantity) from public.inventory i
                 where i.bin_id = o.bin_id and i.item_id = o.item_id and i.batch_lot = o.batch_lot
                   and i.expiry_date is not distinct from o.expiry_date), 0) as physical,
       coalesce(n.incoming, 0) as incoming
from public.open_pick_tasks t
join outq o on o.bin_id = t.from_bin_id and o.item_id = t.item_id and o.batch_lot = t.batch_lot
           and o.expiry_date = t.expiry_date
left join inq n on n.bin_id = o.bin_id and n.item_id = o.item_id and n.batch_lot = o.batch_lot
               and n.expiry_date = o.expiry_date
join public.waves w on w.id = t.wave_id
join public.bins b on b.id = t.from_bin_id
join public.items it on it.id = t.item_id
where coalesce((select sum(i.quantity) from public.inventory i
                where i.bin_id = o.bin_id and i.item_id = o.item_id and i.batch_lot = o.batch_lot
                  and i.expiry_date is not distinct from o.expiry_date), 0)
      + coalesce(n.incoming, 0) < o.reserved;

-- ---------------------------------------------------------------------
-- 2. save_plan: replace only untouched waves; keep everything else.
-- ---------------------------------------------------------------------
create or replace function public.save_plan(p_date date, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w jsonb; t jsonb; o jsonb;
  v_wave uuid; v_item uuid; v_from uuid; v_to uuid;
  n_waves int := 0; n_tasks int := 0; n_out int := 0; n_replaced int; n_kept int;
  v_clash text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can save an allocation plan';
  end if;

  create temp table _replace on commit drop as select id from public.replaceable_waves(p_date) as id;
  select count(*) into n_replaced from _replace;
  select count(*) into n_kept from public.waves where planned_date = p_date and id not in (select id from _replace);

  -- A new wave may not reuse the NO of a wave that is being kept.
  select string_agg(distinct x.wave_no, ', ') into v_clash
  from jsonb_to_recordset(coalesce(p_plan->'waves', '[]')) as x(wave_no text)
  join public.waves kw on kw.planned_date = p_date and kw.wave_no = x.wave_no
  where kw.id not in (select id from _replace);
  if v_clash is not null then
    raise exception 'Wave NO % sudah dikerjakan/ditahan/dibatalkan dan tidak bisa direncanakan ulang', v_clash;
  end if;

  delete from public.waves where id in (select id from _replace);  -- cascades to tasks + outbound

  create temp table _wave_ids (wave_no text primary key, id uuid) on commit drop;

  for w in select * from jsonb_array_elements(coalesce(p_plan->'waves', '[]')) loop
    insert into public.waves (wave_no, planned_date, shipment_numbers, truck, destination, planned_slot, created_by)
    values (w->>'wave_no', p_date,
            coalesce(array(select jsonb_array_elements_text(w->'shipment_numbers')), '{}'),
            nullif(w->>'truck',''), coalesce(w->>'destination',''), nullif(w->>'planned_slot',''), auth.uid())
    returning id into v_wave;
    insert into _wave_ids values (w->>'wave_no', v_wave);
    n_waves := n_waves + 1;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(p_plan->'tasks', '[]')) loop
    select id into v_wave from _wave_ids where wave_no = t->>'wave_no';
    if v_wave is null then raise exception 'Task references unknown wave %', t->>'wave_no'; end if;
    select id into v_item from public.items where sku = t->>'sku';
    if v_item is null then raise exception 'Unknown SKU %', t->>'sku'; end if;
    select id into v_from from public.bins where bin_code = t->>'from_bin';
    if v_from is null then raise exception 'Unknown bin %', t->>'from_bin'; end if;
    v_to := null;
    if coalesce(t->>'to_bin','') <> '' then
      select id into v_to from public.bins where bin_code = t->>'to_bin';
      if v_to is null then raise exception 'Unknown bin %', t->>'to_bin'; end if;
    end if;
    insert into public.pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id,
                                   batch_lot, expiry_date, quantity, pick_type, breaks_pallet, seq)
    values (v_wave, nullif(t->>'shipment_number',''), t->>'task_type', v_item, v_from, v_to,
            coalesce(t->>'batch_lot',''), (t->>'expiry_date')::date, (t->>'quantity')::numeric,
            nullif(t->>'pick_type',''), coalesce((t->>'breaks_pallet')::boolean, false), (t->>'seq')::int);
    n_tasks := n_tasks + 1;
  end loop;

  for o in select * from jsonb_array_elements(coalesce(p_plan->'outbound', '[]')) loop
    select id into v_wave from _wave_ids where wave_no = o->>'wave_no';
    if v_wave is null then raise exception 'Outbound line references unknown wave %', o->>'wave_no'; end if;
    insert into public.outbound (outbound_date, wave_id, shipment_number, sku, item_id, description, order_nos,
                                 truck, destination, quantity_requested, quantity_allocated, shortage_reason)
    values (p_date, v_wave, o->>'shipment_number', o->>'sku',
            (select id from public.items where sku = o->>'sku'), coalesce(o->>'description',''),
            coalesce(array(select jsonb_array_elements_text(o->'order_nos')), '{}'),
            nullif(o->>'truck',''), coalesce(o->>'destination',''),
            (o->>'quantity_requested')::numeric, coalesce((o->>'quantity_allocated')::numeric, 0),
            nullif(o->>'shortage_reason',''));
    n_out := n_out + 1;
  end loop;

  return jsonb_build_object('waves', n_waves, 'tasks', n_tasks, 'outbound', n_out,
                            'replaced', n_replaced, 'kept', n_kept);
end $$;

-- What a plan for p_date would replace and keep, for the UI.
create or replace function public.plan_context(p_date date)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'replaceable', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'wave_no', w.wave_no, 'shipment_numbers', w.shipment_numbers,
                                                                 'truck', w.truck, 'destination', w.destination, 'planned_slot', w.planned_slot))
                             from public.waves w where w.id in (select public.replaceable_waves(p_date))), '[]'),
    'kept', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'wave_no', w.wave_no, 'status', w.status, 'shipment_numbers', w.shipment_numbers))
                      from public.waves w where w.planned_date = p_date
                        and w.id not in (select public.replaceable_waves(p_date))), '[]')
  );
$$;

-- ---------------------------------------------------------------------
-- 3. post_task with actuals. Without the optional arguments it posts the
--    task exactly as planned (what complete_wave does).
-- ---------------------------------------------------------------------
drop function if exists public.post_task(uuid);

create or replace function public.post_task(
  p_task_id    uuid,
  p_actual_qty numeric default null,
  p_from_bin   text    default null,
  p_batch_lot  text    default null,
  p_expiry     date    default null,
  p_reason     text    default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype;
  v_wave_status text;
  v_qty numeric; v_from uuid; v_batch text; v_exp date; v_deviated boolean;
  v_mv public.movements%rowtype;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sign in to post tasks';
  end if;

  select * into t from public.pick_tasks where id = p_task_id for update;
  if not found then raise exception 'Task % not found', p_task_id; end if;
  if t.status = 'COMPLETED' then
    return jsonb_build_object('result', 'ALREADY_POSTED', 'task_id', t.id);
  end if;
  if t.status <> 'PLANNED' then
    raise exception 'Task is % and cannot be posted', t.status;
  end if;
  select status into v_wave_status from public.waves where id = t.wave_id;
  if v_wave_status <> 'PENDING' then
    raise exception 'Wave is % and cannot be worked on', v_wave_status;
  end if;

  v_qty := coalesce(p_actual_qty, t.quantity);
  if v_qty < 0 or v_qty > t.quantity then
    raise exception 'Jumlah aktual harus 0 sampai % (jumlah rencana)', t.quantity;
  end if;
  v_from := t.from_bin_id; v_batch := t.batch_lot; v_exp := t.expiry_date;
  if coalesce(p_from_bin, '') <> '' then
    select id into v_from from public.bins where bin_code = upper(p_from_bin);
    if v_from is null then raise exception 'Bin % tidak ditemukan', p_from_bin; end if;
    if v_from <> t.from_bin_id then
      -- A different bin holds different stock: take its batch/expiry as given
      -- (null expiry = the batch's only row in that bin).
      v_batch := coalesce(p_batch_lot, t.batch_lot);
      v_exp := p_expiry;
    end if;
  end if;
  if p_batch_lot is not null then v_batch := p_batch_lot; end if;
  if p_expiry is not null then v_exp := p_expiry; end if;

  v_deviated := v_qty <> t.quantity or v_from <> t.from_bin_id or v_batch <> t.batch_lot
                or v_exp is distinct from t.expiry_date;
  if v_deviated and coalesce(trim(p_reason), '') = '' then
    raise exception 'Alasan wajib diisi jika hasil berbeda dari rencana';
  end if;
  if v_from = t.to_bin_id then
    raise exception 'Bin asal sama dengan bin tujuan';
  end if;

  if v_qty > 0 then
    insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, task_id, note)
    values (case t.task_type when 'PICK' then 'picking' else 'transfer' end::public.movement_type,
            t.item_id, v_batch, v_qty, v_from, t.to_bin_id, v_exp, t.id,
            case t.task_type when 'PICK' then 'PICK shipment ' || coalesce(t.shipment_number, '-')
                             else 'REPLENISH pickface' end
            || case when v_deviated then ' (menyimpang: ' || p_reason || ')' else '' end)
    returning * into v_mv;
  end if;

  update public.pick_tasks set
    status = 'COMPLETED', completed_at = now(), completed_by = auth.uid(),
    actual_quantity = v_qty, actual_from_bin_id = v_from, actual_batch_lot = v_batch,
    actual_expiry_date = coalesce(v_mv.expiry_date, v_exp),
    deviation_reason = case when v_deviated then p_reason end
  where id = t.id;

  if t.task_type = 'PICK' then
    update public.outbound set quantity_picked = quantity_picked + v_qty
    where wave_id = t.wave_id and shipment_number = t.shipment_number and item_id = t.item_id;
  end if;

  perform public.log_execution_event('TASK', t.id, t.status, 'COMPLETED',
    case when v_deviated then format('actual %s dari %s: %s', v_qty,
      (select bin_code from public.bins where id = v_from), p_reason) end);

  return jsonb_build_object('result', 'POSTED', 'task_id', t.id, 'deviated', v_deviated, 'quantity', v_qty);
end $$;

-- complete_wave now calls the new signature (defaults = as planned).
create or replace function public.complete_wave(p_wave_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waves%rowtype; t record; n_posted int := 0;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sign in to complete waves';
  end if;
  select * into w from public.waves where id = p_wave_id for update;
  if not found then raise exception 'Wave % not found', p_wave_id; end if;
  if w.status = 'COMPLETED' then return jsonb_build_object('result', 'ALREADY_POSTED'); end if;
  if w.status <> 'PENDING' then raise exception 'Wave is % and cannot be completed', w.status; end if;

  for t in select id from public.pick_tasks where wave_id = w.id and status = 'PLANNED' order by seq loop
    perform public.post_task(t.id);
    n_posted := n_posted + 1;
  end loop;

  update public.outbound set status = 'COMPLETED', completed_at = now(), completed_by = auth.uid()
  where wave_id = w.id and status = 'PLANNED';
  update public.waves set status = 'COMPLETED' where id = w.id;
  perform public.log_execution_event('WAVE', w.id, w.status, 'COMPLETED', null);
  return jsonb_build_object('result', 'POSTED', 'tasks_posted', n_posted);
end $$;

-- ---------------------------------------------------------------------
-- 4. Guard: manual moves may not eat stock reserved for open tasks,
--    unless a supervisor/admin does it. Fires before movements_apply
--    (triggers run in name order).
-- ---------------------------------------------------------------------
create or replace function public.guard_reserved_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_physical numeric; v_reserved numeric; v_waves text;
begin
  if new.task_id is not null or new.from_bin_id is null or new.type = 'adjustment' then return new; end if;
  if auth.uid() is null or public.has_role(array['supervisor','admin']::public.user_role[]) then return new; end if;

  select coalesce(sum(quantity), 0) into v_physical from public.inventory
  where bin_id = new.from_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
    and (new.expiry_date is null or expiry_date = new.expiry_date);
  select coalesce(sum(t.quantity), 0), string_agg(distinct w.wave_no || ' (' || w.planned_date || ')', ', ')
    into v_reserved, v_waves
  from public.open_pick_tasks t join public.waves w on w.id = t.wave_id
  where t.from_bin_id = new.from_bin_id and t.item_id = new.item_id and t.batch_lot = new.batch_lot
    and (new.expiry_date is null or t.expiry_date = new.expiry_date);

  if v_physical - new.quantity < v_reserved then
    raise exception 'Stok ini dipesan % unit untuk wave %. Kerjakan lewat halaman Wave, atau minta supervisor.',
      v_reserved, v_waves;
  end if;
  return new;
end $$;

create trigger movements_a_reserved_guard before insert on public.movements
  for each row execute function public.guard_reserved_stock();

-- ---------------------------------------------------------------------
-- Read model: task detail with actuals (columns appended at the end).
-- ---------------------------------------------------------------------
create or replace view public.pick_task_detail with (security_invoker = true) as
select t.id, t.wave_id, w.wave_no, w.planned_date, w.planned_slot, w.status as wave_status,
       t.shipment_number, t.task_type, t.seq, t.status,
       it.sku, it.description, it.uom, it.upp,
       fb.bin_code as from_bin, tb.bin_code as to_bin,
       t.batch_lot, t.expiry_date, t.quantity, t.pick_type, t.breaks_pallet,
       t.completed_at, p.name as completed_by_name,
       t.actual_quantity, ab.bin_code as actual_from_bin, t.actual_batch_lot, t.actual_expiry_date,
       t.deviation_reason
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins tb on tb.id = t.to_bin_id
left join public.profiles p on p.id = t.completed_by
left join public.bins ab on ab.id = t.actual_from_bin_id;

-- ---------------------------------------------------------------------
-- Privileges (see 0005: nothing is granted by default)
-- ---------------------------------------------------------------------
grant select on public.open_pick_tasks, public.task_shortfalls, public.pick_task_detail to authenticated;
revoke execute on function public.post_task(uuid, numeric, text, text, date, text) from public, anon;
revoke execute on function public.planning_stock(date) from public, anon;
revoke execute on function public.plan_context(date) from public, anon;
revoke execute on function public.replaceable_waves(date) from public, anon;
revoke execute on function public.guard_reserved_stock() from public, anon, authenticated;
grant execute on function public.post_task(uuid, numeric, text, text, date, text) to authenticated;
grant execute on function public.planning_stock(date) to authenticated;
grant execute on function public.plan_context(date) to authenticated;
grant execute on function public.replaceable_waves(date) to authenticated;
grant execute on function public.complete_wave(uuid) to authenticated;
grant execute on function public.save_plan(date, jsonb) to authenticated;
grant all on public.open_pick_tasks, public.task_shortfalls to service_role;
