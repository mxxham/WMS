-- =====================================================================
-- 0102  CKB 3PL SAP export of approved adjustments
--
-- An export freezes a set of APPROVED adjustments of one customer into
-- numbered lines (the data is copied, so the file can be regenerated
-- byte-for-byte later) and moves them to EXPORTED in the same
-- transaction. An adjustment can sit in at most one live export.
--
-- Generating a file is not SAP posting. An export stays GENERATED until
-- someone records SAP's own document reference (ckb_confirm_sap_export).
-- If SAP refused the file, the export is VOIDED (admin, with reason) and
-- its adjustments return to APPROVED so they can be exported again.
--
-- Re-export: a new export of the same adjustments, kind REEXPORT, with a
-- mandatory reason and a link to the original. Every file download is
-- logged too, so any extra copy of a file is traceable.
--
-- The file layout is an internal CKB worksheet (format_version
-- CKB-INTERNAL-1), not a verified SAP upload format: format_verified is
-- copied from the sap_export setting at generation time.
-- =====================================================================

create sequence public.ckb_sap_export_seq;

create table public.ckb_sap_exports (
  id                  uuid primary key default gen_random_uuid(),
  ref_no              text not null unique default ('EXP' || lpad(nextval('public.ckb_sap_export_seq')::text, 6, '0')),
  customer_id         uuid not null references public.ckb_customers(id),
  kind                text not null check (kind in ('EXPORT', 'REEXPORT')),
  original_export_id  uuid references public.ckb_sap_exports(id),
  reason              text,
  status              text not null default 'GENERATED' check (status in ('GENERATED', 'SAP_CONFIRMED', 'VOIDED')),
  line_count          int not null check (line_count > 0),
  total_gain          numeric not null,
  total_loss          numeric not null,
  format_version      text not null,
  format_verified     boolean not null,
  created_by          uuid not null references public.profiles(id),
  created_by_name     text not null,
  created_at          timestamptz not null default now(),
  sap_document_ref    text,
  confirmed_by_name   text,
  confirmed_at        timestamptz,
  confirm_note        text,
  voided_by_name      text,
  voided_at           timestamptz,
  void_reason         text,
  download_count      int not null default 0,
  check (kind = 'EXPORT' or (original_export_id is not null and length(trim(coalesce(reason, ''))) >= 3))
);
create index ckb_sap_exports_customer_idx on public.ckb_sap_exports (customer_id, created_at desc);

create table public.ckb_sap_export_lines (
  export_id      uuid not null references public.ckb_sap_exports(id),
  line_no        int not null,
  adjustment_id  uuid not null references public.ckb_adjustments(id),
  data           jsonb not null,
  primary key (export_id, line_no),
  unique (export_id, adjustment_id)
);
create index ckb_sap_export_lines_adj_idx on public.ckb_sap_export_lines (adjustment_id);

create trigger ckb_sap_export_lines_immutable before update or delete on public.ckb_sap_export_lines
  for each row execute function public.ckb_forbid_change();

alter table public.ckb_adjustments
  add constraint ckb_adjustments_export_fk foreign key (export_id) references public.ckb_sap_exports(id);

alter table public.ckb_sap_exports      enable row level security;
alter table public.ckb_sap_export_lines enable row level security;

create policy "ckb: staff read exports" on public.ckb_sap_exports for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff());
create policy "ckb: staff read export lines" on public.ckb_sap_export_lines for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff());

grant select on public.ckb_sap_exports, public.ckb_sap_export_lines to authenticated;
grant all on public.ckb_sap_exports, public.ckb_sap_export_lines to service_role;
grant usage on public.ckb_sap_export_seq to service_role;

-- The frozen line: everything the file prints, so a later regeneration needs no live lookup.
create or replace function public.ckb_export_line_data(a public.ckb_adjustments) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'adjustment_ref', a.ref_no, 'stocktake_ref', (select ref_no from public.ckb_stocktakes where id = a.stocktake_id),
    'baseline_snapshot_ref', (select i.ref_no from public.ckb_stocktakes s join public.ckb_sap_imports i on i.id = s.baseline_import_id
                              where s.id = a.stocktake_id),
    'customer_code', (select code from public.ckb_customers where id = a.customer_id),
    'material_code', a.material_code, 'description', a.description, 'plant', a.plant,
    'storage_location', a.storage_location, 'storage_bin', a.storage_bin, 'batch', a.batch,
    'expiry_date', a.expiry_date, 'uom', a.uom, 'stock_type', a.stock_type,
    'baseline_qty', a.baseline_qty, 'counted_qty', a.accepted_qty, 'delta', a.delta,
    'direction', case when a.delta > 0 then 'GAIN' else 'LOSS' end,
    'classification', a.classification, 'approved_by', a.decided_by_name, 'approved_at', a.decided_at)
