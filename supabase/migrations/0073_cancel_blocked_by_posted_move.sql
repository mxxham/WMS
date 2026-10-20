-- =====================================================================
-- 0073  Cancelling a pick whose pallet move is already posted
-- =====================================================================
-- A broken pallet is two tasks (0035): the pick and the relokasi of the
-- leftover to the pickface, posted together in one transaction. A
-- supervisor may post the relokasi alone to unblock another wave
-- (post-move-early, 0053). The cartons already moved stay moved, because
-- movements are immutable: cancelling the pick afterwards leaves the
-- unpicked cartons behind in the pallet bin and the pickface holding the
-- rest. Nobody on the floor meant that split.
--
-- A pick and its relokasi are ONE physical event, so the ledger keeps it
-- one: cancelling the pick while the relokasi is posted first completes
-- the pallet break. The cartons the cancelled pick would have taken go up
-- to the same pickface the relokasi went to, as one transfer, so the
-- source bin is emptied and the pickface holds the whole pallet. Cancelling
-- the pick then needs no correction afterwards.
--
-- When another open task still takes from that bin for the same SKU and
-- batch, those cartons are not moved: they are that task's stock, and the
-- cancellation is refused so a supervisor decides what happens to them.
--
-- Same pairing rule as the wave page (lib/allocator/pair-moves.ts): the
-- move right after the pick, else right before it, from the same bin,
-- item and batch of the same wave.
-- =====================================================================

-- The pick's relokasi when it is already posted, else null.
create or replace function public.posted_pallet_move_seq(p_pick_id uuid)
returns integer language sql stable security invoker set search_path = public as $$
  select m.seq
  from public.pick_tasks p
  join public.pick_tasks m
    on m.task_type = 'REPLENISH'
   and m.status = 'COMPLETED'
   and m.wave_id = p.wave_id
   and m.item_id = p.item_id
   and m.from_bin_id = p.from_bin_id
   and coalesce(m.batch_lot, '') = coalesce(p.batch_lot, '')
   and abs(m.seq - p.seq) = 1
  where p.id = p_pick_id
  order by m.seq
  limit 1;
$$;

revoke execute on function public.posted_pallet_move_seq(uuid) from public, anon, authenticated;

-- The cartons a cancelled pick leaves behind, and where they belong: its own
-- planned quantity at the pallet bin, and the bin its relokasi went to.
create or replace function public.open_pallet_leftovers(p_pick_id uuid)
returns table (quantity numeric, to_bin_id uuid, to_bin text, expiry date, blocked_by uuid)
language plpgsql stable security invoker set search_path = public as $$
declare p public.pick_tasks%rowtype; m public.pick_tasks%rowtype;
        v_qty numeric; v_exp date; v_busy uuid;
begin
  select * into p from public.pick_tasks where id = p_pick_id;
  if p.id is null or p.task_type <> 'PICK' or p.status not in ('PLANNED','RESCHEDULED') then
    return; -- nothing open to reconcile
  end if;
  select * into m from public.pick_tasks
  where id <> p.id and task_type = 'REPLENISH' and status = 'COMPLETED'
    and wave_id = p.wave_id and item_id = p.item_id and from_bin_id = p.from_bin_id
    and coalesce(batch_lot, '') = coalesce(p.batch_lot, '') and abs(seq - p.seq) = 1
  order by seq limit 1;
  if m.id is null then
    return; -- no posted move: cancelling moves no stock at all
  end if;

  -- The one stock row this move would take: the pick's own expiry first, else the bin's first row
  -- of that batch. Same lookup as the apply_movement trigger (bin + item + batch), so the quantity
  -- can never be more than what is physically there.
  select i.quantity, i.expiry_date into v_qty, v_exp
  from public.inventory i
  where i.bin_id = p.from_bin_id and i.item_id = p.item_id
    and coalesce(i.batch_lot, '') = coalesce(p.batch_lot, '')
  order by (coalesce(i.expiry_date, '0001-01-01'::date) = coalesce(p.expiry_date, '0001-01-01'::date)) desc, i.id
  limit 1;
  v_qty := least(coalesce(v_qty, 0), coalesce(p.quantity, 0));
  if v_qty <= 0 then
    return; -- the bin is already empty for this identity
  end if;

  -- An open task still takes those cartons from this bin: they are its stock, not ours to move.
  select t.id into v_busy from public.pick_tasks t
  where t.id <> p.id and t.task_type in ('PICK','REPLENISH') and t.status in ('PLANNED','RESCHEDULED')
    and t.from_bin_id = p.from_bin_id and t.item_id = p.item_id
    and coalesce(t.batch_lot, '') = coalesce(p.batch_lot, '')
  order by (t.wave_id = p.wave_id) desc, t.seq limit 1;

  return query select v_qty, m.to_bin_id, (select bin_code from public.bins where id = m.to_bin_id), v_exp, v_busy;
