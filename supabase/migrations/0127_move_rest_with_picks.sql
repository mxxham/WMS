-- =====================================================================
-- 0127  Pindah sisa + pick berikutnya: a Bin To Bin for a pallet whose rest
--       is already planned for later picks
--
--  3 Nov: pallet CC27D02 holds 48 of 550058593. Three shipments pick from it
--  (109759868 08:00 takes 20, NO 109757797 10:00 takes 16, 109760403 14:30
--  takes 12): a triple pick from a high bin. The floor wanted the first
--  picker to take 20 and bring the other 28 down to CE10A02, so the later
--  two pick there. Ubah baris refused: no free sisa, the 28 were "already
--  planned" from CC27D02. Typing 28 anyway would have left the later picks
--  pointing at an empty bin.
--
--  move_rest_with_picks does both in one transaction:
--    * the pick's Bin To Bin (edit_pick_row, 0052: same checks, same log)
--      takes everything left on the pallet after this pick and every pick
--      that comes before it in execution order (date, slot, NO, seq);
--    * the open picks of the same SKU + batch + expiry from that bin that
--      come after it now pick from the destination, as 0063 does after a
--      move is posted elsewhere.
--  Same batch and expiry: FEFO is untouched. Only the plan changes, never
--  stock: the later picks wait for the move (the 0007 shortage check counts
--  planned incoming). Each moved pick is logged (Riwayat); Ubah baris on it
--  undoes it.
-- =====================================================================

create or replace function public.move_rest_with_picks(
  p_task_id uuid, p_move_id uuid, p_move_to text, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype; w public.waves%rowtype;
  v_batch text; v_exp date; v_src text; v_to public.bins%rowtype;
  v_have numeric; v_other numeric; v_follow numeric := 0; v_qty numeric;
  v_ids uuid[] := '{}'; v_name text; v_edit jsonb; p record;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah baris';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if nullif(trim(p_reason), '') is null then raise exception 'Alasan wajib diisi'; end if;

  select * into t from public.pick_tasks where id = p_task_id for update;
  if t.id is null or t.task_type <> 'PICK' then raise exception 'Tugas pick tidak ditemukan'; end if;
  if t.status <> 'PLANNED' then raise exception 'Hanya tugas yang belum diposting yang bisa diubah'; end if;
  select * into w from public.waves where id = t.wave_id;
  if w.status not in ('PENDING', 'RESCHEDULED') then raise exception 'Wave NO % sudah %', w.wave_no, w.status; end if;
  v_batch := coalesce(t.actual_batch_lot, t.batch_lot);
  v_exp := coalesce(t.actual_expiry_date, t.expiry_date);
  select bin_code into v_src from public.bins where id = t.from_bin_id;
  select * into v_to from public.bins where bin_code = nullif(upper(trim(coalesce(p_move_to, ''))), '');
  if v_to.id is null then raise exception 'Bin tujuan % tidak ada', p_move_to; end if;
  if v_to.id = t.from_bin_id then raise exception 'Bin asal dan tujuan Bin To Bin sama: %', v_src; end if;

  -- The later picks of this pallet, in execution order (the 0063 order).
  for p in
    select x.id, x.seq, x.quantity, xw.wave_no, xw.id as wave_id
    from public.pick_tasks x join public.waves xw on xw.id = x.wave_id
    where x.task_type = 'PICK' and x.status = 'PLANNED' and xw.status in ('PENDING', 'RESCHEDULED')
      and x.id <> t.id and x.from_bin_id = t.from_bin_id and x.item_id = t.item_id
      and x.batch_lot = v_batch and x.expiry_date is not distinct from v_exp
      and (xw.planned_date, coalesce(xw.planned_slot, '99:99'), coalesce(nullif(regexp_replace(xw.wave_no, '\D', '', 'g'), '')::int, 0), x.seq)
        > (w.planned_date, coalesce(w.planned_slot, '99:99'), coalesce(nullif(regexp_replace(w.wave_no, '\D', '', 'g'), '')::int, 0), t.seq)
    order by xw.planned_date, coalesce(xw.planned_slot, '99:99'), coalesce(nullif(regexp_replace(xw.wave_no, '\D', '', 'g'), '')::int, 0), x.seq
    for update of x
  loop
    -- A later pick with its own Bin To Bin from this pallet is the pallet's real last pick: not ours to re-plan.
    if exists (select 1 from public.pick_tasks m where m.wave_id = p.wave_id and m.task_type <> 'PICK' and m.status = 'PLANNED'
               and m.from_bin_id = t.from_bin_id and m.item_id = t.item_id and m.seq in (p.seq - 1, p.seq + 1)) then
      raise exception 'NO % #% punya Bin To Bin sendiri dari %: ubah baris itu', p.wave_no, p.seq, v_src;
    end if;
    v_ids := v_ids || p.id;
    v_follow := v_follow + p.quantity;
  end loop;
  if cardinality(v_ids) = 0 then
    raise exception 'Tidak ada pick lain dari % sesudah baris #%', v_src, t.seq;
  end if;

  -- Everything the pallet keeps after this pick and the open tasks that stay on it.
  v_have := public.sheet_have(t.from_bin_id, t.item_id, v_batch, v_exp);
  select coalesce(sum(x.quantity), 0) into v_other
  from public.pick_tasks x join public.waves xw on xw.id = x.wave_id
  where x.status = 'PLANNED' and xw.status in ('PENDING', 'RESCHEDULED')
    and x.from_bin_id = t.from_bin_id and x.item_id = t.item_id and x.batch_lot = v_batch
    and x.expiry_date is not distinct from v_exp
    and x.id <> t.id and x.id is distinct from p_move_id and x.id <> all (v_ids);
  v_qty := v_have - t.quantity - v_other;
  if v_qty < v_follow then
    raise exception 'Stok % di % tinggal % setelah pick ini, kurang untuk % karton pick berikutnya',
      nullif(v_batch, ''), v_src, greatest(v_qty, 0), v_follow;
  end if;

  v_edit := public.edit_pick_row(t.id, p_move_id, v_src, v_batch, v_exp, v_to.bin_code, v_qty, p_by_name, p_reason);

  update public.pick_tasks set from_bin_id = v_to.id where id = any (v_ids);
  for p in select x.id from public.pick_tasks x where x.id = any (v_ids) loop
    perform public.log_execution_event('TASK', p.id, 'PLANNED', 'PLANNED',
      format('ikut Bin To Bin NO %s #%s: sisa %s dari %s ke %s, pick ini sekarang dari %s (oleh %s: %s)',
             w.wave_no, t.seq, v_qty, v_src, v_to.bin_code, v_to.bin_code, v_name, trim(p_reason)));
  end loop;

  return v_edit || jsonb_build_object('move_qty', v_qty, 'followed', cardinality(v_ids));
end $$;
revoke execute on function public.move_rest_with_picks(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.move_rest_with_picks(uuid, uuid, text, text, text) to authenticated;
