-- =====================================================================
-- 0004  FEFO allocation, waves and pick tasks on top of the bin ledger
--
-- Merges the FEFO allocator's planning layer into this schema. There is
-- ONE source of truth for stock: public.inventory, written only by the
-- public.movements trigger. The allocator's plan is stored as
--   waves        one outbound run (the "NO" column of Schedule of the day)
--   outbound     demand per shipment + SKU, requested vs allocated
--   pick_tasks   PLANNED bin moves: PICK (bin -> truck) or
--                REPLENISH (reserve bin -> pickface bin)
-- A plan never touches stock. Posting a task inserts exactly one ledger
-- row in public.movements ('picking' or 'transfer'), so the existing
-- trigger validates and applies it, and the task shows up in the
-- movement history, ABC recompute and 3D view like any manual move.
--
-- Physical identity becomes bin + item + batch + EXPIRY (the allocator's
-- rule): two expiry dates of one batch in one bin are two stock rows.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Inventory identity includes expiry
-- ---------------------------------------------------------------------
alter table public.inventory drop constraint if exists inventory_bin_id_item_id_batch_lot_key;
create unique index if not exists inventory_identity_uq
  on public.inventory (bin_id, item_id, batch_lot, (coalesce(expiry_date, 'infinity'::date)));

-- Stock engine, now expiry-aware. A movement without expiry_date still works
-- when the (bin, item, batch) has exactly one stock row.
create or replace function public.apply_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  src public.inventory%rowtype;
  n_rows int;
  v_exp date := new.expiry_date;
  v_rec date := coalesce(new.received_date, current_date);
  v_to_status public.bin_status;
begin
  -- Force the author to be the caller (seed/import from SQL editor have no auth.uid()).
  if auth.uid() is not null then new.user_id := auth.uid(); end if;

  -- Adjustments are supervisor/admin only (defence in depth; RLS checks too).
  if new.type = 'adjustment' and auth.uid() is not null
     and not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can post adjustments';
  end if;

  if new.to_bin_id is not null and new.type <> 'adjustment' then
    select status into v_to_status from public.bins where id = new.to_bin_id;
    if v_to_status = 'blocked' then raise exception 'Destination bin is blocked'; end if;
  end if;

  -- 1) Take stock out of the source bin (picking, transfer, putaway from staging).
  if new.from_bin_id is not null then
    select count(*) into n_rows from public.inventory
      where bin_id = new.from_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
        and (new.expiry_date is null or expiry_date = new.expiry_date);
    if n_rows > 1 then
      raise exception 'Batch % has several expiry dates in this bin; specify the expiry date', new.batch_lot;
    end if;
    select * into src from public.inventory
      where bin_id = new.from_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
        and (new.expiry_date is null or expiry_date = new.expiry_date)
      for update;
    if not found or src.quantity < new.quantity then
      raise exception 'Insufficient stock in source bin (available %, requested %)',
        coalesce(src.quantity, 0), new.quantity;
    end if;
    if src.quantity = new.quantity then
      delete from public.inventory where id = src.id;
    else
      update public.inventory set quantity = quantity - new.quantity, updated_at = now() where id = src.id;
    end if;
    -- Moved stock keeps its original dates (FEFO depends on it).
    v_exp := src.expiry_date;
    v_rec := coalesce(src.received_date, v_rec);
    new.expiry_date := src.expiry_date;
  end if;

  -- 2) Put stock into the destination bin.
  if new.type in ('inbound','putaway','transfer') then
    if new.type in ('inbound','putaway') and new.from_bin_id is null and v_exp is null then
      raise exception 'Expiry date is required when receiving stock';
    end if;
    insert into public.inventory (bin_id, item_id, batch_lot, quantity, expiry_date, received_date)
    values (new.to_bin_id, new.item_id, new.batch_lot, new.quantity, v_exp, v_rec)
    on conflict (bin_id, item_id, batch_lot, (coalesce(expiry_date, 'infinity'::date)))
    do update set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

  elsif new.type = 'adjustment' then
    -- Signed correction on to_bin. Creates the row for opening balances / found stock.
    -- Exact identity match first. Without an expiry, fall back to the batch's
    -- only row in this bin (the pre-expiry-identity behaviour); ambiguous if
    -- the batch has several expiry dates here.
    select * into src from public.inventory
      where bin_id = new.to_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
        and expiry_date is not distinct from new.expiry_date
      for update;
    if not found and new.expiry_date is null then
      select count(*) into n_rows from public.inventory
        where bin_id = new.to_bin_id and item_id = new.item_id and batch_lot = new.batch_lot;
      if n_rows > 1 then
        raise exception 'Batch % has several expiry dates in this bin; specify the expiry date', new.batch_lot;
      end if;
      select * into src from public.inventory
        where bin_id = new.to_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
        for update;
    end if;
    if src.id is null then
      if new.quantity < 0 then raise exception 'Cannot adjust below zero: no stock of this batch in bin'; end if;
      insert into public.inventory (bin_id, item_id, batch_lot, quantity, expiry_date, received_date)
      values (new.to_bin_id, new.item_id, new.batch_lot, new.quantity, new.expiry_date, new.received_date);
    elsif src.quantity + new.quantity < 0 then
      raise exception 'Adjustment would make stock negative (current %)', src.quantity;
    elsif src.quantity + new.quantity = 0 then
      delete from public.inventory where id = src.id;
    else
      update public.inventory set quantity = quantity + new.quantity, updated_at = now()
      where id = src.id;
    end if;
    -- The ledger row records the identity it actually changed.
    new.expiry_date := coalesce(new.expiry_date, src.expiry_date);
  end if;

  return new;
