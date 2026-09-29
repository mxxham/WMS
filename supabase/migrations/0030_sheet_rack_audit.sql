-- =====================================================================
-- 0030  Picking audit from the WMS file, at the rack
--
--  Same walk as 0025, for the lines of the WMS file (0029): per bin + SKU
--  the checker counts what is LEFT and it is compared with what the file
--  says stays in the bin after the day's picks (K_ONE "Sisa di Bin", or
--  the allocator's remaining qty; for STAGING lines, what is at staging).
--      more left than the file says -> picker took less -> SHORT
--      less left                    -> picker took more -> OVER
--  Several lines of one bin + SKU share the count; a difference goes on
--  the line picked last (highest seq), the others pass.
-- =====================================================================

alter table public.sheet_pick_lines add column bin_remaining numeric check (bin_remaining >= 0);

alter table public.sheet_pick_audits
  add column method text not null default 'STAGING' check (method in ('STAGING', 'RACK')),
  add column rack_system numeric,
  add column rack_counted numeric;

drop view public.sheet_pick_line_state;
create view public.sheet_pick_line_state with (security_invoker = true) as
select l.*,
       a.id as last_audit_id, a.result as last_result, a.errors as last_errors, a.checker_name as last_checker,
       a.created_at as last_audited_at, a.method as last_method, a.rack_system as last_rack_system,
       a.rack_counted as last_rack_counted, coalesce(n.attempts, 0) as attempts,
       case when a.id is null then 'TODO' when a.result = 'OK' then 'OK' else 'MISMATCH' end as line_state
from public.sheet_pick_lines l
left join lateral (select * from public.sheet_pick_audits x where x.line_id = l.id order by attempt_no desc limit 1) a on true
left join lateral (select count(*)::int as attempts from public.sheet_pick_audits x where x.line_id = l.id) n on true;
grant select on public.sheet_pick_line_state to authenticated;

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
           (r->>'qty')::numeric as qty, nullif(trim(r->>'picker_name'), '') as picker_name,
           nullif(r->>'bin_remaining', '')::numeric as bin_remaining
    from jsonb_array_elements(p_lines) r
  )
  insert into public.sheet_pick_lines (pick_date, source, file_name, picklist, wave_no, shipment_number, seq,
    bin_code, sku, description, uom, batch, expiry, qty, picker_name, bin_remaining, created_by)
  select p_date, p_source, nullif(trim(p_file), ''), picklist, wave_no, shipment_number, seq,
         bin_code, sku, description, uom, batch, expiry, qty, picker_name, bin_remaining, auth.uid()
  from src
  where coalesce(shipment_number, '') <> '' and coalesce(bin_code, '') <> '' and coalesce(sku, '') <> '' and qty > 0
  on conflict (pick_date, shipment_number, bin_code, sku, batch) do nothing;
  get diagnostics v_added = row_count;

  select count(*) into v_kept from public.sheet_pick_lines l
  where l.pick_date = p_date and exists (select 1 from public.sheet_pick_audits a where a.line_id = l.id);

  return jsonb_build_object('added', v_added, 'kept', v_kept, 'removed', v_removed, 'skipped', v_total - v_added);
end $$;

create or replace function public.record_sheet_rack_audit(
  p_date date, p_bin text, p_sku text, p_checker_name text, p_counted numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  v_bin text := upper(trim(p_bin)); v_sku text := trim(p_sku);
  v_system numeric; v_diff numeric; v_target uuid; v_picker text;
  t record; v_counted numeric; v_errors text[]; v_result text; v_attempt int;
  n_lines int := 0; n_bad int := 0;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;

  -- What the file says stays in the bin: the lowest remaining over all its lines of the day.
  select min(bin_remaining) into v_system from public.sheet_pick_lines
  where pick_date = p_date and bin_code = v_bin and sku = v_sku;

  drop table if exists _lines;
  create temp table _lines on commit drop as
  select s.id, s.seq, s.picker_name, s.sku, s.qty, s.batch, s.expiry
  from public.sheet_pick_line_state s
  where s.pick_date = p_date and s.bin_code = v_bin and s.sku = v_sku and s.line_state in ('TODO', 'MISMATCH');
  perform 1 from public.sheet_pick_lines where id in (select id from _lines) for update;
  if not exists (select 1 from _lines) then
    raise exception 'Tidak ada baris untuk diaudit di % untuk SKU %', v_bin, v_sku;
  end if;
  if v_system is null then raise exception 'File tidak mencatat sisa di bin %: audit per shipment', v_bin; end if;
  select picker_name into v_picker from _lines where public.same_person(v_checker, picker_name) limit 1;
  if v_picker is not null then raise exception 'Checker tidak boleh picker baris di bin ini (%)', v_picker; end if;

  v_diff := p_counted - v_system;
  if v_diff <> 0 and nullif(trim(p_note), '') is null then
    raise exception 'Catatan wajib diisi bila sisa di bin tidak sesuai';
  end if;
  select id into v_target from _lines order by seq desc, id desc limit 1;

  for t in select * from _lines loop
    v_counted := case when t.id = v_target then greatest(t.qty - v_diff, 0) else t.qty end;
    v_errors := public.pick_audit_errors(t.sku, t.batch, t.expiry, t.qty, t.sku, t.batch, null, v_counted, false);
    v_result := case when v_errors = '{}' then 'OK' else 'MISMATCH' end;
    select coalesce(max(attempt_no), 0) + 1 into v_attempt from public.sheet_pick_audits where line_id = t.id;
    insert into public.sheet_pick_audits (line_id, attempt_no, checker_name, found_sku, found_batch, found_expiry,
      counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note,
      method, rack_system, rack_counted, created_by)
    values (t.id, v_attempt, v_checker, t.sku, t.batch, null,
      v_counted, false, t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''),
      'RACK', v_system, p_counted, auth.uid());
    n_lines := n_lines + 1;
    if v_result <> 'OK' then n_bad := n_bad + 1; end if;
  end loop;

  return jsonb_build_object('result', case when n_bad = 0 then 'OK' else 'MISMATCH' end,
    'system', v_system, 'counted', p_counted, 'diff', v_diff, 'lines', n_lines);
end $$;
revoke execute on function public.record_sheet_rack_audit(date, text, text, text, numeric, text) from public, anon;
grant execute on function public.record_sheet_rack_audit(date, text, text, text, numeric, text) to authenticated;
