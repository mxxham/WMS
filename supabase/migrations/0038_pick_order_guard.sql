-- =====================================================================
-- 0038  Picks in plan order, and a count when a pick finds less
--
--  29 Sep, 550069888: a pickface (CC01A01) was picked before the pallet
--  leftovers that were planned to fill it had been moved in; pickers took
--  cartons from other bins without recording where, and the wrong stock
--  spread over several waves.
--  · Order guard: a task that takes from a bin that does not hold enough
--    yet, while a relocation into that bin is still open, is refused with
--    the relocation to do first (post_task, so Selesaikan wave too).
--    task_waits lists them for the wave page, which locks their Posting.
--  · A PICK posted with fewer cartons or from another bin opens a count
--    task on the planned bin (source 'PICK').
-- =====================================================================

alter table public.count_tasks drop constraint count_tasks_source_check;
alter table public.count_tasks add constraint count_tasks_source_check
  check (source in ('MANUAL', 'PUTAWAY', 'DATA_QUALITY', 'CYCLE', 'RECON', 'RECEIPT', 'PICK_AUDIT', 'PICK'));

-- Open tasks that cannot be done from their bin yet because a relocation into it is still open.
create or replace view public.task_waits with (security_invoker = true) as
select t.id as task_id, w.planned_date,
       coalesce((select sum(i.quantity) from public.inventory i
                 where i.bin_id = t.from_bin_id and i.item_id = t.item_id and i.batch_lot = t.batch_lot
                   and i.expiry_date is not distinct from t.expiry_date), 0) as have,
       r.wave_no as wait_wave_no, r.seq as wait_seq, r.from_bin as wait_from, r.to_bin as wait_to, r.quantity as wait_qty
from public.open_pick_tasks t
join public.waves w on w.id = t.wave_id
cross join lateral (
  select rw.wave_no, x.seq, fb.bin_code as from_bin, tb.bin_code as to_bin, x.quantity
  from public.open_pick_tasks x
  join public.waves rw on rw.id = x.wave_id
  join public.bins fb on fb.id = x.from_bin_id
  join public.bins tb on tb.id = x.to_bin_id
  where x.id <> t.id and x.task_type <> 'PICK' and x.to_bin_id = t.from_bin_id
    and x.item_id = t.item_id and x.batch_lot = t.batch_lot
  order by rw.planned_date, rw.planned_slot nulls last, rw.wave_no, x.seq
  limit 1
) r
where coalesce((select sum(i.quantity) from public.inventory i
                where i.bin_id = t.from_bin_id and i.item_id = t.item_id and i.batch_lot = t.batch_lot
                  and i.expiry_date is not distinct from t.expiry_date), 0) < t.quantity;
grant select on public.task_waits to authenticated;

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
  v_have numeric; r record; v_wave_no text;
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

  -- Order guard (0038): the bin does not hold this yet and a relocation into
  -- it is still open, so the plan expects that move first.
  if v_qty > 0 then
    select coalesce(sum(quantity), 0) into v_have from public.inventory
    where bin_id = v_from and item_id = t.item_id and batch_lot = v_batch and expiry_date is not distinct from v_exp;
    if v_have < v_qty then
      select rw.wave_no, x.seq, fb.bin_code as from_code, tb.bin_code as to_code, x.quantity into r
      from public.pick_tasks x
      join public.waves rw on rw.id = x.wave_id
      join public.bins fb on fb.id = x.from_bin_id
      join public.bins tb on tb.id = x.to_bin_id
      where x.id <> t.id and x.status = 'PLANNED' and x.task_type <> 'PICK' and rw.status in ('PENDING', 'RESCHEDULED')
        and x.to_bin_id = v_from and x.item_id = t.item_id and x.batch_lot = v_batch
      order by rw.planned_date, rw.planned_slot nulls last, rw.wave_no, x.seq
      limit 1;
      if found then
        raise exception 'Stok di % belum ada (% dari %): kerjakan dulu relokasi NO % #% dari % ke % (%)',
          r.to_code, v_have, v_qty, r.wave_no, r.seq, r.from_code, r.to_code, r.quantity;
      end if;
    end if;
  end if;

  if v_qty > 0 then
    insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, task_id, task_post, note)
    values (case t.task_type when 'PICK' then 'picking' else 'transfer' end::public.movement_type,
            t.item_id, v_batch, v_qty, v_from, t.to_bin_id, v_exp, t.id, t.post_no,
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

  -- A pick that found less, or took from another bin, says the planned bin's
  -- stock is off: count it now (0038) instead of letting the error spread.
  if t.task_type = 'PICK' and v_deviated and (v_qty < t.quantity or v_from <> t.from_bin_id) then
    select wave_no into v_wave_no from public.waves where id = t.wave_id;
    insert into public.count_tasks (bin_id, reason, source, created_by)
    values (t.from_bin_id, format('Pick NO %s #%s berbeda (%s dari %s): %s', v_wave_no, t.seq, v_qty, t.quantity, p_reason), 'PICK', auth.uid())
    on conflict (bin_id) where status in ('OPEN', 'COUNTED', 'RECOUNT')
    do update set reason = public.count_tasks.reason || '; ' || excluded.reason;
  end if;

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
