-- =====================================================================
-- 0047  Ubah Bin To Bin: another destination for an open move
--
--  30 Sep NO 8 #1: CD39E02 550049044, pick 6 of a pallet of 44, the rest
--  planned to CC34A02. At the rack CC34A02 was full, so the picker put the
--  38 in CC33A02, and the wave page had no way to say so (Tambah Bin To Bin,
--  0045, only adds a move to a pick that has none). A supervisor can now
--  change the destination (and the cartons) of a move that is not posted
--  yet. The move keeps its place next to its pick; the change is logged.
-- =====================================================================

create or replace function public.change_relocation(
  p_move_id uuid, p_to_bin text, p_qty numeric, p_by_name text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.pick_tasks%rowtype; w public.waves%rowtype; v_to public.bins%rowtype; v_old text; v_name text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah Bin To Bin';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  select * into m from public.pick_tasks where id = p_move_id for update;
  if m.id is null or m.task_type = 'PICK' then raise exception 'Tugas ini bukan Bin To Bin'; end if;
  if m.status <> 'PLANNED' then raise exception 'Bin To Bin ini % : tidak terbuka', m.status; end if;
  select * into w from public.waves where id = m.wave_id for update;
  if w.status not in ('PENDING', 'RESCHEDULED') then raise exception 'Wave NO % sudah %', w.wave_no, w.status; end if;
  select * into v_to from public.bins where bin_code = upper(trim(p_to_bin));
  if v_to.id is null then raise exception 'Bin % tidak ada', p_to_bin; end if;
  if v_to.status = 'blocked' then raise exception 'Bin % diblokir', v_to.bin_code; end if;
  if v_to.id = m.from_bin_id then raise exception 'Bin tujuan sama dengan bin asal'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah harus lebih dari 0'; end if;

  select bin_code into v_old from public.bins where id = m.to_bin_id;
  update public.pick_tasks set to_bin_id = v_to.id, quantity = p_qty where id = m.id;
  perform public.log_execution_event('TASK', m.id, 'PLANNED', 'PLANNED',
    format('Bin To Bin diubah oleh %s: %s → %s (%s)%s', v_name, v_old, v_to.bin_code, p_qty,
           coalesce(': ' || nullif(trim(p_reason), ''), '')));
  return jsonb_build_object('task_id', m.id, 'from_bin', v_old, 'to_bin', v_to.bin_code, 'quantity', p_qty);
end $$;
revoke execute on function public.change_relocation(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.change_relocation(uuid, text, numeric, text, text) to authenticated;
