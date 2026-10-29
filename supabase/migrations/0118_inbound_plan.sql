-- =====================================================================
-- 0118  Inbound plan + auto putaway on Penerimaan
--
-- Shell sends a daily inbound plan ("INBOUND SHELL, KAMIS 29 OKTOBER
-- 2026"): shipment, DO, sales order, material, qty, container, seal,
-- transporter, slot time. It is uploaded before the trucks come; what
-- arrives can differ. Admin Inbound checks the container against the
-- plan, the page proposes a bin per pallet (lib/inbound/putaway-plan.ts:
-- drum A-C, pail A, fluidbag / IBC B, carton A-E, the rest below a full
-- pallet to the pickface), the pallet cards are printed with their bins,
-- and posting puts the stock in. Spec:
-- docs/superpowers/specs/2026-10-28-inbound-plan-autoputaway-design.md
--
--  * receipts gain the plan header; source 'PLAN' for uploaded plans.
--  * create_receipts_from_plan: one receipt per DO, plan lines as
--    receipt_expected. A DO that exists, or names an unknown SKU, is
--    skipped with its reason.
--  * record_receipt_check: the check per pallet, batch and expiry optional
--    (how the admin gets the batch is decided later), every bin re-checked
--    here: a rack or floor bin that is active, not quarantine, empty (or
--    the SKU's pickface, or already holding the same SKU) and not chosen
--    by another receipt waiting to be posted.
--  * receipt_actuals.expiry_date may be empty until posting;
--    post_receipt refuses a pallet without one (FEFO).
--  * inbound_reserved_bins: bins chosen by receipts not posted yet.
--  * receipt_summary rebuilt so it carries the new header columns.
-- =====================================================================

alter table public.receipts
  add column source       text not null default 'MANUAL' check (source in ('MANUAL', 'PLAN')),
  add column plan_date    date,
  add column plan_file    text,
  add column shipment_no  text,
  add column sales_order  text,
  add column container_no text,
  add column seal_no      text,
  add column transporter  text,
  add column slot_time    text;
create index receipts_plan_date_idx on public.receipts (plan_date) where plan_date is not null;

alter table public.receipt_actuals alter column expiry_date drop not null;

create or replace view public.inbound_reserved_bins with (security_invoker = true) as
select a.receipt_id, r.doc_no, a.to_bin_id as bin_id, b.bin_code, a.item_id
from public.receipt_actuals a
join public.receipts r on r.id = a.receipt_id
join public.bins b on b.id = a.to_bin_id
where r.status in ('OPEN', 'CHECKED') and a.to_bin_id is not null and a.quantity > 0;
grant select on public.inbound_reserved_bins to authenticated;

-- p_docs: [{doc_no, shipment_no, sales_order, container_no, seal_no, transporter, slot_time, lines: [{sku, quantity}]}]
create or replace function public.create_receipts_from_plan(p_plan_date date, p_file text, p_docs jsonb, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name); d jsonb; l jsonb; v_doc text; v_id uuid; v_item uuid; n int;
  v_bad text; v_created int := 0; v_skipped jsonb := '[]'::jsonb;
begin
  if not public.has_job(array['admin_inbound','leader','admin']) then
    raise exception 'Hanya Admin Inbound, Leader atau Admin yang bisa upload rencana inbound';
  end if;
  if jsonb_typeof(p_docs) <> 'array' or jsonb_array_length(p_docs) = 0 then raise exception 'File rencana tidak berisi DO'; end if;
  for d in select * from jsonb_array_elements(p_docs) loop
    v_doc := upper(trim(coalesce(d->>'doc_no', '')));
    if v_doc = '' then v_skipped := v_skipped || jsonb_build_object('doc_no', '', 'why', 'nomor DO kosong'); continue; end if;
    if exists (select 1 from public.receipts where doc_no = v_doc) then
      v_skipped := v_skipped || jsonb_build_object('doc_no', v_doc, 'why', 'sudah ada di Penerimaan'); continue;
    end if;
    select string_agg(distinct trim(x->>'sku'), ', ') into v_bad from jsonb_array_elements(d->'lines') x
    where not exists (select 1 from public.items where sku = trim(x->>'sku'));
    if v_bad is not null then
      v_skipped := v_skipped || jsonb_build_object('doc_no', v_doc, 'why', 'SKU belum ada di Master item: ' || v_bad); continue;
    end if;
    insert into public.receipts (doc_no, doc_date, supplier, vehicle, note, created_by, created_by_name, source, plan_date, plan_file,
      shipment_no, sales_order, container_no, seal_no, transporter, slot_time)
    values (v_doc, p_plan_date, 'Shell', nullif(trim(d->>'container_no'), ''), null, auth.uid(), v_name, 'PLAN', p_plan_date, nullif(trim(p_file), ''),
      nullif(trim(d->>'shipment_no'), ''), nullif(trim(d->>'sales_order'), ''), nullif(trim(d->>'container_no'), ''),
      nullif(trim(d->>'seal_no'), ''), nullif(trim(d->>'transporter'), ''), nullif(trim(d->>'slot_time'), ''))
    returning id into v_id;
    n := 0;
    for l in select * from jsonb_array_elements(d->'lines') loop
      n := n + 1;
      select id into v_item from public.items where sku = trim(l->>'sku');
      if coalesce((l->>'quantity')::numeric, 0) <= 0 then raise exception 'DO % baris %: qty harus lebih dari 0', v_doc, n; end if;
      insert into public.receipt_expected (receipt_id, line_no, item_id, batch_lot, quantity)
      values (v_id, n, v_item, '', (l->>'quantity')::numeric);
    end loop;
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

-- p_lines: [{sku, quantity, damaged_qty?, batch_lot?, expiry_date?, to_bin_code}] one per pallet. Replaces the previous check.
create or replace function public.record_receipt_check(p_receipt_id uuid, p_lines jsonb, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama pemeriksa'); rc public.receipts%rowtype; r jsonb; n int := 0;
  v_item uuid; v_batch text; v_exp date; v_bin public.bins%rowtype; v_qty numeric; v_dmg numeric; v_other text;
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
    insert into public.receipt_actuals (receipt_id, line_no, item_id, batch_lot, expiry_date, expiry_confirmed, quantity, damaged_qty, to_bin_id)
    values (p_receipt_id, n, v_item, v_batch, v_exp, true, v_qty, v_dmg, v_bin.id);
  end loop;
  update public.receipts set status = 'CHECKED', checked_by_name = v_name, checked_at = now() where id = p_receipt_id;
  return jsonb_build_object('pallets', n);
end $$;

-- post_receipt (0020) + a pallet without an expiry date is refused (FEFO: stock cannot enter a bin without one).
create or replace function public.post_receipt(p_receipt_id uuid, p_note text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama yang memposting'); rc public.receipts%rowtype; a record;
  v_quar uuid; n_in int := 0; n_dmg int := 0; v_note text; v_issues int; v_missing int;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa memposting penerimaan';
  end if;
  select * into rc from public.receipts where id = p_receipt_id for update;
  if rc.id is null then raise exception 'Penerimaan tidak ada'; end if;
  if rc.status <> 'CHECKED' then raise exception 'Penerimaan % belum diperiksa atau sudah %', rc.doc_no, lower(rc.status); end if;
  if public.same_person(v_name, rc.checked_by_name) then
    raise exception 'Yang memposting harus orang lain dari pemeriksa (%)', rc.checked_by_name;
  end if;
  select min(line_no) into v_missing from public.receipt_actuals where receipt_id = p_receipt_id and expiry_date is null;
  if v_missing is not null then
    raise exception 'Palet %: tanggal expired belum diisi. Isi batch dan expired di pemeriksaan sebelum posting.', v_missing;
  end if;
  select count(*) into v_issues from public.receipt_compare where receipt_id = p_receipt_id and result <> 'OK';
  if v_issues > 0 and nullif(trim(p_note), '') is null then
    raise exception 'Ada % selisih dengan dokumen: tulis keterangan (mis. sudah dilaporkan ke Shell)', v_issues;
  end if;
  select id into v_quar from public.bins where zone = 'QUARANTINE' order by bin_code limit 1;

  v_note := 'TERIMA ' || rc.doc_no;
  for a in select * from public.receipt_actuals where receipt_id = p_receipt_id order by line_no loop
    if a.quantity > 0 then
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note, by_name, approved_by_name, ref_id)
      values ('inbound', a.item_id, a.batch_lot, a.quantity, a.to_bin_id, a.expiry_date, current_date,
              v_note || ' palet ' || a.line_no, rc.checked_by_name, v_name, p_receipt_id);
      n_in := n_in + 1;
    end if;
    if a.damaged_qty > 0 then
      if v_quar is null then raise exception 'Tidak ada bin karantina untuk karton rusak'; end if;
      insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note, by_name, approved_by_name, ref_id)
      values ('inbound', a.item_id, a.batch_lot, a.damaged_qty, v_quar, a.expiry_date, current_date,
              v_note || ' palet ' || a.line_no || ' (rusak)', rc.checked_by_name, v_name, p_receipt_id);
      insert into public.stock_holds (scope, bin_id, item_id, batch_lot, expiry_date, quantity, reason_code, note, source, ref_id, created_by, created_by_name)
      values ('LINE', v_quar, a.item_id, a.batch_lot, a.expiry_date, a.damaged_qty, 'DAMAGED',
              'Rusak saat penerimaan ' || rc.doc_no, 'RECEIPT', p_receipt_id, auth.uid(), v_name);
      n_dmg := n_dmg + 1;
    end if;
  end loop;
  update public.receipts set status = 'POSTED', posted_by_name = v_name, posted_at = now(), post_note = nullif(trim(p_note), '')
  where id = p_receipt_id;
  return jsonb_build_object('inbound', n_in, 'damaged', n_dmg, 'issues', v_issues);
end $$;

-- receipt_summary (0020) was created with r.* before these columns existed: rebuilt so the plan header shows.
drop view public.receipt_summary;
create view public.receipt_summary with (security_invoker = true) as
select r.*,
       (select coalesce(sum(quantity), 0) from public.receipt_expected e where e.receipt_id = r.id) as expected_qty,
       (select coalesce(sum(quantity), 0) from public.receipt_actuals a where a.receipt_id = r.id) as good_qty,
       (select coalesce(sum(damaged_qty), 0) from public.receipt_actuals a where a.receipt_id = r.id) as damaged_qty,
       (select count(*) from public.receipt_actuals a where a.receipt_id = r.id) as pallets,
       (select count(*) from public.receipt_compare c where c.receipt_id = r.id and c.result <> 'OK') as issues
from public.receipts r;
grant select on public.receipt_summary to authenticated;

revoke execute on function public.create_receipts_from_plan(date, text, jsonb, text), public.record_receipt_check(uuid, jsonb, text) from public, anon;
grant execute on function public.create_receipts_from_plan(date, text, jsonb, text), public.record_receipt_check(uuid, jsonb, text) to authenticated;
