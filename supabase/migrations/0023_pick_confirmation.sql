-- =====================================================================
-- 0023  Pick confirmation: who picked, and the carton barcode check
--
--  post_task_by = post_task (0007) + the picker's name on the movement +
--  scan verification: a scanned carton code must resolve to the task's
--  SKU; when inventory_policy.require_scan_on_pick is on and the SKU has a
--  barcode in the item master, a scan is required.
-- =====================================================================

create or replace function public.post_task_by(
  p_task_id uuid, p_actual_qty numeric default null, p_from_bin text default null, p_batch_lot text default null,
  p_expiry date default null, p_reason text default null, p_by_name text default null, p_scanned text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name, 'Nama picker'); t record; v_scan_sku text;
begin
  select pt.task_type, it.sku, it.ean into t
  from public.pick_tasks pt join public.items it on it.id = pt.item_id where pt.id = p_task_id;
  if t.sku is null then raise exception 'Tugas tidak ada'; end if;
  if nullif(trim(p_scanned), '') is not null then
    select sku into v_scan_sku from public.item_by_barcode(p_scanned) limit 1;
    if v_scan_sku is null then raise exception 'Barcode % tidak dikenal di master item', trim(p_scanned); end if;
    if v_scan_sku <> t.sku then raise exception 'Barang salah: yang di-scan SKU %, tugas ini SKU %', v_scan_sku, t.sku; end if;
  elsif t.task_type = 'PICK' and t.ean is not null and (public.inventory_policy()->>'require_scan_on_pick')::boolean then
    raise exception 'Scan barcode karton SKU % dulu', t.sku;
  end if;
  perform set_config('app.by_name', v_name, true);
  return public.post_task(p_task_id, p_actual_qty, p_from_bin, p_batch_lot, p_expiry, p_reason);
end $$;

revoke execute on function public.post_task_by(uuid, numeric, text, text, date, text, text, text) from public, anon;
grant execute on function public.post_task_by(uuid, numeric, text, text, date, text, text, text) to authenticated;

-- complete_wave (0007) with the name of whoever posts the rest of the wave.
-- Bulk completion is a supervisor's shortcut: no per-carton scan.
create or replace function public.complete_wave_by(p_wave_id uuid, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.by_name', public.person_name(p_by_name), true);
  return public.complete_wave(p_wave_id);
end $$;
revoke execute on function public.complete_wave_by(uuid, text) from public, anon;
grant execute on function public.complete_wave_by(uuid, text) to authenticated;
