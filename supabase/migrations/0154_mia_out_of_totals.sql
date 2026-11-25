-- =====================================================================
-- 0154  MIA stays out of every stock total
--
-- 0152 left MIA out of the SAP comparison. This migration leaves it out of the
-- rest: the stock the warehouse shows is what stands on the shelves, and MIA is
-- stock nobody can find. MIA has its own tab (Inventory -> MIA) and ledger.
--
--   * inventory_detail / bin_summary no longer list the MIA bin or its stock, so the Stok tab, FEFO, Lama di
--     gudang, the dashboard, Kualitas data, the 3D view and the Wave page ignore it by construction.
--     inventory_detail_all is the old view, with MIA: Lacak batch reads it, so a batch parked in MIA is still found.
--   * wms_day_report (the daily WMS file) and the Buku stok ledger (ledger_wms_end / ledger_wms_book) leave MIA out;
--     a transfer rack -> MIA is a flow of the book (other_unrest), so awal + flows = akhir still holds.
--   * recompute_bin_positions keeps MIA out of the floor row, so saving the layout never shifts STAGING / QUARANTINE
--     one slot along.
-- Each definition below is the latest one (0132, 0055, 0116, 0148) with only the MIA lines added.
-- Idempotent: safe to re-run on the same state.
-- =====================================================================

-- 1  inventory_detail_all (with MIA) and inventory_detail (without)
create or replace view public.inventory_detail_all with (security_invoker = true) as
select i.id, i.bin_id, b.bin_code, b.zone, b.rack, b.level, b.position,
       it.id as item_id, it.sku, it.description, it.uom, it.upp, it.abc_class as item_abc,
       i.batch_lot, i.quantity, i.expiry_date, i.received_date,
       (i.expiry_date - current_date) as days_remaining,
       b.status as bin_status,
       public.held_qty(i.bin_id, i.item_id, i.batch_lot, i.expiry_date, i.quantity) as held,
       public.hold_reasons(i.bin_id, i.item_id, i.batch_lot, i.expiry_date) as hold_reasons,
       b.owner as bin_owner, b.block_kind as bin_kind
from public.inventory i
join public.bins b on b.id = i.bin_id
join public.items it on it.id = i.item_id;

create or replace view public.inventory_detail with (security_invoker = true) as
select id, bin_id, bin_code, zone, rack, level, position, item_id, sku, description, uom, upp, item_abc, batch_lot, quantity, expiry_date, received_date, days_remaining, bin_status, held, hold_reasons, bin_owner, bin_kind
from public.inventory_detail_all
where zone <> 'MIA';
grant select on public.inventory_detail_all to authenticated;

-- 2  bin_summary
create or replace view public.bin_summary with (security_invoker = true) as
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
       coalesce(array_agg(distinct it.sku) filter (where it.sku is not null), '{}') as skus,
       b.block_kind, b.owner, b.block_reason
from public.bins b
left join public.inventory i on i.bin_id = b.id
left join public.items it on it.id = i.item_id
where b.zone <> 'MIA'
group by b.id;

