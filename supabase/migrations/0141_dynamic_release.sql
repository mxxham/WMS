-- =====================================================================
-- 0141  Dynamic release: a wave waits for its truck and is planned again
--       from the stock of the moment the truck arrives
--
--  The day's plan is made once, in slot order, and every later wave leans on
--  the earlier ones: a pick from a pickface counts on the Bin To Bin an
--  earlier wave was planned to carry there. Trucks do not arrive in slot
--  order. A wave worked ahead of its turn found its bins short ("barang
--  kurang"), and the pickers moved stock bin to bin by hand to finish it
--  (user report, 17 Nov 2026).
--
--  Now the plan is made as before, for every shipment at once, and its waves
--  are LOCKED: they wait for their truck. A locked wave keeps a provisional
--  plan (its shortage shows before the truck does) but cannot be posted.
--  When the truck arrives the wave is opened (Truk datang): the allocator
--  runs again in the browser on the stock of that moment — same engine, same
--  FEFO rule — with the opened wave first and the waves still waiting behind
--  it in slot order (lib/allocator/release.ts). release_waves stores that
--  plan and opens the wave in one transaction.
--
--  a) waves.locked_at / released_at (+ who).
--  b) A released wave is no longer replaced by a new plan: its truck is here
--     and its picklist is out (replaceable_waves).
--  c) A wave that is finished or cancelled stops waiting.
--  d) Posting guard: no task of a locked wave is completed, whatever the path.
--  e) task_shortfalls / task_waits ignore the provisional tasks of locked
--     waves: "stok kurang" and "menunggu Bin To Bin" are about waves that can
--     be worked on. (open_pick_tasks is unchanged: a locked wave's tasks still
--     reserve stock against other plans and against moves by hand.)
--  f) save_plan (0124 body): a replaced wave that was locked stays locked
--     under the same NO.
--  g) lock_waves, release_waves.
--
--  The tasks of a locked wave are replaced in place: the wave row, its order
--  rows, its manual DO numbers and its history stay. Perubahan lokasi (0130)
--  records nothing for it: a provisional line was never a location anyone
--  was sent to.
-- =====================================================================

-- ---------------------------------------------------------------------
-- a) The lock
-- ---------------------------------------------------------------------
alter table public.waves
  add column locked_at        timestamptz,
  add column locked_by_name   text,
  add column released_at      timestamptz,
  add column released_by_name text;

comment on column public.waves.locked_at is 'Waiting for its truck since (0141): planned, not workable, planned again when opened. Null = workable.';
comment on column public.waves.released_at is 'When its truck arrived and the wave was opened (0141). Released waves are executed in this order.';

-- ---------------------------------------------------------------------
-- b) A released wave is kept by a new plan
-- ---------------------------------------------------------------------
create or replace function public.replaceable_waves(p_date date)
returns setof uuid language sql stable security invoker set search_path = public as $$
  select w.id from public.waves w
  where w.planned_date = p_date and w.status = 'PENDING' and w.released_at is null
    and not exists (select 1 from public.pick_tasks t where t.wave_id = w.id and t.status <> 'PLANNED');
$$;

-- ---------------------------------------------------------------------
-- c) Finished or cancelled: no longer waiting
-- ---------------------------------------------------------------------
create or replace function public.waves_lock_ends() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status in ('COMPLETED', 'CANCELLED') then
    new.locked_at := null;
    new.locked_by_name := null;
  end if;
  return new;
end $$;
create trigger waves_lock_ends before update of status on public.waves
  for each row execute function public.waves_lock_ends();
revoke execute on function public.waves_lock_ends() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- d) The posting guard: one trigger for every path that completes a task
-- ---------------------------------------------------------------------
create or replace function public.pick_tasks_lock_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_no text;
begin
  select w.wave_no into v_no from public.waves w where w.id = new.wave_id and w.locked_at is not null;
  if v_no is not null then
    raise exception 'NO % masih menunggu truk: buka dulu dengan Truk datang, baru dikerjakan', v_no;
  end if;
  return new;
end $$;
create trigger pick_tasks_lock_guard before update of status on public.pick_tasks
  for each row when (old.status is distinct from new.status and new.status = 'COMPLETED')
  execute function public.pick_tasks_lock_guard();
