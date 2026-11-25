-- =====================================================================
-- 0151  Block C: a slot is 14 pallet positions (the updated floor plan)
--
--  23 Nov 2026 (user, "master lokasi floor block C.xlsx"): every slot FA-01..FA-20 / FB-01..FB-20 is 14 pallet positions
--  on the floor (40 slots = "TOTAL : 560 PP"), stacked IBC / fluid bag / carton 2 high and drum 3 high. 0147 had
--  one pallet footprint per slot (a single stack of up to 3), 1.4 m apart.
--
--  Floor shape (user): 7 positions deep and 2 along the row, with a pallet about 1.2 m along and 1.0 m deep:
--    slot about 2.4 m along the row, 7 m deep  ->  slot_pitch_m 2.6 (a 0.2 m gap), slot_depth_m 7.0.
--  The two rows face each other with a walking lane: lane_gap_m is the distance between the row centres, so it must
--  exceed the 7 m depth: 10 m (3 m lane). All three are placeholders until Block C is measured; set the real values on
--  Pengaturan.
--
--  The capacity of a slot (pallets, enforced by movements_a_site_guard) is not changed here: it is stored per slot when
--  its SKU is assigned (assign_block_c_slots, p_pallets = 14 x stack height, config/warehouse.ts) and no slot was
--  assigned on production when this was written. Slots assigned earlier keep their old capacity until their SKU is
--  assigned again.
--
--  Only values still at the earlier defaults are changed, so a number set by hand on Pengaturan is left alone.
-- =====================================================================

update public.settings
   set value = jsonb_set(value, '{block_c,slot_pitch_m}', '2.6'::jsonb), updated_at = now()
 where key = 'layout' and (value->'block_c'->>'slot_pitch_m')::numeric = 1.4;

update public.settings
   set value = jsonb_set(value, '{block_c,lane_gap_m}', '10'::jsonb), updated_at = now()
 where key = 'layout' and (value->'block_c'->>'lane_gap_m')::numeric = 4;

update public.settings
   set value = jsonb_set(value, '{block_c,slot_depth_m}', '7'::jsonb, true), updated_at = now()
 where key = 'layout' and value->'block_c' is not null and value->'block_c'->'slot_depth_m' is null;

select public.recompute_bin_positions();
