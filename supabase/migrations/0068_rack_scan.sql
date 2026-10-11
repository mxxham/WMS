-- =====================================================================
-- 0068  Rack scan: the bin's label confirms a pick, not the carton
--
--  The barcodes on the floor are on the racking: each location label's QR
--  (and Code 128) is the plain bin code, e.g. CB34D02 (lib/labels.ts).
--  items.ean is empty everywhere, so the picking screen's item scan
--  (item_by_barcode) refused every rack scan ("Barcode ... tidak dikenal")
--  and proved nothing. The labels are upright strips of five levels (A-E):
--  the neighbouring level is the mistake to catch.
--
--  · Every posting at the bin (post_pick_line, post_task_by,
--    post_pick_with_move, post_task_found_elsewhere) now needs the bin code,
--    scanned or typed, of the bin it takes from: else 'Scan label bin dulu',
--    a different code 'Bin salah: kamu scan X, baris ini Y'. Input errors:
--    nothing posted, no Minta supervisor request. require_scan_on_pick no
--    longer applies to these paths (the confirmation is always required).
--  · pick_tasks.scan_method: 'scan' (camera / scanner) or 'ketik' (typed),
--    stamped with scanned_code (now the confirmed bin) when a task
--    completes, from app.pick_scan_method; cleared by unpost_task.
--  · p_scan_mode is a new LAST parameter with default 'scan': the old
--    functions are dropped so a call with the old named arguments (the
--    deployed app) still resolves, and is checked as a rack scan.
--  · post_task_core is post_task_by's body without the confirmation, for
--    the engine's own postings that never had a scan (post_move_early,
--    post_as_done, the move of post_pick_with_move); not callable by clients.
--  · pick_audit_line gains scan_method (last column) for Kepatuhan scan.
-- =====================================================================

alter table public.pick_tasks add column scan_method text
  constraint pick_tasks_scan_method_check check (scan_method in ('scan', 'ketik'));

-- The rack label read (or typed) against the bin a posting takes from. Returns the bin code as confirmed.
create or replace function public.rack_scan_check(p_scanned text, p_scan_mode text, p_bin text)
returns text language plpgsql immutable as $$
declare v_code text := upper(regexp_replace(coalesce(p_scanned, ''), '\s', '', 'g'));
begin
  if coalesce(p_scan_mode, '') not in ('scan', 'ketik') then
    raise exception 'Konfirmasi bin harus scan atau ketik, bukan %', coalesce(p_scan_mode, 'kosong');
  end if;
  if v_code = '' then raise exception 'Scan label bin dulu (atau ketik kodenya)'; end if;
  if v_code is distinct from p_bin then raise exception 'Bin salah: kamu scan %, baris ini %', v_code, coalesce(p_bin, '–'); end if;
  return v_code;
end $$;
revoke execute on function public.rack_scan_check(text, text, text) from public, anon, authenticated;

-- stamp_pick_confirmation (0024) + scan_method.
create or replace function public.stamp_pick_confirmation()
returns trigger language plpgsql as $$
begin
  if new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED' then
    new.picked_by_name := coalesce(nullif(trim(new.picked_by_name), ''), nullif(current_setting('app.by_name', true), ''));
    new.scanned_code := coalesce(new.scanned_code, nullif(current_setting('app.pick_scanned', true), ''));
    -- 0068: how the bin was confirmed (scan / ketik), only on a task that carries the confirmation.
    if new.scanned_code is not null then
      new.scan_method := coalesce(new.scan_method, nullif(current_setting('app.pick_scan_method', true), ''));
    end if;
    new.bulk_posted := new.bulk_posted or coalesce(current_setting('app.pick_bulk', true), '') = 'on';
  end if;
  return new;
end $$;

-- unpost_task (0067) + scan_method cleared with scanned_code; nothing else changed.
create or replace function public.unpost_task(p_task_id uuid, p_by_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_reason text := nullif(trim(p_reason), '');
  t public.pick_tasks%rowtype; v_wave public.waves%rowtype; v_sh text;
  v_qty numeric; v_from uuid; v_batch text; v_exp date;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[])
     and coalesce(current_setting('app.sheet_engine', true), '') <> 'on' then
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
    deviation_reason = null, picked_by_name = null, scanned_code = null, scan_method = null, bulk_posted = false,
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

