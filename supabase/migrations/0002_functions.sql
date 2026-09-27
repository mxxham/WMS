-- =====================================================================
-- 0002  Role helper, profile trigger, stock-movement engine, views
-- =====================================================================

-- SECURITY DEFINER so RLS policies can read the caller's role without
-- recursing into the profiles policies.
create or replace function public.current_user_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.has_role(roles public.user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = any(roles) from public.profiles where id = auth.uid()), false)
$$;

-- New auth user -> profile row with the least-privileged role.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), 'operator')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Stock engine. Runs BEFORE INSERT on movements and is the only code path
-- that writes public.inventory. A failed check aborts the insert, so the
-- ledger and the stock can never disagree.
-- ---------------------------------------------------------------------
create or replace function public.apply_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  src public.inventory%rowtype;
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
    select * into src from public.inventory
      where bin_id = new.from_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
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
    v_exp := coalesce(v_exp, src.expiry_date);
    v_rec := coalesce(src.received_date, v_rec);
  end if;

  -- 2) Put stock into the destination bin.
  if new.type in ('inbound','putaway','transfer') then
    if new.type in ('inbound','putaway') and new.from_bin_id is null and v_exp is null then
      raise exception 'Expiry date is required when receiving stock';
    end if;
    insert into public.inventory (bin_id, item_id, batch_lot, quantity, expiry_date, received_date)
    values (new.to_bin_id, new.item_id, new.batch_lot, new.quantity, v_exp, v_rec)
    on conflict (bin_id, item_id, batch_lot)
    do update set quantity = public.inventory.quantity + excluded.quantity, updated_at = now();

  elsif new.type = 'adjustment' then
    -- Signed correction on to_bin. Creates the row for opening balances / found stock.
    select * into src from public.inventory
      where bin_id = new.to_bin_id and item_id = new.item_id and batch_lot = new.batch_lot
      for update;
    if not found then
      if new.quantity < 0 then raise exception 'Cannot adjust below zero: no stock of this batch in bin'; end if;
      insert into public.inventory (bin_id, item_id, batch_lot, quantity, expiry_date, received_date)
      values (new.to_bin_id, new.item_id, new.batch_lot, new.quantity, new.expiry_date, new.received_date);
    elsif src.quantity + new.quantity < 0 then
      raise exception 'Adjustment would make stock negative (current %)', src.quantity;
    elsif src.quantity + new.quantity = 0 then
      delete from public.inventory where id = src.id;
    else
      update public.inventory set quantity = quantity + new.quantity,
        expiry_date = coalesce(new.expiry_date, expiry_date), updated_at = now()
      where id = src.id;
    end if;
  end if;

  return new;
end $$;

create trigger movements_apply before insert on public.movements
  for each row execute function public.apply_movement();

-- The ledger is append-only.
create or replace function public.block_ledger_edit()
returns trigger language plpgsql as $$
begin
  raise exception 'movements are immutable; post a correcting movement instead';
end $$;
create trigger movements_immutable before update or delete on public.movements
  for each row execute function public.block_ledger_edit();

-- ---------------------------------------------------------------------
-- Snapshot import (admin). Upserts items/bins, then posts one adjustment
-- per (bin, sku, batch) for the difference between file and system, so the
-- import itself is traceable in the ledger.
-- rows: [{bin_code, zone, rack, level, position, status, sku, description,
--         uom, upp, volume_l, batch_lot, quantity, expiry_date, received_date}]
-- ---------------------------------------------------------------------
create or replace function public.import_snapshot(rows jsonb, full_sync boolean, source_name text, keep_bins text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_bin uuid; v_item uuid; v_cur numeric; v_diff numeric;
  n_bins int := 0; n_items int := 0; n_moves int := 0; inv record;
  v_note text := 'IMPORT ' || coalesce(source_name, 'file');
begin
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Only admins can import';
  end if;

  create temp table _seen (bin_id uuid, item_id uuid, batch_lot text) on commit drop;

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

    insert into _seen values (v_bin, v_item, coalesce(r->>'batch_lot',''));

    select quantity into v_cur from public.inventory
      where bin_id = v_bin and item_id = v_item and batch_lot = coalesce(r->>'batch_lot','');
    v_diff := (r->>'quantity')::numeric - coalesce(v_cur, 0);
    if v_diff <> 0 then
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note)
      values ('adjustment', v_item, coalesce(r->>'batch_lot',''), v_diff, v_bin,
              nullif(r->>'expiry_date','')::date, nullif(r->>'received_date','')::date, v_note);
      n_moves := n_moves + 1;
    end if;
  end loop;

  -- Full snapshot: stock in the system that is absent from the file is zeroed (with a ledger entry),
  -- except in bins whose rows were rejected by validation (keep_bins).
  if full_sync then
    for inv in select i.* from public.inventory i
      join public.bins b on b.id = i.bin_id
      where b.bin_code <> all(keep_bins)  -- bins with rejected rows keep their stock
        and not exists (select 1 from _seen s where s.bin_id = i.bin_id and s.item_id = i.item_id and s.batch_lot = i.batch_lot)
    loop
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, note)
      values ('adjustment', inv.item_id, inv.batch_lot, -inv.quantity, inv.bin_id, v_note || ' (not in file)');
      n_moves := n_moves + 1;
    end loop;
  end if;

  return jsonb_build_object('rows', n_bins, 'item_rows', n_items, 'movements', n_moves);
