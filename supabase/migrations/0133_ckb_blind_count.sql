-- =====================================================================
-- 0133  CKB stock take: counters per location, photo rules, blind reads
--
--  8 Nov 2026: the CKB stock take was run from one account. Counters could
--  only be ticked at creation, a supervisor counting saw the SAP number,
--  and no photo was ever required. Dedicated counters with their own
--  accounts will now count, assigned per location, blind.
--  Spec: docs/superpowers/specs/2026-11-08-ckb-blind-count-design.md.
--
--  The rules sit in triggers on ckb_counts, ckb_evidence and
--  ckb_count_tasks, so every writer (ckb_submit_count, the old
--  ckb_add_found_item, any later path) obeys them without copies of the
--  0101 / 0104 functions.
--   1  Assignment per line (ckb_assign_count_tasks) and who may count it.
--   2  Photo rules at count time (per round).
--   3  Evidence ownership and withdrawal; accepting a variance.
--   4  Blind reads for the operator role.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1  Assignment
-- ---------------------------------------------------------------------
alter table public.ckb_count_tasks
  add column assigned_to      uuid references public.profiles(id),
  add column assigned_at      timestamptz,
  add column assigned_by_name text;
create index ckb_count_tasks_assigned_idx on public.ckb_count_tasks (assigned_to) where assigned_to is not null;

-- May the caller count this line? Leads: any line. Operators: an assigned line only when it is theirs; an
-- unassigned line under the session rule of 0101 (listed counters, or any staff when none are listed).
create or replace function public.ckb_can_count_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.ckb_is_staff() then false
    when public.ckb_has_role(array['admin', 'supervisor']) then true
    else coalesce((
      select case when t.assigned_to is not null then t.assigned_to = auth.uid()
                  else not exists (select 1 from public.ckb_stocktake_counters c where c.stocktake_id = t.stocktake_id)
                       or exists (select 1 from public.ckb_stocktake_counters c where c.stocktake_id = t.stocktake_id and c.user_id = auth.uid())
             end
      from public.ckb_count_tasks t where t.id = p_task), false)
  end
$$;
revoke execute on function public.ckb_can_count_task(uuid) from public, anon;
grant execute on function public.ckb_can_count_task(uuid) to authenticated;

create or replace function public.ckb_assign_count_tasks(p_stocktake uuid, p_bins text[], p_counter uuid, p_by_name text)
returns int language plpgsql security definer set search_path = public as $$
declare s public.ckb_stocktakes%rowtype; n int; v_name text;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya supervisor atau admin CKB yang bisa menugaskan penghitung';
  end if;
  s := public.ckb_lock_stocktake(p_stocktake, array['DRAFT', 'COUNTING', 'REVIEW']);
  if cardinality(coalesce(p_bins, '{}')) = 0 then raise exception 'Pilih minimal satu lokasi'; end if;
  if p_counter is not null and not exists (
       select 1 from public.ckb_user_roles r join public.profiles p on p.id = r.user_id
       where r.user_id = p_counter and r.role <> 'customer' and p.active and 'ckb_3pl' = any(p.apps)) then
    raise exception 'Penghitung harus staf CKB aktif';
  end if;
  v_name := coalesce(nullif(trim(p_by_name), ''), public.ckb_actor_name());
  update public.ckb_count_tasks t
     set assigned_to = p_counter, assigned_at = case when p_counter is null then null else now() end,
         assigned_by_name = case when p_counter is null then null else v_name end
   where t.stocktake_id = p_stocktake and upper(t.storage_bin) = any (select upper(trim(b)) from unnest(p_bins) b)
     and t.assigned_to is distinct from p_counter;
  get diagnostics n = row_count;
  -- The session counter list is left alone: it decides who counts the UNassigned lines, and assigning one
  -- location must not lock the rest (final review, 8 Nov).
  perform public.ckb_audit('COUNT_ASSIGN', 'stocktake', p_stocktake::text, s.customer_id, jsonb_build_object(
    'stocktake', s.ref_no, 'bins', p_bins, 'counter', p_counter,
    'counter_name', (select name from public.profiles where id = p_counter), 'lines', n));
  return n;
