-- =====================================================================
-- 0100  CKB 3PL SAP stock snapshots
--
-- One upload = one immutable, dated snapshot of one customer's SAP stock.
-- Nothing ever overwrites an earlier snapshot: rows are insert-only (the
-- triggers refuse UPDATE/DELETE for every role), and "which snapshot is
-- current" is a separate pointer on ckb_customers.active_snapshot_id that
-- a supervisor moves explicitly. A stock take stores the snapshot it was
-- generated from (0101), so changing the pointer never changes a running
-- count's baseline.
--
-- Stock identity = material + plant + storage location + storage bin +
-- batch + expiry + unit + stock type (ckb_identity_key). Two rows that
-- differ in any of these stay two rows. Two rows with the SAME identity in
-- one file are kept as uploaded and counted (ckb_sap_import_summary);
-- the stock take marks them AMBIGUOUS instead of silently adding them up.
--
-- Duplicate files: unique (customer, sha256). The server computes the hash
-- from the uploaded bytes (app/api/ckb/sap/import).
--
-- The column mapping used is copied into the import row together with the
-- "verified" flag of the mapping at that moment: a snapshot taken under an
-- unverified mapping says so forever.
-- =====================================================================

create sequence public.ckb_sap_import_seq;

create table public.ckb_sap_imports (
  id                        uuid primary key default gen_random_uuid(),
  ref_no                    text not null unique default ('SAP' || lpad(nextval('public.ckb_sap_import_seq')::text, 6, '0')),
  customer_id               uuid not null references public.ckb_customers(id),
  snapshot_date             date not null,
  file_name                 text not null,
  file_sha256               text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size                 bigint not null check (file_size > 0),
  sheet_name                text,
  header_line               int,
  mapping                   jsonb not null,
  mapping_verified          boolean not null,
  row_count                 int not null check (row_count > 0),
  rejected_count            int not null default 0,
  errors                    jsonb not null default '[]'::jsonb,   -- [{line, message}] (first 500)
  note                      text,
  imported_by               uuid not null references public.profiles(id),
  imported_by_name          text not null,
  imported_at               timestamptz not null default now(),
  unique (customer_id, file_sha256)
);
create index ckb_sap_imports_customer_idx on public.ckb_sap_imports (customer_id, snapshot_date desc);

create table public.ckb_sap_snapshot_rows (
  id                bigint generated always as identity primary key,
  import_id         uuid not null references public.ckb_sap_imports(id),
  line_no           int not null,
  material_code     text not null check (material_code <> ''),
  description       text not null default '',
  plant             text not null default '',
  storage_location  text not null default '',
  storage_bin       text not null default '',
  batch             text not null default '',
  expiry_date       date,
  uom               text not null check (uom <> ''),
  quantity          numeric not null check (quantity >= 0),
  stock_type        text not null default '',
  identity_key      text not null
);
create index ckb_sap_snapshot_rows_import_idx on public.ckb_sap_snapshot_rows (import_id, identity_key);
create index ckb_sap_snapshot_rows_material_idx on public.ckb_sap_snapshot_rows (import_id, material_code);
create index ckb_sap_snapshot_rows_bin_idx on public.ckb_sap_snapshot_rows (import_id, storage_bin);

alter table public.ckb_customers
  add constraint ckb_customers_active_snapshot_fk foreign key (active_snapshot_id) references public.ckb_sap_imports(id);

create trigger ckb_sap_imports_immutable before update or delete on public.ckb_sap_imports
  for each row execute function public.ckb_forbid_change();
create trigger ckb_sap_snapshot_rows_immutable before update or delete on public.ckb_sap_snapshot_rows
  for each row execute function public.ckb_forbid_change();

-- The one place a stock identity is spelled. Used by snapshots and found items alike.
create or replace function public.ckb_identity_key(p_material text, p_plant text, p_sloc text, p_bin text,
  p_batch text, p_expiry date, p_uom text, p_stock_type text) returns text
language sql immutable as $$
  select concat_ws('|', upper(trim(coalesce(p_material, ''))), upper(trim(coalesce(p_plant, ''))),
    upper(trim(coalesce(p_sloc, ''))), upper(trim(coalesce(p_bin, ''))), upper(trim(coalesce(p_batch, ''))),
    coalesce(p_expiry::text, ''), upper(trim(coalesce(p_uom, ''))), upper(trim(coalesce(p_stock_type, ''))))
$$;

alter table public.ckb_sap_imports       enable row level security;
alter table public.ckb_sap_snapshot_rows enable row level security;

-- Snapshots are internal working data: staff only (customer representatives see results, not raw SAP).
create policy "ckb: staff read imports" on public.ckb_sap_imports
  for select to authenticated using ((select public.account_active()) and public.ckb_is_staff());
create policy "ckb: staff read snapshot rows" on public.ckb_sap_snapshot_rows
  for select to authenticated using ((select public.account_active()) and public.ckb_is_staff());

grant select on public.ckb_sap_imports, public.ckb_sap_snapshot_rows to authenticated;
grant all on public.ckb_sap_imports, public.ckb_sap_snapshot_rows to service_role;
grant usage on public.ckb_sap_import_seq to service_role;

