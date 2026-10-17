-- =====================================================================
-- 0075  Sisa palet tertinggal: cartons the system still holds in a reserve
--       bin although the pallet has physically moved
--
--  The case: reserve bin CB01D01 holds 48. The plan is a pick of 8 plus a
--  relokasi of 40 to the pickface CB01A01. The truck is out of order, so the
--  relokasi is posted early (post_move_early, 0053) to unblock the next
--  wave, and the 8 stay in the system at CB01D01 until the pick is
--  confirmed. The wave is then cancelled, or its pick never gets confirmed,
--  and the floor has already moved the whole pallet. The system keeps 8 in
--  CB01D01: stock that does not exist, reserved for nothing.
--
--  0073 / 0074 finish the pallet break at the moment a pick is cancelled
--  through set_task_status / set_wave_status. They cannot help a pick that
--  was cancelled before 0073, by another path, or after the pair stopped
--  being adjacent (split, Ubah baris). This migration works from the
--  state instead of the event:
--
--    stranded_residue                  every cancelled pick whose relokasi is
--                                      posted, whose source bin still holds
--                                      its leftover and that no open task
--                                      draws from
--    settle_stranded_residue(pick,..)  one supervisor action: the leftover
--                                      goes up to the bin the relokasi went
--                                      to, as ONE transfer (not a count
--                                      adjustment: an adjustment out of
--                                      CB01D01 plus another one into CB01A01
--                                      would be two errors in the accuracy
--                                      KPI for one physical move)
--
--  The quantity is bounded three ways so the view cannot flag a pallet that
--  was put away later: at most the cancelled pick's own planned quantity, at
--  most what the bin holds, and only the loose part (bin quantity modulo
--  UPP, the same rule as 0074). A pick already settled by 0073 / 0074 (its
--  ledger transfer has the pick's task id) is not listed again.
-- =====================================================================

create or replace view public.stranded_residue with (security_invoker = true) as
select pk.id as pick_task_id, m.id as move_task_id,
       w.wave_no, w.planned_date, pk.shipment_number, pk.seq as pick_seq,
       it.sku, it.description, it.uom,
       fb.bin_code as bin, tb.bin_code as to_bin, tb.id as to_bin_id, fb.id as bin_id,
       i.batch_lot, i.expiry_date,
       i.quantity as in_bin,
       case when coalesce(it.upp, 0) > 0 then i.quantity % it.upp
            else least(i.quantity, pk.quantity) end  as raw_residue,
       least(pk.quantity,
             case when coalesce(it.upp, 0) > 0 then i.quantity % it.upp
                  else least(i.quantity, pk.quantity) end) as residue,
       m.completed_at as move_posted_at
from public.pick_tasks pk
join public.waves w          on w.id = pk.wave_id
join public.items it         on it.id = pk.item_id
join public.pick_tasks m     on m.task_type = 'REPLENISH' and m.status = 'COMPLETED'
                            and m.wave_id = pk.wave_id and m.item_id = pk.item_id
                            and m.from_bin_id = pk.from_bin_id
                            and coalesce(m.batch_lot, '') = coalesce(pk.batch_lot, '')
join public.bins fb          on fb.id = pk.from_bin_id
join public.bins tb          on tb.id = m.to_bin_id
join public.inventory i      on i.bin_id = pk.from_bin_id and i.item_id = pk.item_id
                            and coalesce(i.batch_lot, '') = coalesce(pk.batch_lot, '')
                            and i.expiry_date is not distinct from pk.expiry_date
where pk.task_type = 'PICK' and pk.status = 'CANCELLED'
  and i.quantity > 0
  -- the pair rule of the wave page (pair-moves.ts / posted_pallet_move_seq), or the relokasi
  -- is the only one of this wave that left this bin identity after the pick was planned
  and (abs(m.seq - pk.seq) = 1
       or not exists (select 1 from public.pick_tasks m2
                      where m2.task_type = 'REPLENISH' and m2.wave_id = pk.wave_id
                        and m2.from_bin_id = pk.from_bin_id and m2.item_id = pk.item_id
                        and m2.id <> m.id and m2.status = 'COMPLETED'))
  -- an open task still draws from this bin identity: those cartons are its stock
  and not exists (select 1 from public.open_pick_tasks t
                  where t.task_type in ('PICK', 'REPLENISH') and t.from_bin_id = pk.from_bin_id
                    and t.item_id = pk.item_id and coalesce(t.batch_lot, '') = coalesce(pk.batch_lot, ''))
  -- already settled (0073 / 0074 or this migration): a transfer out of this bin carries the pick's id
  and not exists (select 1 from public.movements mv
                  where mv.task_id = pk.id and mv.type = 'transfer' and mv.from_bin_id = pk.from_bin_id)
  and case when coalesce(it.upp, 0) > 0 then i.quantity % it.upp
           else least(i.quantity, pk.quantity) end > 0;
grant select on public.stranded_residue to authenticated;

-- Settle one stranded residue: transfer it to the bin the relokasi went to.
-- Supervisor / admin, with a reason. Returns the quantity moved.
create or replace function public.settle_stranded_residue(p_pick_id uuid, p_by_name text, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare r record; v_name text; v_reason text := nullif(trim(p_reason), '');
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menyelesaikan sisa palet';
  end if;
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  perform 1 from public.pick_tasks where id = p_pick_id for update;
  select * into r from public.stranded_residue where pick_task_id = p_pick_id limit 1;
  if not found then
    raise exception 'Tidak ada sisa palet yang tertinggal untuk pick ini (sudah diselesaikan, atau masih ada tugas terbuka dari bin itu)';
  end if;

  v_name := public.person_name(
    coalesce(nullif(trim(p_by_name), ''), (select pr.name from public.profiles pr where pr.id = auth.uid())),
    'Nama Anda');
  perform set_config('app.by_name', v_name, true);
  insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id,
                               expiry_date, task_id, reason_code, note)
  select 'transfer', pk.item_id, pk.batch_lot, r.residue, r.bin_id, r.to_bin_id,
         coalesce(r.expiry_date, pk.expiry_date), pk.id, 'DATA_ENTRY',
         format('Sisa palet NO %s SH %s #%s: pick batal, palet sudah pindah — %s karton dari %s ikut naik ke %s (%s)',
                r.wave_no, coalesce(r.shipment_number, '-'), r.pick_seq, r.residue, r.bin, r.to_bin, v_reason)
  from public.pick_tasks pk where pk.id = p_pick_id;
  perform set_config('app.by_name', '', true);
  perform public.log_execution_event('TASK', p_pick_id, 'CANCELLED', 'CANCELLED',
    format('sisa palet %s karton %s → %s diselesaikan oleh %s: %s', r.residue, r.bin, r.to_bin, v_name, v_reason));
  return r.residue;
end $$;

revoke execute on function public.settle_stranded_residue(uuid, text, text) from public, anon;
grant execute on function public.settle_stranded_residue(uuid, text, text) to authenticated;
