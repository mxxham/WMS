-- =====================================================================
-- 0161  CKB: the count profile of a customer (first customer: Exxon, EMCL)
--
-- Spec: docs/superpowers/specs/2026-11-25-ckb-emcl-stocktake-design.md
--
-- A customer may count differently from the default:
--   count_identity  'FULL'          the stock identity of today (material, plant, sloc, bin, batch, expiry, unit, stock type)
--                   'MATERIAL_BIN'  the same without batch and expiry: SAP lines that differ only by batch are one count
--                                   task, and the batch codes are information (0162)
--   photo_scope     'TASK'          photos per count line, as today
--                   'BIN'           one photo per bin, then per line only for 0, found stock and recounts (0163)
--   sap_mapping     null            the global ckb_settings 'sap_import' mapping
--                   {verified, columns}  the customer's own column titles (the same shape), recorded on each snapshot
-- Existing customers keep the defaults, so nothing changes for them.
-- =====================================================================

alter table public.ckb_customers
  add column count_identity text not null default 'FULL' check (count_identity in ('FULL', 'MATERIAL_BIN')),
  add column photo_scope text not null default 'TASK' check (photo_scope in ('TASK', 'BIN')),
  add column sap_mapping jsonb check (sap_mapping is null or jsonb_typeof(sap_mapping) = 'object');

-- The mapping that applies to a customer's file: its own, else the global one.
create or replace function public.ckb_sap_mapping_for(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  return coalesce((select sap_mapping from public.ckb_customers where id = p_customer),
                  (select value from public.ckb_settings where key = 'sap_import'));
end $$;

-- Admin sets a customer's count profile. The mapping is checked like the global one (ckb_save_setting).
create or replace function public.ckb_set_customer_count_profile(p_customer uuid, p_identity text, p_photo_scope text, p_mapping jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB'; end if;
  if p_identity not in ('FULL', 'MATERIAL_BIN') then raise exception 'Identitas hitung tidak dikenal'; end if;
  if p_photo_scope not in ('TASK', 'BIN') then raise exception 'Cakupan foto tidak dikenal'; end if;
  -- a missing key is invalid too: jsonb_typeof(NULL) is NULL, which a plain <> would let through
  if p_mapping is not null and (coalesce(jsonb_typeof(p_mapping), '') <> 'object'
      or coalesce(jsonb_typeof(p_mapping->'columns'), '') <> 'object' or coalesce(jsonb_typeof(p_mapping->'verified'), '') <> 'boolean'
      or coalesce(jsonb_typeof(p_mapping->'columns'->'material_code'), '') <> 'array'
      or coalesce(jsonb_typeof(p_mapping->'columns'->'quantity'), '') <> 'array'
      or coalesce(jsonb_typeof(p_mapping->'columns'->'uom'), '') <> 'array') then
    raise exception 'Pemetaan SAP butuh kolom material_code, quantity dan uom';
  end if;
  select jsonb_build_object('count_identity', count_identity, 'photo_scope', photo_scope, 'sap_mapping', sap_mapping)
    into v_before from public.ckb_customers where id = p_customer for update;
  if v_before is null then raise exception 'Pelanggan tidak ditemukan'; end if;
  update public.ckb_customers set count_identity = p_identity, photo_scope = p_photo_scope, sap_mapping = p_mapping where id = p_customer;
  perform public.ckb_audit('CUSTOMER_COUNT_PROFILE', 'customer', p_customer::text, p_customer,
    jsonb_build_object('before', v_before, 'after', jsonb_build_object('count_identity', p_identity, 'photo_scope', p_photo_scope, 'sap_mapping', p_mapping)));
end $$;

-- The import reads the customer's mapping (everything else in it is 0100's, unchanged).
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

  -- the customer's own mapping when it has one, else the global one (0161)
  v_mapping := public.ckb_sap_mapping_for(p_customer);

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

-- ---------------------------------------------------------------------
-- Exxon (EMCL): the first real CKB file (Stock in Bin as of 13 Nov 26) names its columns with SAP's short titles.
-- verified stays false: an admin marks it verified on the Customer page after reading a real import (never in code).
-- ---------------------------------------------------------------------
insert into public.ckb_customers (code, name, count_identity, photo_scope, sap_mapping, notes)
values ('EMCL', 'Exxon (EMCL)', 'MATERIAL_BIN', 'BIN', jsonb_build_object('verified', false, 'columns', jsonb_build_object(
  'material_code', jsonb_build_array('material', 'material number', 'sku code', 'sku', 'item code'),
  'description', jsonb_build_array('material description', 'description'),
  'plant', jsonb_build_array('plant', 'id1'),
  'storage_location', jsonb_build_array('storage location', 'sloc'),
  'storage_bin', jsonb_build_array('storage bin', 'bin', 'storage bi'),
  'batch', jsonb_build_array('batch'),
  'expiry_date', jsonb_build_array('sled/bbd', 'expiry date', 'expiration date'),
  'uom', jsonb_build_array('base unit of measure', 'bun', 'uom'),
  'quantity', jsonb_build_array('total stock', 'total stoc', 'unrestricted', 'unrestricted use'),
  'stock_type', jsonb_build_array('stock type', 'stock category', 'mtyp'))),
  'Hitung per material dan bin; kode batch hanya informasi. ID1 dibaca sebagai plant dan MTyp sebagai tipe stok: konfirmasi dengan file SAP asli.')
on conflict (code) do nothing;

revoke execute on function public.ckb_sap_mapping_for(uuid), public.ckb_set_customer_count_profile(uuid, text, text, jsonb) from public, anon;
grant execute on function public.ckb_sap_mapping_for(uuid), public.ckb_set_customer_count_profile(uuid, text, text, jsonb) to authenticated;