end $$;

-- ---------------------------------------------------------------------
-- Layout -> 3D coordinates. x runs along the aisle (rack number, position),
-- y is height (level), z separates aisles. Floor zones get a grid in front.
-- ---------------------------------------------------------------------
create or replace function public.recompute_bin_positions()
returns int language plpgsql security definer set search_path = public as $$
declare cfg jsonb; n int;
begin
  if auth.uid() is not null and not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Only admins can change the layout';
  end if;
  select value into cfg from public.settings where key = 'layout';

  update public.bins b set
    pos_x = ((b.rack::int - 1) * (cfg->>'bay_width_m')::numeric)
            + ((b.position::int - 0.5) * (cfg->>'bay_width_m')::numeric / (cfg->>'positions_per_bay')::numeric),
    pos_y = (ascii(b.level) - ascii('A')) * (cfg->>'level_height_m')::numeric,
    pos_z = (array_position(array(select jsonb_array_elements_text(cfg->'aisle_order')), b.zone) - 1)
            * ((cfg->>'rack_depth_m')::numeric + (cfg->>'aisle_width_m')::numeric)
  where b.rack is not null and b.level is not null and b.position ~ '^\d+$'
    and b.zone in (select jsonb_array_elements_text(cfg->'aisle_order'));

  -- Floor locations: a simple row in front of the racks, one slot per bin.
  with f as (
    select id, row_number() over (order by zone, bin_code) - 1 as k
    from public.bins where rack is null
  )
  update public.bins b set
    pos_x = (cfg->'floor_zone_origin'->>'x')::numeric + f.k * 1.4,
    pos_y = 0,
    pos_z = (cfg->'floor_zone_origin'->>'z')::numeric
  from f where b.id = f.id;

  select count(*) into n from public.bins where pos_x is not null;
  return n;
end $$;

-- ABC by pick frequency (number of picking lines) over the last N days:
-- A = SKUs covering the first 80% of lines, B = next 15%, C = rest / never picked.
create or replace function public.recompute_abc(days int default 90)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Only admins can recompute ABC';
  end if;
  with f as (
    select item_id, count(*) as lines from public.movements
    where type = 'picking' and created_at >= now() - make_interval(days => days)
    group by item_id
  ), c as (
    select item_id, sum(lines) over (order by lines desc, item_id) / sum(lines) over () as cum from f
  )
  update public.items i set abc_class = case
      when c.cum is null then 'C' when c.cum <= 0.80 then 'A' when c.cum <= 0.95 then 'B' else 'C' end
  from public.items i2 left join c on c.item_id = i2.id
  where i.id = i2.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Read models (security_invoker => caller's RLS applies)
-- ---------------------------------------------------------------------
create view public.inventory_detail with (security_invoker = true) as
select i.id, i.bin_id, b.bin_code, b.zone, b.rack, b.level, b.position,
       it.id as item_id, it.sku, it.description, it.uom, it.upp, it.abc_class as item_abc,
       i.batch_lot, i.quantity, i.expiry_date, i.received_date,
       (i.expiry_date - current_date) as days_remaining
from public.inventory i
join public.bins b on b.id = i.bin_id
join public.items it on it.id = i.item_id;

-- One row per bin for the 3D view and dashboard.
-- fill_ratio = sum(qty / UPP) / capacity (pallet equivalents); null when UPP unknown.
create view public.bin_summary with (security_invoker = true) as
select b.id, b.bin_code, b.zone, b.rack, b.level, b.position, b.status, b.capacity,
       b.pos_x, b.pos_y, b.pos_z,
       coalesce(b.abc_class, (
         select min(it.abc_class) from public.inventory i join public.items it on it.id = i.item_id where i.bin_id = b.id
       )) as abc_class,
       coalesce(sum(i.quantity), 0) as total_qty,
       case when count(i.id) = 0 then 0
            when bool_or(it.upp is null) then null
            else sum(i.quantity / nullif(it.upp, 0)) / nullif(b.capacity, 0) end as fill_ratio,
       min(i.expiry_date) as min_expiry,
       coalesce(array_agg(distinct it.sku) filter (where it.sku is not null), '{}') as skus
from public.bins b
left join public.inventory i on i.bin_id = b.id
left join public.items it on it.id = i.item_id
group by b.id;
