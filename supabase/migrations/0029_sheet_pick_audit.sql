-- =====================================================================
-- 0029  Picking audit from the WMS file
--
--  The day's picks are taken from the WMS workbook (K_ONE picklist, or
--  the allocator's picklist from WMS stock + Schedule of the day when
--  K_ONE is empty) instead of from pick_tasks. The checker audits them
--  blind, the same way as 0024; only the results live in the database.
--
--  sheet_pick_lines   what the file says was picked, per date.
--                     Uploading again replaces the lines not audited yet;
--                     audited lines stay as they were.
--  sheet_pick_audits  one row per attempt, errors from pick_audit_errors().
--  No stock changes: the file is not the ledger, so a mismatch is fixed
--  on the floor and audited again.
-- =====================================================================

create table public.sheet_pick_lines (
  id              uuid primary key default gen_random_uuid(),
  pick_date       date not null,
  source          text not null check (source in ('K_ONE', 'ALLOCATOR')),
  file_name       text,
  picklist        text,
  wave_no         text,
  shipment_number text not null,
  seq             int not null default 0,
  bin_code        text not null,
  sku             text not null,
  description     text not null default '',
  uom             text,
  batch           text not null default '',
  expiry          date,
  qty             numeric not null check (qty > 0),
  picker_name     text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create unique index sheet_pick_lines_key
  on public.sheet_pick_lines (pick_date, shipment_number, bin_code, sku, batch);

create table public.sheet_pick_audits (
  id                 uuid primary key default gen_random_uuid(),
  line_id            uuid not null references public.sheet_pick_lines(id) on delete restrict,
  attempt_no         int not null check (attempt_no >= 1),
  checker_name       text not null,
  found_sku          text not null,
  found_scanned_code text,
  found_batch        text not null default '',
  found_expiry       date,
  counted_qty        numeric not null check (counted_qty >= 0),
  damaged            boolean not null default false,
  expected_sku       text not null,
  expected_batch     text not null default '',
  expected_expiry    date,
  expected_qty       numeric not null,
  errors             text[] not null default '{}'
                       check (errors <@ array['WRONG_SKU','SHORT','OVER','WRONG_BATCH','WRONG_EXPIRY','DAMAGED']),
  result             text not null check (result in ('OK', 'MISMATCH')),
  note               text,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  unique (line_id, attempt_no),
  constraint sheet_pick_audit_result check ((result = 'OK') = (errors = '{}'))
);
create index sheet_pick_audits_created_idx on public.sheet_pick_audits (created_at desc);

alter table public.sheet_pick_lines enable row level security;
alter table public.sheet_pick_audits enable row level security;
create policy "sheet_pick_lines: read" on public.sheet_pick_lines for select to authenticated using (true);
create policy "sheet_pick_audits: read" on public.sheet_pick_audits for select to authenticated using (true);
-- No write policies: written only through the functions below.

-- One row per line with its latest attempt. Expected qty / batch / expiry
-- are in the table, but the page shows them only once a line has an attempt.
create or replace view public.sheet_pick_line_state with (security_invoker = true) as
select l.*,
       a.id as last_audit_id, a.result as last_result, a.errors as last_errors, a.checker_name as last_checker,
       a.created_at as last_audited_at, coalesce(n.attempts, 0) as attempts,
       case when a.id is null then 'TODO' when a.result = 'OK' then 'OK' else 'MISMATCH' end as line_state
from public.sheet_pick_lines l
left join lateral (select * from public.sheet_pick_audits x where x.line_id = l.id order by attempt_no desc limit 1) a on true
left join lateral (select count(*)::int as attempts from public.sheet_pick_audits x where x.line_id = l.id) n on true;

-- ---------------------------------------------------------------------
-- Loading the day's lines from the file
--   p_lines: [{picklist, wave_no, shipment_number, seq, bin_code, sku,
--              description, uom, batch, expiry, qty, picker_name}]
-- ---------------------------------------------------------------------
create or replace function public.load_sheet_pick_lines(p_date date, p_source text, p_file text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_removed int; v_added int; v_kept int; v_total int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  if p_date is null then raise exception 'Tanggal pick wajib diisi'; end if;
  if p_source not in ('K_ONE', 'ALLOCATOR') then raise exception 'Sumber tidak dikenal: %', p_source; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'File tidak berisi baris pick';
  end if;
  v_total := jsonb_array_length(p_lines);

  delete from public.sheet_pick_lines l
  where l.pick_date = p_date and not exists (select 1 from public.sheet_pick_audits a where a.line_id = l.id);
  get diagnostics v_removed = row_count;

  with src as (
    select nullif(trim(r->>'picklist'), '') as picklist, nullif(trim(r->>'wave_no'), '') as wave_no,
           trim(r->>'shipment_number') as shipment_number, coalesce((r->>'seq')::int, 0) as seq,
           upper(trim(r->>'bin_code')) as bin_code, trim(r->>'sku') as sku,
           coalesce(r->>'description', '') as description, nullif(trim(r->>'uom'), '') as uom,
           public.norm_batch(r->>'batch') as batch, nullif(r->>'expiry', '')::date as expiry,
           (r->>'qty')::numeric as qty, nullif(trim(r->>'picker_name'), '') as picker_name
    from jsonb_array_elements(p_lines) r
  )
  insert into public.sheet_pick_lines (pick_date, source, file_name, picklist, wave_no, shipment_number, seq,
    bin_code, sku, description, uom, batch, expiry, qty, picker_name, created_by)
  select p_date, p_source, nullif(trim(p_file), ''), picklist, wave_no, shipment_number, seq,
         bin_code, sku, description, uom, batch, expiry, qty, picker_name, auth.uid()
  from src
  where coalesce(shipment_number, '') <> '' and coalesce(bin_code, '') <> '' and coalesce(sku, '') <> '' and qty > 0
  on conflict (pick_date, shipment_number, bin_code, sku, batch) do nothing;
  get diagnostics v_added = row_count;

  select count(*) into v_kept from public.sheet_pick_lines l
  where l.pick_date = p_date and exists (select 1 from public.sheet_pick_audits a where a.line_id = l.id);

  return jsonb_build_object('added', v_added, 'kept', v_kept, 'removed', v_removed, 'skipped', v_total - v_added);
end $$;

-- ---------------------------------------------------------------------
-- Recording an attempt (same rule and blindness as record_pick_audit)
-- ---------------------------------------------------------------------
create or replace function public.record_sheet_pick_audit(
  p_line_id uuid, p_checker_name text, p_found text, p_counted numeric,
  p_batch text, p_expiry date, p_damaged boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  l public.sheet_pick_lines%rowtype; v_prev public.sheet_pick_audits%rowtype; v_found_sku text; v_code text;
  v_errors text[]; v_result text; v_attempt int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  select * into l from public.sheet_pick_lines where id = p_line_id for update;
  if l.id is null then raise exception 'Baris pick tidak ditemukan'; end if;
  if public.same_person(v_checker, l.picker_name) then
    raise exception 'Checker tidak boleh picker baris ini (%)', l.picker_name;
  end if;
  select * into v_prev from public.sheet_pick_audits where line_id = p_line_id order by attempt_no desc limit 1;
  if v_prev.id is not null and v_prev.result = 'OK' then raise exception 'Baris ini sudah lolos audit'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;
  if nullif(trim(p_found), '') is null then raise exception 'Scan karton atau ketik SKU yang ada di palet'; end if;
  select sku into v_found_sku from public.item_by_barcode(p_found) limit 1;
  if v_found_sku is null then raise exception 'Barcode / SKU % tidak dikenal di master item', trim(p_found); end if;
  v_code := regexp_replace(p_found, '\s', '', 'g');
  if v_code = v_found_sku then v_code := null; end if;

  v_errors := public.pick_audit_errors(l.sku, l.batch, l.expiry, l.qty,
                                       v_found_sku, p_batch, p_expiry, p_counted, coalesce(p_damaged, false));
  v_result := case when v_errors = '{}' then 'OK' else 'MISMATCH' end;
  if v_result = 'MISMATCH' and nullif(trim(p_note), '') is null then
    raise exception 'Tidak sesuai: isi catatan apa yang ditemukan';
  end if;
  v_attempt := coalesce(v_prev.attempt_no, 0) + 1;

  insert into public.sheet_pick_audits (line_id, attempt_no, checker_name, found_sku, found_scanned_code, found_batch, found_expiry,
    counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note, created_by)
  values (p_line_id, v_attempt, v_checker, v_found_sku, v_code, public.norm_batch(p_batch), p_expiry,
    p_counted, coalesce(p_damaged, false), l.sku, l.batch, l.expiry, l.qty, v_errors, v_result, nullif(trim(p_note), ''), auth.uid());

  return jsonb_build_object('result', v_result, 'errors', to_jsonb(v_errors), 'attempt', v_attempt,
    'expected', jsonb_build_object('sku', l.sku, 'batch', l.batch, 'expiry', l.expiry, 'qty', l.qty),
    'found', jsonb_build_object('sku', v_found_sku, 'code', v_code, 'batch', public.norm_batch(p_batch),
                                'expiry', p_expiry, 'qty', p_counted, 'damaged', coalesce(p_damaged, false)));
end $$;

-- ---------------------------------------------------------------------
-- Privileges (see 0005: nothing is granted by default)
-- ---------------------------------------------------------------------
grant select on public.sheet_pick_lines, public.sheet_pick_audits, public.sheet_pick_line_state to authenticated;
grant all on public.sheet_pick_lines, public.sheet_pick_audits to service_role;
revoke execute on function public.load_sheet_pick_lines(date, text, text, jsonb) from public, anon;
grant execute on function public.load_sheet_pick_lines(date, text, text, jsonb) to authenticated;
revoke execute on function public.record_sheet_pick_audit(uuid, text, text, numeric, text, date, boolean, text) from public, anon;
grant execute on function public.record_sheet_pick_audit(uuid, text, text, numeric, text, date, boolean, text) to authenticated;

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['sheet_pick_lines', 'sheet_pick_audits'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