end $$;

-- Snapshot import, keyed on the 4-part identity.
create or replace function public.import_snapshot(rows jsonb, full_sync boolean, source_name text, keep_bins text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin uuid; v_item uuid; v_cur numeric; v_diff numeric; v_exp date; v_batch text;
  n_bins int := 0; n_items int := 0; n_moves int := 0; inv record;
  v_note text := 'IMPORT ' || coalesce(source_name, 'file');
begin
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Only admins can import';
  end if;

  create temp table _seen (bin_id uuid, item_id uuid, batch_lot text, expiry_date date) on commit drop;

  for r in select * from jsonb_array_elements(rows) loop
    insert into public.bins (bin_code, zone, rack, level, position, status)
    values (r->>'bin_code', r->>'zone', r->>'rack', r->>'level', r->>'position',
            coalesce(r->>'status','active')::public.bin_status)
    on conflict (bin_code) do update set zone = excluded.zone, rack = excluded.rack,
      level = excluded.level, position = excluded.position
    returning id into v_bin;
    n_bins := n_bins + 1;

    continue when coalesce(r->>'sku','') = '';

    insert into public.items (sku, description, uom, upp, volume_l)
    values (r->>'sku', coalesce(r->>'description', r->>'sku'), r->>'uom',
            nullif(r->>'upp','')::numeric, nullif(r->>'volume_l','')::numeric)
    on conflict (sku) do update set
      description = coalesce(nullif(excluded.description, ''), public.items.description),
      uom  = coalesce(excluded.uom, public.items.uom),
      upp  = coalesce(excluded.upp, public.items.upp),
      volume_l = coalesce(excluded.volume_l, public.items.volume_l)
    returning id into v_item;
    n_items := n_items + 1;

    v_batch := coalesce(r->>'batch_lot','');
    v_exp := nullif(r->>'expiry_date','')::date;
    v_cur := null;
    select quantity into v_cur from public.inventory
      where bin_id = v_bin and item_id = v_item and batch_lot = v_batch
        and expiry_date is not distinct from v_exp;
    if v_cur is null and v_exp is null then
      -- Same fallback as the trigger: a row without expiry in the file
      -- matches the batch's only row in this bin.
      select quantity, expiry_date into v_cur, v_exp from public.inventory
        where bin_id = v_bin and item_id = v_item and batch_lot = v_batch
          and (select count(*) from public.inventory
               where bin_id = v_bin and item_id = v_item and batch_lot = v_batch) = 1;
    end if;
    insert into _seen values (v_bin, v_item, v_batch, v_exp);
    v_diff := (r->>'quantity')::numeric - coalesce(v_cur, 0);
    if v_diff <> 0 then
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note)
      values ('adjustment', v_item, v_batch, v_diff, v_bin, v_exp,
              nullif(r->>'received_date','')::date, v_note);
      n_moves := n_moves + 1;
    end if;
  end loop;

  -- Full snapshot: stock in the system that is absent from the file is zeroed (with a ledger entry),
  -- except in bins whose rows were rejected by validation (keep_bins).
  if full_sync then
    for inv in select i.* from public.inventory i
      join public.bins b on b.id = i.bin_id
      where b.bin_code <> all(keep_bins)  -- bins with rejected rows keep their stock
        and not exists (select 1 from _seen s where s.bin_id = i.bin_id and s.item_id = i.item_id
                          and s.batch_lot = i.batch_lot and s.expiry_date is not distinct from i.expiry_date)
    loop
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
      values ('adjustment', inv.item_id, inv.batch_lot, -inv.quantity, inv.bin_id, inv.expiry_date,
              v_note || ' (not in file)');
      n_moves := n_moves + 1;
    end loop;
  end if;

  return jsonb_build_object('rows', n_bins, 'item_rows', n_items, 'movements', n_moves);