end $$;
revoke execute on function public.ckb_assign_count_tasks(uuid, text[], uuid, text) from public, anon;
grant execute on function public.ckb_assign_count_tasks(uuid, text[], uuid, text) to authenticated;

-- Every count: the caller must be allowed to count that line.
create or replace function public.ckb_counts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  if auth.uid() is not null and not public.ckb_can_count_task(new.task_id) then
    raise exception 'Anda tidak ditugaskan menghitung baris ini';
  end if;
  v_reason := public.ckb_photo_reason(new.task_id, new.qty);
  if v_reason is not null and not exists (
       select 1 from public.ckb_evidence e join public.ckb_count_tasks t on t.id = new.task_id
       where e.entity_type = 'COUNT_TASK' and e.entity_id = new.task_id and e.round = t.round and e.deleted_at is null) then
    raise exception 'Foto wajib: % — ambil foto dulu, lalu kirim lagi', v_reason;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2  Photo rules at count time
-- ---------------------------------------------------------------------
alter table public.ckb_stocktakes add column photo_rules boolean not null default true;
-- Sessions that exist now keep today's rules: nobody gets stuck mid-count.
update public.ckb_stocktakes set photo_rules = false;
alter table public.ckb_customers add column count_photo_required boolean not null default false;

alter table public.ckb_evidence add column round int;
alter table public.ckb_evidence drop constraint if exists ckb_evidence_kind_check;
alter table public.ckb_evidence add constraint ckb_evidence_kind_check
  check (kind in ('GENERAL', 'DAMAGE', 'LABEL', 'DOCUMENT', 'DISCREPANCY', 'COUNT'));

-- Why this count needs a photo, or null. Mirrored by lib/ckb/count-rules.ts photoReason.
create or replace function public.ckb_photo_reason(p_task uuid, p_qty numeric) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not s.photo_rules then null
    when p_qty = 0 then 'hitungan 0'
    when t.origin = 'FOUND' then 'barang temuan'
    when t.round > 1 then 'hitungan ulang'
    when c.count_photo_required then 'wajib untuk pelanggan ini'
  end
  from public.ckb_count_tasks t
  join public.ckb_stocktakes s on s.id = t.stocktake_id
  join public.ckb_customers c on c.id = s.customer_id
  where t.id = p_task
$$;
grant execute on function public.ckb_photo_reason(uuid, numeric) to authenticated;

create trigger ckb_counts_guard before insert on public.ckb_counts
  for each row execute function public.ckb_counts_guard();

