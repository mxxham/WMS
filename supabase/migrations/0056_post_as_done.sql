-- =====================================================================
-- 0056  Posting sesuai lapangan: correct the row and post it in one step
--
--  5 Oct: making one row match what the picker did took Ubah baris, then
--  Posting, then Batalkan posting, then Posting again — and a pick with its
--  Bin To Bin could not record "taken from another bin" at posting at all.
--  post_as_done takes what really happened — source bin + batch + expiry,
--  cartons taken, where the rest of an opened pallet went (or nowhere) — and,
--  in ONE transaction, corrects the row with edit_pick_row (0052) when its
--  source or Bin To Bin differs, then posts the pick (post_task_by, fewer
--  cartons than planned need the reason) and its move. Every check of those
--  functions applies (the bin must hold the batch, stock never below zero,
--  one open move per bin + batch); any failure posts nothing.
-- =====================================================================

create or replace function public.post_as_done(
  p_task_id uuid, p_move_id uuid, p_from_bin text, p_batch_lot text, p_expiry_date date, p_qty numeric,
  p_move_to text, p_move_qty numeric, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype; m public.pick_tasks%rowtype; v_bin text; v_to text; v_edit jsonb; v_move uuid;
  v_changed boolean; v_res jsonb; v_mres jsonb;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa posting sesuai lapangan';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Alasan wajib diisi'; end if;
  select * into t from public.pick_tasks where id = p_task_id;
  if t.id is null or t.task_type <> 'PICK' or t.status <> 'PLANNED' then raise exception 'Tugas pick terbuka tidak ditemukan'; end if;
  if p_qty is null or p_qty < 0 or p_qty > t.quantity then raise exception 'Jumlah diambil harus 0 sampai % (rencana)', t.quantity; end if;
  if p_move_id is not null then select * into m from public.pick_tasks where id = p_move_id; end if;
  select bin_code into v_bin from public.bins where id = t.from_bin_id;
  select bin_code into v_to from public.bins where id = m.to_bin_id;

  -- 1. The row as it really was: only when source or Bin To Bin differs from the plan.
  v_changed := upper(trim(p_from_bin)) <> v_bin or coalesce(trim(p_batch_lot), '') <> coalesce(t.actual_batch_lot, t.batch_lot)
    or p_expiry_date is distinct from coalesce(t.actual_expiry_date, t.expiry_date)
    or nullif(upper(trim(coalesce(p_move_to, ''))), '') is distinct from v_to
    or (m.id is not null and p_move_qty is distinct from m.quantity);
  if v_changed then
    v_edit := public.edit_pick_row(t.id, p_move_id, p_from_bin, p_batch_lot, p_expiry_date, p_move_to, p_move_qty, p_by_name,
                                   'sesuai lapangan: ' || trim(p_reason));
    v_move := case when coalesce((v_edit->>'move_removed')::boolean, false) then null else (v_edit->>'move_id')::uuid end;
  else
    v_move := p_move_id;
  end if;

  -- 2. The pick, with what was really taken (fewer than planned carries the reason).
  v_res := public.post_task_by(t.id, case when p_qty < t.quantity then p_qty end, null, null, null,
                               case when p_qty < t.quantity then trim(p_reason) end, p_by_name, null);
  -- 3. Its Bin To Bin, as set above.
  if v_move is not null then
    v_mres := public.post_task_by(v_move, null, null, null, null, null, p_by_name, null);
  end if;
  return jsonb_build_object('pick', v_res, 'move', v_mres, 'corrected', v_changed);
end $$;
revoke execute on function public.post_as_done(uuid, uuid, text, text, date, numeric, text, numeric, text, text) from public, anon;
grant execute on function public.post_as_done(uuid, uuid, text, text, date, numeric, text, numeric, text, text) to authenticated;