-- post_task_by's body (0024) without the confirmation: the engine's own postings. Not for clients.
create or replace function public.post_task_core(
  p_task_id uuid, p_actual_qty numeric default null, p_from_bin text default null, p_batch_lot text default null,
  p_expiry date default null, p_reason text default null, p_by_name text default null, p_scanned text default null,
  p_scan_mode text default 'scan')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name, 'Nama picker'); t record; v_res jsonb;
begin
  select pt.task_type, it.sku, it.ean into t
  from public.pick_tasks pt join public.items it on it.id = pt.item_id where pt.id = p_task_id;
  if t.sku is null then raise exception 'Tugas tidak ada'; end if;
  perform set_config('app.by_name', v_name, true);
  perform set_config('app.pick_scanned', regexp_replace(coalesce(p_scanned, ''), '\s', '', 'g'), true);
  perform set_config('app.pick_scan_method', case when nullif(trim(p_scanned), '') is not null then coalesce(p_scan_mode, '') else '' end, true);
  perform set_config('app.pick_bulk', '', true);
  v_res := public.post_task(p_task_id, p_actual_qty, p_from_bin, p_batch_lot, p_expiry, p_reason);
  perform set_config('app.pick_scanned', '', true);
  perform set_config('app.pick_scan_method', '', true);
  return v_res;
end $$;
revoke execute on function public.post_task_core(uuid, numeric, text, text, date, text, text, text, text) from public, anon, authenticated;

-- post_task_by (0024): the rack label instead of the item barcode, then the same posting.
drop function public.post_task_by(uuid, numeric, text, text, date, text, text, text);
create or replace function public.post_task_by(
  p_task_id uuid, p_actual_qty numeric default null, p_from_bin text default null, p_batch_lot text default null,
  p_expiry date default null, p_reason text default null, p_by_name text default null, p_scanned text default null,
  p_scan_mode text default 'scan')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name, 'Nama picker'); t record; v_bin text; v_res jsonb;
begin
  select pt.task_type, it.sku, it.ean, fb.bin_code as from_bin into t
  from public.pick_tasks pt join public.items it on it.id = pt.item_id
  left join public.bins fb on fb.id = pt.from_bin_id where pt.id = p_task_id;
  if t.sku is null then raise exception 'Tugas tidak ada'; end if;
  -- 0068: the rack label of the bin this posting takes from (the bin given, else the planned one).
  v_bin := public.rack_scan_check(p_scanned, p_scan_mode, coalesce(nullif(upper(trim(p_from_bin)), ''), t.from_bin));
  v_res := public.post_task_core(p_task_id, p_actual_qty, p_from_bin, p_batch_lot, p_expiry, p_reason, v_name, v_bin, p_scan_mode);
  return v_res;
