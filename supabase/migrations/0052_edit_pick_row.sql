-- =====================================================================
-- 0052  Ubah baris: one correction for an open row, source and Bin To Bin
--
--  Making one row match the printed picklist took up to three dialogs —
--  Ubah Bin Pick (0049/0050), Tambah Bin To Bin (0045), Ubah Bin To Bin
--  (0047) — each with its own name, reason and log line, and next to
--  Posting, Pecah and Batal the row had too many buttons for a phone.
--  edit_pick_row sets an open pick's source (bin + batch + expiry, any
--  batch: a later expiry is the page's warning, not a refusal) and its
--  Bin To Bin (change, add, or remove) in one transaction, one name, one
--  reason, one log line. The rules of the three it replaces stay:
--    * a changed source must hold the batch + expiry (0050; otherwise the
--      pick lands in stok kurang and can never post),
--    * no blocked bin, destination never the source (pick_task_bins 0004),
--    * one open Bin To Bin per bin + SKU + batch per wave (0045),
--    * the move sits right after its pick, where the wave page pairs it.
--  The page passes the move it shows as paired (p_move_id), so the server
--  never guesses which neighbour belongs to the pick. A removed move is
--  CANCELLED, not deleted: Pulihkan brings it back.
--  The three older RPCs stay for compatibility; the page no longer calls them
--  on open rows.
-- =====================================================================

