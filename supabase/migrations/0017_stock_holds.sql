-- =====================================================================
-- 0017  Stock holds (status on stock without moving it)
--
--  A hold says "this stock may not be shipped": waiting for QC / Shell,
--  damaged, under investigation, recalled, expired, customer return.
--    LINE   part or all of one stock line (bin + SKU + batch + expiry)
--    BATCH  every carton of a SKU + batch, in every bin, including stock
--           that arrives later (recall / quality block)
--  Held stock:
--    · is left out of planning (planning_stock) and shown as held
--      (inventory_detail.held),
--    · cannot be picked, transferred or used by a wave task — only written
--      off (negative adjustment) or moved into QUARANTINE, where the hold
--      follows it. Anything else must release the hold first.
--  Holds are never deleted: released with who, when and why.
-- =====================================================================

create table public.stock_holds (
  id               uuid primary key default gen_random_uuid(),
  scope            text not null check (scope in ('LINE', 'BATCH')),
  bin_id           uuid references public.bins(id),
  item_id          uuid not null references public.items(id),
  batch_lot        text not null default '',
  expiry_date      date,
  quantity         numeric,
  reason_code      text not null check (reason_code in ('QC_HOLD', 'DAMAGED', 'INVESTIGATION', 'RECALL', 'EXPIRED', 'RETURN')),
  note             text not null,
  source           text not null default 'MANUAL' check (source in ('MANUAL', 'RECEIPT', 'CARRY', 'RECON')),
  ref_id           uuid,
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'RELEASED')),
  created_by       uuid references public.profiles(id),
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  released_by      uuid references public.profiles(id),
  released_by_name text,
  released_at      timestamptz,
  release_note     text,
  constraint stock_hold_scope check (
    (scope = 'LINE' and bin_id is not null and quantity > 0) or
    (scope = 'BATCH' and bin_id is null and quantity is null and batch_lot <> '')
  )
);
create index stock_holds_active_line_idx on public.stock_holds (bin_id, item_id, batch_lot) where status = 'ACTIVE';
create index stock_holds_active_batch_idx on public.stock_holds (item_id, batch_lot) where status = 'ACTIVE' and scope = 'BATCH';
create unique index stock_holds_one_batch_hold on public.stock_holds (item_id, batch_lot) where status = 'ACTIVE' and scope = 'BATCH';

alter table public.stock_holds enable row level security;
create policy "stock_holds: read" on public.stock_holds for select to authenticated using (true);
-- No write policies: changes go through place_hold / release_hold and the movement guard.

-- Held quantity of one stock identity with `physical` cartons on hand.
create or replace function public.held_qty(p_bin uuid, p_item uuid, p_batch text, p_expiry date, p_physical numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.stock_holds h where h.status = 'ACTIVE' and h.scope = 'BATCH'
                 and h.item_id = p_item and h.batch_lot = p_batch) then greatest(p_physical, 0)
    else least(greatest(p_physical, 0), coalesce((select sum(h.quantity) from public.stock_holds h
               where h.status = 'ACTIVE' and h.scope = 'LINE' and h.bin_id = p_bin and h.item_id = p_item
                 and h.batch_lot = p_batch and h.expiry_date is not distinct from p_expiry), 0))
  end;
$$;

create or replace function public.hold_reasons(p_bin uuid, p_item uuid, p_batch text, p_expiry date)
returns text language sql stable security definer set search_path = public as $$
  select string_agg(distinct h.reason_code, ', ' order by h.reason_code) from public.stock_holds h
  where h.status = 'ACTIVE' and h.item_id = p_item and h.batch_lot = p_batch
    and (h.scope = 'BATCH' or (h.bin_id = p_bin and h.expiry_date is not distinct from p_expiry));
$$;

-- inventory_detail (0004) + held / hold_reasons at the end.
create or replace view public.inventory_detail with (security_invoker = true) as
select i.id, i.bin_id, b.bin_code, b.zone, b.rack, b.level, b.position,
       it.id as item_id, it.sku, it.description, it.uom, it.upp, it.abc_class as item_abc,
       i.batch_lot, i.quantity, i.expiry_date, i.received_date,
       (i.expiry_date - current_date) as days_remaining,
       b.status as bin_status,
       public.held_qty(i.bin_id, i.item_id, i.batch_lot, i.expiry_date, i.quantity) as held,
       public.hold_reasons(i.bin_id, i.item_id, i.batch_lot, i.expiry_date) as hold_reasons
from public.inventory i
join public.bins b on b.id = i.bin_id
join public.items it on it.id = i.item_id;

