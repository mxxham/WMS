-- =====================================================================
-- 0103  CKB 3PL cargo inspection with configurable checklists
--
-- Checklists are versioned templates: saving a template writes a new
-- version and retires the previous one, so an inspection always shows the
-- exact questions it was answered against (the items are also copied into
-- the inspection at creation).
--
-- Status: DRAFT -> SUBMITTED -> ACCEPTED -> CLOSED, or SUBMITTED -> REJECTED.
-- Answers can only change while DRAFT; once submitted they are history
-- (the trigger refuses any later write). A rejected inspection is not
-- reopened: "Inspeksi ulang" creates a new draft that points back to it
-- (supersedes_id), so both versions stay on record.
-- The reviewer can never be the inspector.
-- An inspection never changes stock.
-- =====================================================================

create sequence public.ckb_inspection_seq;

create table public.ckb_inspection_templates (
  id           uuid primary key default gen_random_uuid(),
  code         text not null check (code ~ '^[A-Z0-9_-]{2,30}$'),
  version      int not null,
  name         text not null,
  customer_id  uuid references public.ckb_customers(id),   -- null = every customer
  items        jsonb not null,   -- [{key, label, category, required, kind: CHECK|TEXT|NUMBER}]
  active       boolean not null default true,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  unique (code, version)
);
create unique index ckb_inspection_templates_one_active on public.ckb_inspection_templates (code) where active;

create table public.ckb_inspections (
  id                uuid primary key default gen_random_uuid(),
  ref_no            text not null unique default ('INS' || lpad(nextval('public.ckb_inspection_seq')::text, 6, '0')),
  customer_id       uuid not null references public.ckb_customers(id),
  inspection_type   text not null check (inspection_type in ('INBOUND', 'OUTBOUND', 'STORAGE', 'OTHER')),
  source_ref        text,           -- shipment / delivery / WO number
  inspection_date   date not null,
  warehouse         text not null,
  location          text,
  material_code     text,
  material_desc     text,
  batch             text,
  package_ref       text,
  template_id       uuid not null references public.ckb_inspection_templates(id),
  checklist         jsonb not null, -- copy of the template items at creation
  status            text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'CLOSED')),
  result            text check (result in ('PASS', 'FAIL')),
  damage_class      text not null default 'NONE' check (damage_class in ('NONE', 'MINOR', 'MAJOR', 'TOTAL_LOSS')),
  findings          text,
  supersedes_id     uuid references public.ckb_inspections(id),
  inspector_id      uuid not null references public.profiles(id),
  inspector_name    text not null,
  created_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  reviewer_id       uuid references public.profiles(id),
  reviewer_name     text,
  reviewed_at       timestamptz,
  review_note       text,
  closed_at         timestamptz,
  closed_by_name    text
);
create index ckb_inspections_customer_idx on public.ckb_inspections (customer_id, inspection_date desc);
create index ckb_inspections_status_idx on public.ckb_inspections (status);

create table public.ckb_inspection_responses (
  inspection_id  uuid not null references public.ckb_inspections(id),
  item_key       text not null,
  result         text check (result in ('OK', 'NG', 'NA')),
  value_text     text,
  value_num      numeric,
  note           text,
  primary key (inspection_id, item_key)
);

-- Answers are writable only while the inspection is a draft.
create or replace function public.ckb_inspection_responses_guard() returns trigger
language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.ckb_inspections
    where id = case when tg_op = 'DELETE' then old.inspection_id else new.inspection_id end;
  if v_status is distinct from 'DRAFT' then
    raise exception 'Jawaban inspeksi yang sudah dikirim tidak bisa diubah';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger ckb_inspection_responses_guard before insert or update or delete on public.ckb_inspection_responses
  for each row execute function public.ckb_inspection_responses_guard();