-- 3  The daily WMS report
create or replace function public.wms_day_report(p_date date)
returns table (
  bin_code text, sku text, description text, uom text, upp numeric, batch_lot text, expiry_date date, received_date date,
  on_hand numeric, pick numeric, b_out numeric, b_in numeric, putaway numeric, adjust numeric, remain numeric
) language sql stable security invoker set search_path = public as $$
  with b as (
    select (p_date::timestamp at time zone 'Asia/Jakarta') as t0, ((p_date + 1)::timestamp at time zone 'Asia/Jakarta') as t1
  ), mv as (
    select m.id, m.type, m.item_id, m.batch_lot, m.expiry_date, m.quantity, m.from_bin_id, m.to_bin_id, m.created_at,
           (m.type = 'adjustment' and exists (select 1 from public.pick_tasks pt where pt.id = m.ref_id and pt.task_type = 'PICK')) as unpick
    from public.movements m, b where m.created_at >= b.t0
  ), legs as (
    -- Every movement as signed deltas on the identities it touches.
    select from_bin_id as bin_id, item_id, batch_lot, expiry_date, -quantity as q, type, unpick, created_at, 'out' as side
      from mv where from_bin_id is not null
    union all
    select to_bin_id, item_id, batch_lot, expiry_date, quantity, type, unpick, created_at, 'in'
      from mv where to_bin_id is not null
  ), agg as (
    select l.bin_id, l.item_id, l.batch_lot, l.expiry_date,
      sum(l.q) filter (where l.created_at >= b.t1) as after_day,
      coalesce(sum(-l.q) filter (where l.created_at < b.t1 and l.type = 'picking'), 0)
        - coalesce(sum(l.q) filter (where l.created_at < b.t1 and l.unpick), 0) as pick,
      coalesce(sum(-l.q) filter (where l.created_at < b.t1 and l.type = 'transfer' and l.side = 'out'), 0) as b_out,
      coalesce(sum(l.q) filter (where l.created_at < b.t1 and l.type = 'transfer' and l.side = 'in'), 0) as b_in,
      coalesce(sum(l.q) filter (where l.created_at < b.t1 and l.type in ('putaway', 'inbound')), 0) as putaway,
      coalesce(sum(l.q) filter (where l.created_at < b.t1 and l.type = 'adjustment' and not l.unpick), 0) as adjust
    from legs l, b group by 1, 2, 3, 4
  ), ids as (
    select bin_id, item_id, batch_lot, expiry_date from public.inventory
    union
    select bin_id, item_id, batch_lot, expiry_date from agg
  ), rows as (
    select i.bin_id, i.item_id, i.batch_lot, i.expiry_date,
      coalesce((select sum(v.quantity) from public.inventory v where v.bin_id = i.bin_id and v.item_id = i.item_id
                and v.batch_lot = i.batch_lot and v.expiry_date is not distinct from i.expiry_date), 0)
        - coalesce(a.after_day, 0) as remain,
      coalesce(a.pick, 0) as pick, coalesce(a.b_out, 0) as b_out, coalesce(a.b_in, 0) as b_in,
      coalesce(a.putaway, 0) as putaway, coalesce(a.adjust, 0) as adjust
    from ids i
    left join agg a on a.bin_id = i.bin_id and a.item_id = i.item_id and a.batch_lot = i.batch_lot
                   and a.expiry_date is not distinct from i.expiry_date
  )
  select bn.bin_code, it.sku, it.description, it.uom, it.upp, r.batch_lot, r.expiry_date,
         (select max(v.received_date) from public.inventory v where v.bin_id = r.bin_id and v.item_id = r.item_id and v.batch_lot = r.batch_lot) as received_date,
         r.remain + r.pick + r.b_out - r.b_in as on_hand, r.pick, r.b_out, r.b_in, r.putaway, r.adjust, r.remain
  from rows r
  join public.bins bn on bn.id = r.bin_id
  join public.items it on it.id = r.item_id
  where bn.zone <> 'MIA' and (r.remain + r.pick + r.b_out - r.b_in <> 0 or r.remain <> 0 or r.pick <> 0 or r.b_out <> 0 or r.b_in <> 0
     or r.putaway <> 0 or r.adjust <> 0)
  order by bn.bin_code, it.sku, r.batch_lot, r.expiry_date;
$$;

-- 4  Buku stok
create or replace function public.ledger_wms_end(p_date date)
returns table (item_id uuid, unrest numeric, block numeric)
language sql stable security invoker set search_path = public as $$
  with b as (select ((p_date + 1)::timestamp at time zone 'Asia/Jakarta') as t1),
  legs as (
    select i.item_id, bn.zone = 'QUARANTINE' as q, i.quantity as qty
      from public.inventory i join public.bins bn on bn.id = i.bin_id where bn.zone <> 'MIA'
    union all  -- undo every movement after the day
    select m.item_id, bn.zone = 'QUARANTINE', m.quantity
      from public.movements m join public.bins bn on bn.id = m.from_bin_id, b where m.created_at >= b.t1 and bn.zone <> 'MIA'
    union all
    select m.item_id, bn.zone = 'QUARANTINE', -m.quantity
      from public.movements m join public.bins bn on bn.id = m.to_bin_id, b where m.created_at >= b.t1 and bn.zone <> 'MIA'
    union all  -- arrived by then, put away later (at most 7 days later)
    select im.item_id, bn.zone = 'QUARANTINE', im.quantity
      from b, public.ledger_inbound_moves(b.t1, b.t1 + interval '7 days') im join public.bins bn on bn.id = im.to_bin_id
     where im.arrival_date <= p_date
  )
  select item_id, coalesce(sum(qty) filter (where not q), 0), coalesce(sum(qty) filter (where q), 0)
  from legs group by item_id;
