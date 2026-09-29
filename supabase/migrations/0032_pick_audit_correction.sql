-- =====================================================================
-- 0032  Picking audit: correct a count saved by mistake
--
--  A checker can tap Sesuai by mistake. Every picking audit (system and
--  WMS file, per shipment and per rack) takes p_correct: a supervisor or
--  admin records the line / bin again although it already passed. The
--  new attempt is flagged `correction` and needs a reason in the note;
--  earlier attempts stay as history. Still refused: loaded shipments and
--  lines a supervisor accepted (their stock was already adjusted).
--  Old signatures are dropped so PostgREST has one function per name.
-- =====================================================================

alter table public.pick_audits add column correction boolean not null default false;
alter table public.sheet_pick_audits add column correction boolean not null default false;

drop function public.record_pick_audit(uuid, text, text, numeric, text, date, boolean, text);
drop function public.record_sheet_pick_audit(uuid, text, text, numeric, text, date, boolean, text);
drop function public.record_rack_audit(date, text, text, text, numeric, text, text);
drop function public.record_sheet_rack_audit(date, text, text, text, numeric, text, text);

-- Guard shared by the four: only a supervisor / admin corrects, with a reason.
create or replace function public.pick_audit_correction_check(p_correct boolean, p_note text)
returns void language plpgsql stable set search_path = public as $$
begin
  if not coalesce(p_correct, false) then return; end if;
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengubah audit';
  end if;
  if nullif(trim(p_note), '') is null then raise exception 'Alasan ubah wajib diisi di catatan'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Per shipment, system (0024)
-- ---------------------------------------------------------------------
create or replace function public.record_pick_audit(
  p_task_id uuid, p_checker_name text, p_found text, p_counted numeric,
  p_batch text, p_expiry date, p_damaged boolean, p_note text, p_correct boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  t record; v_prev public.pick_audits%rowtype; v_found_sku text; v_code text;
  v_errors text[]; v_result text; v_attempt int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  perform public.pick_audit_correction_check(p_correct, p_note);
  select pt.id, pt.wave_id, pt.shipment_number, pt.task_type, pt.status, pt.picked_by_name, it.sku,
         coalesce(pt.actual_quantity, pt.quantity) as qty, coalesce(pt.actual_batch_lot, pt.batch_lot) as batch,
         coalesce(pt.actual_expiry_date, pt.expiry_date) as expiry, w.status as wave_status
    into t
  from public.pick_tasks pt join public.items it on it.id = pt.item_id join public.waves w on w.id = pt.wave_id
  where pt.id = p_task_id
  for update of pt;
  if not found or t.task_type <> 'PICK' or t.status <> 'COMPLETED' then
    raise exception 'Tugas pick belum selesai atau tidak ditemukan';
  end if;
  if t.wave_status = 'CANCELLED' then raise exception 'Wave dibatalkan: baris ini tidak diaudit'; end if;
  if exists (select 1 from public.shipment_loads where wave_id = t.wave_id and shipment_number = t.shipment_number) then
    raise exception 'Shipment % sudah dimuat', t.shipment_number;
  end if;
  if t.qty = 0 then raise exception 'Baris ini tidak dipick (0): tidak perlu diaudit'; end if;
  if public.same_person(v_checker, t.picked_by_name) then
    raise exception 'Checker tidak boleh picker baris ini (%)', t.picked_by_name;
  end if;
  select * into v_prev from public.pick_audits where task_id = p_task_id order by attempt_no desc limit 1;
  if v_prev.resolution is not null then raise exception 'Baris ini sudah diterima supervisor: tidak bisa diubah'; end if;
  if v_prev.id is not null and v_prev.result = 'OK' and not coalesce(p_correct, false) then
    raise exception 'Baris ini sudah lolos audit';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;
  if nullif(trim(p_found), '') is null then raise exception 'Scan karton atau ketik SKU yang ada di palet'; end if;
  select sku into v_found_sku from public.item_by_barcode(p_found) limit 1;
  if v_found_sku is null then raise exception 'Barcode / SKU % tidak dikenal di master item', trim(p_found); end if;
  v_code := regexp_replace(p_found, '\s', '', 'g');
  if v_code = v_found_sku then v_code := null; end if;

  v_errors := public.pick_audit_errors(t.sku, t.batch, t.expiry, t.qty,
                                       v_found_sku, p_batch, p_expiry, p_counted, coalesce(p_damaged, false));
  v_result := case when v_errors = '{}' then 'OK' else 'MISMATCH' end;
  v_attempt := coalesce(v_prev.attempt_no, 0) + 1;

  insert into public.pick_audits (task_id, attempt_no, checker_name, found_sku, found_scanned_code, found_batch, found_expiry,
    counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note, correction, created_by)
  values (p_task_id, v_attempt, v_checker, v_found_sku, v_code, public.norm_batch(p_batch), p_expiry,
    p_counted, coalesce(p_damaged, false), t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''),
    coalesce(p_correct, false), auth.uid());

  -- The expected values leave the database only here, after the count is saved.
  return jsonb_build_object('result', v_result, 'errors', to_jsonb(v_errors), 'attempt', v_attempt,
    'expected', jsonb_build_object('sku', t.sku, 'batch', t.batch, 'expiry', t.expiry, 'qty', t.qty),
    'found', jsonb_build_object('sku', v_found_sku, 'code', v_code, 'batch', public.norm_batch(p_batch),
                                'expiry', p_expiry, 'qty', p_counted, 'damaged', coalesce(p_damaged, false)));