-- Template items: shape check shared by save and create.
create or replace function public.ckb_valid_checklist(p_items jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 100
    and not exists (
      select 1 from jsonb_array_elements(p_items) i
      where coalesce(i->>'key', '') !~ '^[a-z0-9_]{1,40}$'
         or length(trim(coalesce(i->>'label', ''))) < 2
         or coalesce(i->>'kind', '') not in ('CHECK', 'TEXT', 'NUMBER')
         or jsonb_typeof(i->'required') is distinct from 'boolean')
    and (select count(distinct i->>'key') from jsonb_array_elements(p_items) i) = jsonb_array_length(p_items)
$$;

-- Starting template, from the categories of the 0082 paper form (pallet, wrapping, marking).
-- Adjust it in Pengaturan: saving writes version 2.
insert into public.ckb_inspection_templates (code, version, name, items) values ('UMUM', 1, 'Inspeksi kargo umum', '[
  {"key": "pallet_intact",   "label": "Palet utuh, tidak patah atau retak",           "category": "Palet",    "required": true,  "kind": "CHECK"},
  {"key": "pallet_stable",   "label": "Susunan di atas palet stabil",                 "category": "Palet",    "required": true,  "kind": "CHECK"},
  {"key": "wrap_intact",     "label": "Wrapping rapat dan tidak sobek",               "category": "Wrapping", "required": true,  "kind": "CHECK"},
  {"key": "pkg_condition",   "label": "Kemasan tidak penyok, bocor atau basah",       "category": "Kemasan",  "required": true,  "kind": "CHECK"},
  {"key": "label_readable",  "label": "Label terbaca",                                "category": "Marking",  "required": true,  "kind": "CHECK"},
  {"key": "label_matches",   "label": "Label sesuai dokumen (material, batch)",       "category": "Marking",  "required": true,  "kind": "CHECK"},
  {"key": "qty_packages",    "label": "Jumlah kemasan diperiksa",                     "category": "Jumlah",   "required": false, "kind": "NUMBER"},
  {"key": "remarks",         "label": "Keterangan lain",                              "category": "Umum",     "required": false, "kind": "TEXT"}
]');

alter table public.ckb_inspection_templates enable row level security;
alter table public.ckb_inspections          enable row level security;
alter table public.ckb_inspection_responses enable row level security;

create policy "ckb: staff read templates" on public.ckb_inspection_templates for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff());
-- Representatives see their customer's reviewed outcomes, never drafts.
create policy "ckb: inspections" on public.ckb_inspections for select to authenticated using (
  (select public.account_active()) and (public.ckb_is_staff()
    or (status in ('ACCEPTED', 'REJECTED', 'CLOSED') and public.ckb_can_see_customer(customer_id))));
create policy "ckb: inspection responses" on public.ckb_inspection_responses for select to authenticated using (
  (select public.account_active()) and exists (select 1 from public.ckb_inspections i where i.id = inspection_id
    and (public.ckb_is_staff() or (i.status in ('ACCEPTED', 'REJECTED', 'CLOSED') and public.ckb_can_see_customer(i.customer_id)))));