-- Found stock in two steps: the line first (assigned to whoever found it), then the normal count with its photo.
create or replace function public.ckb_add_found_line(p_stocktake uuid, p_material text, p_description text,
  p_bin text, p_batch text, p_expiry date, p_uom text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.ckb_stocktakes%rowtype; v_task uuid; v_seq int; v_key text; v_match int;
begin
  s := public.ckb_lock_stocktake(p_stocktake, array['COUNTING']);
  perform public.ckb_assert_can_count(s);
  if coalesce(trim(p_material), '') = '' or coalesce(trim(p_uom), '') = '' or coalesce(trim(p_bin), '') = '' then
    raise exception 'Material, lokasi dan satuan wajib diisi';
  end if;
  select seq into v_match from public.ckb_count_tasks
    where stocktake_id = p_stocktake and origin = 'BASELINE'
      and upper(material_code) = upper(trim(p_material)) and upper(storage_bin) = upper(trim(p_bin))
      and upper(batch) = upper(trim(coalesce(p_batch, ''))) and expiry_date is not distinct from p_expiry
      and upper(uom) = upper(trim(p_uom))
    limit 1;
  if v_match is not null then raise exception 'Barang ini ada di daftar hitung (tugas #%): hitung di sana', v_match; end if;
  v_key := 'FOUND|' || public.ckb_identity_key(p_material, '', '', p_bin, p_batch, p_expiry, p_uom, '');
  select id into v_task from public.ckb_count_tasks where stocktake_id = p_stocktake and identity_key = v_key;
  if v_task is not null then return v_task; end if;   -- already recorded: count it there
  select coalesce(max(seq), 0) + 1 into v_seq from public.ckb_count_tasks where stocktake_id = p_stocktake;
  insert into public.ckb_count_tasks (stocktake_id, seq, origin, identity_key, material_code, description, storage_bin,
    batch, expiry_date, uom, baseline_qty, baseline_rows, status, assigned_to, assigned_at, assigned_by_name)
  values (p_stocktake, v_seq, 'FOUND', v_key, upper(trim(p_material)), coalesce(trim(p_description), ''),
    upper(trim(p_bin)), coalesce(trim(p_batch), ''), p_expiry, upper(trim(p_uom)), 0, 0, 'OPEN',
    auth.uid(), now(), public.ckb_actor_name())
  returning id into v_task;
  if length(trim(coalesce(p_note, ''))) > 0 then
    perform public.ckb_add_task_note(v_task, p_note);
  end if;
  perform public.ckb_audit('COUNT_FOUND_LINE', 'count_task', v_task::text, s.customer_id, jsonb_build_object(
    'stocktake', s.ref_no, 'seq', v_seq, 'material', upper(trim(p_material)), 'bin', upper(trim(p_bin))));
  return v_task;
end $$;
revoke execute on function public.ckb_add_found_line(uuid, text, text, text, text, date, text, text) from public, anon;
grant execute on function public.ckb_add_found_line(uuid, text, text, text, text, date, text, text) to authenticated;

create or replace function public.ckb_set_customer_count_photo(p_customer uuid, p_required boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ckb_has_role(array['admin']) then raise exception 'Hanya admin CKB'; end if;
  if p_required is null then raise exception 'Pilih ya atau tidak'; end if;
  update public.ckb_customers set count_photo_required = p_required where id = p_customer;
  if not found then raise exception 'Pelanggan tidak ditemukan'; end if;
  perform public.ckb_audit('CUSTOMER_COUNT_PHOTO', 'customer', p_customer::text, p_customer,
    jsonb_build_object('count_photo_required', p_required));
end $$;
revoke execute on function public.ckb_set_customer_count_photo(uuid, boolean) from public, anon;
grant execute on function public.ckb_set_customer_count_photo(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3  Evidence ownership and withdrawal; accepting a variance
-- ---------------------------------------------------------------------
-- A count photo belongs to its round, and only someone who may count the line may add one.
create or replace function public.ckb_evidence_count_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.entity_type = 'COUNT_TASK' then
      if auth.uid() is not null and not public.ckb_can_count_task(new.entity_id) then
        raise exception 'Anda tidak ditugaskan menghitung baris ini: foto tidak bisa ditambah';
      end if;
      new.round := (select round from public.ckb_count_tasks where id = new.entity_id);
    end if;
    return new;
  end if;
  -- UPDATE: withdrawing a photo a submitted count relied on is for a lead only (with its logged reason).
  if new.deleted_at is not null and old.deleted_at is null and old.entity_type = 'COUNT_TASK'
     and not public.ckb_has_role(array['admin', 'supervisor'])
     and exists (select 1 from public.ckb_counts c where c.task_id = old.entity_id and c.round = old.round) then
    raise exception 'Foto ini dipakai hitungan yang sudah dikirim: hanya supervisor yang bisa menariknya';
  end if;
  return new;
end $$;
create trigger ckb_evidence_count_guard before insert or update on public.ckb_evidence
  for each row execute function public.ckb_evidence_count_guard();

-- Accepting a line with a variance needs at least one photo on it (any round).
create or replace function public.ckb_accept_photo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ACCEPTED' and old.status is distinct from 'ACCEPTED' and coalesce(new.variance, 0) <> 0
     and (select photo_rules from public.ckb_stocktakes where id = new.stocktake_id)
     and not exists (select 1 from public.ckb_evidence e where e.entity_type = 'COUNT_TASK' and e.entity_id = new.id
                     and e.deleted_at is null) then
    raise exception 'Selisih % pada tugas #%: perlu minimal satu foto sebelum diterima', new.variance, new.seq;
  end if;
  return new;
end $$;
create trigger ckb_accept_photo_guard before update on public.ckb_count_tasks
  for each row execute function public.ckb_accept_photo_guard();


-- ---------------------------------------------------------------------
-- 4  Blind reads for the operator role
-- ---------------------------------------------------------------------
-- A counter never reads SAP quantities, adjustments, earlier counts or the review notes, anywhere in CKB.
drop policy "ckb: staff read snapshot rows" on public.ckb_sap_snapshot_rows;
create policy "ckb: staff read snapshot rows" on public.ckb_sap_snapshot_rows
  for select to authenticated using ((select public.account_active()) and public.ckb_is_staff() and public.ckb_role() <> 'operator');
drop policy "ckb: staff read counts" on public.ckb_counts;
create policy "ckb: staff read counts" on public.ckb_counts for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff() and public.ckb_role() <> 'operator');
drop policy "ckb: staff read task notes" on public.ckb_task_notes;
create policy "ckb: staff read task notes" on public.ckb_task_notes for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff() and public.ckb_role() <> 'operator');
drop policy "ckb: adjustments" on public.ckb_adjustments;
create policy "ckb: adjustments" on public.ckb_adjustments for select to authenticated using (
  (select public.account_active()) and ((public.ckb_is_staff() and public.ckb_role() <> 'operator')
    or (status in ('APPROVED', 'REJECTED', 'EXPORTED') and public.ckb_can_see_customer(customer_id))));

-- What a counter's Inventaris shows: where each material is, no quantities (the customer's active snapshot).
create or replace function public.ckb_inventory_locations(p_customer uuid)
returns table (storage_bin text, material_code text, description text, uom text)
language sql stable security definer set search_path = public as $$
  select distinct r.storage_bin, r.material_code, r.description, r.uom
  from public.ckb_customers c join public.ckb_sap_snapshot_rows r on r.import_id = c.active_snapshot_id
  where c.id = p_customer and public.ckb_is_staff()
  order by 1, 2