$$;

create or replace function public.ledger_wms_book(p_date date)
returns setof public.ledger_wms_book_row
language sql stable security invoker set search_path = public as $$
  with b as (
    select (p_date::timestamp at time zone 'Asia/Jakarta') as t0, ((p_date + 1)::timestamp at time zone 'Asia/Jakarta') as t1
  ), awal as (select * from public.ledger_wms_end(p_date - 1)),
  akhir as (select * from public.ledger_wms_end(p_date)),
  inb as (
    select im.item_id, sum(im.quantity) as qty,
           coalesce(sum(im.quantity) filter (where bn.zone = 'QUARANTINE'), 0) as qty_block,
           coalesce(sum(im.quantity) filter (where im.assumed), 0) as qty_assumed
      from b, public.ledger_inbound_moves(b.t0, b.t0 + interval '8 days') im join public.bins bn on bn.id = im.to_bin_id
     where im.arrival_date = p_date group by im.item_id
  ), mv as (  -- the day's movements other than inbound ones (those are filed by arrival date above)
    select m.*, fb.zone = 'QUARANTINE' as from_q, tb.zone = 'QUARANTINE' as to_q, fb.zone = 'MIA' as from_m, tb.zone = 'MIA' as to_m,
           (m.type = 'adjustment' and exists (select 1 from public.pick_tasks pt where pt.id = m.ref_id and pt.task_type = 'PICK')) as unpick
      from public.movements m
      left join public.bins fb on fb.id = m.from_bin_id
      left join public.bins tb on tb.id = m.to_bin_id, b
     where m.created_at >= b.t0 and m.created_at < b.t1
       and not (m.type = 'inbound' or (m.type = 'putaway' and m.from_bin_id is null))
  ), flows as (
    select item_id,
      coalesce(sum(quantity) filter (where type = 'picking'), 0)
        - coalesce(sum(quantity) filter (where unpick), 0) as outbound,
      coalesce(sum(quantity) filter (where type = 'transfer' and not coalesce(from_q, false) and coalesce(to_q, false)), 0) as q_in,
      coalesce(sum(quantity) filter (where type = 'transfer' and coalesce(from_q, false) and not coalesce(to_q, false)), 0) as q_out,
      -- everything else, as signed legs by zone (adjustments, and any other kind of movement)
      coalesce(sum(case when to_bin_id is not null and not to_q and not coalesce(to_m, false) then quantity else 0 end
                  - case when from_bin_id is not null and not from_q and not coalesce(from_m, false) then quantity else 0 end)
               filter (where type not in ('picking', 'transfer') and not unpick), 0)
      -- MIA is outside the book: a transfer into it takes stock out of the counted total, out of it puts it back
      + coalesce(sum(case when coalesce(from_m, false) then quantity else 0 end - case when coalesce(to_m, false) then quantity else 0 end)
               filter (where type = 'transfer'), 0) as other_unrest,
      coalesce(sum(case when to_bin_id is not null and to_q then quantity else 0 end
                  - case when from_bin_id is not null and from_q then quantity else 0 end)
               filter (where type not in ('picking', 'transfer') and not unpick), 0) as other_block
    from mv group by item_id
  ), ids as (
    select item_id from awal union select item_id from akhir union select item_id from inb union select item_id from flows
  )
  select it.sku, it.description, coalesce(it.uom, ''),
         coalesce(a.unrest, 0), coalesce(a.block, 0),
         coalesce(i.qty, 0), coalesce(i.qty_block, 0), coalesce(i.qty_assumed, 0),
         coalesce(f.outbound, 0), coalesce(f.q_in, 0), coalesce(f.q_out, 0),
         coalesce(f.other_unrest, 0), coalesce(f.other_block, 0),
         coalesce(z.unrest, 0), coalesce(z.block, 0)
  from ids
  join public.items it on it.id = ids.item_id
  left join awal a on a.item_id = ids.item_id
  left join akhir z on z.item_id = ids.item_id
  left join inb i on i.item_id = ids.item_id
  left join flows f on f.item_id = ids.item_id
  where coalesce(a.unrest, 0) <> 0 or coalesce(a.block, 0) <> 0 or coalesce(z.unrest, 0) <> 0 or coalesce(z.block, 0) <> 0
     or coalesce(i.qty, 0) <> 0 or coalesce(f.outbound, 0) <> 0 or coalesce(f.q_in, 0) <> 0 or coalesce(f.q_out, 0) <> 0
     or coalesce(f.other_unrest, 0) <> 0 or coalesce(f.other_block, 0) <> 0
  order by it.sku;