grant select on public.ckb_inspection_templates, public.ckb_inspections, public.ckb_inspection_responses to authenticated;
grant all on public.ckb_inspection_templates, public.ckb_inspections, public.ckb_inspection_responses to service_role;
grant usage on public.ckb_inspection_seq to service_role;

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
create or replace function public.ckb_save_inspection_template(p_code text, p_name text, p_customer uuid, p_items jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_version int;
  v_id uuid;
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB yang bisa mengubah checklist'; end if;
  if v_code !~ '^[A-Z0-9_-]{2,30}$' then raise exception 'Kode checklist 2-30 huruf besar/angka'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Nama checklist wajib diisi'; end if;
  if not public.ckb_valid_checklist(p_items) then
    raise exception 'Butir checklist tidak valid: tiap butir butuh key unik (a-z0-9_), label, kind CHECK/TEXT/NUMBER dan required';
  end if;
  perform pg_advisory_xact_lock(hashtext('ckb_template:' || v_code));
  select coalesce(max(version), 0) + 1 into v_version from public.ckb_inspection_templates where code = v_code;
  update public.ckb_inspection_templates set active = false where code = v_code and active;
  insert into public.ckb_inspection_templates (code, version, name, customer_id, items, created_by)
    values (v_code, v_version, trim(p_name), p_customer, p_items, auth.uid()) returning id into v_id;
  perform public.ckb_audit('INSPECTION_TEMPLATE_SAVE', 'inspection_template', v_id::text, p_customer,
    jsonb_build_object('code', v_code, 'version', v_version, 'items', jsonb_array_length(p_items)));
  return v_id;
end $$;

create or replace function public.ckb_set_inspection_template_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB'; end if;
  select code into v_code from public.ckb_inspection_templates where id = p_id;
  if v_code is null then raise exception 'Checklist tidak ditemukan'; end if;
  if p_active then update public.ckb_inspection_templates set active = false where code = v_code and active and id <> p_id; end if;
  update public.ckb_inspection_templates set active = p_active where id = p_id;
  perform public.ckb_audit(case when p_active then 'INSPECTION_TEMPLATE_ACTIVATE' else 'INSPECTION_TEMPLATE_RETIRE' end,
    'inspection_template', p_id::text, null, jsonb_build_object('code', v_code));
end $$;

create or replace function public.ckb_create_inspection(p_customer uuid, p_type text, p_template uuid, p_source_ref text,
  p_date date, p_warehouse text, p_location text, p_material text, p_material_desc text, p_batch text,
  p_package_ref text, p_supersedes uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tpl public.ckb_inspection_templates%rowtype;
  v_id uuid;
  v_prev public.ckb_inspections%rowtype;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB yang bisa membuat inspeksi'; end if;
  if not exists (select 1 from public.ckb_customers where id = p_customer and active) then
    raise exception 'Customer tidak ditemukan atau tidak aktif';
  end if;
  if p_type not in ('INBOUND', 'OUTBOUND', 'STORAGE', 'OTHER') then raise exception 'Jenis inspeksi tidak dikenal'; end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal inspeksi tidak valid'; end if;
  if coalesce(trim(p_warehouse), '') = '' then raise exception 'Gudang wajib diisi'; end if;
  select * into tpl from public.ckb_inspection_templates where id = p_template and active;
  if tpl.id is null then raise exception 'Checklist tidak ditemukan atau sudah tidak aktif'; end if;
  if tpl.customer_id is not null and tpl.customer_id <> p_customer then raise exception 'Checklist ini untuk customer lain'; end if;
  if p_supersedes is not null then
    select * into v_prev from public.ckb_inspections where id = p_supersedes;
    if v_prev.id is null or v_prev.status <> 'REJECTED' or v_prev.customer_id <> p_customer then
      raise exception 'Inspeksi ulang hanya untuk inspeksi yang ditolak dari customer yang sama';
    end if;
  end if;

  insert into public.ckb_inspections (customer_id, inspection_type, source_ref, inspection_date, warehouse, location,
    material_code, material_desc, batch, package_ref, template_id, checklist, supersedes_id, inspector_id, inspector_name)
  values (p_customer, p_type, nullif(trim(p_source_ref), ''), p_date, trim(p_warehouse), nullif(trim(p_location), ''),
    nullif(upper(trim(p_material)), ''), nullif(trim(p_material_desc), ''), nullif(trim(p_batch), ''),
    nullif(trim(p_package_ref), ''), tpl.id, tpl.items, p_supersedes, auth.uid(), public.ckb_actor_name())
  returning id into v_id;
  perform public.ckb_audit('INSPECTION_CREATE', 'inspection', v_id::text, p_customer, jsonb_build_object(
    'type', p_type, 'template', tpl.code || ' v' || tpl.version, 'source_ref', nullif(trim(p_source_ref), ''),
    'supersedes', p_supersedes));
  return v_id;
end $$;

-- p_responses: [{key, result?, value_text?, value_num?, note?}] — replaces all answers of the draft.
create or replace function public.ckb_save_inspection_draft(p_id uuid, p_responses jsonb, p_findings text, p_damage_class text)
returns void
language plpgsql security definer set search_path = public as $$
declare i public.ckb_inspections%rowtype;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  select * into i from public.ckb_inspections where id = p_id for update;
  if i.id is null then raise exception 'Inspeksi tidak ditemukan'; end if;
  if i.status <> 'DRAFT' then raise exception 'Inspeksi % sudah dikirim', i.ref_no; end if;
  if i.inspector_id <> auth.uid() and not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya pemeriksa atau supervisor yang bisa mengisi inspeksi ini';
  end if;
  if p_damage_class not in ('NONE', 'MINOR', 'MAJOR', 'TOTAL_LOSS') then raise exception 'Kelas kerusakan tidak dikenal'; end if;
  if jsonb_typeof(coalesce(p_responses, '[]')) <> 'array' then raise exception 'Jawaban tidak valid'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_responses, '[]')) r
             where not exists (select 1 from jsonb_array_elements(i.checklist) c where c->>'key' = r->>'key')) then
    raise exception 'Jawaban untuk butir yang tidak ada di checklist';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_responses, '[]')) r
             where r ? 'result' and jsonb_typeof(r->'result') <> 'null' and r->>'result' not in ('OK', 'NG', 'NA')) then
    raise exception 'Hasil butir harus OK, NG atau NA';
  end if;

  delete from public.ckb_inspection_responses where inspection_id = p_id;
  insert into public.ckb_inspection_responses (inspection_id, item_key, result, value_text, value_num, note)
  select p_id, r->>'key', nullif(r->>'result', ''), nullif(trim(r->>'value_text'), ''),
    case when jsonb_typeof(r->'value_num') = 'number' then (r->>'value_num')::numeric end, nullif(trim(r->>'note'), '')
  from jsonb_array_elements(coalesce(p_responses, '[]')) r;
  update public.ckb_inspections set findings = nullif(trim(p_findings), ''), damage_class = p_damage_class where id = p_id;