-- planning_stock (0007): held stock is not plannable. `held` appended.
drop function public.planning_stock(date);
create function public.planning_stock(p_date date)
returns table (
  bin_code text, bin_status public.bin_status, sku text, description text, uom text, upp numeric,
  batch_lot text, quantity numeric, expiry_date date, received_date date,
  physical numeric, reserved numeric, incoming numeric, held numeric
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
revoke execute on function public.planning_stock(date) from public, anon;
grant execute on function public.planning_stock(date) to authenticated;

-- Shrink active LINE holds of one identity (newest first) to fit `p_physical`.
create or replace function public.trim_line_holds(p_bin uuid, p_item uuid, p_batch text, p_expiry date, p_physical numeric, p_why text)
returns void language plpgsql security definer set search_path = public as $$
declare h record; v_total numeric; v_excess numeric;
begin
  select coalesce(sum(quantity), 0) into v_total from public.stock_holds
  where status = 'ACTIVE' and scope = 'LINE' and bin_id = p_bin and item_id = p_item and batch_lot = p_batch
    and expiry_date is not distinct from p_expiry;
  v_excess := v_total - greatest(p_physical, 0);
  for h in select * from public.stock_holds
           where status = 'ACTIVE' and scope = 'LINE' and bin_id = p_bin and item_id = p_item and batch_lot = p_batch
             and expiry_date is not distinct from p_expiry
           order by created_at desc, id for update loop
    exit when v_excess <= 0;
    if h.quantity <= v_excess then
      update public.stock_holds set status = 'RELEASED', released_by = auth.uid(), released_by_name = 'sistem',
        released_at = now(), release_note = p_why where id = h.id;
      v_excess := v_excess - h.quantity;
    else
      update public.stock_holds set quantity = quantity - v_excess where id = h.id;
      v_excess := 0;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Movement guard: held stock stays put.
-- Functions that move a whole identity and carry its holds themselves
-- (identity corrections, bin swaps) set app.hold_carry = 'on' locally.
-- ---------------------------------------------------------------------
create or replace function public.guard_held_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_bin uuid; v_out numeric; v_physical numeric; v_held numeric; v_exp date; v_rows int;
  v_to_zone text; v_reasons text; v_bin_code text; v_move numeric; h record; v_left numeric;
begin
  if coalesce(current_setting('app.hold_carry', true), '') = 'on' then return new; end if;
  if new.from_bin_id is not null then
    v_bin := new.from_bin_id; v_out := new.quantity;
  elsif new.type = 'adjustment' and new.quantity < 0 then
    v_bin := new.to_bin_id; v_out := -new.quantity;
  else
    return new;
  end if;

  -- The identity the movement will draw from (apply_movement resolves a missing expiry the same way).
  select count(*), sum(quantity), min(expiry_date) into v_rows, v_physical, v_exp from public.inventory
  where bin_id = v_bin and item_id = new.item_id and batch_lot = new.batch_lot
    and (new.expiry_date is null or expiry_date = new.expiry_date);
  if v_rows <> 1 then return new; end if;  -- none / ambiguous: apply_movement raises its own error
  v_held := public.held_qty(v_bin, new.item_id, new.batch_lot, v_exp, v_physical);
  if v_held = 0 then return new; end if;
  if new.type = 'transfer' then select zone into v_to_zone from public.bins where id = new.to_bin_id; end if;
  -- Taking only unheld cartons is fine — except into quarantine, where held cartons go first.
  if v_physical - v_out >= v_held and v_to_zone is distinct from 'QUARANTINE' then return new; end if;

  -- Write-off of held stock: allowed; the holds shrink with the stock.
  if new.type = 'adjustment' then
    perform public.trim_line_holds(v_bin, new.item_id, new.batch_lot, v_exp, v_physical - v_out, 'Stok ditulis-off (adjustment)');
    return new;
  end if;

  -- Into quarantine: allowed; the held part of what moves keeps its hold there.
  if new.type = 'transfer' then
    if v_to_zone = 'QUARANTINE' then
      v_move := least(v_out, v_held);  -- held cartons leave first
      if not exists (select 1 from public.stock_holds where status = 'ACTIVE' and scope = 'BATCH'
                     and item_id = new.item_id and batch_lot = new.batch_lot) then
        v_left := v_move;
        for h in select * from public.stock_holds
                 where status = 'ACTIVE' and scope = 'LINE' and bin_id = v_bin and item_id = new.item_id
                   and batch_lot = new.batch_lot and expiry_date is not distinct from v_exp
                 order by created_at, id loop
          exit when v_left <= 0;
          insert into public.stock_holds (scope, bin_id, item_id, batch_lot, expiry_date, quantity, reason_code, note,
                                          source, ref_id, created_by, created_by_name)
          values ('LINE', new.to_bin_id, h.item_id, h.batch_lot, h.expiry_date, least(h.quantity, v_left), h.reason_code,
                  h.note, 'CARRY', h.id, auth.uid(), h.created_by_name);
          v_left := v_left - least(h.quantity, v_left);
        end loop;
        perform public.trim_line_holds(v_bin, new.item_id, new.batch_lot, v_exp, v_held - v_move, 'Dipindah ke karantina');
      end if;
      return new;
    end if;
  end if;

  select bin_code into v_bin_code from public.bins where id = v_bin;
  v_reasons := public.hold_reasons(v_bin, new.item_id, new.batch_lot, v_exp);
  raise exception 'Stok % batch % di % ditahan (%): % dari % unit tidak boleh diambil. Lepas hold dulu, atau pindahkan ke karantina.',
    (select sku from public.items where id = new.item_id), coalesce(nullif(new.batch_lot, ''), '–'), v_bin_code,
    v_reasons, v_held, v_physical;
end $$;

-- Before the reservation guard and apply_movement (triggers fire in name order).
create trigger movements_a_hold_guard before insert on public.movements
  for each row execute function public.guard_held_stock();
revoke execute on function public.guard_held_stock() from public, anon, authenticated;

-- The reservation guard (0007) spoke up when there was not enough stock at
-- all ("dipesan 0 unit untuk wave <NULL>"), hiding apply_movement's own
-- "insufficient stock" message. Only reserved stock is its business.
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

  if v_reserved > 0 and new.quantity <= v_physical and v_physical - new.quantity < v_reserved then
    raise exception 'Stok ini dipesan % unit untuk wave %. Kerjakan lewat halaman Wave, atau minta supervisor.',
      v_reserved, v_waves;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Place / release
-- ---------------------------------------------------------------------
create or replace function public.place_hold(
  p_scope text, p_bin_code text, p_sku text, p_batch text, p_expiry date, p_qty numeric,
  p_reason_code text, p_note text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name); v_item uuid; v_bin uuid; src public.inventory%rowtype;
  v_free numeric; v_id uuid; v_tasks int;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menahan stok';
  end if;
  if nullif(trim(p_note), '') is null then raise exception 'Keterangan hold wajib diisi'; end if;
  select id into v_item from public.items where sku = trim(p_sku);
  if v_item is null then raise exception 'SKU % tidak ada di master item', p_sku; end if;

  if p_scope = 'BATCH' then
    if nullif(trim(p_batch), '') is null then raise exception 'Hold per batch butuh nomor batch'; end if;
    if exists (select 1 from public.stock_holds where status = 'ACTIVE' and scope = 'BATCH' and item_id = v_item and batch_lot = trim(p_batch)) then
      raise exception 'Batch % SKU % sudah ditahan', trim(p_batch), p_sku;
    end if;
    insert into public.stock_holds (scope, item_id, batch_lot, reason_code, note, created_by, created_by_name)
    values ('BATCH', v_item, trim(p_batch), p_reason_code, trim(p_note), auth.uid(), v_name)
    returning id into v_id;
    select count(*) into v_tasks from public.open_pick_tasks where item_id = v_item and batch_lot = trim(p_batch);
  elsif p_scope = 'LINE' then
    select id into v_bin from public.bins where bin_code = upper(trim(p_bin_code));
    select * into src from public.inventory
    where bin_id = v_bin and item_id = v_item and batch_lot = coalesce(p_batch, '') and expiry_date is not distinct from p_expiry;
    if src.id is null then raise exception 'Stok % / % / batch % tidak ditemukan (mungkin sudah berubah)', p_bin_code, p_sku, p_batch; end if;
    v_free := src.quantity - public.held_qty(src.bin_id, src.item_id, src.batch_lot, src.expiry_date, src.quantity);
    if p_qty is null or p_qty <= 0 then raise exception 'Jumlah yang ditahan harus lebih dari 0'; end if;
    if p_qty > v_free then raise exception 'Hanya % unit yang belum ditahan di baris ini', v_free; end if;
    insert into public.stock_holds (scope, bin_id, item_id, batch_lot, expiry_date, quantity, reason_code, note, created_by, created_by_name)
    values ('LINE', src.bin_id, v_item, src.batch_lot, src.expiry_date, p_qty, p_reason_code, trim(p_note), auth.uid(), v_name)
    returning id into v_id;
    select count(*) into v_tasks from public.open_pick_tasks
    where from_bin_id = src.bin_id and item_id = v_item and batch_lot = src.batch_lot and expiry_date = src.expiry_date;
  else
    raise exception 'Jenis hold % tidak dikenal', p_scope;
  end if;
  return jsonb_build_object('id', v_id, 'open_tasks', v_tasks);
end $$;

create or replace function public.release_hold(p_id uuid, p_note text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name);
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa melepas hold';
  end if;
  if nullif(trim(p_note), '') is null then raise exception 'Alasan melepas hold wajib diisi'; end if;
  update public.stock_holds set status = 'RELEASED', released_by = auth.uid(), released_by_name = v_name,
    released_at = now(), release_note = trim(p_note)
  where id = p_id and status = 'ACTIVE';
  if not found then raise exception 'Hold tidak ada atau sudah dilepas'; end if;
end $$;

create or replace view public.stock_hold_detail with (security_invoker = true) as
select h.id, h.scope, b.bin_code, it.sku, it.description, it.uom, h.batch_lot, h.expiry_date, h.quantity,
       h.reason_code, h.note, h.source, h.status, h.created_by_name, h.created_at,
       h.released_by_name, h.released_at, h.release_note,
       -- what the hold covers right now
       case when h.scope = 'BATCH' then
              (select coalesce(sum(i.quantity), 0) from public.inventory i where i.item_id = h.item_id and i.batch_lot = h.batch_lot)
            else least(h.quantity, (select coalesce(sum(i.quantity), 0) from public.inventory i
                                    where i.bin_id = h.bin_id and i.item_id = h.item_id and i.batch_lot = h.batch_lot
                                      and i.expiry_date is not distinct from h.expiry_date)) end as covered_qty,
       case when h.scope = 'BATCH' then
              (select count(distinct i.bin_id) from public.inventory i where i.item_id = h.item_id and i.batch_lot = h.batch_lot)
            else 1 end as bins
from public.stock_holds h
join public.items it on it.id = h.item_id
left join public.bins b on b.id = h.bin_id;

grant select on public.stock_holds, public.stock_hold_detail to authenticated;
grant all on public.stock_holds to service_role;
grant execute on function public.held_qty(uuid, uuid, text, date, numeric), public.hold_reasons(uuid, uuid, text, date) to authenticated;
revoke execute on function public.trim_line_holds(uuid, uuid, text, date, numeric, text) from public, anon, authenticated;
revoke execute on function public.place_hold(text, text, text, text, date, numeric, text, text, text), public.release_hold(uuid, text, text) from public, anon;
grant execute on function public.place_hold(text, text, text, text, date, numeric, text, text, text), public.release_hold(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- apply_movement (0004) with the quarantine rule above.
-- ---------------------------------------------------------------------
create or replace function public.apply_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  src public.inventory%rowtype;
  n_rows int;
  v_exp date := new.expiry_date;
  v_rec date := coalesce(new.received_date, current_date);
  v_to_status public.bin_status;
  v_to_zone text;
  v_from_zone text;
begin
  -- Force the author to be the caller (seed/import from SQL editor have no auth.uid()).
  if auth.uid() is not null then new.user_id := auth.uid(); end if;

  -- Adjustments are supervisor/admin only (defence in depth; RLS checks too).
  if new.type = 'adjustment' and auth.uid() is not null
     and not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can post adjustments';
  end if;

  -- Quarantine is blocked for picking but is where held / damaged stock goes:
  -- supervisors may move stock in; nothing is ever picked out of it.
  if new.to_bin_id is not null and new.type <> 'adjustment' then
    select status, zone into v_to_status, v_to_zone from public.bins where id = new.to_bin_id;
    if v_to_zone = 'QUARANTINE' then
      if auth.uid() is not null and not public.has_role(array['supervisor','admin']::public.user_role[]) then
        raise exception 'Hanya supervisor atau admin yang bisa memindahkan stok ke karantina';
      end if;
    elsif v_to_status = 'blocked' then
      raise exception 'Destination bin is blocked';
    end if;
  end if;
  if new.type = 'picking' and new.from_bin_id is not null then
    select zone into v_from_zone from public.bins where id = new.from_bin_id;
    if v_from_zone = 'QUARANTINE' then raise exception 'Stok karantina tidak boleh dipick'; end if;
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
