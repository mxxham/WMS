-- =====================================================================
-- 0034  Wave corrections: undo a posting, change an order's quantity
--
--  unpost_task        "Batalkan posting": a posted task goes back to
--                     PLANNED and its stock is put back exactly as the
--                     posting took it (pick: an adjustment back into the
--                     source bin; relocation: a transfer back). Both the
--                     posting and its reversal stay in the ledger. Refused
--                     when the shipment is loaded or the line was already
--                     picking-audited (fix it with Ubah on the audit).
--  set_order_quantity "Ubah jumlah order": the real quantity of one order
--                     line (1000 on the file, 983 really needed). Going
--                     down, the open picks of that line shrink from the
--                     last one back; what a broken pallet no longer gives
--                     is added to its planned relocation, so the rest still
--                     goes to the pickface. Going up only records the order:
--                     the extra shows as short until the plan is redone.
--  Both: supervisor / admin, name and reason required, logged.
-- =====================================================================

-- One movement per task and posting: a task undone and posted again gets
-- post_no 2, so its new movement does not collide with the first one, while
-- posting the same task twice is still impossible (0004).
alter table public.pick_tasks add column post_no int not null default 1;
alter table public.movements add column task_post int;
drop index public.movements_task_uq;
create unique index movements_task_uq on public.movements (task_id, coalesce(task_post, 1)) where task_id is not null;

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

  if t.task_type = 'PICK' then
    update public.outbound set quantity_picked = quantity_picked + v_qty
    where wave_id = t.wave_id and shipment_number = t.shipment_number and item_id = t.item_id;
  end if;

  perform public.log_execution_event('TASK', t.id, t.status, 'COMPLETED',
    case when v_deviated then format('actual %s dari %s: %s', v_qty,
      (select bin_code from public.bins where id = v_from), p_reason) end);

  return jsonb_build_object('result', 'POSTED', 'task_id', t.id, 'deviated', v_deviated, 'quantity', v_qty);
end $$;

create or replace function public.unpost_task(p_task_id uuid, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_reason text := nullif(trim(p_reason), '');
  t public.pick_tasks%rowtype; v_wave public.waves%rowtype; v_sh text;
  v_qty numeric; v_from uuid; v_batch text; v_exp date;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa membatalkan posting';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if v_reason is null then raise exception 'Alasan batalkan posting wajib diisi'; end if;

  select * into t from public.pick_tasks where id = p_task_id for update;
  if t.id is null then raise exception 'Tugas tidak ditemukan'; end if;
  if t.status <> 'COMPLETED' then raise exception 'Tugas ini belum diposting'; end if;
  select * into v_wave from public.waves where id = t.wave_id for update;
  if v_wave.status = 'CANCELLED' then raise exception 'Wave dibatalkan: posting tidak bisa dibatalkan'; end if;
  if t.task_type = 'PICK' then
    if exists (select 1 from public.shipment_loads where wave_id = t.wave_id and shipment_number = t.shipment_number) then
      raise exception 'Shipment % sudah dimuat: posting tidak bisa dibatalkan', t.shipment_number;
    end if;
    if exists (select 1 from public.pick_audits where task_id = t.id) then
      raise exception 'Baris ini sudah diaudit picking: betulkan lewat Ubah di audit picking';
    end if;
  end if;

  v_qty := coalesce(t.actual_quantity, t.quantity);
  v_from := coalesce(t.actual_from_bin_id, t.from_bin_id);
  v_batch := coalesce(t.actual_batch_lot, t.batch_lot);
  v_exp := coalesce(t.actual_expiry_date, t.expiry_date);
  v_sh := coalesce(t.shipment_number, '-');

  perform set_config('app.by_name', v_name, true);
  if v_qty > 0 then
    if t.task_type = 'PICK' then
      -- The picked cartons go back into the bin they came from.
      perform set_config('app.adjust_reason', 'DATA_ENTRY', true);
      perform set_config('app.adjust_approved', 'on', true);
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, ref_id)
      values ('adjustment', t.item_id, v_batch, v_qty, v_from, v_exp, 'DATA_ENTRY',
              format('Batalkan posting pick NO %s SH %s #%s: %s', v_wave.wave_no, v_sh, t.seq, v_reason), t.id);
      perform set_config('app.adjust_approved', '', true);
      perform set_config('app.adjust_reason', '', true);
    else
      -- The relocation goes back: from the pickface to the bin it left.
      insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, ref_id)
      values ('transfer', t.item_id, v_batch, v_qty, t.to_bin_id, v_from, v_exp,
              format('Batalkan posting relokasi NO %s #%s: %s', v_wave.wave_no, t.seq, v_reason), t.id);
    end if;
  end if;

  update public.pick_tasks set
    status = 'PLANNED', completed_at = null, completed_by = null,
    actual_quantity = null, actual_from_bin_id = null, actual_batch_lot = null, actual_expiry_date = null,
    deviation_reason = null, picked_by_name = null, scanned_code = null, bulk_posted = false,
    post_no = post_no + 1
  where id = t.id;

  if t.task_type = 'PICK' then
    update public.outbound set quantity_picked = greatest(quantity_picked - v_qty, 0),
      status = case when status = 'COMPLETED' then 'PLANNED' else status end,
      completed_at = case when status = 'COMPLETED' then null else completed_at end
    where wave_id = t.wave_id and shipment_number = t.shipment_number and item_id = t.item_id;
  end if;
  if v_wave.status = 'COMPLETED' then
    update public.waves set status = 'PENDING' where id = v_wave.id;
    perform public.log_execution_event('WAVE', v_wave.id, 'COMPLETED', 'PENDING', format('dibuka lagi: batalkan posting #%s', t.seq));
  end if;
  perform public.log_execution_event('TASK', t.id, 'COMPLETED', 'PLANNED', format('batalkan posting oleh %s: %s', v_name, v_reason));

  return jsonb_build_object('result', 'UNPOSTED', 'task_id', t.id, 'quantity', v_qty, 'wave_reopened', v_wave.status = 'COMPLETED');
