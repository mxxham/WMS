-- =====================================================================
-- 0149  Block C: the two sides touch, like a rack block
--
--  20 Nov 2026 (user): Block C is one block with two sides, FA (20 slots) and FB (20 slots), 40 in all, "just like
--  the rack": the faces stand back to back, FB-01 directly behind FA-01, as rack 21 stands behind rack 01.
--  0148 drew them 4 m apart with a walking lane between. The distance between the two faces is now the slot depth
--  (layout.rack_depth_m, 1.2 m), so they touch; raise block_c.lane_gap_m on Pengaturan if the floor has a lane
--  between the sides (the Excel plan leaves an empty column between them).
--
--  Only a layout still at the 0148 default (4 m) is changed: a value someone set by hand is left alone.
-- =====================================================================

update public.settings
   set value = jsonb_set(value, '{block_c,lane_gap_m}', to_jsonb(coalesce((value->>'rack_depth_m')::numeric, 1.2))),
       updated_at = now()
 where key = 'layout'
   and (value->'block_c'->>'lane_gap_m')::numeric = 4;

select public.recompute_bin_positions();
