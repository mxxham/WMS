-- =====================================================================
-- 0031  Rack audit: wrong item in the bin
--
--  At the rack the checker may find a different SKU in the bin than the
--  one picked from it. Both rack counts (system 0025/0026, WMS file 0030)
--  take an optional p_found_sku (carton scan or SKU): when it resolves to
--  another SKU, every open line of the bin + SKU fails with WRONG_SKU and
--  records what was found. A note is required. p_counted stays the count
--  of the expected SKU still in the bin (0 when there is none).
--  The old 6-argument functions are dropped: with an extra defaulted
--  argument PostgREST could not choose between the two.
-- =====================================================================

drop function public.record_rack_audit(date, text, text, text, numeric, text);
drop function public.record_sheet_rack_audit(date, text, text, text, numeric, text);

-- The other SKU the checker found, or null when it is the expected one.
create or replace function public.rack_found_sku(p_found text, p_expected text, p_note text)
returns text language plpgsql stable set search_path = public as $$
declare v_found text;
begin
  if nullif(trim(p_found), '') is null then return null; end if;
  select sku into v_found from public.item_by_barcode(p_found) limit 1;
  if v_found is null then raise exception 'Barcode / SKU % tidak dikenal di master item', trim(p_found); end if;
  if v_found = p_expected then return null; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Catatan wajib diisi bila barang di bin salah'; end if;
  return v_found;
end $$;

create or replace function public.record_rack_audit(
  p_date date, p_bin text, p_sku text, p_checker_name text, p_counted numeric, p_note text default null,
  p_found_sku text default null)
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
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;
  select id into v_bin from public.bins where bin_code = upper(trim(p_bin));
  select id into v_item from public.items where sku = trim(p_sku);
  if v_bin is null or v_item is null then raise exception 'Bin atau SKU tidak ditemukan'; end if;

  -- The lines this count covers, locked.
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
    and l.line_state in ('TODO', 'MISMATCH') and not l.loaded and l.wave_status <> 'CANCELLED';
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
      method, rack_system, rack_counted, created_by)
    values (t.id, v_attempt, v_checker, coalesce(v_found, t.sku),
      case when v_found is not null and regexp_replace(p_found_sku, '\s', '', 'g') <> v_found then regexp_replace(p_found_sku, '\s', '', 'g') end,
      public.norm_batch(t.batch), null,
      v_counted, false, t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''),
      'RACK', v_system, p_counted, auth.uid());
    n_lines := n_lines + 1;
    if v_result <> 'OK' then n_bad := n_bad + 1; end if;
  end loop;

  -- The count and the system quantity it was compared with.
  return jsonb_build_object('result', case when n_bad = 0 then 'OK' else 'MISMATCH' end,
    'system', v_system, 'counted', p_counted, 'diff', v_diff, 'lines', n_lines, 'found_sku', v_found);
end $$;

create or replace function public.record_sheet_rack_audit(
  p_date date, p_bin text, p_sku text, p_checker_name text, p_counted numeric, p_note text default null,
  p_found_sku text default null)
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
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;

  -- What the file says stays in the bin: the lowest remaining over all its lines of the day.
  select min(bin_remaining) into v_system from public.sheet_pick_lines
  where pick_date = p_date and bin_code = v_bin and sku = v_sku;

  drop table if exists _lines;
  create temp table _lines on commit drop as
  select s.id, s.seq, s.picker_name, s.sku, s.qty, s.batch, s.expiry
  from public.sheet_pick_line_state s
  where s.pick_date = p_date and s.bin_code = v_bin and s.sku = v_sku and s.line_state in ('TODO', 'MISMATCH');
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
      method, rack_system, rack_counted, created_by)
    values (t.id, v_attempt, v_checker, coalesce(v_found, t.sku),
      case when v_found is not null and regexp_replace(p_found_sku, '\s', '', 'g') <> v_found then regexp_replace(p_found_sku, '\s', '', 'g') end,
      t.batch, null,
      v_counted, false, t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''),
      'RACK', v_system, p_counted, auth.uid());
    n_lines := n_lines + 1;
    if v_result <> 'OK' then n_bad := n_bad + 1; end if;
  end loop;

  return jsonb_build_object('result', case when n_bad = 0 then 'OK' else 'MISMATCH' end,
    'system', v_system, 'counted', p_counted, 'diff', v_diff, 'lines', n_lines, 'found_sku', v_found);
end $$;

revoke execute on function public.rack_found_sku(text, text, text) from public, anon;
grant execute on function public.rack_found_sku(text, text, text) to authenticated;
revoke execute on function public.record_rack_audit(date, text, text, text, numeric, text, text) from public, anon;
grant execute on function public.record_rack_audit(date, text, text, text, numeric, text, text) to authenticated;
revoke execute on function public.record_sheet_rack_audit(date, text, text, text, numeric, text, text) from public, anon;
grant execute on function public.record_sheet_rack_audit(date, text, text, text, numeric, text, text) to authenticated;
