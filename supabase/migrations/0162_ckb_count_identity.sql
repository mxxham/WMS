-- =====================================================================
-- 0162  CKB: count by the customer's identity (0161), batch as information
--
-- Spec: docs/superpowers/specs/2026-11-25-ckb-emcl-stocktake-design.md
--
--   * ckb_count_tasks.batch_info: the SAP lines a merged task was made of ([{batch, expiry, qty}]); no read grant, as for the rest of the table;
--   * ckb_create_stocktake groups the snapshot by the customer's count_identity (MATERIAL_BIN merges lines that differ only by batch);
--   * ckb_submit_count ignores batch and expiry checks for a MATERIAL_BIN customer, so BATCH_MISMATCH cannot happen;
--   * ckb_add_found_line matches and keys without batch and expiry for a MATERIAL_BIN customer;
--   * ckb_stocktake_tasks returns batch_codes (codes only, for everybody) and batch_detail (with quantities, only where the baseline is shown).
-- A FULL customer behaves exactly as before.
-- =====================================================================

alter table public.ckb_count_tasks add column batch_info jsonb;

create or replace function public.ckb_create_stocktake(p_customer uuid, p_import uuid, p_scope_type text,
  p_scope_values text[], p_warehouse text, p_blind boolean, p_counters uuid[], p_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_values text[] := coalesce((select array_agg(distinct upper(trim(v))) from unnest(p_scope_values) v
                               where trim(coalesce(v, '')) <> ''), '{}');
  v_tasks int;
  v_identity text;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya supervisor atau admin CKB yang bisa membuat sesi stock take';
  end if;
  if not exists (select 1 from public.ckb_customers where id = p_customer and active) then
    raise exception 'Customer tidak ditemukan atau tidak aktif';
  end if;
  if not exists (select 1 from public.ckb_sap_imports where id = p_import and customer_id = p_customer) then
    raise exception 'Snapshot dasar harus milik customer yang sama';
  end if;
  if p_scope_type not in ('FULL', 'BINS', 'MATERIALS') then raise exception 'Cakupan tidak dikenal'; end if;
  if p_scope_type <> 'FULL' and cardinality(v_values) = 0 then
    raise exception 'Pilih minimal satu % untuk cakupan ini', case when p_scope_type = 'BINS' then 'bin' else 'material' end;
  end if;
  if coalesce(trim(p_warehouse), '') = '' then raise exception 'Gudang wajib diisi'; end if;
  if exists (select 1 from unnest(coalesce(p_counters, '{}')) u
             where not exists (select 1 from public.ckb_user_roles r join public.profiles p on p.id = r.user_id
                               where r.user_id = u and r.role <> 'customer' and p.active and 'ckb_3pl' = any(p.apps))) then
    raise exception 'Penghitung harus staf CKB aktif';
  end if;

  insert into public.ckb_stocktakes (customer_id, baseline_import_id, scope_type, scope_values, warehouse, blind, notes,
    created_by, created_by_name)
  values (p_customer, p_import, p_scope_type, case when p_scope_type = 'FULL' then '{}' else v_values end,
    trim(p_warehouse), coalesce(p_blind, true), nullif(trim(p_notes), ''), auth.uid(), public.ckb_actor_name())
  returning id into v_id;

  select count_identity into v_identity from public.ckb_customers where id = p_customer;

  -- One task per stock identity of the customer's profile (0161): FULL = the key stored with each snapshot row; MATERIAL_BIN = the same
  -- without batch and expiry, so lines that differ only by batch are ONE task with the summed baseline and the codes kept in batch_info.
  -- DUPLICATE_ROWS now means the same FULL identity appears twice (kept and flagged, never summed silently), not "more than one line".
  insert into public.ckb_count_tasks (stocktake_id, seq, origin, identity_key, material_code, description, plant,
    storage_location, storage_bin, batch, expiry_date, uom, stock_type, baseline_qty, baseline_rows, identity_issue, batch_info)
  select v_id, row_number() over (order by min(g.storage_bin), min(g.material_code), min(g.batch), g.k),
    'BASELINE', g.k, min(g.material_code), min(g.description), min(g.plant), min(g.storage_location),
    min(g.storage_bin),
    case when v_identity = 'MATERIAL_BIN' then '' else min(g.batch) end,
    case when v_identity = 'MATERIAL_BIN' then null else min(g.expiry_date) end,
    min(g.uom), min(g.stock_type),
    sum(g.quantity), count(*), case when count(*) > count(distinct g.identity_key) then 'DUPLICATE_ROWS' end,
    case when v_identity = 'MATERIAL_BIN'
         then jsonb_agg(jsonb_build_object('batch', g.batch, 'expiry', g.expiry_date, 'qty', g.quantity) order by g.batch, g.line_no) end
  from (
    select r.*, case when v_identity = 'MATERIAL_BIN'
                     then public.ckb_identity_key(r.material_code, r.plant, r.storage_location, r.storage_bin, '', null, r.uom, r.stock_type)
                     else r.identity_key end as k
    from public.ckb_sap_snapshot_rows r
    where r.import_id = p_import
      and (p_scope_type = 'FULL'
        or (p_scope_type = 'BINS' and upper(r.storage_bin) = any(v_values))
        or (p_scope_type = 'MATERIALS' and upper(r.material_code) = any(v_values)))
  ) g
  group by g.k;
  get diagnostics v_tasks = row_count;
  if v_tasks = 0 then raise exception 'Tidak ada baris snapshot dalam cakupan ini'; end if;

  insert into public.ckb_stocktake_counters (stocktake_id, user_id)
    select v_id, u from unnest(coalesce(p_counters, '{}')) u on conflict do nothing;

  perform public.ckb_audit('STOCKTAKE_CREATE', 'stocktake', v_id::text, p_customer, jsonb_build_object(
    'baseline_import_id', p_import, 'scope_type', p_scope_type, 'scope_values', to_jsonb(v_values),
    'blind', coalesce(p_blind, true), 'tasks', v_tasks, 'counters', to_jsonb(coalesce(p_counters, '{}'))));
  return v_id;
end $$;

create or replace function public.ckb_submit_count(p_task uuid, p_qty numeric, p_batch_ok boolean, p_expiry_ok boolean,
  p_observed_batch text, p_observed_expiry date, p_note text, p_client_key uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t public.ckb_count_tasks%rowtype;
  s public.ckb_stocktakes%rowtype;
  v_existing public.ckb_counts%rowtype;
  v_id uuid;
begin
  if p_client_key is null then raise exception 'Kunci pengiriman wajib ada'; end if;
  select * into v_existing from public.ckb_counts where client_key = p_client_key;
  if v_existing.id is not null then
    if v_existing.task_id <> p_task then raise exception 'Kunci pengiriman sudah dipakai untuk tugas lain'; end if;
    return v_existing.id;   -- retried submission: the first one stands
  end if;

  select * into t from public.ckb_count_tasks where id = p_task for update;
  if t.id is null then raise exception 'Tugas hitung tidak ditemukan'; end if;
  select * into s from public.ckb_stocktakes where id = t.stocktake_id;
  perform public.ckb_assert_can_count(s);
  -- 0162: for a customer that counts by material and bin the batch is information, so no batch or expiry check can ever fail
  if (select count_identity from public.ckb_customers where id = s.customer_id) = 'MATERIAL_BIN' then
    p_batch_ok := null; p_expiry_ok := null; p_observed_batch := null; p_observed_expiry := null;
  end if;
  if not ((s.status = 'COUNTING' and t.status in ('OPEN', 'COUNTED', 'RECOUNT_REQUESTED'))
       or (s.status = 'REVIEW' and t.status = 'RECOUNT_REQUESTED')) then
    raise exception 'Tugas #% tidak sedang dibuka untuk dihitung (sesi %, tugas %)', t.seq, s.status, t.status;
  end if;
  if p_qty is null then raise exception 'Qty wajib diisi; isi 0 jika barang tidak ada'; end if;
  if p_qty < 0 then raise exception 'Qty tidak boleh negatif'; end if;
  if (p_batch_ok is false or p_expiry_ok is false) and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Batch/expiry tidak cocok: tulis catatan apa yang terlihat';
  end if;

  insert into public.ckb_counts (task_id, round, qty, batch_matches, expiry_matches, observed_batch, observed_expiry,
    note, counter_id, counter_name, client_key)
  values (p_task, t.round, p_qty, p_batch_ok, p_expiry_ok, nullif(trim(p_observed_batch), ''), p_observed_expiry,
    nullif(trim(p_note), ''), auth.uid(), public.ckb_actor_name(), p_client_key)
  returning id into v_id;
  update public.ckb_count_tasks set status = 'COUNTED' where id = p_task;
  perform public.ckb_audit('COUNT_SUBMIT', 'count_task', p_task::text, s.customer_id, jsonb_build_object(
    'stocktake', s.ref_no, 'seq', t.seq, 'round', t.round, 'qty', p_qty, 'count_id', v_id,
    'batch_ok', p_batch_ok, 'expiry_ok', p_expiry_ok));
  return v_id;
end $$;

create or replace function public.ckb_add_found_line(p_stocktake uuid, p_material text, p_description text,
  p_bin text, p_batch text, p_expiry date, p_uom text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.ckb_stocktakes%rowtype; v_task uuid; v_seq int; v_key text; v_match int; v_mb boolean;
begin
  s := public.ckb_lock_stocktake(p_stocktake, array['COUNTING']);
  perform public.ckb_assert_can_count(s);
  v_mb := (select count_identity = 'MATERIAL_BIN' from public.ckb_customers where id = s.customer_id);
  if coalesce(trim(p_material), '') = '' or coalesce(trim(p_uom), '') = '' or coalesce(trim(p_bin), '') = '' then
    raise exception 'Material, lokasi dan satuan wajib diisi';
  end if;
  select seq into v_match from public.ckb_count_tasks
    where stocktake_id = p_stocktake and origin = 'BASELINE'
      and upper(material_code) = upper(trim(p_material)) and upper(storage_bin) = upper(trim(p_bin))
      and (v_mb or (upper(batch) = upper(trim(coalesce(p_batch, ''))) and expiry_date is not distinct from p_expiry))
      and upper(uom) = upper(trim(p_uom))
    limit 1;
  if v_match is not null then raise exception 'Barang ini ada di daftar hitung (tugas #%): hitung di sana', v_match; end if;
  v_key := 'FOUND|' || public.ckb_identity_key(p_material, '', '', p_bin, case when v_mb then '' else p_batch end, case when v_mb then null else p_expiry end, p_uom, '');
  select id into v_task from public.ckb_count_tasks where stocktake_id = p_stocktake and identity_key = v_key;
  if v_task is not null then return v_task; end if;   -- already recorded: count it there
  select coalesce(max(seq), 0) + 1 into v_seq from public.ckb_count_tasks where stocktake_id = p_stocktake;
  insert into public.ckb_count_tasks (stocktake_id, seq, origin, identity_key, material_code, description, storage_bin,
    batch, expiry_date, uom, baseline_qty, baseline_rows, status, assigned_to, assigned_at, assigned_by_name)
  values (p_stocktake, v_seq, 'FOUND', v_key, upper(trim(p_material)), coalesce(trim(p_description), ''),
    upper(trim(p_bin)), case when v_mb then '' else coalesce(trim(p_batch), '') end, case when v_mb then null else p_expiry end, upper(trim(p_uom)), 0, 0, 'OPEN',
    auth.uid(), now(), public.ckb_actor_name())
  returning id into v_task;
  if length(trim(coalesce(p_note, ''))) > 0 then
    perform public.ckb_add_task_note(v_task, p_note);
  end if;
  perform public.ckb_audit('COUNT_FOUND_LINE', 'count_task', v_task::text, s.customer_id, jsonb_build_object(
    'stocktake', s.ref_no, 'seq', v_seq, 'material', upper(trim(p_material)), 'bin', upper(trim(p_bin))));
  return v_task;
end $$;

drop function public.ckb_stocktake_tasks(uuid);
create or replace function public.ckb_stocktake_tasks(p_stocktake uuid)
returns table (id uuid, seq int, origin text, material_code text, description text, plant text,
  storage_location text, storage_bin text, batch text, expiry_date date, uom text, stock_type text,
  baseline_qty numeric, baseline_rows int, identity_issue text, round int, status text,
  count_rounds int, count_total int, latest_count_id uuid, latest_qty numeric, latest_counter text,
  latest_counted_at timestamptz, latest_batch_ok boolean, latest_expiry_ok boolean,
  accepted_qty numeric, variance numeric, classification text, wrong_bin_hint boolean,
  decision_reason text, decided_by_name text, decided_at timestamptz,
  batch_codes text[], batch_detail jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  s public.ckb_stocktakes%rowtype;
  v_show boolean;
  v_counter boolean := public.ckb_role() = 'operator';  -- 0133: a counter sees only lines they may count
begin
  select * into s from public.ckb_stocktakes st where st.id = p_stocktake;
  if s.id is null then raise exception 'Sesi stock take tidak ditemukan'; end if;
  if public.ckb_is_staff() then
    v_show := public.ckb_has_role(array['admin', 'supervisor']) or not s.blind;
  elsif s.status = 'CLOSED' and public.ckb_can_see_customer(s.customer_id) then
    v_show := true;
  else
    raise exception 'Akses ditolak';
  end if;

  return query
  with latest as (
    select distinct on (c.task_id) c.task_id, c.round lround, c.counter_id lcounter, c.id cid, c.qty, c.counter_name, c.counted_at, c.batch_matches, c.expiry_matches
    from public.ckb_counts c join public.ckb_count_tasks t on t.id = c.task_id
    where t.stocktake_id = p_stocktake
    order by c.task_id, c.entry_no desc
  ), agg as (
    select c.task_id, count(*)::int n, count(distinct c.round)::int rounds
    from public.ckb_counts c join public.ckb_count_tasks t on t.id = c.task_id
    where t.stocktake_id = p_stocktake group by c.task_id
  ), base as (
    select t.*, l.lround, l.lcounter, l.cid, l.qty lqty, l.counter_name lname, l.counted_at lat, l.batch_matches lb, l.expiry_matches le,
      coalesce(a.n, 0) n, coalesce(a.rounds, 0) rounds,
      coalesce(t.classification,
        public.ckb_classify(t.origin, t.identity_issue, l.cid is not null, t.baseline_qty, l.qty, l.batch_matches, l.expiry_matches)) cls,
      coalesce(t.variance, case when l.cid is not null then l.qty - t.baseline_qty end) var
    from public.ckb_count_tasks t
    left join latest l on l.task_id = t.id
    left join agg a on a.task_id = t.id
    where t.stocktake_id = p_stocktake
      and (not v_counter or public.ckb_can_count_task(t.id))
  )
  select b.id, b.seq, b.origin, b.material_code, b.description, b.plant, b.storage_location, b.storage_bin, b.batch,
    b.expiry_date, b.uom, b.stock_type,
    case when v_show then b.baseline_qty end,
    b.baseline_rows, b.identity_issue, b.round, b.status, b.rounds, b.n,
    -- 0133: in a blind session a counter sees only their count of the current round (a recount is blind).
    case when v_show or not v_counter or (b.lround = b.round and b.lcounter = auth.uid()) then b.cid end,
    case when v_show or not v_counter or (b.lround = b.round and b.lcounter = auth.uid()) then b.lqty end,
    case when v_show or not v_counter or (b.lround = b.round and b.lcounter = auth.uid()) then b.lname end,
    case when v_show or not v_counter or (b.lround = b.round and b.lcounter = auth.uid()) then b.lat end,
    case when v_show or not v_counter or (b.lround = b.round and b.lcounter = auth.uid()) then b.lb end,
    case when v_show or not v_counter or (b.lround = b.round and b.lcounter = auth.uid()) then b.le end,
    case when v_show or not v_counter then b.accepted_qty end,
    case when v_show then b.var end,
    case when v_show then b.cls when b.cid is null then 'UNCOUNTED' else 'COUNTED' end,
    case when v_show then (b.cls = 'SHORTAGE' and exists (
      select 1 from base o where o.id <> b.id and o.material_code = b.material_code and o.batch = b.batch
        and o.uom = b.uom and o.storage_bin <> b.storage_bin and o.cls in ('OVERAGE', 'UNEXPECTED'))) end,
    case when v_show or not v_counter then b.decision_reason end,
    case when v_show or not v_counter then b.decided_by_name end, b.decided_at,
    -- 0162: the batch codes of a merged task are information for everybody; what SAP holds per code is baseline, so only who may see it
    case when b.batch_info is not null then (select array_agg(distinct x->>'batch' order by x->>'batch')
                                              from jsonb_array_elements(b.batch_info) x where coalesce(x->>'batch', '') <> '') end,
    case when v_show then b.batch_info end
  from base b
  order by b.seq;
end $$;

revoke execute on function public.ckb_stocktake_tasks(uuid) from public, anon;
grant execute on function public.ckb_stocktake_tasks(uuid) to authenticated;