create or replace function public.edit_pick_row(
  p_task_id uuid, p_move_id uuid, p_from_bin text, p_batch_lot text, p_expiry_date date,
  p_move_to text, p_move_qty numeric, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype; w public.waves%rowtype; m public.pick_tasks%rowtype;
  v_from public.bins%rowtype; v_to public.bins%rowtype;
  v_name text; v_reason text := nullif(trim(p_reason), '');
  v_old_bin text; v_old_batch text; v_old_exp date; v_batch text := coalesce(trim(p_batch_lot), '');
  v_old_to text; v_to_code text := nullif(upper(trim(coalesce(p_move_to, ''))), '');
  v_src_changed boolean; v_have numeric; v_parts text[] := '{}'; v_new_move uuid;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah baris';
  end if;
  v_name := public.person_name(p_by_name, 'Nama Anda');
  if v_reason is null then raise exception 'Alasan wajib diisi'; end if;

  select * into t from public.pick_tasks where id = p_task_id for update;
  if t.id is null or t.task_type <> 'PICK' then raise exception 'Tugas pick tidak ditemukan'; end if;
  if t.status <> 'PLANNED' then raise exception 'Hanya tugas yang belum diposting yang bisa diubah'; end if;
  select * into w from public.waves where id = t.wave_id for update;
  if w.status not in ('PENDING', 'RESCHEDULED') then raise exception 'Wave NO % sudah %', w.wave_no, w.status; end if;
  select bin_code into v_old_bin from public.bins where id = t.from_bin_id;
  v_old_batch := coalesce(t.actual_batch_lot, t.batch_lot);
  v_old_exp := coalesce(t.actual_expiry_date, t.expiry_date);

  if p_move_id is not null then
    select * into m from public.pick_tasks
     where id = p_move_id and wave_id = t.wave_id and task_type = 'REPLENISH' and status = 'PLANNED'
       and item_id = t.item_id and from_bin_id = t.from_bin_id and seq in (t.seq - 1, t.seq + 1)
     for update;
    if m.id is null then raise exception 'Bin To Bin baris #% sudah berubah: muat ulang halaman', t.seq; end if;
    select bin_code into v_old_to from public.bins where id = m.to_bin_id;
  end if;

  select * into v_from from public.bins where bin_code = upper(trim(coalesce(p_from_bin, '')));
  if v_from.id is null then raise exception 'Bin % tidak ada', p_from_bin; end if;
  if v_from.status = 'blocked' then raise exception 'Bin % diblokir', v_from.bin_code; end if;
  v_src_changed := v_from.id <> t.from_bin_id or v_batch <> v_old_batch or p_expiry_date is distinct from v_old_exp;
  if v_src_changed then
    select coalesce(sum(quantity), 0) into v_have from public.inventory
     where bin_id = v_from.id and item_id = t.item_id and batch_lot = v_batch and expiry_date is not distinct from p_expiry_date;
    if v_have <= 0 then
      raise exception 'Bin % tidak menyimpan batch % exp %: koreksi stok dulu (Adjust stok), atau posting dengan Berbeda → Bin lain',
        v_from.bin_code, nullif(v_batch, ''), p_expiry_date;
    end if;
  end if;

  if v_to_code is not null then
    select * into v_to from public.bins where bin_code = v_to_code;
    if v_to.id is null then raise exception 'Bin % tidak ada', v_to_code; end if;
    if v_to.status = 'blocked' then raise exception 'Bin % diblokir', v_to.bin_code; end if;
    if v_to.id = v_from.id then raise exception 'Bin asal dan tujuan Bin To Bin sama: %', v_from.bin_code; end if;
    if p_move_qty is null or p_move_qty <= 0 then raise exception 'Jumlah sisa Bin To Bin harus lebih dari 0'; end if;
    if exists (select 1 from public.pick_tasks x where x.wave_id = t.wave_id and x.task_type <> 'PICK' and x.status = 'PLANNED'
               and x.from_bin_id = v_from.id and x.item_id = t.item_id and x.batch_lot = v_batch
               and x.id is distinct from m.id) then
      raise exception 'Sudah ada Bin To Bin terbuka dari % di wave NO %', v_from.bin_code, w.wave_no;
    end if;
  end if;

  if not v_src_changed and ((m.id is null and v_to_code is null)
      or (m.id is not null and v_to.id = m.to_bin_id and p_move_qty = m.quantity)) then
    raise exception 'Tidak ada yang diubah di baris #%', t.seq;
  end if;

  if v_src_changed then
    update public.pick_tasks set from_bin_id = v_from.id, batch_lot = v_batch, expiry_date = p_expiry_date where id = t.id;
    v_parts := v_parts || format('sumber %s %s exp %s → %s %s exp %s', v_old_bin, nullif(v_old_batch, ''), v_old_exp,
                                 v_from.bin_code, nullif(v_batch, ''), p_expiry_date);
    if p_expiry_date > v_old_exp then v_parts := v_parts || 'FEFO dilewati'::text; end if;
  end if;

  if m.id is not null and v_to_code is null then
    update public.pick_tasks set status = 'CANCELLED' where id = m.id;
    perform public.log_execution_event('TASK', m.id, 'PLANNED', 'CANCELLED',
      format('Bin To Bin dihapus lewat Ubah baris #%s oleh %s: %s', t.seq, v_name, v_reason));
    v_parts := v_parts || format('Bin To Bin ke %s (%s) dihapus', v_old_to, m.quantity);
  elsif m.id is not null then
    update public.pick_tasks set from_bin_id = v_from.id, to_bin_id = v_to.id, batch_lot = v_batch,
                                 expiry_date = p_expiry_date, quantity = p_move_qty where id = m.id;
    if v_to.id <> m.to_bin_id or p_move_qty <> m.quantity then
      v_parts := v_parts || format('Bin To Bin %s (%s) → %s (%s)', v_old_to, m.quantity, v_to.bin_code, p_move_qty);
    end if;
  elsif v_to_code is not null then
    -- Room right after the pick, so the move sits next to it (0045).
    update public.pick_tasks set seq = seq + 1 where wave_id = t.wave_id and seq > t.seq;
    insert into public.pick_tasks (wave_id, shipment_number, task_type, item_id, from_bin_id, to_bin_id,
                                   batch_lot, expiry_date, quantity, pick_type, breaks_pallet, seq)
    values (t.wave_id, null, 'REPLENISH', t.item_id, v_from.id, v_to.id, v_batch, p_expiry_date,
            p_move_qty, 'CASE', true, t.seq + 1)
    returning id into v_new_move;
    perform public.log_execution_event('TASK', v_new_move, null, 'PLANNED',
      format('Bin To Bin ditambah lewat Ubah baris #%s oleh %s: %s', t.seq, v_name, v_reason));
    v_parts := v_parts || format('Bin To Bin ditambah → %s (%s)', v_to.bin_code, p_move_qty);
  end if;

  perform public.log_execution_event('TASK', t.id, 'PLANNED', 'PLANNED',
    format('baris diubah oleh %s: %s: %s', v_name, array_to_string(v_parts, '; '), v_reason));
  return jsonb_build_object('task_id', t.id, 'from_bin', v_from.bin_code, 'batch_lot', v_batch, 'expiry_date', p_expiry_date,
                            'move_id', coalesce(v_new_move, m.id), 'move_to', v_to.bin_code,
                            'move_removed', m.id is not null and v_to_code is null);
end $$;
revoke execute on function public.edit_pick_row(uuid, uuid, text, text, date, text, numeric, text, text) from public, anon;
grant execute on function public.edit_pick_row(uuid, uuid, text, text, date, text, numeric, text, text) to authenticated;