end $$;
revoke execute on function public.post_task_by(uuid, numeric, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.post_task_by(uuid, numeric, text, text, date, text, text, text, text) to authenticated;

-- post_pick_with_move (0035): the pallet bin's label for the pick.
drop function public.post_pick_with_move(uuid, uuid, numeric, numeric, text, text, text);
create or replace function public.post_pick_with_move(
  p_pick_id uuid, p_move_id uuid, p_pick_qty numeric, p_move_qty numeric,
  p_reason text, p_by_name text, p_scanned text default null, p_scan_mode text default 'scan')
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.pick_tasks%rowtype; m public.pick_tasks%rowtype; v_pick jsonb; v_move jsonb; v_bin text;
begin
  select * into p from public.pick_tasks where id = p_pick_id for update;
  select * into m from public.pick_tasks where id = p_move_id for update;
  if p.id is null or m.id is null then raise exception 'Tugas tidak ditemukan'; end if;
  if p.task_type <> 'PICK' or m.task_type = 'PICK' or p.wave_id <> m.wave_id or p.item_id <> m.item_id
     or p.from_bin_id <> m.from_bin_id or p.batch_lot <> m.batch_lot then
    raise exception 'Tugas ini bukan pasangan pick + pindah sisa palet';
  end if;
  -- 0068: the rack label of the pallet bin the pick takes from; the move carries no scan, as before.
  v_bin := public.rack_scan_check(p_scanned, p_scan_mode, (select bin_code from public.bins where id = p.from_bin_id));
  v_pick := public.post_task_core(p_pick_id, p_pick_qty, null, null, null, p_reason, p_by_name, v_bin, p_scan_mode);
  v_move := public.post_task_core(p_move_id, p_move_qty, null, null, null, p_reason, p_by_name, null);
  return jsonb_build_object('pick', v_pick, 'move', v_move);
end $$;
revoke execute on function public.post_pick_with_move(uuid, uuid, numeric, numeric, text, text, text, text) from public, anon;
grant execute on function public.post_pick_with_move(uuid, uuid, numeric, numeric, text, text, text, text) to authenticated;

-- post_task_found_elsewhere (0039): the label of the bin the cartons are really taken from.
drop function public.post_task_found_elsewhere(uuid, text, numeric, text, text, text);
create or replace function public.post_task_found_elsewhere(
  p_task_id uuid, p_bin text, p_qty numeric, p_reason text, p_by_name text, p_scanned text default null,
  p_scan_mode text default 'scan')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.pick_tasks%rowtype; v_wave text; v_bin uuid; v_code text := upper(trim(p_bin)); v_plan_code text;
  v_have numeric; v_move numeric; v_res jsonb; v_scan text;
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
  -- 0068: the rack label of the bin the cartons are taken from, before anything is booked.
  v_scan := public.rack_scan_check(p_scanned, p_scan_mode, v_code);
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

  v_res := public.post_task_core(p_task_id, p_qty, v_code, t.batch_lot, t.expiry_date,
                               format('diambil dari %s: %s', v_code, trim(p_reason)), p_by_name, v_scan, p_scan_mode);
  return v_res || jsonb_build_object('moved_on_books', v_move);
end $$;
revoke execute on function public.post_task_found_elsewhere(uuid, text, numeric, text, text, text, text) from public, anon;
grant execute on function public.post_task_found_elsewhere(uuid, text, numeric, text, text, text, text) to authenticated;

-- post_move_early (0053) and post_as_done (0056) never carried a scan: they post through post_task_core.
create or replace function public.post_move_early(p_move_id uuid, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.pick_tasks%rowtype; w public.waves%rowtype; v_name text; v_res jsonb;
begin
  v_name := public.person_name(p_by_name, 'Nama Anda');
  select * into m from public.pick_tasks where id = p_move_id for update;
  if m.id is null or m.task_type = 'PICK' then raise exception 'Bin To Bin tidak ditemukan'; end if;
  if m.status <> 'PLANNED' then raise exception 'Bin To Bin #% sudah %', m.seq, m.status; end if;
  select * into w from public.waves where id = m.wave_id for update;
  if w.status = 'RESCHEDULED' then
    -- A parked wave is the supervisor's call; on an active wave any operator posts as usual.
    if not public.has_role(array['supervisor','admin']::public.user_role[]) then
      raise exception 'Wave NO % ditunda: hanya supervisor atau admin yang bisa memposting Bin To Bin-nya', w.wave_no;
    end if;
    update public.waves set status = 'PENDING' where id = w.id;
    v_res := public.post_task_core(m.id, null, null, null, null, null, v_name, null);
    update public.waves set status = 'RESCHEDULED' where id = w.id;
  elsif w.status = 'PENDING' then
    v_res := public.post_task_core(m.id, null, null, null, null, null, v_name, null);
  else
    raise exception 'Wave NO % sudah %', w.wave_no, w.status;
  end if;
  perform public.log_execution_event('TASK', m.id, 'PLANNED', 'COMPLETED',
    format('Bin To Bin diposting tanpa pick-nya oleh %s (wave NO %s %s)', v_name, w.wave_no,
           case when w.status = 'RESCHEDULED' then 'ditunda' else 'aktif' end));
  return v_res;
end $$;

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
  v_res := public.post_task_core(t.id, case when p_qty < t.quantity then p_qty end, null, null, null,
                                 case when p_qty < t.quantity then trim(p_reason) end, p_by_name, null);
  -- 3. Its Bin To Bin, as set above.
  if v_move is not null then
    v_mres := public.post_task_core(v_move, null, null, null, null, null, p_by_name, null);
  end if;
  return jsonb_build_object('pick', v_res, 'move', v_mres, 'corrected', v_changed);
end $$;

-- post_pick_line (0067): the rack label instead of the item barcode; everything else as in 0067.
drop function public.post_pick_line(uuid, jsonb, text, text, text);
create or replace function public.post_pick_line(p_wave_id uuid, p_row jsonb, p_by_name text, p_reason text, p_scanned text default null,
                                                 p_scan_mode text default 'scan')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; w public.waves%rowtype; t public.pick_tasks%rowtype; m public.pick_tasks%rowtype;
  v_total numeric; v_scan_bin text;
  v_limit numeric := coalesce((public.inventory_policy()->>'adjust_approval_qty')::numeric, 20);
  v_unchanged boolean := false; v_fbin text; v_fbatch text; v_fexp date;
  v_kind text; v_msg text; v_res jsonb; c jsonb; v_req uuid; v_corr int := 0;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Masuk dulu untuk posting';
  end if;
  v_name := public.person_name(p_by_name, 'Nama picker');
  -- Lock first: two pickers posting the same line are decided one after the other. The tasks are locked too:
  -- post_task / post_task_by lock only the task, never the wave.
  select * into w from public.waves where id = p_wave_id for update;
  if w.id is null then raise exception 'Wave tidak ditemukan'; end if;
  if nullif(p_row->>'pick_id', '') is not null then
    select * into t from public.pick_tasks where id = (p_row->>'pick_id')::uuid for update;
    if t.id is null or t.wave_id <> w.id or t.task_type <> 'PICK' then raise exception 'Baris ini bukan pick wave NO %', w.wave_no; end if;
  end if;
  if nullif(p_row->>'move_id', '') is not null then
    select * into m from public.pick_tasks where id = (p_row->>'move_id')::uuid for update;
    if m.id is null or m.wave_id <> w.id or m.task_type = 'PICK' then raise exception 'Bin To Bin ini bukan milik wave NO %', w.wave_no; end if;
  end if;
  if t.id is null and m.id is null then raise exception 'Baris tanpa tugas'; end if;
  -- A move with no pick: a blank destination or quantity would cancel the planned Bin To Bin, so refuse before anything is written.
  if nullif(p_row->>'pick_id', '') is null and nullif(p_row->>'move_id', '') is not null
     and (nullif(upper(trim(coalesce(p_row->>'move_to', ''))), '') is null or coalesce((p_row->>'move_qty')::numeric, 0) <= 0) then
    raise exception 'Isi bin tujuan dan Qty sisa untuk Bin To Bin ini';
  end if;
  if t.id is not null and m.id is not null and not coalesce(m.item_id = t.item_id, false) then
    raise exception 'Bin To Bin ini bukan milik baris ini';
  end if;
  -- Neither posted: the planned pallet must match. Once either is posted the plan no longer says where the line
  -- came from (a Berbeda moves the planned Bin To Bin's source to the real bin, the pick keeps its plan), so the
  -- check below on the posted sources decides (residual N2).
  if t.id is not null and m.id is not null and t.status <> 'COMPLETED' and m.status <> 'COMPLETED'
     and not coalesce(m.batch_lot is not distinct from t.batch_lot and m.from_bin_id = t.from_bin_id, false) then
    raise exception 'Bin To Bin ini bukan milik baris ini';
  end if;
  -- A posted pick or move: the move must have left from where the pick really was taken (bin, batch, expiry),
  -- else it is another line's move (e.g. a split piece's neighbour) and re-posting it would move it. Two-valued.
  if t.id is not null and m.id is not null and (t.status = 'COMPLETED' or m.status = 'COMPLETED')
     and not coalesce(coalesce(m.actual_from_bin_id, m.from_bin_id) = coalesce(t.actual_from_bin_id, t.from_bin_id)
       and coalesce(m.actual_batch_lot, m.batch_lot) = coalesce(t.actual_batch_lot, t.batch_lot)
       and coalesce(m.actual_expiry_date, m.expiry_date) is not distinct from coalesce(t.actual_expiry_date, t.expiry_date), false) then
    raise exception 'Bin To Bin ini bukan milik baris ini';
  end if;

  -- Input the picker fixes on the card: never recorded.
  select coalesce(sum(coalesce((s->>'qty')::numeric, 0)), 0) into v_total
  from jsonb_array_elements(coalesce(p_row->'sources', '[]'::jsonb)) s;
  if t.id is not null and v_total > t.quantity then
    raise exception 'Lebih dari order: paling banyak % untuk baris ini', t.quantity;
  end if;
  -- 0068: the rack label confirms every row (scanned or typed): the row's first source as the engine reads it,
  -- for a move-only row its pallet. Required, whatever require_scan_on_pick says.
  v_scan_bin := public.rack_scan_check(p_scanned, p_scan_mode, (select f.bin_code from public.pick_line_first_source(p_row) f));

  -- What only a supervisor may do: recorded, nothing posted.
  if w.status <> 'PENDING' then
    v_kind := 'wave_not_pending';
    v_msg := format('Wave NO %s sedang %s: minta supervisor', w.wave_no,
                    case w.status when 'RESCHEDULED' then 'Tunda' when 'COMPLETED' then 'selesai' else 'dibatalkan' end);
  elsif t.status = 'COMPLETED' or m.status = 'COMPLETED' then
    -- An open pick may be posted next to another picker's completed move as long as the row leaves that move as posted.
    if t.id is not null and t.status <> 'COMPLETED' and m.status = 'COMPLETED' then
      -- Mirrors the engine's v_same. The row is read the way the engine reads it (pick_line_first_source, move_to, move_qty).
      -- The batch is compared as written, not as the engine maps it to the bin's own: that errs toward refusing.
      select f.bin_code, f.batch, f.expiry into v_fbin, v_fbatch, v_fexp from public.pick_line_first_source(p_row) f;
      -- Two-valued on purpose: a NULL here (e.g. a blank move_to) must read as "changed", never as "allowed".
      v_unchanged := coalesce(v_fbin is not null
        and nullif(upper(trim(coalesce(p_row->>'move_to', ''))), '') is not distinct from (select bin_code from public.bins where id = m.to_bin_id)
        and nullif(upper(trim(coalesce(p_row->>'move_to', ''))), '') is not null
        and coalesce((p_row->>'move_qty')::numeric, 0) = coalesce(m.actual_quantity, m.quantity)
        and v_fbin is not distinct from (select bin_code from public.bins where id = coalesce(m.actual_from_bin_id, m.from_bin_id))
        and v_fbatch = coalesce(m.actual_batch_lot, m.batch_lot, '')
        and v_fexp is not distinct from coalesce(m.actual_expiry_date, m.expiry_date), false);
    end if;
    if t.status = 'COMPLETED' and not public.same_person(t.picked_by_name, v_name) then
      v_kind := 'other_picker';
      v_msg := format('Baris ini diposting oleh %s: minta supervisor', coalesce(t.picked_by_name, 'orang lain'));
    elsif m.status = 'COMPLETED' and not public.same_person(m.picked_by_name, v_name) and not v_unchanged then
      v_kind := 'other_picker';
      v_msg := format('Bin To Bin baris ini diposting oleh %s: minta supervisor', coalesce(m.picked_by_name, 'orang lain'));
    elsif t.status = 'COMPLETED' and exists (select 1 from public.pick_audits where task_id = t.id) then
      v_kind := 'audited';
      v_msg := 'Baris ini sudah diaudit picking: minta supervisor';
    elsif t.status = 'COMPLETED' and exists (select 1 from public.shipment_loads where wave_id = t.wave_id and shipment_number = t.shipment_number) then
      v_kind := 'loaded';
      v_msg := format('Shipment %s sudah dimuat: minta supervisor', t.shipment_number);
    end if;
  end if;

  if v_kind is null then
    -- Posted at the bin, one line: not bulk, with the confirmed bin and how it was confirmed. Reset below.
    perform set_config('app.pick_line', 'on', true);
    perform set_config('app.pick_scanned', v_scan_bin, true);
    perform set_config('app.pick_scan_method', p_scan_mode, true);
    begin
      v_res := public.post_wave_sheet_rows(p_wave_id, jsonb_build_array(p_row), v_name,
                                           coalesce(nullif(trim(p_reason), ''), 'picking'));
      for c in select e from jsonb_array_elements(coalesce(v_res->'auto', '[]'::jsonb)) e where e->>'kind' = 'correction' loop
        v_corr := v_corr + 1;
        if (c->>'qty')::numeric > v_limit then
          v_kind := 'correction_over_limit';
          v_msg := format('Sistem hanya punya %s di %s untuk SKU %s batch %s, diambil %s: minta supervisor',
                          c->>'had', c->>'bin', c->>'sku', coalesce(nullif(c->>'batch', ''), '–'),
                          (c->>'had')::numeric + (c->>'qty')::numeric);
          raise exception using errcode = 'PL001', message = v_msg;
        end if;
      end loop;
    exception when sqlstate 'PL001' then
      v_res := null;  -- the savepoint rolled the whole line back; v_kind / v_msg stay set
    end;
    perform set_config('app.pick_line', '', true);
    perform set_config('app.pick_scanned', '', true);
    perform set_config('app.pick_scan_method', '', true);
  end if;

  if v_kind is not null then
    -- One open request per line: a retry updates it.
    update public.pick_line_requests set row = p_row, by_name = v_name, kind = v_kind, message = v_msg, created_at = now(),
      task_post_no = coalesce(t.post_no, m.post_no), task_was_done = coalesce(t.status, m.status) = 'COMPLETED'
    where status = 'OPEN' and pick_id is not distinct from t.id and move_id is not distinct from m.id
    returning id into v_req;
    if v_req is null then
      insert into public.pick_line_requests (wave_id, pick_id, move_id, row, by_name, kind, message, task_post_no, task_was_done)
      values (w.id, t.id, m.id, p_row, v_name, v_kind, v_msg, coalesce(t.post_no, m.post_no), coalesce(t.status, m.status) = 'COMPLETED')
      returning id into v_req;
    end if;
    return jsonb_build_object('result', 'refused', 'kind', v_kind, 'message', v_msg, 'request_id', v_req);
  end if;

  return jsonb_build_object('result', 'posted', 'posted_by', v_name, 'corrections', v_corr,
                            'auto', v_res->'auto', 'rows', v_res->'rows');
end $$;
revoke execute on function public.post_pick_line(uuid, jsonb, text, text, text, text) from public, anon;
grant execute on function public.post_pick_line(uuid, jsonb, text, text, text, text) to authenticated;

-- pick_audit_line (0024) + scan_method as its last column.
create or replace view public.pick_audit_line with (security_invoker = true) as
with latest as (
  select distinct on (task_id) * from public.pick_audits order by task_id, attempt_no desc
), n as (
  select task_id, count(*)::int as attempts from public.pick_audits group by task_id
)
select t.id as task_id, t.wave_id, w.wave_no, w.planned_date, w.status as wave_status, t.shipment_number, t.seq,
       it.sku, it.description, it.uom,
       coalesce(ab.bin_code, fb.bin_code) as from_bin, coalesce(ab.zone, fb.zone) as zone,
       coalesce(t.actual_batch_lot, t.batch_lot) as batch_lot, coalesce(t.actual_expiry_date, t.expiry_date) as expiry_date,
       t.quantity as planned_qty, coalesce(t.actual_quantity, t.quantity) as picked_qty, t.deviation_reason,
       t.completed_at, t.picked_by_name, t.bulk_posted, t.scanned_code,
       l.id as audit_id, l.attempt_no, l.result, l.errors, l.resolution, l.checker_name, l.created_at as audited_at,
       coalesce(n.attempts, 0) as attempts,
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when l.id is null then 'TODO'
            when l.result = 'OK' then 'OK'
            when l.resolution is not null then 'RESOLVED'
            else 'MISMATCH' end as line_state,
       sl.id is not null as loaded,
       t.scan_method
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join public.shipment_loads sl on sl.wave_id = t.wave_id and sl.shipment_number = t.shipment_number
where t.task_type = 'PICK' and t.status = 'COMPLETED';
