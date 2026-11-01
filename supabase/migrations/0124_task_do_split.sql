-- =====================================================================
-- 0124  Every audited item carries its own DO, by one rule
--
--  0121/0122 gave each audited item the DOs of its shipment + SKU: when a
--  shipment orders one SKU on several DOs (2-8 Schedule rows, on 7-17% of the
--  lines in the September workbooks), every pick of that SKU listed every DO.
--  On top of that the DO was built in two places that disagreed:
--  pick_audit_line sorted the plan's numbers alphabetically, pick_audit_move
--  kept first-seen order and added the manual DOs of the Wave page, and the
--  pages added the manual DOs a third time in TypeScript.
--
--  The split is now made once, by the allocator (lib/allocator/orders.ts):
--  the lines, in printed order, fill the DOs in Schedule row order. It is
--  stored per task, and one function reads it for every surface:
--
--    task_do_nos(task)  PICK      its pick_task_orders, in fill order;
--                                 a task without them (a plan saved before
--                                 0124, a line added on the Wave page) falls
--                                 back to its shipment + SKU's order_nos.
--                       REPLENISH the DOs of the pick it is the pallet rest of
--                                 (move_pick: same wave + SKU, seq - 1, which
--                                 is where plan.ts and post_wave_sheet put a
--                                 move); a move without one falls back to the
--                                 wave's demand for its SKU.
--
--  Manual DOs (shipment_do_no, 0079) are shipment paperwork, typed after
--  allocation with no link to an item: they are no longer attached to items,
--  only shown on the shipment.
--
--  a) outbound.order_qtys: each DO's cartons, so a replan splits the same way.
--  b) pick_task_orders: a task's DOs and their cartons. No write policy.
--  c) save_plan re-issued (0123 body) to write both.
--  d) move_pick + task_do_nos.
--  e) pick_audit_line, pick_audit_move: do_nos from task_do_nos; a move's
--     shipment, destination and city follow its pick. Same columns, same
--     order, same types.
--  f) pick_task_detail + do_nos (appended), so a Wave page reprint prints the
--     same DO per line as the first print.
-- =====================================================================

-- ---------------------------------------------------------------------
-- a) Each DO's cartons on the demand line
-- ---------------------------------------------------------------------
alter table public.outbound
  add column order_qtys jsonb not null default '[]'::jsonb check (jsonb_typeof(order_qtys) = 'array');

-- ---------------------------------------------------------------------
-- b) A task's DOs
-- ---------------------------------------------------------------------
create table public.pick_task_orders (
  task_id  uuid    not null references public.pick_tasks(id) on delete cascade,
  ord      int     not null,
  order_no text    not null check (trim(order_no) <> ''),
  qty      numeric not null check (qty > 0),
  primary key (task_id, ord),
  unique (task_id, order_no)
);

alter table public.pick_task_orders enable row level security;

