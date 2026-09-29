-- =====================================================================
-- 0039  A pick whose cartons are in another bin than the books say
--
--  29 Sep, NO 7: the plan picked 550062978 from CB21A02; on the floor the
--  cartons were in CB23A01 (a relocation put them in the wrong bin). The
--  posting dialog only offers bins where the system holds the SKU, and a
--  pick from a bin without stock on the books is refused. The picker can
--  now type the bin: when it does not hold enough on the books, the
--  planned batch is first recorded as moved there from the planned bin
--  (a transfer "barang ternyata di …"), then the pick is posted from it.
--  The planned bin gets its count task from post_task (0038).
-- =====================================================================

create or replace function public.post_task_found_elsewhere(
  p_task_id uuid, p_bin text, p_qty numeric, p_reason text, p_by_name text, p_scanned text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype; v_wave text; v_bin uuid; v_code text := upper(trim(p_bin)); v_plan_code text;
  v_have numeric; v_move numeric; v_res jsonb;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Alasan wajib diisi'; end if;
  select * into t from public.pick_tasks where id = p_task_id for update;
  if t.id is null or t.status <> 'PLANNED' or t.task_type <> 'PICK' then raise exception 'Tugas pick tidak terbuka'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > t.quantity then raise exception 'Jumlah harus 1 sampai %', t.quantity; end if;
  select id into v_bin from public.bins where bin_code = v_code;
  if v_bin is null then raise exception 'Bin % tidak ada', v_code; end if;
  if v_bin = t.from_bin_id then raise exception 'Itu bin rencana: pilih Sesuai rencana atau jumlah lain'; end if;
  select bin_code into v_plan_code from public.bins where id = t.from_bin_id;
  select wave_no into v_wave from public.waves where id = t.wave_id;

  select coalesce(sum(quantity), 0) into v_have from public.inventory
  where bin_id = v_bin and item_id = t.item_id and batch_lot = t.batch_lot and expiry_date is not distinct from t.expiry_date;
  v_move := greatest(p_qty - v_have, 0);
  if v_move > 0 then
    perform set_config('app.by_name', public.person_name(p_by_name, 'Nama picker'), true);
    -- The movements trigger refuses it when the planned bin does not hold these cartons either.
    insert into public.movements (type, item_id, batch_lot, quantity, from_bin_id, to_bin_id, expiry_date, note, ref_id)
    values ('transfer', t.item_id, t.batch_lot, v_move, t.from_bin_id, v_bin, t.expiry_date,
            format('Barang ternyata di %s, bukan %s (pick NO %s #%s): %s', v_code, v_plan_code, v_wave, t.seq, trim(p_reason)), t.id);
  end if;

  v_res := public.post_task_by(p_task_id, p_qty, v_code, t.batch_lot, t.expiry_date,
                               format('diambil dari %s: %s', v_code, trim(p_reason)), p_by_name, p_scanned);
  return v_res || jsonb_build_object('moved_on_books', v_move);
end $$;
revoke execute on function public.post_task_found_elsewhere(uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public.post_task_found_elsewhere(uuid, text, numeric, text, text, text) to authenticated;
