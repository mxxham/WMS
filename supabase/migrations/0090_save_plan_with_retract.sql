-- =====================================================================
-- 0090  save_plan_with_retract: retract one shipment's open tasks in a
--       carried wave, then save the new plan atomically.
--
--  Two new SECURITY DEFINER RPCs:
--    1. retract_shipment_open_tasks(p_wave_id, p_shipment_number, p_reason)
--       Retracts ONLY that (wave_id, shipment_number)'s open tasks:
--       - If stranded_residue flags the wave first, run settle_stranded_residue (0075)
--         exactly as it does for each flagged pick.
--       - For each open PICK whose pallet break already posted, run the SAME
--         settle logic 0074's CANCELLED path runs (complete_open_pallet with
--         p_ignore_wave = p_wave_id so same-wave siblings don't block).
--       - The shipment-scoped rows become CANCELLED with p_reason: open PICK
--         tasks and outbound rows of that (wave_id, shipment_number).
--         REPLENISH (Bin To Bin) rows are NOT touched: the plan payload builds
--         them shipment-less (lib/allocator/plan.ts, shipment_number null), so
--         a shipment-scoped cancel can never match them — they live with the
--         wave, stay postable on the floor, and disappear when the wave does.
--       - Posted tasks and movements untouched. Sibling shipments untouched.
--    2. save_plan_with_retract(p_date, p_plan, p_retract)
--       One transaction: for each p_retract entry call retract_shipment_open_tasks,
--       then PERFORM save_plan(p_date, p_plan) internally. Same return type.
--       Any exception rolls back everything.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. retract_shipment_open_tasks
-- ---------------------------------------------------------------------
create or replace function public.retract_shipment_open_tasks(
  p_wave_id uuid, p_shipment_number text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w public.waves%rowtype;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'tanpa alasan');
  v_name text;
  v_pick uuid;
  v_moved numeric := 0;
  n_cancelled int := 0;
  n_settled int := 0;
  r record;
begin
  -- Role check (supervisor/admin only, same as set_wave_status)
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menarik tugas terbuka';
  end if;

  -- Verify wave exists and is in a state that can have open tasks retracted
  select * into w from public.waves where id = p_wave_id for update;
  if not found then raise exception 'Wave % tidak ditemukan', p_wave_id; end if;
  if w.status not in ('PENDING','RESCHEDULED') then
    raise exception 'Wave NO % status % tidak bisa ditarik tugasnya', w.wave_no, w.status;
  end if;

  v_name := public.person_name(
    (select pr.name from public.profiles pr where pr.id = auth.uid()),
    'Nama Anda');

  -- --------------------------------------------------------------
  -- Step 1: Stranded residue (0075) — settle before retracting
  -- --------------------------------------------------------------
  for r in
    select sr.pick_task_id
    from public.stranded_residue sr
    join public.pick_tasks pt on pt.id = sr.pick_task_id
    where pt.wave_id = p_wave_id and pt.shipment_number = p_shipment_number
  loop
    perform public.settle_stranded_residue(r.pick_task_id, v_name, v_reason);
    n_settled := n_settled + 1;
  end loop;

  -- --------------------------------------------------------------
  -- Step 2: For each open PICK whose pallet break already posted,
  --         run complete_open_pallet (same as 0074's CANCELLED path)
  --         with p_ignore_wave = p_wave_id so same-wave siblings don't block.
  -- --------------------------------------------------------------
  for v_pick in
    select t.id from public.pick_tasks t
    where t.wave_id = p_wave_id
      and t.shipment_number = p_shipment_number
      and t.task_type = 'PICK'
      and t.status in ('PLANNED','RESCHEDULED')
      and public.posted_pallet_move_seq(t.id) is not null
    order by t.seq
  loop
    v_moved := v_moved + coalesce(
      public.complete_open_pallet(v_pick, v_name, v_reason, p_wave_id), 0);
  end loop;

  -- --------------------------------------------------------------
  -- Step 3: Cancel the shipment's open PICKs in this wave, then its
  --         outbound rows. Keyed by shipment_number, so the wave's
  --         shipment-less REPLENISH rows (Bin To Bin) are deliberately
  --         untouched — see the header note. This mirrors what
  --         set_wave_status does for a whole wave, scoped to one shipment.
  -- --------------------------------------------------------------
  with c as (
    update public.pick_tasks
    set status = 'CANCELLED'
    where wave_id = p_wave_id
      and shipment_number = p_shipment_number
      and status in ('PLANNED','RESCHEDULED')
    returning id
  )
  select count(*) into n_cancelled from c;

  -- Outbound rows for this shipment in this wave -> CANCELLED
  update public.outbound
  set status = 'CANCELLED'
  where wave_id = p_wave_id
    and shipment_number = p_shipment_number
    and status = 'PLANNED';

  -- --------------------------------------------------------------
  -- Step 4: Log execution events
  -- --------------------------------------------------------------
  perform public.log_execution_event('WAVE', w.id, w.status, w.status,
    format('tarik tugas shipment %s: %s dibatalkan, %s dipindahkan ke pickface',
           p_shipment_number, n_cancelled, v_moved));

  -- Individual task events are not strictly necessary (the UPDATE above
  -- doesn't fire row-level triggers), but we log a summary.
  -- Note: set_wave_status logs per-task events in its loop; here we
  -- consolidate since we do a bulk UPDATE.

  return jsonb_build_object(
    'result', 'UPDATED',
    'wave_id', w.id,
    'wave_no', w.wave_no,
    'shipment_number', p_shipment_number,
    'tasks_cancelled', n_cancelled,
    'stranded_settled', n_settled,
    'moved_to_pickface', v_moved,
    'reason', v_reason);
end $$;

revoke execute on function public.retract_shipment_open_tasks(uuid, text, text) from public, anon;
grant execute on function public.retract_shipment_open_tasks(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. save_plan_with_retract
-- ---------------------------------------------------------------------
create or replace function public.save_plan_with_retract(
  p_date date, p_plan jsonb, p_retract jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_retract jsonb;
  v_save_result jsonb;
begin
  -- Role check (same as save_plan)
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can save an allocation plan';
  end if;

  -- p_retract is an array of objects: {wave_id, shipment_number, reason}
  -- Iterate and call retract_shipment_open_tasks for each
  if p_retract is not null and jsonb_typeof(p_retract) = 'array' then
    for r in select * from jsonb_array_elements(p_retract) loop
      v_retract := r;
      perform public.retract_shipment_open_tasks(
        (v_retract->>'wave_id')::uuid,
        v_retract->>'shipment_number',
        coalesce(nullif(v_retract->>'reason', ''), 'sisanya direncanakan ulang')
      );
    end loop;
  end if;

  -- Drop temp tables that save_plan creates (they persist in the transaction)
  execute 'drop table if exists _replace, _wave_ids, _seen';

  -- Now call the existing save_plan internally (same transaction)
  v_save_result := public.save_plan(p_date, p_plan);

  return v_save_result;
end $$;

revoke execute on function public.save_plan_with_retract(date, jsonb, jsonb) from public, anon;
grant execute on function public.save_plan_with_retract(date, jsonb, jsonb) to authenticated;