end $$;

revoke execute on function public.open_pallet_leftovers(uuid) from public, anon, authenticated;

-- Move the leftovers of a cancelled pick up to its pickface, completing the
-- pallet break the plan started. Returns the quantity moved; 0 when there
-- was nothing to move; raises when another open task still needs those
-- cartons, so a supervisor decides.
create or replace function public.complete_open_pallet(p_pick_id uuid, p_by_name text, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare p public.pick_tasks%rowtype; l record; v_name text; v_reason text := nullif(trim(p_reason), '');
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa membatalkan pick';
  end if;
  select * into p from public.pick_tasks where id = p_pick_id for update;
  if p.id is null or p.task_type <> 'PICK' then
    raise exception 'Tugas ini bukan pick';
  end if;

  select * into l from public.open_pallet_leftovers(p_pick_id);
  if not found or l.quantity is null or l.quantity <= 0 then
    return 0;
  end if;
  if l.blocked_by is not null then
    raise exception
      'Pick #% tidak bisa dibatalkan: sisa paletnya sudah diposting ke % (% karton), dan ada pick lain yang masih mengambil dari bin asal. Batalkan posting relokasi #%, atau selesaikan / perbaiki pick lain itu dulu.',
      p.seq, l.to_bin, l.quantity,
      public.posted_pallet_move_seq(p_pick_id);
  end if;

  v_name := public.person_name(
    coalesce(nullif(trim(p_by_name), ''), (select pr.name from public.profiles pr where pr.id = auth.uid())),
    'Nama Anda');
  perform set_config('app.by_name', v_name, true);
  insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id,
                               expiry_date, task_id, reason_code, note)
  values ('transfer', p.item_id, p.batch_lot, l.quantity, p.from_bin_id, l.to_bin_id,
          coalesce(l.expiry, p.expiry_date), p.id, 'DATA_ENTRY',
          format('Batal pick NO %s SH %s #%s: palet pecah — %s karton dari %s naik ke %s (%s)',
                 (select wave_no from public.waves where id = p.wave_id),
                 coalesce(p.shipment_number, '-'), p.seq, l.quantity,
                 (select bin_code from public.bins where id = p.from_bin_id), l.to_bin, v_reason));
  perform set_config('app.by_name', '', true);
  return l.quantity;
end $$;

revoke execute on function public.complete_open_pallet(uuid, text, text) from public, anon;
grant execute on function public.complete_open_pallet(uuid, text, text) to authenticated;

-- Cancelling the pick: complete the pallet break first, then cancel.
create or replace function public.set_task_status(p_task_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.pick_tasks%rowtype; v_moved numeric := 0;
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

  if p_status = 'CANCELLED' and t.task_type = 'PICK' then
    v_moved := public.complete_open_pallet(t.id, null, p_reason);
  end if;

  update public.pick_tasks set status = p_status where id = t.id;
  perform public.log_execution_event('TASK', t.id, t.status, p_status, p_reason);
  return jsonb_build_object('result', 'UPDATED', 'from_status', t.status, 'to_status', p_status,
                            'moved_to_pickface', v_moved);
end $$;

-- Cancelling the wave: same for every pick of it, then cancel as before.
create or replace function public.set_wave_status(p_wave_id uuid, p_status text, p_reason text default null,
                                                  p_new_slot text default null, p_new_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waves%rowtype; n_cancelled int := 0; n_moved numeric := 0; v_qty numeric; v_pick uuid;
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
    -- 0073: every pick of this wave whose pallet break was already posted half-way finishes
    -- the break first, so no bin keeps cartons from a cancelled shipment. A pick that is already
    -- posted keeps its cartons (the truck has them) and is left COMPLETED, as before.
    for v_pick in select t.id from public.pick_tasks t
                 where t.wave_id = w.id and t.task_type = 'PICK' and t.status in ('PLANNED','RESCHEDULED')
                 order by t.seq loop
      v_qty := public.complete_open_pallet(v_pick, null, p_reason);
      n_moved := n_moved + coalesce(v_qty, 0);
    end loop;

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
                            'tasks_cancelled', n_cancelled, 'moved_to_pickface', n_moved);
end $$;
