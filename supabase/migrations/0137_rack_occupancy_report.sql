-- =====================================================================
-- 0137  Manager report on Rekonsiliasi SAP > Cocok: rack occupancy
--
-- 10 Nov 2026: every afternoon the warehouse manager got two pictures on
-- WhatsApp, both made by hand in Excel: a rack map coloured by how many of
-- each rack's 10 bins hold stock (locations / occupied / remaining /
-- occupancy %, stock volume against a target volume) and an SAP vs physical
-- accuracy sheet. The Cocok view of a reconciliation now shows both; the
-- accuracy part comes from the reconciliation, this migration adds the rack
-- part.
--
--  * rack_occupancy(): today's numbers, read under the caller's RLS.
--      locations = rack bins Shell may use (bin_usable: active, owner SHELL
--                  or none), so blocked bins, pillars (NOT_PRESENT), planned
--                  racks and bins lent to CKB do not count;
--      occupied  = those holding stock (qty > 0);
--      litres    = Shell stock (every bin not owned by CKB) x items.volume_l.
--    Per bay (aisle + rack number) and per aisle, plus the plan layout.
--  * inventory_policy gains target_volume_l (1,756,000 L, the figure on the
--    9 Nov sheet), editable on Pengaturan.
-- =====================================================================

create or replace function public.inventory_policy_defaults()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'default_shelf_life_months', 48,   -- Shell packaged lubricants: production + 4 years
    'min_dispatch_days', 0,            -- refuse to ship stock with fewer days left
    'near_expiry_days', 180,           -- "ship first / report to Shell" window
    'adjust_approval_qty', 20,         -- |adjustment| above this (cartons) needs a second person
    'count_tolerance_qty', jsonb_build_object('A', 0, 'B', 0, 'C', 0),  -- per bin, cartons
    'recount_on_variance', true,       -- a count off by more than the tolerance is recounted blind
    'ira_target_pct', 98,
    'require_scan_on_pick', false,     -- pick confirmation needs the carton barcode
    'pick_accuracy_target_pct', 99.5,  -- first-attempt line accuracy of the picking audit (0024)
    'bin_check_max_qty', 5,            -- after a pick leaving at most this many (0 included), ask what is left (0058)
    'abc_a_pct', 80,                   -- class A = SKUs making the first 80% of picking lines (0126)
    'abc_b_pct', 95,                   -- class B = up to 95%; C = the rest
    'target_volume_l', 1756000         -- stock volume the warehouse is sized for, litres (0137)
  );
$$;

create or replace function public.rack_occupancy()
returns jsonb language sql stable set search_path = public as $$
  with b as (
    select b.id, b.zone, b.rack, b.status, b.block_kind, b.owner,
           b.status = 'active' and (b.owner = 'SHELL' or b.owner is null) as usable,
           coalesce((select sum(i.quantity) from public.inventory i where i.bin_id = b.id), 0) as qty
    from public.bins b
    where b.rack is not null
  ),
  bay as (
    select zone, rack,
           count(*) filter (where usable) as locations,
           count(*) filter (where usable and qty > 0) as occupied,
           count(*) filter (where block_kind = 'NOT_PRESENT') as gone,
           count(*) filter (where block_kind = 'PLANNED') as planned,
           count(*) filter (where status <> 'active' and coalesce(block_kind, 'BLOCKED') = 'BLOCKED') as blocked,
           count(*) filter (where owner = 'CKB') as ckb,
           count(*) as bins
    from b group by zone, rack
  ),
  shell_bays as (
    -- A bay entirely lent to CKB 3PL (aisles CG/CH) is not part of Shell's map.
    select * from bay where ckb < bins
  ),
  aisle as (
    select zone, sum(locations) as locations, sum(occupied) as occupied, sum(blocked) as blocked,
           sum(gone) as gone, sum(ckb) as ckb
    from shell_bays group by zone
  ),
  stock as (
    select coalesce(sum(i.quantity * coalesce(it.volume_l, 0)), 0) as litres,
           coalesce(sum(i.quantity), 0) as cartons,
           count(distinct i.item_id) filter (where it.volume_l is null and i.quantity > 0) as no_volume
    from public.inventory i
    join public.items it on it.id = i.item_id
    join public.bins bn on bn.id = i.bin_id
    where bn.owner is distinct from 'CKB'
  ),
  layout as (
    select coalesce((select value from public.settings where key = 'layout'), '{}'::jsonb) as v
  )
  select jsonb_build_object(
    'at', now(),
    'locations', (select coalesce(sum(locations), 0) from shell_bays),
    'occupied', (select coalesce(sum(occupied), 0) from shell_bays),
    'litres', (select litres from stock),
    'cartons', (select cartons from stock),
    'skus_without_volume', (select no_volume from stock),
    'target_volume_l', (public.inventory_policy()->>'target_volume_l')::numeric,
    'aisle_order', coalesce((select v->'aisle_order' from layout), '[]'::jsonb),
    'bays_per_side', coalesce((select (v->>'bays_per_side')::int from layout), 20),
    'aisles', coalesce((select jsonb_agg(to_jsonb(a) order by a.zone) from aisle a), '[]'::jsonb),
    'bays', coalesce((select jsonb_agg(jsonb_build_object('zone', s.zone, 'rack', s.rack, 'locations', s.locations,
                        'occupied', s.occupied, 'gone', s.gone, 'planned', s.planned, 'blocked', s.blocked, 'ckb', s.ckb)
                        order by s.zone, s.rack) from shell_bays s), '[]'::jsonb)
  );
$$;
revoke execute on function public.rack_occupancy() from public, anon;
grant execute on function public.rack_occupancy() to authenticated;