-- Readable exactly when the task is (pick_tasks' own policies apply inside exists).
create policy "pick_task_orders: read" on public.pick_task_orders
for select to authenticated
using ((select public.is_active()) and exists (select 1 from public.pick_tasks t where t.id = task_id));

-- No write policy: written only by save_plan.
grant select on public.pick_task_orders to authenticated;
grant all on public.pick_task_orders to service_role;

-- ---------------------------------------------------------------------
-- c) save_plan (0123 body) + outbound.order_qtys + pick_task_orders
-- ---------------------------------------------------------------------
create or replace function public.save_plan(p_date date, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w jsonb; t jsonb; o jsonb;
  v_wave uuid; v_item uuid; v_from uuid; v_to uuid; v_task uuid;
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
            nullif(t->>'pick_type',''), coalesce((t->>'breaks_pallet')::boolean, false), (t->>'seq')::int)
    returning id into v_task;
    -- 0124: the DOs whose cartons this pick carries, in fill order (blank or empty entries dropped,
    -- the same DO twice adds up).
    if t->>'task_type' = 'PICK' and jsonb_typeof(t->'orders') = 'array' then
      insert into public.pick_task_orders (task_id, ord, order_no, qty)
      select v_task, row_number() over (order by min(e.ord))::int, trim(e.x->>'order_no'), sum((e.x->>'qty')::numeric)
      from jsonb_array_elements(t->'orders') with ordinality as e(x, ord)
      where trim(coalesce(e.x->>'order_no', '')) <> '' and (e.x->>'qty')::numeric > 0
      group by trim(e.x->>'order_no');
    end if;
    n_tasks := n_tasks + 1;
  end loop;

  for o in select * from jsonb_array_elements(coalesce(p_plan->'outbound', '[]')) loop
    select id into v_wave from _wave_ids where wave_no = o->>'wave_no';
    if v_wave is null then raise exception 'Outbound line references unknown wave %', o->>'wave_no'; end if;
    insert into public.outbound (outbound_date, wave_id, shipment_number, sku, item_id, description, order_nos, order_qtys,
                                 truck, destination, ship_to_location, quantity_requested, quantity_allocated, shortage_reason)
    values (p_date, v_wave, o->>'shipment_number', o->>'sku',
            (select id from public.items where sku = o->>'sku'), coalesce(o->>'description',''),
            coalesce(array(select jsonb_array_elements_text(o->'order_nos')), '{}'),
            case when jsonb_typeof(o->'order_qtys') = 'array' then o->'order_qtys' else '[]'::jsonb end,
            nullif(o->>'truck',''), coalesce(o->>'destination',''), coalesce(o->>'ship_to_location',''),
            (o->>'quantity_requested')::numeric, coalesce((o->>'quantity_allocated')::numeric, 0),
            nullif(o->>'shortage_reason',''));
    n_out := n_out + 1;
  end loop;

  return jsonb_build_object('waves', n_waves, 'tasks', n_tasks, 'outbound', n_out,
                            'replaced', n_replaced, 'kept', n_kept);
end $$;

