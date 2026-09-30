-- =====================================================================
-- 0046  Split an open pick in two ("Pecah")
--
--  A pick can take at most its planned quantity, from one bin. When the
--  floor took one line's cartons from two bins (30 Sep SH 109694908:
--  CD25D02 planned 36, really 23 from CD25D02 + 13 from CC01A01), the line
--  is split: the task keeps the first part, a new open pick for the same
--  shipment / SKU / bin / batch gets the rest, right after it. Each part
--  is then posted from its own bin (Berbeda). The order is unchanged.
-- =====================================================================

create or replace function public.split_task(p_task_id uuid, p_keep numeric, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.pick_tasks%rowtype; w public.waves%rowtype; v_id uuid; v_name text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa memecah tugas';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  select * into t from public.pick_tasks where id = p_task_id for update;
  if t.id is null or t.task_type <> 'PICK' then raise exception 'Tugas pick tidak ditemukan'; end if;
  if t.status <> 'PLANNED' then raise exception 'Hanya tugas yang belum diposting yang bisa dipecah'; end if;
  select * into w from public.waves where id = t.wave_id for update;
  if w.status not in ('PENDING', 'RESCHEDULED') then raise exception 'Wave NO % sudah %', w.wave_no, w.status; end if;
  if p_keep is null or p_keep <= 0 or p_keep >= t.quantity then
    raise exception 'Jumlah yang tetap di tugas ini harus 1 sampai %', t.quantity - 1;
  end if;

  update public.pick_tasks set seq = seq + 1 where wave_id = t.wave_id and seq > t.seq;
  update public.pick_tasks set quantity = p_keep, breaks_pallet = false where id = t.id;
  insert into public.pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id,
                                 batch_lot, expiry_date, quantity, pick_type, breaks_pallet, seq)
  values (t.wave_id, t.shipment_number, 'PICK', t.item_id, t.from_bin_id, null,
          t.batch_lot, t.expiry_date, t.quantity - p_keep, 'CASE', false, t.seq + 1)
  returning id into v_id;
  perform public.log_execution_event('TASK', t.id, 'PLANNED', 'PLANNED',
    format('dipecah oleh %s: %s + %s', v_name, p_keep, t.quantity - p_keep));
  return jsonb_build_object('kept', p_keep, 'new_task', v_id, 'new_qty', t.quantity - p_keep, 'new_seq', t.seq + 1);
end $$;
revoke execute on function public.split_task(uuid, numeric, text) from public, anon;
grant execute on function public.split_task(uuid, numeric, text) to authenticated;
