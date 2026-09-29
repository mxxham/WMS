-- =====================================================================
-- 0035  A pick and its pallet's leftover move, posted as one line
--
--  The picklist prints a broken pallet as ONE line: pick N for the truck,
--  move the rest to the pickface. The plan stores two tasks (PICK +
--  REPLENISH, 0004); the wave page now shows and posts them together, so
--  both are posted (or undone) in one transaction and cannot drift apart.
--  p_pick_qty / p_move_qty null = as planned; a reason is required when
--  either differs (post_task, 0007 / 0033 / 0034).
-- =====================================================================

create or replace function public.post_pick_with_move(
  p_pick_id uuid, p_move_id uuid, p_pick_qty numeric, p_move_qty numeric,
  p_reason text, p_by_name text, p_scanned text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.pick_tasks%rowtype; m public.pick_tasks%rowtype; v_pick jsonb; v_move jsonb;
begin
  select * into p from public.pick_tasks where id = p_pick_id for update;
  select * into m from public.pick_tasks where id = p_move_id for update;
  if p.id is null or m.id is null then raise exception 'Tugas tidak ditemukan'; end if;
  if p.task_type <> 'PICK' or m.task_type = 'PICK' or p.wave_id <> m.wave_id or p.item_id <> m.item_id
     or p.from_bin_id <> m.from_bin_id or p.batch_lot <> m.batch_lot then
    raise exception 'Tugas ini bukan pasangan pick + pindah sisa palet';
  end if;
  v_pick := public.post_task_by(p_pick_id, p_pick_qty, null, null, null, p_reason, p_by_name, p_scanned);
  v_move := public.post_task_by(p_move_id, p_move_qty, null, null, null, p_reason, p_by_name, null);
  return jsonb_build_object('pick', v_pick, 'move', v_move);
end $$;

create or replace function public.unpost_pick_with_move(p_pick_id uuid, p_move_id uuid, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_move jsonb; v_pick jsonb;
begin
  -- The move first: its cartons go back to the pallet bin, then the pick's.
  v_move := public.unpost_task(p_move_id, p_by_name, p_reason);
  v_pick := public.unpost_task(p_pick_id, p_by_name, p_reason);
  return jsonb_build_object('pick', v_pick, 'move', v_move);
end $$;

revoke execute on function public.post_pick_with_move(uuid, uuid, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.post_pick_with_move(uuid, uuid, numeric, numeric, text, text, text) to authenticated;
revoke execute on function public.unpost_pick_with_move(uuid, uuid, text, text) from public, anon;
grant execute on function public.unpost_pick_with_move(uuid, uuid, text, text) to authenticated;
