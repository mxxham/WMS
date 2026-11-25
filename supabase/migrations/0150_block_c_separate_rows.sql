-- =====================================================================
-- 0150  Block C: FA and FB are two separate rows again (reverts the gap of 0149)
--
--  20 Nov 2026 (user): Block C has 40 slots, FA 20 and FB another 20. They are NOT one combined block: 0149 stood FB
--  directly behind FA (1.2 m, touching, "like a rack block"), which the user rejected. Each row is its own row of
--  20 slots, reachable from both of its long sides, with a walking lane between FA and FB.
--
--  block_c.lane_gap_m is that distance between the two rows (centre to centre). 4 m is a placeholder until Block C
--  is measured: set the real value on Pengaturan. Only a layout still at the 0149 default (the rack depth, 1.2 m)
--  is changed, so a value set by hand is left alone.
-- =====================================================================

update public.settings
   set value = jsonb_set(value, '{block_c,lane_gap_m}', '4'::jsonb),
       updated_at = now()
 where key = 'layout'
   and (value->'block_c'->>'lane_gap_m')::numeric = coalesce((value->>'rack_depth_m')::numeric, 1.2);

select public.recompute_bin_positions();
