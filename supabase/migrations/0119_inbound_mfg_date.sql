-- =====================================================================
-- 0119  Manufacture date on received pallets
--
-- The pallet card of a drum, pail, IBC or fluidbag prints the manufacture
-- date beside the batch (lib/form-checker/pdf.ts). Penerimaan had nowhere
-- to record it, so cards from a checked receipt (0118) printed an empty
-- box. Asked for on 28 Oct 2026.
--
--  * receipt_actuals.mfg_date (optional).
--  * record_receipt_check (0118) takes mfg_date per pallet
--    ([{sku, quantity, damaged_qty?, batch_lot?, expiry_date?, mfg_date?,
--    to_bin_code}]); a date in the future is refused. Everything else in
--    the function is unchanged.
-- The card falls back to the date in a Shell date-coded batch
-- (lib/inbound/cards.ts) when none is entered.
-- =====================================================================

alter table public.receipt_actuals add column mfg_date date;

create or replace function public.record_receipt_check(p_receipt_id uuid, p_lines jsonb, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama pemeriksa'); rc public.receipts%rowtype; r jsonb; n int := 0;
  v_item uuid; v_batch text; v_exp date; v_mfg date; v_bin public.bins%rowtype; v_qty numeric; v_dmg numeric; v_other text;
begin
  if not public.has_job(array['admin_inbound','checker','leader','admin']) then
    raise exception 'Hanya Admin Inbound, Checker, Leader atau Admin yang bisa mencatat pemeriksaan';
  end if;
  select * into rc from public.receipts where id = p_receipt_id for update;
  if rc.id is null then raise exception 'Penerimaan tidak ada'; end if;
  if rc.status not in ('OPEN', 'CHECKED') then raise exception 'Penerimaan % sudah %', rc.doc_no, lower(rc.status); end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Catat minimal satu palet'; end if;

  delete from public.receipt_actuals where receipt_id = p_receipt_id;
  for r in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select id into v_item from public.items where sku = trim(r->>'sku');
    if v_item is null then raise exception 'Palet %: SKU % tidak ada di master item', n, r->>'sku'; end if;
    v_batch := upper(trim(coalesce(r->>'batch_lot', '')));
    v_exp := nullif(r->>'expiry_date', '')::date;
    v_mfg := nullif(r->>'mfg_date', '')::date;
    if v_mfg is not null and v_mfg > (now() at time zone 'Asia/Jakarta')::date then
      raise exception 'Palet %: tanggal produksi % di masa depan', n, to_char(v_mfg, 'DD-MM-YYYY');
    end if;
    if v_exp is not null and v_exp <= current_date then
      raise exception 'Palet %: stok sudah expired (%)', n, to_char(v_exp, 'DD-MM-YYYY');
    end if;
    v_qty := coalesce((r->>'quantity')::numeric, 0);
    v_dmg := coalesce((r->>'damaged_qty')::numeric, 0);
    if v_qty < 0 or v_dmg < 0 or v_qty + v_dmg = 0 then raise exception 'Palet %: qty baik + rusak harus lebih dari 0', n; end if;
    v_bin := null;
    if v_qty > 0 then
      select * into v_bin from public.bins where bin_code = upper(trim(coalesce(r->>'to_bin_code', '')));
      if v_bin.id is null then raise exception 'Palet %: bin tujuan % tidak ada', n, coalesce(nullif(r->>'to_bin_code', ''), '–'); end if;
      if v_bin.zone = 'QUARANTINE' then raise exception 'Palet %: stok baik tidak ke karantina (isi qty rusak untuk karton rusak)', n; end if;
      if v_bin.status = 'blocked' then raise exception 'Palet %: bin % diblokir', n, v_bin.bin_code; end if;
      -- Empty, or the same SKU already there (its pickface, or a top-up).
      if exists (select 1 from public.inventory i where i.bin_id = v_bin.id and i.quantity > 0 and i.item_id <> v_item) then
        raise exception 'Palet %: bin % sudah berisi barang lain', n, v_bin.bin_code;
      end if;
      select string_agg(distinct x.doc_no, ', ') into v_other from public.inbound_reserved_bins x
      where x.bin_id = v_bin.id and x.receipt_id <> p_receipt_id;
      if v_other is not null then raise exception 'Palet %: bin % sudah dipilih untuk DO %', n, v_bin.bin_code, v_other; end if;
      if v_bin.zone ~ '^C[A-Z]$' and exists (select 1 from public.receipt_actuals a where a.receipt_id = p_receipt_id and a.to_bin_id = v_bin.id
                    and a.item_id = v_item and not exists (select 1 from public.pickfaces p where p.bin_id = v_bin.id)) then
        raise exception 'Palet %: dua palet ke bin % (satu bin rak = satu palet)', n, v_bin.bin_code;
      end if;
    end if;
    insert into public.receipt_actuals (receipt_id, line_no, item_id, batch_lot, expiry_date, expiry_confirmed, quantity, damaged_qty, to_bin_id, mfg_date)
    values (p_receipt_id, n, v_item, v_batch, v_exp, true, v_qty, v_dmg, v_bin.id, v_mfg);
  end loop;
  update public.receipts set status = 'CHECKED', checked_by_name = v_name, checked_at = now() where id = p_receipt_id;
  return jsonb_build_object('pallets', n);
end $$;