end $$;

-- inventory_detail gains the bin status so the allocator can skip blocked bins.
create or replace view public.inventory_detail with (security_invoker = true) as
select i.id, i.bin_id, b.bin_code, b.zone, b.rack, b.level, b.position,
       it.id as item_id, it.sku, it.description, it.uom, it.upp, it.abc_class as item_abc,
       i.batch_lot, i.quantity, i.expiry_date, i.received_date,
       (i.expiry_date - current_date) as days_remaining,
       b.status as bin_status
from public.inventory i
join public.bins b on b.id = i.bin_id
join public.items it on it.id = i.item_id;

-- ---------------------------------------------------------------------
-- 2. Planning tables
-- ---------------------------------------------------------------------
create table public.waves (
  id               uuid primary key default gen_random_uuid(),
  wave_no          text not null,
  planned_date     date not null,
  shipment_numbers text[] not null default '{}',
  truck            text,
  destination      text not null default '',
  planned_slot     text,
  status           text not null default 'PENDING'
                     check (status in ('PENDING','COMPLETED','RESCHEDULED','CANCELLED')),
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (planned_date, wave_no)
);
create index waves_date_idx on public.waves (planned_date);

-- Demand per shipment + SKU. quantity_allocated < quantity_requested = shortage.
create table public.outbound (
  id                 uuid primary key default gen_random_uuid(),
  outbound_date      date not null,
  wave_id            uuid not null references public.waves(id) on delete cascade,
  shipment_number    text not null,
  sku                text not null,
  item_id            uuid references public.items(id),
  description        text not null default '',
  order_nos          text[] not null default '{}',
  truck              text,
  destination        text not null default '',
  quantity_requested numeric not null check (quantity_requested > 0),
  quantity_allocated numeric not null default 0 check (quantity_allocated >= 0),
  shortage_reason    text,
  status             text not null default 'PLANNED'
                       check (status in ('PLANNED','COMPLETED','RESCHEDULED','CANCELLED')),
  completed_at       timestamptz,
  completed_by       uuid references public.profiles(id),
  created_at         timestamptz not null default now()
);
create index outbound_wave_idx on public.outbound (wave_id);
create index outbound_date_idx on public.outbound (outbound_date);

create table public.pick_tasks (
  id              uuid primary key default gen_random_uuid(),
  wave_id         uuid not null references public.waves(id) on delete cascade,
  shipment_number text,                      -- null for REPLENISH
  task_type       text not null check (task_type in ('PICK','REPLENISH')),
  item_id         uuid not null references public.items(id),
  from_bin_id     uuid not null references public.bins(id),
  to_bin_id       uuid references public.bins(id),
  batch_lot       text not null default '',
  expiry_date     date not null,
  quantity        numeric not null check (quantity > 0),
  pick_type       text check (pick_type in ('PALLET','CASE')),
  breaks_pallet   boolean not null default false,
  seq             int not null,
  status          text not null default 'PLANNED'
                    check (status in ('PLANNED','COMPLETED','RESCHEDULED','CANCELLED')),
  completed_at    timestamptz,
  completed_by    uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  constraint pick_task_bins check (
    (task_type = 'PICK' and to_bin_id is null) or
    (task_type = 'REPLENISH' and to_bin_id is not null and to_bin_id <> from_bin_id)
  )
);
create index pick_tasks_wave_idx on public.pick_tasks (wave_id, seq);
create index pick_tasks_from_idx on public.pick_tasks (from_bin_id) where status = 'PLANNED';
create index pick_tasks_to_idx   on public.pick_tasks (to_bin_id)   where status = 'PLANNED';