-- ---------------------------------------------------------------------
-- Import: the server parses the file and sends the rows; every row is
-- validated again here, and the whole snapshot is written in one statement
-- or not at all.
--   p_file   {name, sha256, size, sheet, header_line}
--   p_rows   [{line, material_code, description, plant, storage_location, storage_bin,
--              batch, expiry_date "YYYY-MM-DD"|null, uom, quantity, stock_type}]
--   p_errors [{line, message}] rows the parser already rejected (kept for the report)
-- ---------------------------------------------------------------------
create or replace function public.ckb_import_sap_snapshot(p_customer uuid, p_snapshot_date date, p_file jsonb,
  p_rows jsonb, p_errors jsonb, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_mapping jsonb;
  v_existing text;
  v_count int;
  v_bad record;
  v_errors jsonb := coalesce(p_errors, '[]'::jsonb);
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya supervisor atau admin CKB yang bisa mengimpor snapshot SAP';
  end if;
  if not exists (select 1 from public.ckb_customers where id = p_customer and active) then
    raise exception 'Customer tidak ditemukan atau tidak aktif';
  end if;
  if p_snapshot_date is null then raise exception 'Tanggal snapshot wajib diisi'; end if;
  if p_snapshot_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal snapshot tidak boleh di masa depan';
  end if;
  if coalesce(p_file->>'sha256', '') !~ '^[0-9a-f]{64}$' then raise exception 'Checksum file tidak valid'; end if;
  if coalesce(trim(p_file->>'name'), '') = '' then raise exception 'Nama file wajib ada'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'File tidak berisi baris stok yang valid';
  end if;
  if jsonb_array_length(p_rows) > 50000 then raise exception 'Maksimal 50.000 baris per snapshot'; end if;

  select ref_no into v_existing from public.ckb_sap_imports
    where customer_id = p_customer and file_sha256 = p_file->>'sha256';
  if v_existing is not null then
    raise exception 'File ini sudah pernah diimpor untuk customer ini sebagai %', v_existing;
  end if;

  -- Re-validate every row: required fields present, quantity a real non-negative number,
  -- expiry a date. An empty quantity is an error, never zero.
  select r.ord, r.v into v_bad
  from jsonb_array_elements(p_rows) with ordinality as r(v, ord)
  where coalesce(trim(r.v->>'material_code'), '') = ''
     or coalesce(trim(r.v->>'uom'), '') = ''
     or coalesce(jsonb_typeof(r.v->'quantity'), 'missing') <> 'number'
     or (r.v->>'quantity')::numeric < 0
     or (r.v ? 'expiry_date' and jsonb_typeof(r.v->'expiry_date') not in ('null', 'string'))
     or (jsonb_typeof(r.v->'expiry_date') = 'string' and (r.v->>'expiry_date') !~ '^\d{4}-\d{2}-\d{2}$')
  limit 1;
  if v_bad.ord is not null then
    raise exception 'Baris % tidak valid (material, satuan dan qty angka >= 0 wajib)', coalesce(v_bad.v->>'line', v_bad.ord::text);
  end if;

  select value into v_mapping from public.ckb_settings where key = 'sap_import';

  insert into public.ckb_sap_imports (customer_id, snapshot_date, file_name, file_sha256, file_size, sheet_name, header_line,
    mapping, mapping_verified, row_count, rejected_count, errors, note, imported_by, imported_by_name)
  values (p_customer, p_snapshot_date, trim(p_file->>'name'), p_file->>'sha256', coalesce((p_file->>'size')::bigint, 1),
    nullif(p_file->>'sheet', ''), nullif(p_file->>'header_line', '')::int,
    v_mapping->'columns', coalesce((v_mapping->>'verified')::boolean, false),
    jsonb_array_length(p_rows),
    case when jsonb_typeof(v_errors) = 'array' then jsonb_array_length(v_errors) else 0 end,
    case when jsonb_typeof(v_errors) = 'array'
         then coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_errors) e limit 500) x), '[]'::jsonb)
         else '[]'::jsonb end,
    nullif(trim(p_note), ''), auth.uid(), public.ckb_actor_name())
  returning id into v_id;

  insert into public.ckb_sap_snapshot_rows (import_id, line_no, material_code, description, plant, storage_location,
    storage_bin, batch, expiry_date, uom, quantity, stock_type, identity_key)
  select v_id,
    coalesce((r.v->>'line')::int, r.ord::int),
    trim(r.v->>'material_code'),
    coalesce(trim(r.v->>'description'), ''),
    coalesce(trim(r.v->>'plant'), ''),
    coalesce(trim(r.v->>'storage_location'), ''),
    upper(coalesce(trim(r.v->>'storage_bin'), '')),
    coalesce(trim(r.v->>'batch'), ''),
    nullif(r.v->>'expiry_date', '')::date,
    upper(trim(r.v->>'uom')),
    (r.v->>'quantity')::numeric,
    coalesce(trim(r.v->>'stock_type'), ''),
    public.ckb_identity_key(r.v->>'material_code', r.v->>'plant', r.v->>'storage_location', r.v->>'storage_bin',
      r.v->>'batch', nullif(r.v->>'expiry_date', '')::date, r.v->>'uom', r.v->>'stock_type')
  from jsonb_array_elements(p_rows) with ordinality as r(v, ord);

  get diagnostics v_count = row_count;
  perform public.ckb_audit('SAP_IMPORT', 'sap_import', v_id::text, p_customer, jsonb_build_object(
    'file', p_file->>'name', 'sha256', p_file->>'sha256', 'rows', v_count,
    'rejected', case when jsonb_typeof(v_errors) = 'array' then jsonb_array_length(v_errors) else 0 end,
    'snapshot_date', p_snapshot_date, 'mapping_verified', coalesce((v_mapping->>'verified')::boolean, false)));
  return v_id;
