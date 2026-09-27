-- =====================================================================
-- 0020  Receiving against the delivery document (Penerimaan)
--
--  OPEN      the receipt: Shell's delivery document number and the lines
--            it says are on the truck (SKU, batch if printed, quantity).
--  CHECKED   the checker at the dock recorded what is physically there,
--            per pallet: SKU, batch, expiry (checked against the batch
--            code), good qty, damaged qty and the bin it goes to. The
--            checker does not need the document quantities (blind).
--            May be re-recorded until posted.
--  POSTED    a supervisor who is not the checker posts it: good cartons
--            become inbound movements into their bins, damaged cartons go
--            to QUARANTINE with a DAMAGED hold. The comparison with the
--            document is kept (receipt_compare) as the discrepancy report.
--  CANCELLED nothing was posted.
-- =====================================================================

create table public.receipts (
  id               uuid primary key default gen_random_uuid(),
  doc_no           text not null unique,
  doc_date         date,
  supplier         text not null default 'Shell',
  vehicle          text,
  note             text,
  status           text not null default 'OPEN' check (status in ('OPEN', 'CHECKED', 'POSTED', 'CANCELLED')),
  created_by       uuid references public.profiles(id),
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  checked_by_name  text,
  checked_at       timestamptz,
  posted_by_name   text,
  posted_at        timestamptz,
  post_note        text,
  cancelled_by_name text,
  cancelled_at     timestamptz,
  cancel_note      text
);
create index receipts_status_idx on public.receipts (status, created_at desc);

create table public.receipt_expected (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.receipts(id) on delete cascade,
  line_no     int not null,
  item_id     uuid not null references public.items(id),
  batch_lot   text not null default '',   -- '' = the document names no batch
  quantity    numeric not null check (quantity > 0)
);
create index receipt_expected_receipt_idx on public.receipt_expected (receipt_id);

create table public.receipt_actuals (
  id               uuid primary key default gen_random_uuid(),
  receipt_id       uuid not null references public.receipts(id) on delete cascade,
  line_no          int not null,
  item_id          uuid not null references public.items(id),
  batch_lot        text not null default '',
  expiry_date      date not null,
  expiry_confirmed boolean not null default false,  -- expiry differs from the batch code and the label was re-checked
  quantity         numeric not null check (quantity >= 0),
  damaged_qty      numeric not null default 0 check (damaged_qty >= 0),
  to_bin_id        uuid references public.bins(id),
  constraint receipt_actual_qty check (quantity + damaged_qty > 0),
  constraint receipt_actual_bin check (quantity = 0 or to_bin_id is not null)
);
create index receipt_actuals_receipt_idx on public.receipt_actuals (receipt_id);

alter table public.receipts enable row level security;
alter table public.receipt_expected enable row level security;
alter table public.receipt_actuals enable row level security;
create policy "receipts: read" on public.receipts for select to authenticated using (true);
create policy "receipt_expected: read" on public.receipt_expected for select to authenticated using (true);
create policy "receipt_actuals: read" on public.receipt_actuals for select to authenticated using (true);

-- p_lines: [{sku, batch_lot?, quantity}] as printed on the delivery document.
create or replace function public.create_receipt(p_doc_no text, p_doc_date date, p_vehicle text, p_note text, p_lines jsonb, p_by_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name); v_id uuid; r jsonb; v_item uuid; n int := 0;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa membuat penerimaan';
  end if;
  if nullif(trim(p_doc_no), '') is null then raise exception 'Nomor dokumen (DO / surat jalan) wajib diisi'; end if;
  if exists (select 1 from public.receipts where doc_no = upper(trim(p_doc_no))) then
    raise exception 'Dokumen % sudah pernah dibuat', upper(trim(p_doc_no));
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Isi minimal satu baris dokumen'; end if;
  insert into public.receipts (doc_no, doc_date, vehicle, note, created_by, created_by_name)
  values (upper(trim(p_doc_no)), p_doc_date, nullif(trim(p_vehicle), ''), nullif(trim(p_note), ''), auth.uid(), v_name)
  returning id into v_id;
  for r in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select id into v_item from public.items where sku = trim(r->>'sku');
    if v_item is null then raise exception 'Baris %: SKU % tidak ada di master item', n, r->>'sku'; end if;
    if (r->>'quantity') is null or (r->>'quantity')::numeric <= 0 then raise exception 'Baris %: qty harus lebih dari 0', n; end if;
    insert into public.receipt_expected (receipt_id, line_no, item_id, batch_lot, quantity)
    values (v_id, n, v_item, upper(trim(coalesce(r->>'batch_lot', ''))), (r->>'quantity')::numeric);
  end loop;
  return v_id;