revoke execute on function public.save_plan(date, jsonb) from public, anon;
grant execute on function public.save_plan(date, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- d) The one DO rule
-- ---------------------------------------------------------------------
-- The pick a Bin To Bin line is the pallet rest of: the PICK of the same SKU
-- right before it in the wave (plan.ts and post_wave_sheet both put the move
-- at the pick's seq + 1). Null for a move with no such pick.
create or replace function public.move_pick(p_task uuid)
returns uuid language sql stable set search_path = public as $$
  select p.id
  from public.pick_tasks m
  join public.pick_tasks p on p.wave_id = m.wave_id and p.seq = m.seq - 1
                          and p.task_type = 'PICK' and p.item_id = m.item_id
  where m.id = p_task and m.task_type = 'REPLENISH'
  limit 1
$$;

-- The DOs of one task, as every audit surface and the reprint show them.
create or replace function public.task_do_nos(p_task uuid)
returns text[] language plpgsql stable set search_path = public as $$
declare
  t public.pick_tasks%rowtype;
  v_sku text;
  v_pick uuid;
  v text[];
begin
  select * into t from public.pick_tasks where id = p_task;
  if not found then return '{}'::text[]; end if;
  select sku into v_sku from public.items where id = t.item_id;

  if t.task_type = 'REPLENISH' then
    v_pick := public.move_pick(p_task);
    if v_pick is not null then return public.task_do_nos(v_pick); end if;
    -- No pick to follow: every DO of the wave's demand for the SKU.
    return public.norm_do_nos((
      select coalesce(jsonb_agg(d.d order by o.shipment_number, o.created_at, d.ord), '[]'::jsonb)
      from public.outbound o cross join lateral unnest(o.order_nos) with ordinality as d(d, ord)
      where o.wave_id = t.wave_id and o.sku = v_sku and o.status <> 'CANCELLED'));
  end if;

  select array_agg(x.order_no order by x.ord) into v from public.pick_task_orders x where x.task_id = p_task;
  if v is not null then return v; end if;
  -- Not split (saved before 0124, or added later): the shipment + SKU's DOs.
  return public.norm_do_nos((
    select coalesce(jsonb_agg(d.d order by o.created_at, d.ord), '[]'::jsonb)
    from public.outbound o cross join lateral unnest(o.order_nos) with ordinality as d(d, ord)
    where o.wave_id = t.wave_id and o.shipment_number = t.shipment_number
      and o.sku = v_sku and o.status <> 'CANCELLED'));
end $$;

revoke execute on function public.move_pick(uuid) from public, anon;
grant execute on function public.move_pick(uuid) to authenticated;
revoke execute on function public.task_do_nos(uuid) from public, anon;
grant execute on function public.task_do_nos(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- e) pick_audit_line (0123 body): do_nos from task_do_nos
-- ---------------------------------------------------------------------
create or replace view public.pick_audit_line with (security_invoker = true) as
with latest as (
  select distinct on (task_id) * from public.pick_audits order by task_id, attempt_no desc
), n as (
  select task_id, count(*)::int as attempts from public.pick_audits group by task_id
)
select t.id as task_id, t.wave_id, w.wave_no, w.planned_date, w.status as wave_status, t.shipment_number, t.seq,
       it.sku, it.description, it.uom,
       coalesce(ab.bin_code, fb.bin_code) as from_bin, coalesce(ab.zone, fb.zone) as zone,
       coalesce(t.actual_batch_lot, t.batch_lot) as batch_lot, coalesce(t.actual_expiry_date, t.expiry_date) as expiry_date,
       t.quantity as planned_qty, coalesce(t.actual_quantity, t.quantity) as picked_qty, t.deviation_reason,
       t.completed_at, t.picked_by_name, t.bulk_posted, t.scanned_code,
       l.id as audit_id, l.attempt_no, l.result, l.errors, l.resolution, l.checker_name, l.created_at as audited_at,
       coalesce(n.attempts, 0) as attempts,
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when l.id is null then 'TODO'
            when l.result = 'OK' then 'OK'
            when l.resolution is not null then 'RESOLVED'
            else 'MISMATCH' end as line_state,
       sl.id is not null as loaded,
       t.scan_method,
       it.volume_l,
       -- 0124: the item's own DOs, by the one rule
       public.task_do_nos(t.id) as do_nos,
       -- 0123: who the goods go to, and where
       coalesce(nullif(trim(d.destination), ''), split_part(w.destination, ' · ', 1), '') as destination,
       coalesce(nullif(trim(d.ship_to_location), ''),
                case when position(' · ' in w.destination) > 0 then split_part(w.destination, ' · ', 2) end,
                '') as ship_to_location
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join public.shipment_loads sl on sl.wave_id = t.wave_id and sl.shipment_number = t.shipment_number
left join lateral (
  select max(o.destination) as destination, max(o.ship_to_location) as ship_to_location
  from public.outbound o
  where o.wave_id = t.wave_id and o.shipment_number = t.shipment_number
    and o.sku = it.sku and o.status <> 'CANCELLED'
) d on true
where t.task_type = 'PICK' and t.status = 'COMPLETED';

grant select on public.pick_audit_line to authenticated;

-- ---------------------------------------------------------------------
-- e) pick_audit_move (0123 body): a move follows the pick it is the rest of
-- ---------------------------------------------------------------------
create or replace view public.pick_audit_move with (security_invoker = true) as
with latest as (
  select distinct on (task_id) * from public.pick_audits order by task_id, attempt_no desc
), n as (
  select task_id, count(*)::int as attempts from public.pick_audits group by task_id
), src as (
  select distinct on (task_id) * from public.move_source_audits order by task_id, attempt_no desc
), sn as (
  select task_id, count(*)::int as attempts from public.move_source_audits group by task_id
)
select t.id as task_id, t.wave_id, w.wave_no, w.planned_date, w.status as wave_status, t.seq,
       it.sku, it.description, it.uom,
       coalesce(ab.bin_code, fb.bin_code) as from_bin, coalesce(ab.zone, fb.zone) as zone,
       tb.bin_code as to_bin, tb.zone as to_zone,
       coalesce(t.actual_batch_lot, t.batch_lot) as batch_lot, coalesce(t.actual_expiry_date, t.expiry_date) as expiry_date,
       t.quantity as planned_qty, coalesce(t.actual_quantity, t.quantity) as moved_qty, t.deviation_reason,
       t.completed_at, t.picked_by_name, t.bulk_posted, t.scanned_code,
       l.id as audit_id, l.attempt_no, l.result, l.errors, l.resolution, l.checker_name, l.created_at as audited_at,
       coalesce(n.attempts, 0) as attempts,
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when l.id is null then 'TODO'
            when l.result = 'OK' then 'OK'
            when l.resolution is not null then 'RESOLVED'
            else 'MISMATCH' end as line_state,
       -- 0114: the count left in the source bin
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when s.id is null then 'TODO'
            when s.result = 'OK' then 'OK'
            else 'MISMATCH' end as from_state,
       coalesce(sn.attempts, 0) as from_attempts,
       s.checker_name as from_checker, s.system_qty as from_system, s.counted_qty as from_counted,
       s.found_sku as from_found_sku, s.note as from_note, s.correction as from_correction, s.created_at as from_audited_at,
       -- 0124: the shipment of the pick this move follows; else the wave's demand for the SKU (0122)
       coalesce(case when mp.shipment_number is not null then array[mp.shipment_number] end,
                dm.shipments, w.shipment_numbers) as shipment_numbers,
       public.task_do_nos(t.id) as do_nos,
       -- 0123: who the goods go to, and where (of that same shipment)
       coalesce(dm.destinations,
                case when w.destination <> '' then array[split_part(w.destination, ' · ', 1)] else '{}'::text[] end) as destinations,
       coalesce(dm.ship_to_locations,
                case when position(' · ' in w.destination) > 0 then array[split_part(w.destination, ' · ', 2)] else '{}'::text[] end) as ship_to_locations
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
join public.bins tb on tb.id = t.to_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join src s on s.task_id = t.id
left join sn on sn.task_id = t.id
left join lateral (
  select p.shipment_number from public.pick_tasks p where p.id = public.move_pick(t.id)
) mp on true
-- The demand this move serves: its pick's shipment for the SKU, or (no pick) the whole wave's.
left join lateral (
  select array_agg(distinct o.shipment_number order by o.shipment_number) as shipments,
         (select array_agg(x.v order by x.v)
            from (select distinct coalesce(nullif(trim(o3.destination), ''), split_part(w.destination, ' · ', 1)) as v
                    from public.outbound o3
                   where o3.wave_id = t.wave_id and o3.sku = it.sku and o3.status <> 'CANCELLED'
                     and (mp.shipment_number is null or o3.shipment_number = mp.shipment_number)) x
           where coalesce(x.v, '') <> '') as destinations,
         (select array_agg(y.v order by y.v)
            from (select distinct coalesce(nullif(trim(o4.ship_to_location), ''),
                                           case when position(' · ' in w.destination) > 0
                                                then split_part(w.destination, ' · ', 2) end) as v
                    from public.outbound o4
                   where o4.wave_id = t.wave_id and o4.sku = it.sku and o4.status <> 'CANCELLED'
                     and (mp.shipment_number is null or o4.shipment_number = mp.shipment_number)) y
           where coalesce(y.v, '') <> '') as ship_to_locations
  from public.outbound o
  where o.wave_id = t.wave_id and o.sku = it.sku and o.status <> 'CANCELLED'
    and (mp.shipment_number is null or o.shipment_number = mp.shipment_number)
) dm on true
where t.task_type = 'REPLENISH' and t.status = 'COMPLETED';

grant select on public.pick_audit_move to authenticated;

-- ---------------------------------------------------------------------
-- f) pick_task_detail (0067 body) + do_nos, appended
-- ---------------------------------------------------------------------
create or replace view public.pick_task_detail with (security_invoker = true) as
select t.id, t.wave_id, w.wave_no, w.planned_date, w.planned_slot, w.status as wave_status,
       t.shipment_number, t.task_type, t.seq, t.status,
       it.sku, it.description, it.uom, it.upp,
       fb.bin_code as from_bin, tb.bin_code as to_bin,
       t.batch_lot, t.expiry_date, t.quantity, t.pick_type, t.breaks_pallet,
       t.completed_at, p.name as completed_by_name,
       t.actual_quantity, ab.bin_code as actual_from_bin, t.actual_batch_lot, t.actual_expiry_date,
       t.deviation_reason, t.picked_by_name,
       public.task_do_nos(t.id) as do_nos
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins tb on tb.id = t.to_bin_id
left join public.profiles p on p.id = t.completed_by
left join public.bins ab on ab.id = t.actual_from_bin_id;

grant select on public.pick_task_detail to authenticated;
