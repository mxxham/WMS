-- =====================================================================
-- 0045  Add a Bin To Bin to a pick on the wave page
--
--  30 Sep NO 4 #4: CB12E02 550076253, pick 67 of a pallet of 80, and the
--  plan had no move for the 13 left (the pickface counted as full). The
--  wave page can now add one: a REPLENISH task right after the pick, same
--  wave, same bin / batch, to the bin chosen (the SKU's pickface or a
--  nearby empty Level-A bin). The pick and its move then show and post as
--  one line (0035). The tasks after the pick move one place down.
-- =====================================================================

create or replace function public.add_relocation(
  p_task_id uuid, p_to_bin text, p_qty numeric, p_by_name text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype; w public.waves%rowtype; v_to public.bins%rowtype; v_from uuid; v_id uuid; v_name text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menambah Bin To Bin';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  select * into t from public.pick_tasks where id = p_task_id for update;
  if t.id is null or t.task_type <> 'PICK' then raise exception 'Tugas pick tidak ditemukan'; end if;
  if t.status not in ('PLANNED', 'COMPLETED') then raise exception 'Tugas ini % : tidak bisa diberi Bin To Bin', t.status; end if;
  select * into w from public.waves where id = t.wave_id for update;
  if w.status not in ('PENDING', 'RESCHEDULED') then raise exception 'Wave NO % sudah %', w.wave_no, w.status; end if;
  select * into v_to from public.bins where bin_code = upper(trim(p_to_bin));
  if v_to.id is null then raise exception 'Bin % tidak ada', p_to_bin; end if;
  if v_to.status = 'blocked' then raise exception 'Bin % diblokir', v_to.bin_code; end if;
  v_from := coalesce(t.actual_from_bin_id, t.from_bin_id);
  if v_to.id = v_from then raise exception 'Bin tujuan sama dengan bin asal'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah harus lebih dari 0'; end if;
  if exists (select 1 from public.pick_tasks x where x.wave_id = t.wave_id and x.task_type <> 'PICK' and x.status = 'PLANNED'
             and x.from_bin_id = v_from and x.item_id = t.item_id and x.batch_lot = coalesce(t.actual_batch_lot, t.batch_lot)) then
    raise exception 'Sudah ada Bin To Bin terbuka dari bin ini di wave NO %', w.wave_no;
  end if;

  -- Room right after the pick, so the move sits next to it (the wave page pairs neighbours).
  update public.pick_tasks set seq = seq + 1 where wave_id = t.wave_id and seq > t.seq;
  insert into public.pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id,
                                 batch_lot, expiry_date, quantity, pick_type, breaks_pallet, seq)
  values (t.wave_id, null, 'REPLENISH', t.item_id, v_from, v_to.id,
          coalesce(t.actual_batch_lot, t.batch_lot), coalesce(t.actual_expiry_date, t.expiry_date),
          p_qty, 'CASE', true, t.seq + 1)
  returning id into v_id;
  perform public.log_execution_event('TASK', v_id, null, 'PLANNED',
    format('Bin To Bin ditambah oleh %s ke %s (%s)%s', v_name, v_to.bin_code, p_qty,
           coalesce(': ' || nullif(trim(p_reason), ''), '')));
  return jsonb_build_object('task_id', v_id, 'to_bin', v_to.bin_code, 'seq', t.seq + 1);
end $$;
revoke execute on function public.add_relocation(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.add_relocation(uuid, text, numeric, text, text) to authenticated;