$$;
revoke execute on function public.ckb_export_line_data(public.ckb_adjustments) from public, anon, authenticated;

create or replace function public.ckb_create_sap_export(p_customer uuid, p_adjustments uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_setting jsonb;
  v_ids uuid[] := (select array_agg(distinct x order by x) from unnest(coalesce(p_adjustments, '{}')) x where x is not null);
  r_adj public.ckb_adjustments%rowtype;
  v_n int := 0;
  v_gain numeric := 0;
  v_loss numeric := 0;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya supervisor atau admin CKB yang bisa membuat ekspor SAP';
  end if;
  if cardinality(coalesce(v_ids, '{}')) = 0 then raise exception 'Tidak ada penyesuaian yang dipilih'; end if;
  if not exists (select 1 from public.ckb_customers where id = p_customer) then raise exception 'Customer tidak ditemukan'; end if;

  -- Lock and validate everything before writing anything.
  for r_adj in select * from public.ckb_adjustments where id = any(v_ids) order by id for update loop
    if r_adj.customer_id <> p_customer then raise exception '% milik customer lain', r_adj.ref_no; end if;
    if r_adj.status <> 'APPROVED' then raise exception '% tidak bisa diekspor (status %)', r_adj.ref_no, r_adj.status; end if;
    v_n := v_n + 1;
    if r_adj.delta > 0 then v_gain := v_gain + r_adj.delta; else v_loss := v_loss - r_adj.delta; end if;
  end loop;
  if v_n <> cardinality(v_ids) then raise exception 'Sebagian penyesuaian tidak ditemukan'; end if;

  select value into v_setting from public.ckb_settings where key = 'sap_export';
  insert into public.ckb_sap_exports (customer_id, kind, line_count, total_gain, total_loss, format_version, format_verified,
    created_by, created_by_name)
  values (p_customer, 'EXPORT', v_n, v_gain, v_loss, coalesce(v_setting->>'format_version', 'CKB-INTERNAL-1'),
    coalesce((v_setting->>'verified')::boolean, false), auth.uid(), public.ckb_actor_name())
  returning id into v_id;

  insert into public.ckb_sap_export_lines (export_id, line_no, adjustment_id, data)
  select v_id, row_number() over (order by a.storage_bin, a.material_code, a.batch, a.ref_no), a.id, public.ckb_export_line_data(a)
  from public.ckb_adjustments a where a.id = any(v_ids);

  update public.ckb_adjustments set status = 'EXPORTED', export_id = v_id, exported_at = now() where id = any(v_ids);
  perform public.ckb_audit('SAP_EXPORT', 'sap_export', v_id::text, p_customer, jsonb_build_object(
    'lines', v_n, 'gain', v_gain, 'loss', v_loss, 'adjustments', to_jsonb(v_ids)));
  return v_id;
end $$;

create or replace function public.ckb_reexport_sap(p_export uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e public.ckb_sap_exports%rowtype;
  v_id uuid;
  v_setting jsonb;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan ekspor ulang wajib diisi'; end if;
  select * into e from public.ckb_sap_exports where id = p_export for update;
  if e.id is null then raise exception 'Ekspor tidak ditemukan'; end if;
  if e.status = 'VOIDED' then raise exception '% sudah dibatalkan; buat ekspor baru dari penyesuaian yang disetujui', e.ref_no; end if;

  select value into v_setting from public.ckb_settings where key = 'sap_export';
  insert into public.ckb_sap_exports (customer_id, kind, original_export_id, reason, line_count, total_gain, total_loss,
    format_version, format_verified, created_by, created_by_name)
  values (e.customer_id, 'REEXPORT', coalesce(e.original_export_id, e.id), trim(p_reason), e.line_count, e.total_gain,
    e.total_loss, coalesce(v_setting->>'format_version', e.format_version), coalesce((v_setting->>'verified')::boolean, false),
    auth.uid(), public.ckb_actor_name())
  returning id into v_id;
  insert into public.ckb_sap_export_lines (export_id, line_no, adjustment_id, data)
    select v_id, line_no, adjustment_id, data from public.ckb_sap_export_lines where export_id = p_export;
  perform public.ckb_audit('SAP_REEXPORT', 'sap_export', v_id::text, e.customer_id, jsonb_build_object(
    'original', e.ref_no, 'reason', trim(p_reason), 'lines', e.line_count));
  return v_id;
end $$;

create or replace function public.ckb_confirm_sap_export(p_export uuid, p_sap_ref text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.ckb_sap_exports%rowtype;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  if length(trim(coalesce(p_sap_ref, ''))) < 3 then raise exception 'Nomor dokumen SAP wajib diisi'; end if;
  select * into e from public.ckb_sap_exports where id = p_export for update;
  if e.id is null then raise exception 'Ekspor tidak ditemukan'; end if;
  if e.status <> 'GENERATED' then raise exception '% berstatus %', e.ref_no, e.status; end if;
  update public.ckb_sap_exports set status = 'SAP_CONFIRMED', sap_document_ref = trim(p_sap_ref),
    confirmed_by_name = public.ckb_actor_name(), confirmed_at = now(), confirm_note = nullif(trim(p_note), '')
  where id = p_export;
  perform public.ckb_audit('SAP_EXPORT_CONFIRM', 'sap_export', p_export::text, e.customer_id,
    jsonb_build_object('sap_document_ref', trim(p_sap_ref), 'note', nullif(trim(p_note), '')));
end $$;

create or replace function public.ckb_void_sap_export(p_export uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.ckb_sap_exports%rowtype;
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB yang bisa membatalkan ekspor'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan pembatalan wajib diisi'; end if;
  select * into e from public.ckb_sap_exports where id = p_export for update;
  if e.id is null then raise exception 'Ekspor tidak ditemukan'; end if;
  if e.status <> 'GENERATED' then raise exception '% berstatus %: hanya ekspor yang belum dikonfirmasi SAP yang bisa dibatalkan', e.ref_no, e.status; end if;
  update public.ckb_sap_exports set status = 'VOIDED', voided_by_name = public.ckb_actor_name(), voided_at = now(),
    void_reason = trim(p_reason) where id = p_export;
  -- Back to APPROVED only those adjustments whose live export this was (a re-export never owns them).
  update public.ckb_adjustments set status = 'APPROVED', export_id = null, exported_at = null
    where export_id = p_export and status = 'EXPORTED';
  perform public.ckb_audit('SAP_EXPORT_VOID', 'sap_export', p_export::text, e.customer_id,
    jsonb_build_object('reason', trim(p_reason)));
end $$;

-- Called by the download route before it streams the file.
create or replace function public.ckb_log_export_download(p_export uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.ckb_sap_exports%rowtype;
begin
  if not public.ckb_is_staff() then raise exception 'Akses ditolak'; end if;
  select * into e from public.ckb_sap_exports where id = p_export for update;
  if e.id is null then raise exception 'Ekspor tidak ditemukan'; end if;
  update public.ckb_sap_exports set download_count = download_count + 1 where id = p_export;
  perform public.ckb_audit('SAP_EXPORT_DOWNLOAD', 'sap_export', p_export::text, e.customer_id,
    jsonb_build_object('ref', e.ref_no, 'download_no', e.download_count + 1));
end $$;

revoke execute on function public.ckb_create_sap_export(uuid, uuid[]), public.ckb_reexport_sap(uuid, text),
  public.ckb_confirm_sap_export(uuid, text, text), public.ckb_void_sap_export(uuid, text),
  public.ckb_log_export_download(uuid) from public, anon;
grant execute on function public.ckb_create_sap_export(uuid, uuid[]), public.ckb_reexport_sap(uuid, text),
  public.ckb_confirm_sap_export(uuid, text, text), public.ckb_void_sap_export(uuid, text),
  public.ckb_log_export_download(uuid) to authenticated;
