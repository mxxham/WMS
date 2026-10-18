-- =====================================================================
-- 0078  Three gaps left after 0074-0077
--
--  1. A pick posted alone, its relokasi still planned, the wave cancelled.
--     set_wave_status leaves the posted pick COMPLETED (the truck has it) and
--     cancels the planned relokasi, so the pallet's loose rest (48 - 8 = 40)
--     rests in a level B-E bin for good: the invalid state, with nothing to
--     ever move it. stranded_residue only looked for a cancelled PICK with a
--     posted relokasi, so it showed 0 rows. It now also lists a COMPLETED
--     pick whose adjacent relokasi was CANCELLED while the reserve bin still
--     holds a sub-UPP rest (kind = 'move_cancelled'). Level A is never
--     flagged: a pickface legitimately holds loose cartons. The same one
--     supervisor action settles it, moving the rest to the bin the cancelled
--     relokasi was planned to.
--
--  2. restore_wave put EVERY cancelled outbound line back to PLANNED, also
--     the lines whose pick it skipped because the pallet break was already
--     posted. Those lines then looked planned with no live pick. An outbound
--     line (wave + shipment + item) now stays CANCELLED when its picks were
--     skipped and none of them came back.
--
--  3. Pair rule. lib/allocator/pair-moves.ts pairs a pick with the move right
--     AFTER it (seq+1), else right before (seq-1). posted_pallet_move_seq,
--     open_pallet_leftovers (0074) and stranded_residue (0075) took the lower
--     seq, i.e. seq-1, so when both neighbours are posted moves from the same
--     bin the cancel named a different pickface than the wave page does.
--     All three now prefer seq+1 too. (pair-moves.ts also lets a move belong
--     to one pick only; that "claimed once" rule is not replayed here.)
--
--  New migration: 0074-0077 are applied and never edited. Every function
--  below keeps its argument list, so create or replace replaces it and no
--  overload is left behind (see 0077).
-- =====================================================================

-- 3. The pick's relokasi when it is already posted, else null. Next move first.
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
  order by (m.seq = p.seq + 1) desc, m.seq
  limit 1;
$$;
revoke execute on function public.posted_pallet_move_seq(uuid) from public, anon, authenticated;

-- 3. 0074's leftover lookup, identical except the pair choice (next move first).
create or replace function public.open_pallet_leftovers(p_pick_id uuid, p_ignore_wave uuid default null)
returns table (quantity numeric, to_bin_id uuid, to_bin text, expiry date, blocked_by uuid)
language plpgsql stable security invoker set search_path = public as $$
declare p public.pick_tasks%rowtype; m public.pick_tasks%rowtype;
        v_qty numeric; v_exp date; v_busy uuid; v_upp integer;
begin
  select * into p from public.pick_tasks where id = p_pick_id;
  if p.id is null or p.task_type <> 'PICK' or p.status not in ('PLANNED','RESCHEDULED') then
    return; -- nothing open to reconcile
  end if;
  select * into m from public.pick_tasks
  where id <> p.id and task_type = 'REPLENISH' and status = 'COMPLETED'
    and wave_id = p.wave_id and item_id = p.item_id and from_bin_id = p.from_bin_id
    and coalesce(batch_lot, '') = coalesce(p.batch_lot, '') and abs(seq - p.seq) = 1
  order by (seq = p.seq + 1) desc, seq limit 1;
  if m.id is null then
    return; -- no posted move: cancelling moves no stock at all
  end if;

  select i.quantity, i.expiry_date into v_qty, v_exp
  from public.inventory i
  where i.bin_id = p.from_bin_id and i.item_id = p.item_id
    and coalesce(i.batch_lot, '') = coalesce(p.batch_lot, '')
  order by (coalesce(i.expiry_date, '0001-01-01'::date) = coalesce(p.expiry_date, '0001-01-01'::date)) desc, i.id
  limit 1;

  -- Residue rule: move (bin quantity % upp), never clamp to the pick's possibly stale quantity.
  select i.upp into v_upp from public.items i where i.id = p.item_id;
  if v_upp is not null and v_upp > 0 then
    v_qty := v_qty % v_upp;
  else
    v_qty := least(coalesce(v_qty, 0), coalesce(p.quantity, 0));
  end if;
  if v_qty <= 0 then
    return; -- the bin is already empty for this identity, or residue is 0 (whole pallets)
  end if;

  select t.id into v_busy from public.pick_tasks t
  where t.id <> p.id and t.task_type in ('PICK','REPLENISH') and t.status in ('PLANNED','RESCHEDULED')
    and t.from_bin_id = p.from_bin_id and t.item_id = p.item_id
    and coalesce(t.batch_lot, '') = coalesce(p.batch_lot, '')
    and (p_ignore_wave is null or t.wave_id <> p_ignore_wave)
  order by (t.wave_id = p.wave_id) desc, t.seq limit 1;

  return query select v_qty, m.to_bin_id, (select bin_code from public.bins where id = m.to_bin_id), v_exp, v_busy;