end $$;

create or replace function public.ckb_submit_inspection(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.ckb_inspections%rowtype;
  v_missing text;
  v_ng boolean;
  v_photo boolean;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  select * into i from public.ckb_inspections where id = p_id for update;
  if i.id is null then raise exception 'Inspeksi tidak ditemukan'; end if;
  if i.status <> 'DRAFT' then raise exception 'Inspeksi % sudah dikirim', i.ref_no; end if;
  if i.inspector_id <> auth.uid() and not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya pemeriksa atau supervisor yang bisa mengirim inspeksi ini';
  end if;

  select string_agg(c->>'label', ', ') into v_missing
  from jsonb_array_elements(i.checklist) c
  left join public.ckb_inspection_responses r on r.inspection_id = p_id and r.item_key = c->>'key'
  where (c->>'required')::boolean and (r.item_key is null
    or (c->>'kind' = 'CHECK' and r.result is null)
    or (c->>'kind' = 'TEXT' and r.value_text is null)
    or (c->>'kind' = 'NUMBER' and r.value_num is null));
  if v_missing is not null then raise exception 'Butir wajib belum diisi: %', v_missing; end if;

  if exists (select 1 from public.ckb_inspection_responses where inspection_id = p_id and result = 'NG' and note is null) then
    raise exception 'Setiap butir NG wajib diberi catatan';
  end if;
  v_ng := exists (select 1 from public.ckb_inspection_responses where inspection_id = p_id and result = 'NG');
  if v_ng and coalesce((select (value->>'require_photo_on_ng')::boolean from public.ckb_settings where key = 'inspection'), true) then
    v_photo := exists (select 1 from public.ckb_evidence e where e.entity_type = 'INSPECTION' and e.entity_id = p_id and e.deleted_at is null);
    if not v_photo then raise exception 'Ada butir NG: unggah minimal satu foto bukti sebelum mengirim'; end if;
  end if;
  if v_ng and i.damage_class = 'NONE' and i.findings is null then
    raise exception 'Ada butir NG: isi temuan atau kelas kerusakan';
  end if;

  update public.ckb_inspections set status = 'SUBMITTED', submitted_at = now(),
    result = case when v_ng then 'FAIL' else 'PASS' end where id = p_id;
  perform public.ckb_audit('INSPECTION_SUBMIT', 'inspection', p_id::text, i.customer_id, jsonb_build_object(
    'ref', i.ref_no, 'result', case when v_ng then 'FAIL' else 'PASS' end, 'damage_class', i.damage_class,
    'responses', (select jsonb_agg(jsonb_build_object('key', item_key, 'result', result, 'value_text', value_text,
       'value_num', value_num, 'note', note)) from public.ckb_inspection_responses where inspection_id = p_id)));
end $$;

create or replace function public.ckb_review_inspection(p_id uuid, p_accept boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.ckb_inspections%rowtype;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya supervisor atau admin CKB yang bisa mereview inspeksi';
  end if;
  if p_accept is null then raise exception 'Pilih terima atau tolak'; end if;
  select * into i from public.ckb_inspections where id = p_id for update;
  if i.id is null then raise exception 'Inspeksi tidak ditemukan'; end if;
  if i.status <> 'SUBMITTED' then raise exception 'Inspeksi % berstatus %', i.ref_no, i.status; end if;
  if i.inspector_id = auth.uid() then raise exception 'Pemeriksa tidak boleh mereview inspeksinya sendiri'; end if;
  if not p_accept and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Alasan penolakan wajib diisi'; end if;
  update public.ckb_inspections set status = case when p_accept then 'ACCEPTED' else 'REJECTED' end,
    reviewer_id = auth.uid(), reviewer_name = public.ckb_actor_name(), reviewed_at = now(), review_note = nullif(trim(p_note), '')
  where id = p_id;
  perform public.ckb_audit(case when p_accept then 'INSPECTION_ACCEPT' else 'INSPECTION_REJECT' end, 'inspection',
    p_id::text, i.customer_id, jsonb_build_object('ref', i.ref_no, 'note', nullif(trim(p_note), '')));
end $$;

create or replace function public.ckb_close_inspection(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.ckb_inspections%rowtype;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  select * into i from public.ckb_inspections where id = p_id for update;
  if i.id is null then raise exception 'Inspeksi tidak ditemukan'; end if;
  if i.status <> 'ACCEPTED' then raise exception 'Hanya inspeksi yang diterima yang bisa ditutup'; end if;
  update public.ckb_inspections set status = 'CLOSED', closed_at = now(), closed_by_name = public.ckb_actor_name()
    where id = p_id;
  perform public.ckb_audit('INSPECTION_CLOSE', 'inspection', p_id::text, i.customer_id,
    jsonb_build_object('ref', i.ref_no, 'note', nullif(trim(p_note), '')));
end $$;

revoke execute on function public.ckb_save_inspection_template(text, text, uuid, jsonb),
  public.ckb_set_inspection_template_active(uuid, boolean),
  public.ckb_create_inspection(uuid, text, uuid, text, date, text, text, text, text, text, text, uuid),
  public.ckb_save_inspection_draft(uuid, jsonb, text, text), public.ckb_submit_inspection(uuid),
  public.ckb_review_inspection(uuid, boolean, text), public.ckb_close_inspection(uuid, text) from public, anon;
grant execute on function public.ckb_save_inspection_template(text, text, uuid, jsonb),
  public.ckb_set_inspection_template_active(uuid, boolean),
  public.ckb_create_inspection(uuid, text, uuid, text, date, text, text, text, text, text, text, uuid),
  public.ckb_save_inspection_draft(uuid, jsonb, text, text), public.ckb_submit_inspection(uuid),
  public.ckb_review_inspection(uuid, boolean, text), public.ckb_close_inspection(uuid, text) to authenticated;
