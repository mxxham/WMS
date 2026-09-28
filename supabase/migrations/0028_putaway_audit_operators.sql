-- =====================================================================
-- 0028  Operators may audit putaways at the rack
--
--  Same rule as the picking audit (0024/0025): any signed-in role can be
--  the checker; the named checker may not be the person who did the
--  putaway. record_audit (0012, the list tab) stays supervisor-only.
-- =====================================================================

create or replace function public.record_putaway_audit(
  p_movement_id uuid, p_checker_name text, p_found text, p_batch text, p_counted numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  m record; v_found_sku text; v_sku_ok boolean; v_batch_ok boolean; v_result text; v_prev public.audits%rowtype;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  select mv.id, mv.quantity, mv.batch_lot, mv.by_name, it.sku into m
  from public.movements mv join public.items it on it.id = mv.item_id
  where mv.id = p_movement_id and mv.type in ('putaway', 'inbound');
  if m.id is null then raise exception 'Mutasi putaway tidak ditemukan'; end if;
  if public.same_person(v_checker, m.by_name) then
    raise exception 'Checker tidak boleh orang yang melakukan putaway ini (%)', m.by_name;
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;
  if nullif(trim(p_found), '') is null then raise exception 'Scan karton atau ketik SKU yang ada di bin'; end if;
  select sku into v_found_sku from public.item_by_barcode(p_found) limit 1;
  if v_found_sku is null then raise exception 'Barcode / SKU % tidak dikenal di master item', trim(p_found); end if;

  v_sku_ok := v_found_sku = m.sku;
  v_batch_ok := public.norm_batch(p_batch) = public.norm_batch(m.batch_lot);
  v_result := case when v_sku_ok and v_batch_ok and p_counted = m.quantity then 'OK' else 'MISMATCH' end;
  if v_result = 'MISMATCH' and nullif(trim(p_note), '') is null then
    raise exception 'Ada selisih: catatan wajib diisi';
  end if;

  select * into v_prev from public.audits where movement_id = p_movement_id for update;
  if v_prev.id is null then
    insert into public.audits (kind, movement_id, expected_qty, counted_qty, sku_ok, batch_ok, result, note, audited_by,
                               checker_name, found_sku, found_batch)
    values ('PUTAWAY', p_movement_id, m.quantity, p_counted, v_sku_ok, v_batch_ok, v_result, nullif(trim(p_note), ''), auth.uid(),
            v_checker, v_found_sku, public.norm_batch(p_batch));
  else
    update public.audits set
      history = v_prev.history || jsonb_build_object(
        'counted_qty', v_prev.counted_qty, 'sku_ok', v_prev.sku_ok, 'batch_ok', v_prev.batch_ok,
        'result', v_prev.result, 'note', v_prev.note, 'audited_by', v_prev.audited_by, 'audited_at', v_prev.audited_at,
        'checker_name', v_prev.checker_name, 'found_sku', v_prev.found_sku, 'found_batch', v_prev.found_batch),
      expected_qty = m.quantity, counted_qty = p_counted, sku_ok = v_sku_ok, batch_ok = v_batch_ok,
      result = v_result, note = nullif(trim(p_note), ''), audited_by = auth.uid(), audited_at = now(),
      checker_name = v_checker, found_sku = v_found_sku, found_batch = public.norm_batch(p_batch)
    where id = v_prev.id;
  end if;

  return jsonb_build_object('result', v_result, 'sku_ok', v_sku_ok, 'batch_ok', v_batch_ok,
    'expected', jsonb_build_object('sku', m.sku, 'batch', m.batch_lot, 'qty', m.quantity),
    'found', jsonb_build_object('sku', v_found_sku, 'batch', public.norm_batch(p_batch), 'qty', p_counted));
end $$;
