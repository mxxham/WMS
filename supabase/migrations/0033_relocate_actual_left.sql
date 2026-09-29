-- =====================================================================
-- 0033  Relocation carries what is really left in the bin
--
--  A broken pallet is planned as a PICK plus a relocation of the rest to
--  the pickface. When the pick takes less than planned (NO 4 on 29 Sep:
--  pick 15 of 32), more is left than the relocation planned (29, not 12),
--  and post_task (0007) refused any actual above the planned quantity, so
--  the rest stayed on the books in the old bin. A relocation may now post
--  more than planned; the movements trigger still refuses more than the
--  bin holds. Picks keep the cap.
-- =====================================================================

create or replace function public.post_task(
  p_task_id    uuid,
  p_actual_qty numeric default null,
  p_from_bin   text    default null,
  p_batch_lot  text    default null,
  p_expiry     date    default null,
  p_reason     text    default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype;
  v_wave_status text;
  v_qty numeric; v_from uuid; v_batch text; v_exp date; v_deviated boolean;
  v_mv public.movements%rowtype;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sign in to post tasks';
  end if;

  select * into t from public.pick_tasks where id = p_task_id for update;
  if not found then raise exception 'Task % not found', p_task_id; end if;
  if t.status = 'COMPLETED' then
    return jsonb_build_object('result', 'ALREADY_POSTED', 'task_id', t.id);
  end if;
  if t.status <> 'PLANNED' then
    raise exception 'Task is % and cannot be posted', t.status;
  end if;
  select status into v_wave_status from public.waves where id = t.wave_id;
  if v_wave_status <> 'PENDING' then
    raise exception 'Wave is % and cannot be worked on', v_wave_status;
  end if;

  v_qty := coalesce(p_actual_qty, t.quantity);
  -- A pick never takes more than the order asked for. A relocation carries
  -- what is really left of the pallet, which is more than planned when the
  -- pick before it took less; the movement trigger refuses more than the bin holds.
  if v_qty < 0 or (t.task_type = 'PICK' and v_qty > t.quantity) then
    raise exception 'Jumlah aktual harus 0 sampai % (jumlah rencana)', t.quantity;
  end if;
  v_from := t.from_bin_id; v_batch := t.batch_lot; v_exp := t.expiry_date;
  if coalesce(p_from_bin, '') <> '' then
    select id into v_from from public.bins where bin_code = upper(p_from_bin);
    if v_from is null then raise exception 'Bin % tidak ditemukan', p_from_bin; end if;
    if v_from <> t.from_bin_id then
      -- A different bin holds different stock: take its batch/expiry as given
      -- (null expiry = the batch's only row in that bin).
      v_batch := coalesce(p_batch_lot, t.batch_lot);
      v_exp := p_expiry;
    end if;
  end if;
  if p_batch_lot is not null then v_batch := p_batch_lot; end if;
  if p_expiry is not null then v_exp := p_expiry; end if;

  v_deviated := v_qty <> t.quantity or v_from <> t.from_bin_id or v_batch <> t.batch_lot
                or v_exp is distinct from t.expiry_date;
  if v_deviated and coalesce(trim(p_reason), '') = '' then
    raise exception 'Alasan wajib diisi jika hasil berbeda dari rencana';
  end if;
  if v_from = t.to_bin_id then
    raise exception 'Bin asal sama dengan bin tujuan';
  end if;

  if v_qty > 0 then
    insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, task_id, note)
    values (case t.task_type when 'PICK' then 'picking' else 'transfer' end::public.movement_type,
            t.item_id, v_batch, v_qty, v_from, t.to_bin_id, v_exp, t.id,
            case t.task_type when 'PICK' then 'PICK shipment ' || coalesce(t.shipment_number, '-')
                             else 'REPLENISH pickface' end
            || case when v_deviated then ' (menyimpang: ' || p_reason || ')' else '' end)
    returning * into v_mv;
  end if;

  update public.pick_tasks set
    status = 'COMPLETED', completed_at = now(), completed_by = auth.uid(),
    actual_quantity = v_qty, actual_from_bin_id = v_from, actual_batch_lot = v_batch,
    actual_expiry_date = coalesce(v_mv.expiry_date, v_exp),
    deviation_reason = case when v_deviated then p_reason end
  where id = t.id;

  if t.task_type = 'PICK' then
    update public.outbound set quantity_picked = quantity_picked + v_qty
    where wave_id = t.wave_id and shipment_number = t.shipment_number and item_id = t.item_id;
  end if;

  perform public.log_execution_event('TASK', t.id, t.status, 'COMPLETED',
    case when v_deviated then format('actual %s dari %s: %s', v_qty,
      (select bin_code from public.bins where id = v_from), p_reason) end);

  return jsonb_build_object('result', 'POSTED', 'task_id', t.id, 'deviated', v_deviated, 'quantity', v_qty);
end $$;
revoke execute on function public.post_task(uuid, numeric, text, text, date, text) from public, anon;
grant execute on function public.post_task(uuid, numeric, text, text, date, text) to authenticated;
