-- =====================================================================
-- 0043  Empty bins, for a pallet that needs a place
--
--  When a pallet's leftover has no planned bin-to-bin move (or its target
--  is full), the picker needs a free bin nearby. empty_bins lists the rack
--  bins that are active, hold nothing and are not the target of an open
--  task (a relocation or move still on its way in). Read on Inventory →
--  Bin kosong, sorted by distance from the bin the picker stands at.
-- =====================================================================

create or replace view public.empty_bins with (security_invoker = true) as
select b.bin_code, b.zone, b.rack, b.level, b.position, b.abc_class
from public.bins b
where b.status = 'active' and b.rack is not null
  and not exists (select 1 from public.inventory i where i.bin_id = b.id and i.quantity > 0)
  and not exists (select 1 from public.open_pick_tasks t where t.to_bin_id = b.id);
grant select on public.empty_bins to authenticated;
