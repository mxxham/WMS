-- =====================================================================
-- 0049  Ubah bin pick: re-point an open pick to the bin that really holds it
--
--  The pallet for a pick was physically moved to another bin after the
--  plan was saved, so the plan — and the printed picklist — point at a
--  bin that no longer holds the stock. The wave page had no way to say
--  so: `Berbeda` (0038) and `Bin lain` (0039) only record the deviation
--  at posting time, leaving the plan showing the wrong bin until the
--  pick is posted. A supervisor can now re-point a pick that is not
--  posted yet to the bin that really holds it — and its Bin To Bin
--  (0045) travels with it in the same transaction, because
--  add_relocation took that move's source from the pick's source and
--  post_pick_with_move (0035) pairs the two by their source bin, so one
--  moved without the other would relocate stock the pick never touched
--  and the pair would no longer post as one line. Only `from_bin_id` is
--  written on both rows: item, batch, expiry and quantity are untouched,
--  so the pick keeps its FEFO place, and the move keeps its destination.
-- =====================================================================

create or replace function public.change_pick_bin(
  p_task_id uuid, p_from_bin text, p_by_name text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype; w public.waves%rowtype; v_to public.bins%rowtype;
  m public.pick_tasks%rowtype; v_old text; v_move_from text; v_name text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah bin pick';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  select * into t from public.pick_tasks where id = p_task_id for update;
  if t.id is null or t.task_type <> 'PICK' then raise exception 'Tugas pick tidak ditemukan'; end if;
  if t.status <> 'PLANNED' then raise exception 'Hanya tugas yang belum diposting yang bisa diubah binnya'; end if;
  select * into w from public.waves where id = t.wave_id for update;
  if w.status not in ('PENDING', 'RESCHEDULED') then raise exception 'Wave NO % sudah %', w.wave_no, w.status; end if;
  select * into v_to from public.bins where bin_code = upper(trim(p_from_bin));
  if v_to.id is null then raise exception 'Bin % tidak ada', p_from_bin; end if;
  if v_to.status = 'blocked' then raise exception 'Bin % diblokir', v_to.bin_code; end if;
  if v_to.id = t.from_bin_id then raise exception 'Bin % sama dengan bin rencana saat ini', v_to.bin_code; end if;
  select bin_code into v_old from public.bins where id = t.from_bin_id;

  -- The move add_relocation (0045) put next to this pick: its source IS the
  -- pick's source, so it travels along. Nearest (lowest seq) is the one the
  -- wave page pairs; a pick with no move is re-pointed on its own.
  select * into m from public.pick_tasks
   where wave_id = t.wave_id and task_type = 'REPLENISH' and status = 'PLANNED'
     and from_bin_id = t.from_bin_id and item_id = t.item_id
     and batch_lot = coalesce(t.actual_batch_lot, t.batch_lot)
   order by seq limit 1 for update;
  if m.id is not null then
    -- pick_task_bins (0004): a REPLENISH row needs to_bin_id <> from_bin_id,
    -- so re-pointing into the move's own destination would blow up the UPDATE.
    if v_to.id = m.to_bin_id then raise exception 'Bin % sama dengan tujuan Bin To Bin-nya', v_to.bin_code; end if;
    select bin_code into v_move_from from public.bins where id = m.from_bin_id;
  end if;

  update public.pick_tasks set from_bin_id = v_to.id where id = t.id;
  -- One open move per (bin, item, batch) per wave. Checked after the pick has
  -- re-pointed and before the move does, so the pair itself never trips it.
  if exists (select 1 from public.pick_tasks x where x.wave_id = t.wave_id and x.task_type <> 'PICK' and x.status = 'PLANNED'
             and x.from_bin_id = v_to.id and x.item_id = t.item_id and x.batch_lot = coalesce(t.actual_batch_lot, t.batch_lot)) then
    raise exception 'Sudah ada Bin To Bin terbuka dari bin ini di wave NO %', w.wave_no;
  end if;
  if m.id is not null then
    update public.pick_tasks set from_bin_id = v_to.id where id = m.id;
  end if;

  perform public.log_execution_event('TASK', t.id, 'PLANNED', 'PLANNED',
    format('bin pick diubah oleh %s: %s → %s%s', v_name, v_old, v_to.bin_code,
           coalesce(': ' || nullif(trim(p_reason), ''), '')));
  return jsonb_build_object('task_id', t.id, 'from_bin', v_old, 'to_bin', v_to.bin_code,
                            'move_id', m.id, 'move_from_bin', v_move_from);
end $$;
revoke execute on function public.change_pick_bin(uuid, text, text, text) from public, anon;
grant execute on function public.change_pick_bin(uuid, text, text, text) to authenticated;