end $$;

create or replace function public.set_order_quantity(
  p_wave_id uuid, p_shipment text, p_sku text, p_quantity numeric, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_reason text := nullif(trim(p_reason), '');
  v_wave public.waves%rowtype; v_item uuid; o public.outbound%rowtype;
  v_picked numeric; v_open numeric; v_cut numeric; v_take numeric; t record; n_changed int := 0; v_reloc uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah jumlah order';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if v_reason is null then raise exception 'Alasan ubah jumlah order wajib diisi'; end if;
  if p_quantity is null or p_quantity < 0 then raise exception 'Jumlah order tidak valid'; end if;

  select * into v_wave from public.waves where id = p_wave_id for update;
  if v_wave.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if v_wave.status = 'CANCELLED' then raise exception 'Wave dibatalkan'; end if;
  if exists (select 1 from public.shipment_loads where wave_id = p_wave_id and shipment_number = p_shipment) then
    raise exception 'Shipment % sudah dimuat: jumlah order tidak bisa diubah', p_shipment;
  end if;
  select id into v_item from public.items where sku = trim(p_sku);
  select * into o from public.outbound where wave_id = p_wave_id and shipment_number = p_shipment and item_id = v_item for update;
  if o.id is null then raise exception 'Order SKU % untuk shipment % tidak ada di wave ini', p_sku, p_shipment; end if;

  -- What the open picks still have to bring: the new quantity less what is already picked.
  select coalesce(sum(coalesce(actual_quantity, quantity)) filter (where status = 'COMPLETED'), 0),
         coalesce(sum(quantity) filter (where status = 'PLANNED'), 0)
    into v_picked, v_open
  from public.pick_tasks
  where wave_id = p_wave_id and shipment_number = p_shipment and item_id = v_item and task_type = 'PICK';
  v_cut := greatest(v_open - greatest(p_quantity - v_picked, 0), 0);

  -- Cut first where a pallet is broken anyway (a relocation takes its rest),
  -- so full-pallet picks stay whole; then from the last pick back.
  for t in select p.* from public.pick_tasks p
           where p.wave_id = p_wave_id and p.shipment_number = p_shipment and p.item_id = v_item
             and p.task_type = 'PICK' and p.status = 'PLANNED'
           order by exists (select 1 from public.pick_tasks r
                            where r.wave_id = p.wave_id and r.task_type <> 'PICK' and r.status = 'PLANNED'
                              and r.item_id = p.item_id and r.from_bin_id = p.from_bin_id and r.batch_lot = p.batch_lot) desc,
                    p.seq desc
           for update of p loop
    exit when v_cut <= 0;
    v_take := least(v_cut, t.quantity);
    if v_take = t.quantity then
      update public.pick_tasks set status = 'CANCELLED' where id = t.id;
      perform public.log_execution_event('TASK', t.id, 'PLANNED', 'CANCELLED', format('order %s jadi %s: %s', o.quantity_requested, p_quantity, v_reason));
    else
      update public.pick_tasks set quantity = quantity - v_take where id = t.id;
    end if;
    -- The cartons this pick no longer takes stay on its pallet: its relocation carries them.
    select id into v_reloc from public.pick_tasks
    where wave_id = p_wave_id and task_type <> 'PICK' and status = 'PLANNED' and item_id = v_item
      and from_bin_id = t.from_bin_id and batch_lot = t.batch_lot
    order by seq limit 1;
    if v_reloc is not null then update public.pick_tasks set quantity = quantity + v_take where id = v_reloc; end if;
    v_cut := v_cut - v_take; n_changed := n_changed + 1;
  end loop;

  update public.outbound set quantity_requested = p_quantity, quantity_allocated = least(quantity_allocated, p_quantity)
  where id = o.id;
  perform public.log_execution_event('WAVE', p_wave_id, v_wave.status, v_wave.status,
    format('order SH %s SKU %s: %s -> %s oleh %s: %s', p_shipment, trim(p_sku), o.quantity_requested, p_quantity, v_name, v_reason));

  return jsonb_build_object('result', 'CHANGED', 'old', o.quantity_requested, 'new', p_quantity,
    'picked', v_picked, 'tasks_changed', n_changed);
end $$;

revoke execute on function public.unpost_task(uuid, text, text) from public, anon;
grant execute on function public.unpost_task(uuid, text, text) to authenticated;
revoke execute on function public.set_order_quantity(uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.set_order_quantity(uuid, text, text, numeric, text, text) to authenticated;