$$;

-- 5  3D positions
create or replace function public.recompute_bin_positions()
returns int language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb; n int;
  v_bay numeric; v_depth numeric; v_level numeric; v_lane numeric; v_ppb numeric; v_sides int;
  v_pitch numeric;
  c_x numeric; c_z numeric; c_pitch numeric; c_gap numeric; c_lanes jsonb;
begin
  if auth.uid() is not null and not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Only admins can change the layout';
  end if;
  select value into cfg from public.settings where key = 'layout';
  v_bay   := (cfg->>'bay_width_m')::numeric;
  v_depth := (cfg->>'rack_depth_m')::numeric;
  v_level := (cfg->>'level_height_m')::numeric;
  v_lane  := (cfg->>'aisle_width_m')::numeric;
  v_ppb   := (cfg->>'positions_per_bay')::numeric;
  v_sides := coalesce((cfg->>'bays_per_side')::int, 0);
  -- Distance between neighbouring blocks: two faces deep + one walking lane.
  v_pitch := case when v_sides > 0 then 2 * v_depth + v_lane else v_depth + v_lane end;

  update public.bins b set
    pos_x = (case when v_sides > 0 then (b.rack::int - 1) % v_sides else b.rack::int - 1 end) * v_bay
            + (b.position::int - 0.5) * v_bay / v_ppb,
    pos_y = (ascii(b.level) - ascii('A')) * v_level,
    pos_z = (array_position(array(select jsonb_array_elements_text(cfg->'aisle_order')), b.zone) - 1) * v_pitch
            + case when v_sides = 0 then 0
                   when b.rack::int > v_sides then v_depth / 2   -- right face
                   else -v_depth / 2 end                         -- left face
  where b.rack is not null and b.level is not null and b.position ~ '^\d+$'
    and b.zone in (select jsonb_array_elements_text(cfg->'aisle_order'));

  -- Floor locations of Oso 5: a simple row in front of the racks, one slot per bin (Block C has its own area below).
  with f as (
    select id, row_number() over (order by zone, bin_code) - 1 as k
    from public.bins where rack is null and site <> 'BLOCKC' and zone <> 'MIA'
  )
  update public.bins b set
    pos_x = (cfg->'floor_zone_origin'->>'x')::numeric + f.k * 1.4,
    pos_y = 0,
    pos_z = (cfg->'floor_zone_origin'->>'z')::numeric
  from f where b.id = f.id;

  -- Block C (0148): FA-01 at the origin, slots along x; each further lane one lane gap away in z.
  c_x     := coalesce((cfg->'block_c'->'origin'->>'x')::numeric, 0);
  c_z     := coalesce((cfg->'block_c'->'origin'->>'z')::numeric, 70);
  c_pitch := coalesce((cfg->'block_c'->>'slot_pitch_m')::numeric, 1.4);
  c_gap   := coalesce((cfg->'block_c'->>'lane_gap_m')::numeric, 4);
  c_lanes := coalesce(cfg->'block_c'->'lanes', '["FA","FB"]'::jsonb);
  update public.bins b set
    pos_x = c_x + (b.position::int - 1) * c_pitch,
    pos_y = 0,
    pos_z = c_z + (array_position(array(select jsonb_array_elements_text(c_lanes)), b.zone) - 1) * c_gap
  where b.site = 'BLOCKC' and b.position ~ '^\d+$' and b.zone in (select jsonb_array_elements_text(c_lanes));

  select count(*) into n from public.bins where pos_x is not null;
  return n;
end $$;