end $$;
revoke execute on function public.open_pallet_leftovers(uuid, uuid) from public, anon, authenticated;

-- 1 + 3. stranded_residue: the 0075 shape (cancelled pick, posted relokasi) plus the new one
-- (completed pick, cancelled relokasi, sub-UPP rest at level B-E). `kind` is the new last column.
create or replace view public.stranded_residue with (security_invoker = true) as
select pk.id as pick_task_id, m.id as move_task_id,
       w.wave_no, w.planned_date, pk.shipment_number, pk.seq as pick_seq,
       it.sku, it.description, it.uom,
       fb.bin_code as bin, tb.bin_code as to_bin, tb.id as to_bin_id, fb.id as bin_id,
       i.batch_lot, i.expiry_date,
       i.quantity as in_bin,
       case when coalesce(it.upp, 0) > 0 then i.quantity % it.upp
            else least(i.quantity, pk.quantity) end as residue,
       m.completed_at as move_posted_at,
       'pick_cancelled'::text as kind
from public.pick_tasks pk
join public.waves w          on w.id = pk.wave_id
join public.items it         on it.id = pk.item_id
join public.bins fb          on fb.id = pk.from_bin_id
join lateral (
  select i.* from public.inventory i
  where i.bin_id = pk.from_bin_id and i.item_id = pk.item_id
    and coalesce(i.batch_lot, '') = coalesce(pk.batch_lot, '')
  order by (coalesce(i.expiry_date, '0001-01-01'::date) = coalesce(pk.expiry_date, '0001-01-01'::date)) desc, i.id
  limit 1
) i on true
join lateral (
  select m.* from public.pick_tasks m
  where m.task_type = 'REPLENISH' and m.status = 'COMPLETED'
    and m.wave_id = pk.wave_id and m.item_id = pk.item_id
    and m.from_bin_id = pk.from_bin_id
    and coalesce(m.batch_lot, '') = coalesce(pk.batch_lot, '')
  order by (abs(m.seq - pk.seq) = 1) desc, abs(m.seq - pk.seq), (m.seq = pk.seq + 1) desc, m.seq
  limit 1
) m on true
join public.bins tb          on tb.id = m.to_bin_id
where pk.task_type = 'PICK' and pk.status = 'CANCELLED'
  and i.quantity > 0
  and not exists (select 1 from public.open_pick_tasks t
                  where t.task_type in ('PICK', 'REPLENISH') and t.from_bin_id = pk.from_bin_id
                    and t.item_id = pk.item_id and coalesce(t.batch_lot, '') = coalesce(pk.batch_lot, ''))
  and not exists (select 1 from public.movements mv
                  where mv.task_id = pk.id and mv.type = 'transfer' and mv.from_bin_id = pk.from_bin_id)
  and case when coalesce(it.upp, 0) > 0 then i.quantity % it.upp
           else least(i.quantity, pk.quantity) end > 0
union all
select pk.id, m.id,
       w.wave_no, w.planned_date, pk.shipment_number, pk.seq,
       it.sku, it.description, it.uom,
       fb.bin_code, tb.bin_code, tb.id, fb.id,
       i.batch_lot, i.expiry_date,
       i.quantity,
       i.quantity % it.upp,
       null::timestamptz,
       'move_cancelled'::text
from public.pick_tasks pk
join public.waves w          on w.id = pk.wave_id
join public.items it         on it.id = pk.item_id and coalesce(it.upp, 0) > 0
join public.bins fb          on fb.id = pk.from_bin_id and fb.level in ('B','C','D','E')
join lateral (
  select i.* from public.inventory i
  where i.bin_id = pk.from_bin_id and i.item_id = pk.item_id
    and coalesce(i.batch_lot, '') = coalesce(pk.batch_lot, '')
  order by (coalesce(i.expiry_date, '0001-01-01'::date) = coalesce(pk.expiry_date, '0001-01-01'::date)) desc, i.id
  limit 1
) i on true
join lateral (
  select m.* from public.pick_tasks m
  where m.task_type = 'REPLENISH' and m.status = 'CANCELLED'
    and m.wave_id = pk.wave_id and m.item_id = pk.item_id
    and m.from_bin_id = pk.from_bin_id
    and coalesce(m.batch_lot, '') = coalesce(pk.batch_lot, '')
    and abs(m.seq - pk.seq) = 1
  order by (m.seq = pk.seq + 1) desc, m.seq
  limit 1
) m on true
join public.bins tb          on tb.id = m.to_bin_id
where pk.task_type = 'PICK' and pk.status = 'COMPLETED'
  and i.quantity > 0 and i.quantity % it.upp > 0
  -- no live relokasi of this pallet still on its way, and no open task draws from the bin
  and not exists (select 1 from public.open_pick_tasks t
                  where t.task_type in ('PICK', 'REPLENISH') and t.from_bin_id = pk.from_bin_id
                    and t.item_id = pk.item_id and coalesce(t.batch_lot, '') = coalesce(pk.batch_lot, ''))
  -- already settled: the transfer is booked on the cancelled relokasi (the pick's own task id is
  -- taken by its picking movement, movements_task_uq allows one movement per task and post)
  and not exists (select 1 from public.movements mv
                  where mv.task_id = m.id and mv.type = 'transfer' and mv.from_bin_id = pk.from_bin_id);
