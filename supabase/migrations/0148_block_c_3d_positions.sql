-- =====================================================================
-- 0148  Block C in the 3D view: coordinates for the floor slots
--
--  0147 made Block C slots (FA-01..FB-20) floor bins with no rack. The
--  floor branch of recompute_bin_positions (0006) puts EVERY rack-less bin
--  in one row in front of the racks, so the 40 slots would have been lined
--  up with STAGING / QUARANTINE and pushed their positions along. Block C is
--  another building: it gets its own origin and two facing lanes.
--
--  layout.block_c = {
--    "origin": {"x": .., "z": ..},   where FA-01 stands (m); far from Oso 5 on purpose
--    "slot_pitch_m": 1.4,            distance between neighbouring slots along a lane
--    "lane_gap_m": 4.0,              walking gap between the two lanes (FA / FB face each other)
--    "pallet_height_m": 1.2,         height of one stacked pallet, to draw the stack
--    "lanes": ["FA","FB"]            lane order, first lane at the origin
--  }
--  Change a dimension here (Admin > Pengaturan), never in the scene.
-- =====================================================================

update public.settings
   set value = value || jsonb_build_object('block_c', jsonb_build_object(
         'origin', jsonb_build_object('x', 0, 'z', 70), 'slot_pitch_m', 1.4, 'lane_gap_m', 4.0,
         'pallet_height_m', 1.2, 'lanes', jsonb_build_array('FA', 'FB'))),
       updated_at = now()
 where key = 'layout' and not (value ? 'block_c');

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
    from public.bins where rack is null and site <> 'BLOCKC'
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

-- Slots planned from now on get their coordinates at once (plan_block_c_slots of 0147 + the recompute below).
create or replace function public.plan_block_c_slots(p_lanes text[], p_slots int, p_reason text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_name text; v_set uuid := gen_random_uuid();
  v_l text; v_lanes text[]; n_new int := 0; n_old int := 0;
begin
  if not public.has_role(array['admin']::public.user_role[]) then raise exception 'Hanya admin yang bisa merencanakan slot Block C'; end if;
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  if p_slots is null or p_slots not between 1 and 99 then raise exception 'Jumlah slot per jalur harus 1-99'; end if;
  select array_agg(distinct upper(trim(x))) into v_lanes from unnest(p_lanes) x where trim(coalesce(x, '')) <> '';
  if v_lanes is null then raise exception 'Isi minimal satu jalur (FA, FB, ...)'; end if;
  foreach v_l in array v_lanes loop
    if v_l !~ '^F[A-Z]$' then raise exception 'Jalur % tidak valid: harus seperti FA (F + satu huruf)', v_l; end if;
  end loop;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  with want as (
    select l || '-' || to_char(s, 'FM00') as code, l as lane, to_char(s, 'FM00') as pos
    from unnest(v_lanes) l, generate_series(1, p_slots) s),
  ins as (
    insert into public.bins (bin_code, zone, rack, level, position, status, block_kind, block_reason, capacity, site)
    select code, lane, null, null, pos, 'blocked', 'PLANNED', v_reason, null, 'BLOCKC' from want
    on conflict (bin_code) do nothing
    returning bin_code),
  lg as (
    insert into public.bin_changes (change_set, bin_code, field, old_value, new_value, reason, changed_by, changed_by_name)
    select v_set, bin_code, 'CREATED', null, 'PLANNED BLOCKC', v_reason, auth.uid(), v_name from ins returning 1)
  select (select count(*) from ins), (select count(*) from want) - (select count(*) from ins) into n_new, n_old;
  if n_new = 0 then raise exception 'Semua % slot itu sudah ada', n_old; end if;
  -- A lane that is new to the layout joins block_c.lanes, after the existing ones, so it gets coordinates.
  update public.settings
     set value = jsonb_set(value, '{block_c,lanes}',
           (select coalesce(jsonb_agg(z order by ord), '[]'::jsonb) from (
              select z, min(ord) as ord from (
                select z, ord from jsonb_array_elements_text(coalesce(value->'block_c'->'lanes', '[]'::jsonb)) with ordinality t(z, ord)
                union all select l, 1000 + o from unnest(v_lanes) with ordinality u(l, o)) q group by z) r)),
         updated_at = now()
   where key = 'layout' and value ? 'block_c';
  perform public.recompute_bin_positions();
  return jsonb_build_object('change_set', v_set, 'created', n_new, 'existing', n_old);
end $$;

revoke execute on function public.plan_block_c_slots(text[], int, text, text) from public, anon;
grant execute on function public.plan_block_c_slots(text[], int, text, text) to authenticated;

select public.recompute_bin_positions();