revoke execute on function public.pick_tasks_lock_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- e) Problems are about waves that can be worked on
-- ---------------------------------------------------------------------
-- task_shortfalls (0007 body) over the open tasks of waves that are not locked.
create or replace view public.task_shortfalls with (security_invoker = true) as
with live as (
  select t.* from public.open_pick_tasks t
  join public.waves lw on lw.id = t.wave_id
  where lw.locked_at is null
), outq as (
  select from_bin_id as bin_id, item_id, batch_lot, expiry_date, sum(quantity) as reserved
  from live group by 1, 2, 3, 4
), inq as (
  select to_bin_id as bin_id, item_id, batch_lot, expiry_date, sum(quantity) as incoming
  from live where to_bin_id is not null group by 1, 2, 3, 4
)
select t.id as task_id, t.wave_id, w.planned_date, w.wave_no, b.bin_code as from_bin, it.sku,
       t.batch_lot, t.expiry_date, o.reserved,
       coalesce((select sum(i.quantity) from public.inventory i
                 where i.bin_id = o.bin_id and i.item_id = o.item_id and i.batch_lot = o.batch_lot
                   and i.expiry_date is not distinct from o.expiry_date), 0) as physical,
       coalesce(n.incoming, 0) as incoming
from live t
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

-- task_waits (0053 body): a task of a workable wave, waiting for a move of a workable wave.
create or replace view public.task_waits with (security_invoker = true) as
select t.id as task_id, w.planned_date,
       coalesce((select sum(i.quantity) from public.inventory i
                 where i.bin_id = t.from_bin_id and i.item_id = t.item_id and i.batch_lot = t.batch_lot
                   and i.expiry_date is not distinct from t.expiry_date), 0) as have,
       r.wave_no as wait_wave_no, r.seq as wait_seq, r.from_bin as wait_from, r.to_bin as wait_to, r.quantity as wait_qty,
       r.id as wait_task_id, r.wave_status as wait_wave_status
from public.open_pick_tasks t
join public.waves w on w.id = t.wave_id
cross join lateral (
  select rw.wave_no, x.seq, fb.bin_code as from_bin, tb.bin_code as to_bin, x.quantity, x.id, rw.status as wave_status
  from public.open_pick_tasks x
  join public.waves rw on rw.id = x.wave_id
  join public.bins fb on fb.id = x.from_bin_id
  join public.bins tb on tb.id = x.to_bin_id
  where x.id <> t.id and x.task_type <> 'PICK' and x.to_bin_id = t.from_bin_id
    and x.item_id = t.item_id and x.batch_lot = t.batch_lot
    and rw.locked_at is null
  order by rw.planned_date, rw.planned_slot nulls last, rw.wave_no, x.seq
  limit 1
) r
where w.locked_at is null
  and coalesce((select sum(i.quantity) from public.inventory i
                where i.bin_id = t.from_bin_id and i.item_id = t.item_id and i.batch_lot = t.batch_lot
                  and i.expiry_date is not distinct from t.expiry_date), 0) < t.quantity;

-- ---------------------------------------------------------------------
-- f) save_plan (0124 body) + the lock of a replaced wave is carried by NO
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

  -- 0141: a replaced wave that waits for its truck keeps waiting under the same NO.
  drop table if exists _lock_carry;
  create temp table _lock_carry on commit drop as
    select lw.wave_no, lw.locked_at, lw.locked_by_name from public.waves lw
    where lw.id in (select id from _replace) and lw.locked_at is not null;

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

  update public.waves nw set locked_at = c.locked_at, locked_by_name = c.locked_by_name
  from _lock_carry c
  where nw.id in (select id from _wave_ids) and nw.wave_no = c.wave_no;

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
-- g) Lock
-- ---------------------------------------------------------------------
-- The typed name, else the account's.
create or replace function public.wave_actor_name(p_by_name text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(regexp_replace(trim(coalesce(p_by_name, '')), '\s+', ' ', 'g'), ''),
                  (select nullif(trim(name), '') from public.profiles where id = auth.uid()),
                  'Sistem')
$$;
revoke execute on function public.wave_actor_name(text) from public, anon, authenticated;