grant select on public.stranded_residue to authenticated;

-- Settle one stranded residue (either kind): transfer it to the bin of the relokasi.
create or replace function public.settle_stranded_residue(p_pick_id uuid, p_by_name text, p_reason text)
returns numeric language plpgsql security definer set search_path = public as $$
declare r record; v_name text; v_reason text := nullif(trim(p_reason), ''); v_status text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menyelesaikan sisa palet';
  end if;
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  perform 1 from public.pick_tasks where id = p_pick_id for update;
  select * into r from public.stranded_residue where pick_task_id = p_pick_id
  order by (kind = 'pick_cancelled') desc limit 1;
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
         coalesce(r.expiry_date, pk.expiry_date),
         case when r.kind = 'move_cancelled' then r.move_task_id else pk.id end, 'DATA_ENTRY',
         format('Sisa palet NO %s SH %s #%s: %s — %s karton dari %s ikut naik ke %s (%s)',
                r.wave_no, coalesce(r.shipment_number, '-'), r.pick_seq,
                case when r.kind = 'move_cancelled' then 'relokasi dibatalkan, sisa palet masih di bin reserve'
                     else 'pick batal, palet sudah pindah' end,
                r.residue, r.bin, r.to_bin, v_reason)
  from public.pick_tasks pk where pk.id = p_pick_id;
  perform set_config('app.by_name', '', true);
  select status into v_status from public.pick_tasks where id = p_pick_id;
  perform public.log_execution_event('TASK', p_pick_id, v_status, v_status,
    format('sisa palet %s karton %s → %s diselesaikan oleh %s: %s', r.residue, r.bin, r.to_bin, v_name, v_reason));
  return r.residue;
end $$;
revoke execute on function public.settle_stranded_residue(uuid, text, text) from public, anon;
grant execute on function public.settle_stranded_residue(uuid, text, text) to authenticated;

-- 2. restore_wave: identical to 0076, except an outbound line whose picks were all skipped stays CANCELLED.
create or replace function public.restore_wave(p_wave_id uuid, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.waves%rowtype; v_name text; v_reason text := nullif(trim(p_reason), ''); v_lines jsonb; t record; n int := 0; skipped jsonb := '[]'::jsonb; s jsonb;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa memulihkan wave';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;
  select * into w from public.waves where id = p_wave_id for update;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if w.status <> 'CANCELLED' then raise exception 'Wave NO % tidak dibatalkan', w.wave_no; end if;

  v_lines := public.wave_restore_lines(w.id);
  for t in select l.id from public.wave_cancelled_lines(w.id) l loop
    if exists (select 1 from public.pick_tasks pt
               where pt.id = t.id and pt.task_type = 'PICK'
                 and public.posted_pallet_move_seq(pt.id) is not null) then
      select jsonb_build_object('task_id', pt.id, 'seq', pt.seq, 'sku', it.sku, 'bin', b.bin_code,
                                'reason', 'palet sudah dipindahkan (relokasi #' || public.posted_pallet_move_seq(pt.id) || ' diposting)')
      into s
      from public.pick_tasks pt
      join public.items it on it.id = pt.item_id
      join public.bins b on b.id = pt.from_bin_id
      where pt.id = t.id;
      skipped := skipped || s;
      continue;
    end if;
    update public.pick_tasks pt set status = 'PLANNED' where pt.id = t.id;
    perform public.log_execution_event('TASK', t.id, 'CANCELLED', 'PLANNED', format('wave dipulihkan oleh %s: %s', v_name, v_reason));
    n := n + 1;
  end loop;
  -- An outbound line comes back only when it has a live pick again, or never lost one to a skip.
  update public.outbound o set status = 'PLANNED'
  where o.wave_id = w.id and o.status = 'CANCELLED'
    and not (exists (select 1 from jsonb_array_elements(skipped) k
                     join public.pick_tasks sp on sp.id = (k->>'task_id')::uuid
                     where sp.wave_id = w.id and sp.shipment_number = o.shipment_number and sp.item_id = o.item_id)
             and not exists (select 1 from public.pick_tasks lp
                             where lp.wave_id = w.id and lp.task_type = 'PICK' and lp.status = 'PLANNED'
                               and lp.shipment_number = o.shipment_number and lp.item_id = o.item_id));
  update public.waves set status = 'PENDING' where id = w.id;
  perform public.log_execution_event('WAVE', w.id, 'CANCELLED', 'PENDING', format('dipulihkan oleh %s: %s', v_name, v_reason));
  return jsonb_build_object('restored', n, 'lines', v_lines, 'skipped_pallet_breaks', skipped);
end $$;
revoke execute on function public.restore_wave(uuid, text, text) from public, anon;
grant execute on function public.restore_wave(uuid, text, text) to authenticated;