end $$;

-- Totals and duplicate identities come from the rows (the header is written before them and is
-- immutable afterwards).
create or replace view public.ckb_sap_import_summary with (security_invoker = true) as
select i.id, i.ref_no, i.customer_id, c.code as customer_code, c.name as customer_name, i.snapshot_date,
  i.file_name, i.file_sha256, i.file_size, i.sheet_name, i.header_line, i.mapping_verified,
  i.row_count, i.rejected_count, i.note, i.imported_by_name, i.imported_at,
  (select coalesce(sum(r.quantity), 0) from public.ckb_sap_snapshot_rows r where r.import_id = i.id) as total_qty,
  (select count(*) from (select r.identity_key from public.ckb_sap_snapshot_rows r where r.import_id = i.id
     group by r.identity_key having count(*) > 1) d) as duplicate_identity_count,
  (c.active_snapshot_id = i.id) as is_active
from public.ckb_sap_imports i
join public.ckb_customers c on c.id = i.customer_id;
grant select on public.ckb_sap_import_summary to authenticated;

-- Explicit activation: which snapshot new stock takes default to, and what Inventaris shows.
create or replace function public.ckb_activate_snapshot(p_import uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid;
  v_before uuid;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya supervisor atau admin CKB yang bisa mengaktifkan snapshot';
  end if;
  select customer_id into v_customer from public.ckb_sap_imports where id = p_import;
  if v_customer is null then raise exception 'Snapshot tidak ditemukan'; end if;
  select active_snapshot_id into v_before from public.ckb_customers where id = v_customer for update;
  if v_before = p_import then return; end if;
  update public.ckb_customers set active_snapshot_id = p_import, updated_at = now(), updated_by = auth.uid()
    where id = v_customer;
  perform public.ckb_audit('SNAPSHOT_ACTIVATE', 'sap_import', p_import::text, v_customer,
    jsonb_build_object('before', v_before, 'after', p_import));
end $$;

-- Identity-by-identity difference between two snapshots of the same customer.
create or replace function public.ckb_compare_snapshots(p_a uuid, p_b uuid)
returns table (identity_key text, material_code text, description text, storage_bin text, batch text,
  expiry_date date, uom text, qty_a numeric, qty_b numeric, delta numeric, change text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.ckb_is_staff() then raise exception 'Akses ditolak'; end if;
  if (select customer_id from public.ckb_sap_imports where id = p_a) is distinct from
     (select customer_id from public.ckb_sap_imports where id = p_b)
     or not exists (select 1 from public.ckb_sap_imports where id = p_a) then
    raise exception 'Kedua snapshot harus ada dan milik customer yang sama';
  end if;
  return query
  with a as (
    select r.identity_key k, min(r.material_code) m, min(r.description) d, min(r.storage_bin) b, min(r.batch) bt,
      min(r.expiry_date) e, min(r.uom) u, sum(r.quantity) q
    from public.ckb_sap_snapshot_rows r where r.import_id = p_a group by r.identity_key
  ), b as (
    select r.identity_key k, min(r.material_code) m, min(r.description) d, min(r.storage_bin) b, min(r.batch) bt,
      min(r.expiry_date) e, min(r.uom) u, sum(r.quantity) q
    from public.ckb_sap_snapshot_rows r where r.import_id = p_b group by r.identity_key
  )
  select coalesce(a.k, b.k), coalesce(a.m, b.m), coalesce(a.d, b.d), coalesce(a.b, b.b), coalesce(a.bt, b.bt),
    coalesce(a.e, b.e), coalesce(a.u, b.u), a.q, b.q, coalesce(b.q, 0) - coalesce(a.q, 0),
    case when a.k is null then 'ADDED' when b.k is null then 'REMOVED' when a.q <> b.q then 'CHANGED' else 'SAME' end
  from a full join b on a.k = b.k
  order by 11 desc, 2, 4;
end $$;

revoke execute on function public.ckb_import_sap_snapshot(uuid, date, jsonb, jsonb, jsonb, text),
  public.ckb_activate_snapshot(uuid), public.ckb_compare_snapshots(uuid, uuid) from public, anon;
grant execute on function public.ckb_import_sap_snapshot(uuid, date, jsonb, jsonb, jsonb, text),
  public.ckb_activate_snapshot(uuid), public.ckb_compare_snapshots(uuid, uuid) to authenticated;