-- Status-transition audit. History is never erased.
create table public.execution_events (
  id          bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('WAVE','TASK')),
  entity_id   uuid not null,
  from_status text,
  to_status   text not null,
  reason      text,
  actor       uuid references public.profiles(id),
  occurred_at timestamptz not null default now()
);
create index execution_events_entity_idx on public.execution_events (entity_type, entity_id);

-- A posted task produces exactly one ledger row; the unique index makes a
-- double post impossible even under concurrency.
alter table public.movements add column task_id uuid references public.pick_tasks(id);
create unique index movements_task_uq on public.movements (task_id) where task_id is not null;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger waves_updated_at before update on public.waves
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. RPCs. Planning tables have no write policies: every change goes
--    through these functions, which check the caller's role.
-- ---------------------------------------------------------------------
create or replace function public.log_execution_event(p_type text, p_id uuid, p_from text, p_to text, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into public.execution_events (entity_type, entity_id, from_status, to_status, reason, actor)
  values (p_type, p_id, p_from, p_to, p_reason, auth.uid());
$$;

-- Replaces the plan for one date. Refuses when any wave of that date has
-- already been worked on (a posted task or a non-pending status), so a
-- re-plan can never orphan executed picks.
-- p_plan: { waves:    [{wave_no, shipment_numbers[], truck, destination, planned_slot}],
--           tasks:    [{wave_no, shipment_number, task_type, sku, from_bin, to_bin,
--                       batch_lot, expiry_date, quantity, pick_type, breaks_pallet, seq}],
--           outbound: [{wave_no, shipment_number, sku, description, order_nos[], truck,
--                       destination, quantity_requested, quantity_allocated, shortage_reason}] }
create or replace function public.save_plan(p_date date, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w jsonb; t jsonb; o jsonb;
  v_wave uuid; v_item uuid; v_from uuid; v_to uuid;
  n_waves int := 0; n_tasks int := 0; n_out int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can save an allocation plan';
  end if;

  if exists (
    select 1 from public.waves wv
    where wv.planned_date = p_date
      and (wv.status not in ('PENDING','CANCELLED')
           or exists (select 1 from public.pick_tasks pt where pt.wave_id = wv.id and pt.status = 'COMPLETED'))
  ) then
    raise exception 'The plan for % is already being executed; finish or cancel its waves before re-planning', p_date;
  end if;

  delete from public.waves where planned_date = p_date;  -- cascades to tasks + outbound

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

  return jsonb_build_object('waves', n_waves, 'tasks', n_tasks, 'outbound', n_out);
end $$;

-- Executes one task: writes its ledger row (the movements trigger moves the
-- stock and rejects it if the bin no longer holds enough). Idempotent.
create or replace function public.post_task(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype;
  v_wave_status text;
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

  insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, task_id, note)
  values (case t.task_type when 'PICK' then 'picking' else 'transfer' end::public.movement_type,
          t.item_id, t.batch_lot, t.quantity, t.from_bin_id, t.to_bin_id, t.expiry_date, t.id,
          case t.task_type when 'PICK' then 'PICK shipment ' || coalesce(t.shipment_number, '-')
                           else 'REPLENISH pickface' end);

  update public.pick_tasks set status = 'COMPLETED', completed_at = now(), completed_by = auth.uid()
  where id = t.id;
  perform public.log_execution_event('TASK', t.id, t.status, 'COMPLETED', null);

  return jsonb_build_object('result', 'POSTED', 'task_id', t.id);
end $$;

create or replace function public.set_task_status(p_task_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.pick_tasks%rowtype;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can reschedule or cancel tasks';
  end if;
  if p_status not in ('PLANNED','RESCHEDULED','CANCELLED') then
    raise exception 'Invalid status % (use post_task to complete)', p_status;
  end if;
  select * into t from public.pick_tasks where id = p_task_id for update;
  if not found then raise exception 'Task % not found', p_task_id; end if;
  if t.status = 'COMPLETED' then raise exception 'Task is already completed'; end if;
  if t.status = p_status then return jsonb_build_object('result', 'NO_CHANGE'); end if;

  update public.pick_tasks set status = p_status where id = t.id;
  perform public.log_execution_event('TASK', t.id, t.status, p_status, p_reason);
  return jsonb_build_object('result', 'UPDATED', 'from_status', t.status, 'to_status', p_status);
end $$;

create or replace function public.set_wave_status(p_wave_id uuid, p_status text, p_reason text default null,
                                                  p_new_slot text default null, p_new_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waves%rowtype; n_cancelled int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can reschedule or cancel waves';
  end if;
  if p_status not in ('PENDING','RESCHEDULED','CANCELLED') then
    raise exception 'Invalid status % (use complete_wave to complete)', p_status;
  end if;
  select * into w from public.waves where id = p_wave_id for update;
  if not found then raise exception 'Wave % not found', p_wave_id; end if;
  if w.status in ('COMPLETED','CANCELLED') then raise exception 'Wave is already %', w.status; end if;

  if p_status = 'CANCELLED' then
    with c as (update public.pick_tasks set status = 'CANCELLED'
               where wave_id = w.id and status in ('PLANNED','RESCHEDULED') returning id)
    select count(*) into n_cancelled from c;
    update public.outbound set status = 'CANCELLED' where wave_id = w.id and status = 'PLANNED';
  end if;

  update public.waves set status = p_status,
         planned_slot = coalesce(p_new_slot, planned_slot),
         planned_date = coalesce(p_new_date, planned_date)
  where id = w.id;
  perform public.log_execution_event('WAVE', w.id, w.status, p_status, p_reason);
  return jsonb_build_object('result', 'UPDATED', 'from_status', w.status, 'to_status', p_status,
                            'tasks_cancelled', n_cancelled);
end $$;

-- Posts every remaining PLANNED task of the wave in sequence, then closes it.
-- All-or-nothing: one short bin rolls the whole wave back.
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
-- 4. Read models
-- ---------------------------------------------------------------------
create view public.pick_task_detail with (security_invoker = true) as
select t.id, t.wave_id, w.wave_no, w.planned_date, w.planned_slot, w.status as wave_status,
       t.shipment_number, t.task_type, t.seq, t.status,
       it.sku, it.description, it.uom, it.upp,
       fb.bin_code as from_bin, tb.bin_code as to_bin,
       t.batch_lot, t.expiry_date, t.quantity, t.pick_type, t.breaks_pallet,
       t.completed_at, p.name as completed_by_name
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins tb on tb.id = t.to_bin_id
left join public.profiles p on p.id = t.completed_by;

-- ---------------------------------------------------------------------
-- 5. RLS: every signed-in user reads; writes only through the RPCs above.
-- ---------------------------------------------------------------------
alter table public.waves            enable row level security;
alter table public.outbound         enable row level security;
alter table public.pick_tasks       enable row level security;
alter table public.execution_events enable row level security;

create policy "waves: read"            on public.waves            for select to authenticated using (true);
create policy "outbound: read"         on public.outbound         for select to authenticated using (true);
create policy "pick_tasks: read"       on public.pick_tasks       for select to authenticated using (true);
create policy "execution_events: read" on public.execution_events for select to authenticated using (true);

-- The ledger insert policy must not let a client forge a task link.
drop policy "movements: insert" on public.movements;
create policy "movements: insert" on public.movements for insert to authenticated
  with check (
    user_id = auth.uid()
    and task_id is null
    and (type <> 'adjustment' or public.has_role(array['supervisor','admin']::public.user_role[]))
  );

revoke execute on function public.log_execution_event(text, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.save_plan(date, jsonb) from public, anon;
revoke execute on function public.post_task(uuid) from public, anon;
revoke execute on function public.set_task_status(uuid, text, text) from public, anon;
revoke execute on function public.set_wave_status(uuid, text, text, text, date) from public, anon;
revoke execute on function public.complete_wave(uuid) from public, anon;
grant execute on function public.save_plan(date, jsonb) to authenticated;
grant execute on function public.post_task(uuid) to authenticated;
grant execute on function public.set_task_status(uuid, text, text) to authenticated;
grant execute on function public.set_wave_status(uuid, text, text, text, date) to authenticated;
grant execute on function public.complete_wave(uuid) to authenticated;