$$;
revoke execute on function public.ckb_inventory_locations(uuid) from public, anon;
grant execute on function public.ckb_inventory_locations(uuid) to authenticated;

-- ckb_stocktake_tasks (0101) with the counter's view narrowed.
create or replace function public.ckb_stocktake_tasks(p_stocktake uuid)
returns table (id uuid, seq int, origin text, material_code text, description text, plant text,
  storage_location text, storage_bin text, batch text, expiry_date date, uom text, stock_type text,
  baseline_qty numeric, baseline_rows int, identity_issue text, round int, status text,
  count_rounds int, count_total int, latest_count_id uuid, latest_qty numeric, latest_counter text,
  latest_counted_at timestamptz, latest_batch_ok boolean, latest_expiry_ok boolean,
  accepted_qty numeric, variance numeric, classification text, wrong_bin_hint boolean,
  decision_reason text, decided_by_name text, decided_at timestamptz)
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
    case when v_show or not v_counter then b.decided_by_name end, b.decided_at
  from base b
  order by b.seq;
end $$;

-- ckb_dashboard (0107): no SAP-derived discrepancy count for a counter.
create or replace function public.ckb_dashboard(p_customer uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.ckb_is_staff() then raise exception 'Akses ditolak'; end if;
  with st as (
    select s.* from public.ckb_stocktakes s where p_customer is null or s.customer_id = p_customer
  ), tk as (
    select t.*, s.status s_status,
      (select c.qty from public.ckb_counts c where c.task_id = t.id order by c.entry_no desc limit 1) lqty,
      (select c.batch_matches is false or c.expiry_matches is false from public.ckb_counts c where c.task_id = t.id
        order by c.entry_no desc limit 1) lmismatch
    from public.ckb_count_tasks t join st s on s.id = t.stocktake_id
    where s.status in ('COUNTING', 'REVIEW')
  )
  select jsonb_build_object(
    'stocktakes_counting', (select count(*) from st where status = 'COUNTING'),
    'stocktakes_review', (select count(*) from st where status = 'REVIEW'),
    'stocktakes_draft', (select count(*) from st where status = 'DRAFT'),
    'tasks_awaiting_count', (select count(*) from tk where status in ('OPEN', 'RECOUNT_REQUESTED')),
    'recounts_requested', (select count(*) from tk where status = 'RECOUNT_REQUESTED'),
    -- 0133: derived from SAP quantities, so not for a counter (operator).
    'discrepancies_awaiting_review', case when public.ckb_role() = 'operator' then null else
       (select count(*) from tk where s_status = 'REVIEW' and status = 'COUNTED'
       and (lqty <> baseline_qty or origin = 'FOUND' or identity_issue is not null or lmismatch)) end,
    'adjustments_proposed', (select count(*) from public.ckb_adjustments a where a.status = 'PROPOSED'
       and (p_customer is null or a.customer_id = p_customer)),
    'adjustments_awaiting_export', (select count(*) from public.ckb_adjustments a where a.status = 'APPROVED'
       and (p_customer is null or a.customer_id = p_customer)),
    'exports_unconfirmed', (select count(*) from public.ckb_sap_exports e where e.status = 'GENERATED'
       and (p_customer is null or e.customer_id = p_customer)),
    'rebagging_open', (select count(*) from public.ckb_rebagging_jobs j
       where j.status in ('DRAFT', 'OPEN', 'IN_PROGRESS', 'REJECTED', 'ON_HOLD') and (p_customer is null or j.customer_id = p_customer)),
    'rebagging_awaiting_verification', (select count(*) from public.ckb_rebagging_jobs j
       where j.status = 'AWAITING_VERIFICATION' and (p_customer is null or j.customer_id = p_customer)),
    'rebagging_awaiting_posting', (select count(*) from public.ckb_rebagging_jobs j
       where j.status = 'VERIFIED' and (p_customer is null or j.customer_id = p_customer)),
    'inspections_draft', (select count(*) from public.ckb_inspections i where i.status = 'DRAFT'
       and (p_customer is null or i.customer_id = p_customer)),
    'inspections_awaiting_review', (select count(*) from public.ckb_inspections i where i.status = 'SUBMITTED'
       and (p_customer is null or i.customer_id = p_customer)),
    'customers_without_snapshot', (select count(*) from public.ckb_customers c where c.active and c.active_snapshot_id is null
       and (p_customer is null or c.id = p_customer))
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 5  Penugasan hitung: per location, its lines, how many are counted, and who counts them
-- ---------------------------------------------------------------------
create or replace function public.ckb_assignment_overview(p_stocktake uuid)
returns table (storage_bin text, lines int, counted int, assigned_to uuid, assigned_name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya supervisor atau admin CKB yang bisa melihat penugasan';
  end if;
  return query
  select t.storage_bin, count(*)::int, (count(*) filter (where t.status not in ('OPEN', 'RECOUNT_REQUESTED')))::int,
         -- one counter per location; a location split between counters shows the most common one
         mode() within group (order by t.assigned_to), (select p.name from public.profiles p where p.id = mode() within group (order by t.assigned_to))
  from public.ckb_count_tasks t
  where t.stocktake_id = p_stocktake
  group by t.storage_bin
  order by t.storage_bin;
end $$;
revoke execute on function public.ckb_assignment_overview(uuid) from public, anon;
grant execute on function public.ckb_assignment_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6  Final review (8 Nov): the remaining read paths of SAP numbers, photos per counter, the session rule
-- ---------------------------------------------------------------------
-- Comparing snapshots returns every SAP quantity: leads only.
create or replace function public.ckb_compare_snapshots(p_a uuid, p_b uuid)
returns table (identity_key text, material_code text, description text, storage_bin text, batch text,
  expiry_date date, uom text, qty_a numeric, qty_b numeric, delta numeric, change text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- 0133: SAP quantities are not for a counter (operator).
  if not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Akses ditolak: hanya supervisor atau admin CKB yang bisa membandingkan snapshot';
  end if;
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

-- SAP export worksheets carry baseline, counted and delta: not for a counter.
drop policy "ckb: staff read exports" on public.ckb_sap_exports;
create policy "ckb: staff read exports" on public.ckb_sap_exports for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff() and public.ckb_role() <> 'operator');
drop policy "ckb: staff read export lines" on public.ckb_sap_export_lines;
create policy "ckb: staff read export lines" on public.ckb_sap_export_lines for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff() and public.ckb_role() <> 'operator');

-- A counter sees a count photo only on a line they may count, and only of its current round (an earlier photo can
-- show the earlier number); session documents (STOCKTAKE evidence) not at all. Everyone else: unchanged.
create or replace function public.ckb_evidence_row_visible(p_type text, p_id uuid, p_round int) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.ckb_role() is distinct from 'operator' then true
    when p_type = 'STOCKTAKE' then false
    when p_type = 'COUNT_TASK' then public.ckb_can_count_task(p_id)
      and p_round is not distinct from (select round from public.ckb_count_tasks where id = p_id)
    else true
  end
$$;
drop policy "ckb: evidence follows its record" on public.ckb_evidence;
create policy "ckb: evidence follows its record" on public.ckb_evidence for select to authenticated
  using ((select public.account_active()) and deleted_at is null and public.ckb_entity_visible(entity_type, entity_id)
         and public.ckb_evidence_row_visible(entity_type, entity_id, round));

-- ckb_evidence_open (0104) with the same row rule.
create or replace function public.ckb_evidence_open(p_id uuid) returns table (storage_path text, mime text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare e public.ckb_evidence%rowtype;
begin
  select * into e from public.ckb_evidence where id = p_id;
  if e.id is null then raise exception 'Bukti tidak ditemukan'; end if;
  if e.deleted_at is not null and not public.ckb_has_role(array['admin']) then raise exception 'Bukti tidak ditemukan'; end if;
  if not public.ckb_entity_visible(e.entity_type, e.entity_id) then raise exception 'Bukti tidak ditemukan'; end if;
  if not public.ckb_evidence_row_visible(e.entity_type, e.entity_id, e.round) then raise exception 'Bukti tidak ditemukan'; end if;
  perform public.ckb_audit('EVIDENCE_VIEW', lower(e.entity_type), e.entity_id::text, e.customer_id,
    jsonb_build_object('evidence_id', e.id));
  return query select e.storage_path, e.mime;
end $$;

-- The session rule of 0101 for operators, now also passing an operator who has lines assigned in the session
-- (assignment no longer adds them to the counter list).
create or replace function public.ckb_assert_can_count(s public.ckb_stocktakes) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB yang bisa menghitung'; end if;
  if public.ckb_role() = 'operator'
     and exists (select 1 from public.ckb_stocktake_counters where stocktake_id = s.id)
     and not exists (select 1 from public.ckb_stocktake_counters where stocktake_id = s.id and user_id = auth.uid())
     and not exists (select 1 from public.ckb_count_tasks where stocktake_id = s.id and assigned_to = auth.uid()) then
    raise exception 'Anda tidak ditugaskan menghitung sesi %', s.ref_no;
  end if;
end $$;
revoke execute on function public.ckb_assert_can_count(public.ckb_stocktakes) from public, anon, authenticated;
