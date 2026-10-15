-- Local demo helper: turn 0073 OFF, to see what the system used to do.
-- The two functions below are the versions from 0004_allocation.sql, before 0073: cancelling a
-- pick whose pallet relokasi is already posted strands the cartons in the pallet bin, because
-- movements are immutable and nothing undoes them.
--
--   psql -f scripts/demo/0073-off.sql                        # back to the old behaviour
--   psql -f supabase/tests/43_cancel_posted_move.sql          # watch the rows fail
--   psql -f supabase/migrations/0073_cancel_blocked_by_posted_move.sql   # 0073 back on
--   psql -f supabase/tests/43_cancel_posted_move.sql          # all rows PASS
\set ON_ERROR_STOP on

create or replace function public.set_task_status(p_task_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.pick_tasks%rowtype;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can reschedule or cancel tasks';
  end if;
  if p_status not in ('PLANNED','RESCHEDULED','CANCELLED') then
    raise exception 'Invalid status % (use post_task to complete)', p_status;
  end if;
  select * into t from public.pick_tasks where id = p_task_id for update;
  if not found then raise exception 'Task % not found', p_task_id; end if;
  if t.status = 'COMPLETED' then raise exception 'Task is already completed'; end if;
  if t.status = p_status then return jsonb_build_object('result', 'NO_CHANGE'); end if;

  update public.pick_tasks set status = p_status where id = t.id;
  perform public.log_execution_event('TASK', t.id, t.status, p_status, p_reason);
  return jsonb_build_object('result', 'UPDATED', 'from_status', t.status, 'to_status', p_status);
end $$;

create or replace function public.set_wave_status(p_wave_id uuid, p_status text, p_reason text default null,
                                                  p_new_slot text default null, p_new_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waves%rowtype; n_cancelled int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Only supervisors or admins can reschedule or cancel waves';
  end if;
  if p_status not in ('PENDING','RESCHEDULED','CANCELLED') then
    raise exception 'Invalid status % (use complete_wave to complete)', p_status;
  end if;
  select * into w from public.waves where id = p_wave_id for update;
  if not found then raise exception 'Wave % not found', p_wave_id; end if;
  if w.status in ('COMPLETED','CANCELLED') then raise exception 'Wave is already %', w.status; end if;

  if p_status = 'CANCELLED' then
    with c as (update public.pick_tasks set status = 'CANCELLED'
               where wave_id = w.id and status in ('PLANNED','RESCHEDULED') returning id)
    select count(*) into n_cancelled from c;
    update public.outbound set status = 'CANCELLED' where wave_id = w.id and status = 'PLANNED';
  end if;

  update public.waves set status = p_status,
         planned_slot = coalesce(p_new_slot, planned_slot),
         planned_date = coalesce(p_new_date, planned_date)
  where id = w.id;
  perform public.log_execution_event('WAVE', w.id, w.status, p_status, p_reason);
  return jsonb_build_object('result', 'UPDATED', 'from_status', w.status, 'to_status', p_status,
                            'tasks_cancelled', n_cancelled);
end $$;