end $$;

-- ---------------------------------------------------------------------
-- Per shipment, WMS file (0029)
-- ---------------------------------------------------------------------
create or replace function public.record_sheet_pick_audit(
  p_line_id uuid, p_checker_name text, p_found text, p_counted numeric,
  p_batch text, p_expiry date, p_damaged boolean, p_note text, p_correct boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  l public.sheet_pick_lines%rowtype; v_prev public.sheet_pick_audits%rowtype; v_found_sku text; v_code text;
  v_errors text[]; v_result text; v_attempt int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  perform public.pick_audit_correction_check(p_correct, p_note);
  select * into l from public.sheet_pick_lines where id = p_line_id for update;
  if l.id is null then raise exception 'Baris pick tidak ditemukan'; end if;
  if public.same_person(v_checker, l.picker_name) then
    raise exception 'Checker tidak boleh picker baris ini (%)', l.picker_name;
  end if;
  select * into v_prev from public.sheet_pick_audits where line_id = p_line_id order by attempt_no desc limit 1;
  if v_prev.id is not null and v_prev.result = 'OK' and not coalesce(p_correct, false) then
    raise exception 'Baris ini sudah lolos audit';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;
  if nullif(trim(p_found), '') is null then raise exception 'Scan karton atau ketik SKU yang ada di palet'; end if;
  select sku into v_found_sku from public.item_by_barcode(p_found) limit 1;
  if v_found_sku is null then raise exception 'Barcode / SKU % tidak dikenal di master item', trim(p_found); end if;
  v_code := regexp_replace(p_found, '\s', '', 'g');
  if v_code = v_found_sku then v_code := null; end if;

  v_errors := public.pick_audit_errors(l.sku, l.batch, l.expiry, l.qty,
                                       v_found_sku, p_batch, p_expiry, p_counted, coalesce(p_damaged, false));
  v_result := case when v_errors = '{}' then 'OK' else 'MISMATCH' end;
  if v_result = 'MISMATCH' and nullif(trim(p_note), '') is null then
    raise exception 'Tidak sesuai: isi catatan apa yang ditemukan';
  end if;
  v_attempt := coalesce(v_prev.attempt_no, 0) + 1;

  insert into public.sheet_pick_audits (line_id, attempt_no, checker_name, found_sku, found_scanned_code, found_batch, found_expiry,
    counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note, correction, created_by)
  values (p_line_id, v_attempt, v_checker, v_found_sku, v_code, public.norm_batch(p_batch), p_expiry,
    p_counted, coalesce(p_damaged, false), l.sku, l.batch, l.expiry, l.qty, v_errors, v_result, nullif(trim(p_note), ''),
    coalesce(p_correct, false), auth.uid());

  return jsonb_build_object('result', v_result, 'errors', to_jsonb(v_errors), 'attempt', v_attempt,
    'expected', jsonb_build_object('sku', l.sku, 'batch', l.batch, 'expiry', l.expiry, 'qty', l.qty),
    'found', jsonb_build_object('sku', v_found_sku, 'code', v_code, 'batch', public.norm_batch(p_batch),
                                'expiry', p_expiry, 'qty', p_counted, 'damaged', coalesce(p_damaged, false)));
end $$;

-- ---------------------------------------------------------------------
-- Per rack, system (0025 / 0026 / 0031)
-- ---------------------------------------------------------------------
create or replace function public.record_rack_audit(
  p_date date, p_bin text, p_sku text, p_checker_name text, p_counted numeric, p_note text default null,
  p_found_sku text default null, p_correct boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  v_bin uuid; v_item uuid; v_system numeric; v_diff numeric; v_target uuid; v_picker text; v_found text;
  t record; v_counted numeric; v_errors text[]; v_result text; v_attempt int;
  n_lines int := 0; n_bad int := 0;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  perform public.pick_audit_correction_check(p_correct, p_note);
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;
  select id into v_bin from public.bins where bin_code = upper(trim(p_bin));
  select id into v_item from public.items where sku = trim(p_sku);
  if v_bin is null or v_item is null then raise exception 'Bin atau SKU tidak ditemukan'; end if;

  -- The lines this count covers, locked. A correction also takes the lines that passed.
  drop table if exists _lines;
  create temp table _lines on commit drop as
  select pt.id, pt.completed_at, pt.seq, pt.picked_by_name, it.sku,
         coalesce(pt.actual_quantity, pt.quantity) as qty,
         coalesce(pt.actual_batch_lot, pt.batch_lot) as batch,
         coalesce(pt.actual_expiry_date, pt.expiry_date) as expiry
  from public.pick_tasks pt
  join public.items it on it.id = pt.item_id
  join public.waves w on w.id = pt.wave_id
  join public.pick_audit_line l on l.task_id = pt.id
  where w.planned_date = p_date and coalesce(pt.actual_from_bin_id, pt.from_bin_id) = v_bin and pt.item_id = v_item
    and (l.line_state in ('TODO', 'MISMATCH') or (coalesce(p_correct, false) and l.line_state = 'OK'))
    and not l.loaded and l.wave_status <> 'CANCELLED';
  perform 1 from public.pick_tasks where id in (select id from _lines) for update;
  if not exists (select 1 from _lines) then
    raise exception 'Tidak ada baris untuk diaudit di % untuk SKU %', upper(trim(p_bin)), p_sku;
  end if;
  select picked_by_name into v_picker from _lines where public.same_person(v_checker, picked_by_name) limit 1;
  if v_picker is not null then raise exception 'Checker tidak boleh picker baris di bin ini (%)', v_picker; end if;
  v_found := public.rack_found_sku(p_found_sku, trim(p_sku), p_note);

  select coalesce(sum(quantity), 0) into v_system from public.inventory where bin_id = v_bin and item_id = v_item;
  v_diff := p_counted - v_system;
  if v_diff <> 0 and nullif(trim(p_note), '') is null then
    raise exception 'Catatan wajib diisi bila sisa di bin tidak sesuai';
  end if;
  select id into v_target from _lines order by completed_at desc, seq desc, id desc limit 1;

  for t in select * from _lines loop
    v_counted := case when t.id = v_target then greatest(t.qty - v_diff, 0) else t.qty end;
    v_errors := public.pick_audit_errors(t.sku, t.batch, t.expiry, t.qty, coalesce(v_found, t.sku), t.batch, null, v_counted, false);
    v_result := case when v_errors = '{}' then 'OK' else 'MISMATCH' end;
    select coalesce(max(attempt_no), 0) + 1 into v_attempt from public.pick_audits where task_id = t.id;
    insert into public.pick_audits (task_id, attempt_no, checker_name, found_sku, found_scanned_code, found_batch, found_expiry,
      counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note,
      method, rack_system, rack_counted, correction, created_by)
    values (t.id, v_attempt, v_checker, coalesce(v_found, t.sku),
      case when v_found is not null and regexp_replace(p_found_sku, '\s', '', 'g') <> v_found then regexp_replace(p_found_sku, '\s', '', 'g') end,
      public.norm_batch(t.batch), null,
      v_counted, false, t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''),
      'RACK', v_system, p_counted, coalesce(p_correct, false), auth.uid());
    n_lines := n_lines + 1;
    if v_result <> 'OK' then n_bad := n_bad + 1; end if;
  end loop;

  return jsonb_build_object('result', case when n_bad = 0 then 'OK' else 'MISMATCH' end,
    'system', v_system, 'counted', p_counted, 'diff', v_diff, 'lines', n_lines, 'found_sku', v_found);
end $$;

-- ---------------------------------------------------------------------
-- Per rack, WMS file (0030 / 0031)
-- ---------------------------------------------------------------------
create or replace function public.record_sheet_rack_audit(
  p_date date, p_bin text, p_sku text, p_checker_name text, p_counted numeric, p_note text default null,
  p_found_sku text default null, p_correct boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  v_bin text := upper(trim(p_bin)); v_sku text := trim(p_sku);
  v_system numeric; v_diff numeric; v_target uuid; v_picker text; v_found text;
  t record; v_counted numeric; v_errors text[]; v_result text; v_attempt int;
  n_lines int := 0; n_bad int := 0;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  perform public.pick_audit_correction_check(p_correct, p_note);
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;

  -- What the file says stays in the bin: the lowest remaining over all its lines of the day.
  select min(bin_remaining) into v_system from public.sheet_pick_lines
  where pick_date = p_date and bin_code = v_bin and sku = v_sku;

  drop table if exists _lines;
  create temp table _lines on commit drop as
  select s.id, s.seq, s.picker_name, s.sku, s.qty, s.batch, s.expiry
  from public.sheet_pick_line_state s
  where s.pick_date = p_date and s.bin_code = v_bin and s.sku = v_sku
    and (s.line_state in ('TODO', 'MISMATCH') or coalesce(p_correct, false));
  perform 1 from public.sheet_pick_lines where id in (select id from _lines) for update;
  if not exists (select 1 from _lines) then
    raise exception 'Tidak ada baris untuk diaudit di % untuk SKU %', v_bin, v_sku;
  end if;
  if v_system is null then raise exception 'File tidak mencatat sisa di bin %: audit per shipment', v_bin; end if;
  select picker_name into v_picker from _lines where public.same_person(v_checker, picker_name) limit 1;
  if v_picker is not null then raise exception 'Checker tidak boleh picker baris di bin ini (%)', v_picker; end if;
  v_found := public.rack_found_sku(p_found_sku, v_sku, p_note);

  v_diff := p_counted - v_system;
  if v_diff <> 0 and nullif(trim(p_note), '') is null then
    raise exception 'Catatan wajib diisi bila sisa di bin tidak sesuai';
  end if;
  select id into v_target from _lines order by seq desc, id desc limit 1;

  for t in select * from _lines loop
    v_counted := case when t.id = v_target then greatest(t.qty - v_diff, 0) else t.qty end;
    v_errors := public.pick_audit_errors(t.sku, t.batch, t.expiry, t.qty, coalesce(v_found, t.sku), t.batch, null, v_counted, false);
    v_result := case when v_errors = '{}' then 'OK' else 'MISMATCH' end;
    select coalesce(max(attempt_no), 0) + 1 into v_attempt from public.sheet_pick_audits where line_id = t.id;
    insert into public.sheet_pick_audits (line_id, attempt_no, checker_name, found_sku, found_scanned_code, found_batch, found_expiry,
      counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note,
      method, rack_system, rack_counted, correction, created_by)
    values (t.id, v_attempt, v_checker, coalesce(v_found, t.sku),
      case when v_found is not null and regexp_replace(p_found_sku, '\s', '', 'g') <> v_found then regexp_replace(p_found_sku, '\s', '', 'g') end,
      t.batch, null,
      v_counted, false, t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''),
      'RACK', v_system, p_counted, coalesce(p_correct, false), auth.uid());
    n_lines := n_lines + 1;
    if v_result <> 'OK' then n_bad := n_bad + 1; end if;
  end loop;

  return jsonb_build_object('result', case when n_bad = 0 then 'OK' else 'MISMATCH' end,
    'system', v_system, 'counted', p_counted, 'diff', v_diff, 'lines', n_lines, 'found_sku', v_found);
end $$;

revoke execute on function public.pick_audit_correction_check(boolean, text) from public, anon;
grant execute on function public.pick_audit_correction_check(boolean, text) to authenticated;
revoke execute on function public.record_pick_audit(uuid, text, text, numeric, text, date, boolean, text, boolean) from public, anon;
grant execute on function public.record_pick_audit(uuid, text, text, numeric, text, date, boolean, text, boolean) to authenticated;
revoke execute on function public.record_sheet_pick_audit(uuid, text, text, numeric, text, date, boolean, text, boolean) from public, anon;
grant execute on function public.record_sheet_pick_audit(uuid, text, text, numeric, text, date, boolean, text, boolean) to authenticated;
revoke execute on function public.record_rack_audit(date, text, text, text, numeric, text, text, boolean) from public, anon;
grant execute on function public.record_rack_audit(date, text, text, text, numeric, text, text, boolean) to authenticated;
revoke execute on function public.record_sheet_rack_audit(date, text, text, text, numeric, text, text, boolean) from public, anon;
grant execute on function public.record_sheet_rack_audit(date, text, text, text, numeric, text, text, boolean) to authenticated;
