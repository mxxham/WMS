-- =====================================================================
-- 0006  Back-to-back rack blocks (WSM SUB 2 physical layout)
--
-- Each aisle code (CA..CG) is ONE rack block with two faces:
--   left face  = racks 01..20
--   right face = racks 21..40, rack 21 directly behind rack 01
-- A walking lane runs between one block's right face and the next block's
-- left face. Positions 01/02 stay side by side inside a bay.
--
-- New layout key `bays_per_side` (20). 0 restores the old single-row view.
-- The allocator's pick path uses the same rule (config.baysPerSide).
-- =====================================================================

update public.settings
   set value = value || '{"bays_per_side": 20}'::jsonb, updated_at = now()
 where key = 'layout' and not (value ? 'bays_per_side');

create or replace function public.recompute_bin_positions()
returns int language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb; n int;
  v_bay numeric; v_depth numeric; v_level numeric; v_lane numeric; v_ppb numeric; v_sides int;
  v_pitch numeric;
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

select public.recompute_bin_positions();