end $$;

-- p_lines: [{sku, batch_lot, expiry_date, quantity, damaged_qty, to_bin_code, expiry_confirmed}]
-- Replaces anything recorded before (a re-check of the whole truck).
create or replace function public.record_receipt(p_receipt_id uuid, p_lines jsonb, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama pemeriksa'); rc public.receipts%rowtype; r jsonb; n int := 0;
  v_item uuid; v_batch text; v_exp date; v_expected date; v_bin public.bins%rowtype; v_qty numeric; v_dmg numeric;
begin
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
    if v_batch = '' then raise exception 'Palet %: batch wajib diisi (lihat label karton)', n; end if;
    v_exp := nullif(r->>'expiry_date', '')::date;
    if v_exp is null then raise exception 'Palet %: tanggal expired wajib diisi', n; end if;
    v_expected := public.batch_expected_expiry(v_item, v_batch);
    if v_expected is not null and v_expected <> v_exp and not coalesce((r->>'expiry_confirmed')::boolean, false) then
      raise exception 'Palet %: expired % tidak cocok dengan batch % (seharusnya %). Periksa label; centang konfirmasi bila label memang begitu.',
        n, to_char(v_exp, 'DD-MM-YYYY'), v_batch, to_char(v_expected, 'DD-MM-YYYY');
    end if;
    if v_exp <= current_date then raise exception 'Palet %: stok sudah expired (%) — jangan diterima sebagai stok baik', n, to_char(v_exp, 'DD-MM-YYYY'); end if;
    v_qty := coalesce((r->>'quantity')::numeric, 0);
    v_dmg := coalesce((r->>'damaged_qty')::numeric, 0);
    if v_qty < 0 or v_dmg < 0 or v_qty + v_dmg = 0 then raise exception 'Palet %: qty baik + rusak harus lebih dari 0', n; end if;
    v_bin := null;
    if v_qty > 0 then
      select * into v_bin from public.bins where bin_code = upper(trim(coalesce(r->>'to_bin_code', '')));
      if v_bin.id is null then raise exception 'Palet %: bin tujuan % tidak ada', n, coalesce(r->>'to_bin_code', '–'); end if;
      if v_bin.zone = 'QUARANTINE' then raise exception 'Palet %: stok baik tidak ke karantina (isi qty rusak untuk karton rusak)', n; end if;
      if v_bin.status = 'blocked' then raise exception 'Palet %: bin % diblokir', n, v_bin.bin_code; end if;
    end if;
    insert into public.receipt_actuals (receipt_id, line_no, item_id, batch_lot, expiry_date, expiry_confirmed, quantity, damaged_qty, to_bin_id)
    values (p_receipt_id, n, v_item, v_batch, v_exp, coalesce((r->>'expiry_confirmed')::boolean, false), v_qty, v_dmg, v_bin.id);
  end loop;
  update public.receipts set status = 'CHECKED', checked_by_name = v_name, checked_at = now() where id = p_receipt_id;
  return jsonb_build_object('pallets', n);
end $$;

-- Document vs dock, per SKU + batch. A document line without a batch
-- matches all received batches of its SKU that no batch-specific line claims.
create or replace view public.receipt_compare with (security_invoker = true) as
with exp as (
  select e.receipt_id, e.item_id, e.batch_lot, sum(e.quantity) as expected
  from public.receipt_expected e group by 1, 2, 3
), act as (
  select a.receipt_id, a.item_id, a.batch_lot, sum(a.quantity) as good, sum(a.damaged_qty) as damaged
  from public.receipt_actuals a group by 1, 2, 3
), act_matched as (
  -- received batches whose SKU is on the document without a batch roll up to batch ''
  select a.receipt_id, a.item_id,
         case when exists (select 1 from exp x where x.receipt_id = a.receipt_id and x.item_id = a.item_id and x.batch_lot = a.batch_lot)
                then a.batch_lot
              when exists (select 1 from exp x where x.receipt_id = a.receipt_id and x.item_id = a.item_id and x.batch_lot = '')
                then ''
              else a.batch_lot end as batch_lot,
         a.batch_lot as received_batch, a.good, a.damaged
  from act a
), joined as (
  select coalesce(x.receipt_id, m.receipt_id) as receipt_id, coalesce(x.item_id, m.item_id) as item_id,
         coalesce(x.batch_lot, m.batch_lot) as batch_lot,
         coalesce(max(x.expected), 0) as expected, coalesce(sum(m.good), 0) as good, coalesce(sum(m.damaged), 0) as damaged,
         string_agg(distinct nullif(m.received_batch, ''), ', ') as received_batches
  from exp x
  full join act_matched m on m.receipt_id = x.receipt_id and m.item_id = x.item_id and m.batch_lot = x.batch_lot
  group by 1, 2, 3
)
select j.receipt_id, it.sku, it.description, it.uom, j.batch_lot, j.received_batches, j.expected, j.good, j.damaged,
       j.good + j.damaged - j.expected as diff,
       case when j.expected = 0 then 'NOT_ON_DOC'
            when j.good + j.damaged = 0 then 'MISSING'
            when j.good + j.damaged < j.expected then 'SHORT'
            when j.good + j.damaged > j.expected then 'OVER'
            when j.damaged > 0 then 'DAMAGED'
            else 'OK' end as result
from joined j join public.items it on it.id = j.item_id;

create or replace function public.post_receipt(p_receipt_id uuid, p_note text, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.person_name(p_by_name, 'Nama yang memposting'); rc public.receipts%rowtype; a record;
  v_quar uuid; n_in int := 0; n_dmg int := 0; v_note text; v_issues int;
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

create or replace function public.cancel_receipt(p_receipt_id uuid, p_note text, p_by_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name);
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa membatalkan penerimaan';
  end if;
  if nullif(trim(p_note), '') is null then raise exception 'Alasan pembatalan wajib diisi'; end if;
  update public.receipts set status = 'CANCELLED', cancelled_by_name = v_name, cancelled_at = now(), cancel_note = trim(p_note)
  where id = p_receipt_id and status in ('OPEN', 'CHECKED');
  if not found then raise exception 'Penerimaan tidak ada atau sudah diposting / dibatalkan'; end if;
end $$;

create or replace view public.receipt_summary with (security_invoker = true) as
select r.*,
       (select coalesce(sum(quantity), 0) from public.receipt_expected e where e.receipt_id = r.id) as expected_qty,
       (select coalesce(sum(quantity), 0) from public.receipt_actuals a where a.receipt_id = r.id) as good_qty,
       (select coalesce(sum(damaged_qty), 0) from public.receipt_actuals a where a.receipt_id = r.id) as damaged_qty,
       (select count(*) from public.receipt_actuals a where a.receipt_id = r.id) as pallets,
       (select count(*) from public.receipt_compare c where c.receipt_id = r.id and c.result <> 'OK') as issues
from public.receipts r;

grant select on public.receipts, public.receipt_expected, public.receipt_actuals, public.receipt_compare, public.receipt_summary to authenticated;
grant all on public.receipts, public.receipt_expected, public.receipt_actuals to service_role;
revoke execute on function public.create_receipt(text, date, text, text, jsonb, text), public.record_receipt(uuid, jsonb, text),
  public.post_receipt(uuid, text, text), public.cancel_receipt(uuid, text, text) from public, anon;
grant execute on function public.create_receipt(text, date, text, text, jsonb, text), public.record_receipt(uuid, jsonb, text),
  public.post_receipt(uuid, text, text), public.cancel_receipt(uuid, text, text) to authenticated;