-- Locks waves until their truck arrives. Without p_wave_ids: every wave of the day nobody has
-- worked on and whose truck has not arrived. With them: those waves (also one opened by mistake,
-- as long as nothing of it is posted).
create or replace function public.lock_waves(p_date date, p_wave_ids uuid[] default null, p_by_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_bad text; r record; n int := 0; v_nos text[] := '{}';
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengunci wave';
  end if;
  if p_date is null then raise exception 'Tanggal wajib diisi'; end if;
  v_name := public.wave_actor_name(p_by_name);

  if p_wave_ids is not null then
    select string_agg(w.wave_no, ', ' order by w.wave_no) into v_bad
    from public.waves w
    where w.id = any(p_wave_ids)
      and (w.planned_date <> p_date or w.status <> 'PENDING'
           or exists (select 1 from public.pick_tasks t where t.wave_id = w.id and t.status <> 'PLANNED'));
    if v_bad is not null then
      raise exception 'NO % sudah dikerjakan atau tidak aktif: tidak bisa dikunci', v_bad;
    end if;
  end if;

  for r in
    update public.waves w
       set locked_at = now(), locked_by_name = v_name, released_at = null, released_by_name = null
     where w.planned_date = p_date and w.status = 'PENDING' and w.locked_at is null
       and case when p_wave_ids is null then w.released_at is null else w.id = any(p_wave_ids) end
       and not exists (select 1 from public.pick_tasks t where t.wave_id = w.id and t.status <> 'PLANNED')
    returning w.id, w.wave_no
  loop
    perform public.log_execution_event('WAVE', r.id, 'PENDING', 'LOCKED', format('dikunci menunggu truk oleh %s', v_name));
    n := n + 1; v_nos := v_nos || r.wave_no;
  end loop;
  return jsonb_build_object('locked', n, 'wave_nos', to_jsonb(v_nos));
end $$;

revoke execute on function public.lock_waves(date, uuid[], text) from public, anon;
grant execute on function public.lock_waves(date, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- g) Release
-- ---------------------------------------------------------------------
-- Replaces the tasks of the locked waves p_ids with p_plan (the save_plan payload; its `waves` are
-- not read). The order rows stay: only what was allocated, and why not, is written back, counted
-- from the tasks stored. Refused unless the plan covers exactly the demand those waves hold now.
create or replace function public.apply_locked_plan(p_ids uuid[], p_plan jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  t jsonb; v_nos text[]; v_bad text;
  v_wave uuid; v_item uuid; v_from uuid; v_to uuid; v_task uuid; n int := 0;
begin
  select array_agg(wave_no) into v_nos from public.waves where id = any(p_ids);

  if exists (select 1 from public.pick_tasks where wave_id = any(p_ids) and status <> 'PLANNED') then
    raise exception 'Wave yang menunggu truk punya baris yang sudah diubah. Muat ulang halaman.';
  end if;

  select string_agg(distinct coalesce(x.no, '?'), ', ') into v_bad
  from (select e->>'wave_no' as no from jsonb_array_elements(coalesce(p_plan->'tasks', '[]')) e
        union all
        select e->>'wave_no' from jsonb_array_elements(coalesce(p_plan->'outbound', '[]')) e) x
  where x.no is null or x.no <> all(v_nos);
  if v_bad is not null then
    raise exception 'Rencana memuat wave yang tidak menunggu truk (NO %). Muat ulang halaman.', v_bad;
  end if;

  -- The plan was made from the order rows as they were read; they must still be the same.
  if exists (
    select 1
    from (select w.wave_no, o.shipment_number, o.sku, sum(o.quantity_requested) as q
          from public.outbound o join public.waves w on w.id = o.wave_id
          where o.wave_id = any(p_ids) and o.status <> 'CANCELLED' group by 1, 2, 3) d
    full join
         (select e->>'wave_no' as wave_no, e->>'shipment_number' as shipment_number, e->>'sku' as sku,
                 sum((e->>'quantity_requested')::numeric) as q
          from jsonb_array_elements(coalesce(p_plan->'outbound', '[]')) e group by 1, 2, 3) p
      using (wave_no, shipment_number, sku)
    where d.q is distinct from p.q) then
    raise exception 'Order wave yang menunggu truk berubah sejak dihitung. Muat ulang halaman, lalu ulangi.';
  end if;

  -- No pick beyond what its shipment orders.
  select string_agg(distinct format('%s / %s', a.shipment_number, a.sku), ', ') into v_bad
  from (select e->>'wave_no' as wave_no, e->>'shipment_number' as shipment_number, e->>'sku' as sku,
               sum((e->>'quantity')::numeric) as q
        from jsonb_array_elements(coalesce(p_plan->'tasks', '[]')) e
        where e->>'task_type' = 'PICK' group by 1, 2, 3) a
  left join (select w.wave_no, o.shipment_number, o.sku, sum(o.quantity_requested) as q
             from public.outbound o join public.waves w on w.id = o.wave_id
             where o.wave_id = any(p_ids) and o.status <> 'CANCELLED' group by 1, 2, 3) d
    using (wave_no, shipment_number, sku)
  where d.q is null or a.q > d.q;
  if v_bad is not null then
    raise exception 'Rencana mengambil lebih dari order (%).', v_bad;
  end if;

  delete from public.pick_tasks where wave_id = any(p_ids);

  -- The task loop of save_plan (0124).
  for t in select * from jsonb_array_elements(coalesce(p_plan->'tasks', '[]')) loop
    select id into v_wave from public.waves where id = any(p_ids) and wave_no = t->>'wave_no';
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
    if t->>'task_type' = 'PICK' and jsonb_typeof(t->'orders') = 'array' then
      insert into public.pick_task_orders (task_id, ord, order_no, qty)
      select v_task, row_number() over (order by min(e.ord))::int, trim(e.x->>'order_no'), sum((e.x->>'qty')::numeric)
      from jsonb_array_elements(t->'orders') with ordinality as e(x, ord)
      where trim(coalesce(e.x->>'order_no', '')) <> '' and (e.x->>'qty')::numeric > 0
      group by trim(e.x->>'order_no');
    end if;
    n := n + 1;
  end loop;

  -- Allocated = the picks stored, spread over the order rows of a shipment + SKU in the order they
  -- were made; the reason of a shortage is the plan's.
  with alloc as (
    select pt.wave_id, pt.shipment_number, it.sku, sum(pt.quantity) as q
    from public.pick_tasks pt join public.items it on it.id = pt.item_id
    where pt.wave_id = any(p_ids) and pt.task_type = 'PICK' group by 1, 2, 3
  ), why as (
    select w.id as wave_id, e->>'shipment_number' as shipment_number, e->>'sku' as sku,
           max(nullif(e->>'shortage_reason', '')) as reason
    from jsonb_array_elements(coalesce(p_plan->'outbound', '[]')) e
    join public.waves w on w.id = any(p_ids) and w.wave_no = e->>'wave_no'
    group by 1, 2, 3
  ), r as (
    select o.id, o.quantity_requested as req, y.reason,
           coalesce(a.q, 0) - coalesce(sum(o.quantity_requested) over (
             partition by o.wave_id, o.shipment_number, o.sku order by o.created_at, o.id
             rows between unbounded preceding and 1 preceding), 0) as left_q
    from public.outbound o
    left join alloc a on a.wave_id = o.wave_id and a.shipment_number = o.shipment_number and a.sku = o.sku
    left join why y on y.wave_id = o.wave_id and y.shipment_number = o.shipment_number and y.sku = o.sku
    where o.wave_id = any(p_ids) and o.status <> 'CANCELLED'
  )
  update public.outbound o
     set quantity_allocated = greatest(least(r.req, r.left_q), 0),
         shortage_reason = case when greatest(least(r.req, r.left_q), 0) < r.req then coalesce(r.reason, 'NO_STOCK') end
  from r where o.id = r.id;

  return n;
end $$;
revoke execute on function public.apply_locked_plan(uuid[], jsonb) from public, anon, authenticated;

-- Truk datang: opens p_wave_ids (in that order). With p_plan the tasks of EVERY wave of the day
-- that waits for a truck are replaced by it first — the opened waves planned ahead of the waiting
-- ones, from the stock of this moment (plan-client.ts planRelease). Without a plan the waves are
-- opened as they were planned.
create or replace function public.release_waves(p_date date, p_wave_ids uuid[], p_plan jsonb default null, p_by_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_ids uuid[]; n_tasks int := 0; i int; w public.waves%rowtype; v_nos text[] := '{}';
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa membuka wave';
  end if;
  if coalesce(cardinality(p_wave_ids), 0) = 0 then raise exception 'Pilih wave yang truknya datang'; end if;
  v_name := public.wave_actor_name(p_by_name);

  -- Every wave of the day that waits, held for this transaction: two trucks opened at the same
  -- moment plan one after the other, never over each other.
  perform 1 from public.waves
  where planned_date = p_date and status = 'PENDING' and locked_at is not null order by id for update;
  select array_agg(id) into v_ids from public.waves
  where planned_date = p_date and status = 'PENDING' and locked_at is not null;

  if exists (select 1 from unnest(p_wave_ids) x where x <> all(coalesce(v_ids, '{}'))) then
    raise exception 'Wave ini tidak lagi menunggu truk (sudah dibuka, ditunda, atau dibatalkan). Muat ulang halaman.';
  end if;

  if p_plan is not null and jsonb_typeof(p_plan) = 'object' then
    n_tasks := public.apply_locked_plan(v_ids, p_plan);
  end if;

  for i in 1 .. cardinality(p_wave_ids) loop
    update public.waves
       set locked_at = null, locked_by_name = null, released_at = clock_timestamp(), released_by_name = v_name
     where id = p_wave_ids[i] and locked_at is not null
    returning * into w;
    if not found then continue; end if;  -- the same wave twice in the list
    perform public.log_execution_event('WAVE', w.id, 'LOCKED', 'PENDING',
      case when p_plan is not null and jsonb_typeof(p_plan) = 'object'
           then format('truk datang: dibuka oleh %s, dihitung ulang dari stok saat ini', v_name)
           else format('truk datang: dibuka oleh %s tanpa hitung ulang', v_name) end);
    v_nos := v_nos || w.wave_no;
  end loop;

  return jsonb_build_object('released', cardinality(v_nos), 'wave_nos', to_jsonb(v_nos),
                            'replanned', case when p_plan is null then 0 else cardinality(v_ids) end, 'tasks', n_tasks);
end $$;

revoke execute on function public.release_waves(date, uuid[], jsonb, text) from public, anon;
grant execute on function public.release_waves(date, uuid[], jsonb, text) to authenticated;
