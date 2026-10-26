-- =====================================================================
-- 0101  CKB 3PL stock take: sessions, count tasks, counts, review,
--       and adjustment proposals
--
-- Rules (docs/CKB_3PL.md §5):
--   * A session counts one customer against ONE snapshot, fixed at
--     creation (baseline_import_id). Activating a newer snapshot later
--     never changes it.
--   * One count task per stock identity in scope. Identities that appear
--     on several snapshot rows carry identity_issue = 'DUPLICATE_ROWS' and
--     classify as AMBIGUOUS: they can be recounted or excluded with a
--     reason, never accepted into an adjustment, until the business rule
--     for them is confirmed.
--   * Counts are append-only. Every submission (first count, revision,
--     recount) is a new row; nothing is overwritten. "Not counted" = no
--     row; zero = a row with qty 0.
--   * Variance = accepted count - baseline, per task. Shortages and
--     overages in different bins are NEVER netted; a shortage next to a
--     same-material overage elsewhere is only flagged (wrong_bin_hint).
--   * Counting changes no stock. Accepting a task with a variance creates
--     a PROPOSED adjustment; only a supervisor/admin approval makes it
--     APPROVED (one adjustment per task, unique). There is no CKB stock
--     balance to post to yet: approved adjustments are the ledger of
--     decided corrections, and SAP export (0102) is how they leave.
--   * Blind counting: ckb_count_tasks is not readable over the API at all;
--     ckb_stocktake_tasks() returns the baseline only to supervisors and
--     admins, to operators only when the session is not blind, and to
--     customer representatives only once the session is CLOSED.
-- =====================================================================

create sequence public.ckb_stocktake_seq;
create sequence public.ckb_adjustment_seq;

create table public.ckb_stocktakes (
  id                  uuid primary key default gen_random_uuid(),
  ref_no              text not null unique default ('ST' || lpad(nextval('public.ckb_stocktake_seq')::text, 6, '0')),
  customer_id         uuid not null references public.ckb_customers(id),
  baseline_import_id  uuid not null references public.ckb_sap_imports(id),
  scope_type          text not null check (scope_type in ('FULL', 'BINS', 'MATERIALS')),
  scope_values        text[] not null default '{}',
  warehouse           text not null,
  blind               boolean not null default true,
  status              text not null default 'DRAFT' check (status in ('DRAFT', 'COUNTING', 'REVIEW', 'CLOSED', 'CANCELLED')),
  notes               text,
  created_by          uuid not null references public.profiles(id),
  created_by_name     text not null,
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  review_started_at   timestamptz,
  closed_at           timestamptz,
  closed_by_name      text,
  cancelled_at        timestamptz,
  cancel_reason       text
);
create index ckb_stocktakes_customer_idx on public.ckb_stocktakes (customer_id, created_at desc);
create index ckb_stocktakes_status_idx on public.ckb_stocktakes (status);

create table public.ckb_stocktake_counters (
  stocktake_id  uuid not null references public.ckb_stocktakes(id) on delete cascade,
  user_id       uuid not null references public.profiles(id),
  primary key (stocktake_id, user_id)
);

create table public.ckb_count_tasks (
  id                uuid primary key default gen_random_uuid(),
  stocktake_id      uuid not null references public.ckb_stocktakes(id),
  seq               int not null,
  origin            text not null check (origin in ('BASELINE', 'FOUND')),
  identity_key      text not null,
  material_code     text not null,
  description       text not null default '',
  plant             text not null default '',
  storage_location  text not null default '',
  storage_bin       text not null default '',
  batch             text not null default '',
  expiry_date       date,
  uom               text not null,
  stock_type        text not null default '',
  baseline_qty      numeric not null default 0,
  baseline_rows     int not null default 0,
  identity_issue    text check (identity_issue in ('DUPLICATE_ROWS')),
  round             int not null default 1,
  status            text not null default 'OPEN' check (status in ('OPEN', 'COUNTED', 'RECOUNT_REQUESTED', 'ACCEPTED', 'EXCLUDED')),
  accepted_count_id uuid,
  accepted_qty      numeric,
  variance          numeric,
  classification    text,
  decision_reason   text,
  decided_by        uuid references public.profiles(id),
  decided_by_name   text,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (stocktake_id, seq),
  unique (stocktake_id, identity_key)
);
create index ckb_count_tasks_stocktake_idx on public.ckb_count_tasks (stocktake_id, status);

create table public.ckb_counts (
  id               uuid primary key default gen_random_uuid(),
  entry_no         bigint generated always as identity unique,  -- submission order; "latest" = highest
  task_id          uuid not null references public.ckb_count_tasks(id),
  round            int not null,
  qty              numeric not null check (qty >= 0),
  batch_matches    boolean,          -- null = not checked
  expiry_matches   boolean,
  observed_batch   text,
  observed_expiry  date,
  note             text,
  counter_id       uuid not null references public.profiles(id),
  counter_name     text not null,
  counted_at       timestamptz not null default clock_timestamp(),
  client_key       uuid not null unique  -- idempotency: a retried submission returns the first row
);
create index ckb_counts_task_idx on public.ckb_counts (task_id, entry_no);

alter table public.ckb_count_tasks
  add constraint ckb_count_tasks_accepted_fk foreign key (accepted_count_id) references public.ckb_counts(id);

create table public.ckb_task_notes (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid not null references public.ckb_count_tasks(id),
  kind      text not null check (kind in ('INVESTIGATION', 'RECOUNT_REQUEST', 'DECISION')),
  note      text not null,
  by_id     uuid references public.profiles(id),
  by_name   text not null,
  at        timestamptz not null default now()
);
create index ckb_task_notes_task_idx on public.ckb_task_notes (task_id, at);

create table public.ckb_adjustments (
  id                 uuid primary key default gen_random_uuid(),
  ref_no             text not null unique default ('ADJ' || lpad(nextval('public.ckb_adjustment_seq')::text, 6, '0')),
  customer_id        uuid not null references public.ckb_customers(id),
  stocktake_id       uuid not null references public.ckb_stocktakes(id),
  task_id            uuid not null unique references public.ckb_count_tasks(id),
  accepted_count_id  uuid not null references public.ckb_counts(id),
  material_code      text not null,
  description        text not null default '',
  plant              text not null default '',
  storage_location   text not null default '',
  storage_bin        text not null default '',
  batch              text not null default '',
  expiry_date        date,
  uom                text not null,
  stock_type         text not null default '',
  baseline_qty       numeric not null,
  accepted_qty       numeric not null,
  delta              numeric not null check (delta <> 0),
  classification     text not null,
  status             text not null default 'PROPOSED' check (status in ('PROPOSED', 'APPROVED', 'REJECTED', 'EXPORTED')),
  proposed_by        uuid references public.profiles(id),
  proposed_by_name   text not null,
  proposed_at        timestamptz not null default now(),
  decided_by         uuid references public.profiles(id),
  decided_by_name    text,
  decided_at         timestamptz,
  decision_reason    text,
  export_id          uuid,             -- fk in 0102
  exported_at        timestamptz
);
create index ckb_adjustments_status_idx on public.ckb_adjustments (customer_id, status);
create index ckb_adjustments_stocktake_idx on public.ckb_adjustments (stocktake_id);

-- Counts and notes are history: never edited, never deleted.
create trigger ckb_counts_immutable before update or delete on public.ckb_counts
  for each row execute function public.ckb_forbid_change();
create trigger ckb_task_notes_immutable before update or delete on public.ckb_task_notes
  for each row execute function public.ckb_forbid_change();

-- An adjustment's numbers are frozen at proposal: only its status trail may change,
-- and a decided adjustment can only move forward (APPROVED -> EXPORTED, and back by a voided export).
create or replace function public.ckb_adjustments_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Penyesuaian tidak bisa dihapus'; end if;
  if (new.customer_id, new.stocktake_id, new.task_id, new.accepted_count_id, new.material_code, new.storage_bin,
      new.batch, new.expiry_date, new.uom, new.baseline_qty, new.accepted_qty, new.delta)
     is distinct from
     (old.customer_id, old.stocktake_id, old.task_id, old.accepted_count_id, old.material_code, old.storage_bin,
      old.batch, old.expiry_date, old.uom, old.baseline_qty, old.accepted_qty, old.delta) then
    raise exception 'Angka dan identitas penyesuaian tidak bisa diubah';
  end if;
  if not (old.status = new.status
       or (old.status = 'PROPOSED' and new.status in ('APPROVED', 'REJECTED'))
       or (old.status = 'APPROVED' and new.status = 'EXPORTED')
       or (old.status = 'EXPORTED' and new.status = 'APPROVED')) then
    raise exception 'Perubahan status penyesuaian % -> % tidak diizinkan', old.status, new.status;
  end if;
  return new;
end $$;
create trigger ckb_adjustments_guard before update or delete on public.ckb_adjustments
  for each row execute function public.ckb_adjustments_guard();

-- ---------------------------------------------------------------------
-- Classification: the one definition (docs/CKB_3PL.md §5.3)
-- ---------------------------------------------------------------------
create or replace function public.ckb_classify(p_origin text, p_issue text, p_has_count boolean,
  p_baseline numeric, p_qty numeric, p_batch_ok boolean, p_expiry_ok boolean) returns text
language sql immutable as $$
  select case
    when not coalesce(p_has_count, false) then 'UNCOUNTED'
    when p_issue is not null then 'AMBIGUOUS'
    when p_origin = 'FOUND' then 'UNEXPECTED'
    when p_batch_ok is false or p_expiry_ok is false then 'BATCH_MISMATCH'
    when p_qty = p_baseline then 'MATCH'
    when p_qty < p_baseline then 'SHORTAGE'
    else 'OVERAGE'
  end
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.ckb_stocktakes         enable row level security;
alter table public.ckb_stocktake_counters enable row level security;
alter table public.ckb_count_tasks        enable row level security;
alter table public.ckb_counts             enable row level security;
alter table public.ckb_task_notes         enable row level security;
alter table public.ckb_adjustments        enable row level security;

create policy "ckb: stocktakes" on public.ckb_stocktakes for select to authenticated using (
  (select public.account_active()) and (public.ckb_is_staff()
    or (status = 'CLOSED' and public.ckb_can_see_customer(customer_id))));
create policy "ckb: staff read counters" on public.ckb_stocktake_counters for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff());
-- count tasks: no policy and no grant (baseline secrecy) — read through ckb_stocktake_tasks().
create policy "ckb: staff read counts" on public.ckb_counts for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff());
create policy "ckb: staff read task notes" on public.ckb_task_notes for select to authenticated
  using ((select public.account_active()) and public.ckb_is_staff());
create policy "ckb: adjustments" on public.ckb_adjustments for select to authenticated using (
  (select public.account_active()) and (public.ckb_is_staff()
    or (status in ('APPROVED', 'REJECTED', 'EXPORTED') and public.ckb_can_see_customer(customer_id))));

grant select on public.ckb_stocktakes, public.ckb_stocktake_counters, public.ckb_counts,
  public.ckb_task_notes, public.ckb_adjustments to authenticated;
-- Supabase's default privileges grant new tables to anon/authenticated: take count tasks back
-- explicitly. RLS without a policy is the second wall either way.
revoke all on public.ckb_count_tasks from anon, authenticated;
grant all on public.ckb_stocktakes, public.ckb_stocktake_counters, public.ckb_count_tasks, public.ckb_counts,
  public.ckb_task_notes, public.ckb_adjustments to service_role;
grant usage on public.ckb_stocktake_seq, public.ckb_adjustment_seq to service_role;

-- ---------------------------------------------------------------------
-- Read: tasks with their current count, classification and hints
-- ---------------------------------------------------------------------
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
    select distinct on (c.task_id) c.task_id, c.id cid, c.qty, c.counter_name, c.counted_at, c.batch_matches, c.expiry_matches
    from public.ckb_counts c join public.ckb_count_tasks t on t.id = c.task_id
    where t.stocktake_id = p_stocktake
    order by c.task_id, c.entry_no desc
  ), agg as (
    select c.task_id, count(*)::int n, count(distinct c.round)::int rounds
    from public.ckb_counts c join public.ckb_count_tasks t on t.id = c.task_id
    where t.stocktake_id = p_stocktake group by c.task_id
  ), base as (
    select t.*, l.cid, l.qty lqty, l.counter_name lname, l.counted_at lat, l.batch_matches lb, l.expiry_matches le,
      coalesce(a.n, 0) n, coalesce(a.rounds, 0) rounds,
      coalesce(t.classification,
        public.ckb_classify(t.origin, t.identity_issue, l.cid is not null, t.baseline_qty, l.qty, l.batch_matches, l.expiry_matches)) cls,
      coalesce(t.variance, case when l.cid is not null then l.qty - t.baseline_qty end) var
    from public.ckb_count_tasks t
    left join latest l on l.task_id = t.id
    left join agg a on a.task_id = t.id
    where t.stocktake_id = p_stocktake
  )
  select b.id, b.seq, b.origin, b.material_code, b.description, b.plant, b.storage_location, b.storage_bin, b.batch,
    b.expiry_date, b.uom, b.stock_type,
    case when v_show then b.baseline_qty end,
    b.baseline_rows, b.identity_issue, b.round, b.status, b.rounds, b.n, b.cid, b.lqty, b.lname, b.lat, b.lb, b.le,
    b.accepted_qty,
    case when v_show then b.var end,
    case when v_show then b.cls when b.cid is null then 'UNCOUNTED' else 'COUNTED' end,
    case when v_show then (b.cls = 'SHORTAGE' and exists (
      select 1 from base o where o.id <> b.id and o.material_code = b.material_code and o.batch = b.batch
        and o.uom = b.uom and o.storage_bin <> b.storage_bin and o.cls in ('OVERAGE', 'UNEXPECTED'))) end,
    b.decision_reason, b.decided_by_name, b.decided_at
  from base b
  order by b.seq;
end $$;

-- Who can be assigned as a counter. ckb_user_roles is readable only row-by-row (own row, or a CKB
-- admin), so supervisors pick counters from this list instead.
create or replace function public.ckb_staff()
returns table (user_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select r.user_id, p.name, r.role::text
  from public.ckb_user_roles r join public.profiles p on p.id = r.user_id
  where public.ckb_has_role(array['admin', 'supervisor'])
    and r.role <> 'customer' and p.active and 'ckb_3pl' = any(p.apps)
  order by p.name
$$;
revoke execute on function public.ckb_staff() from public, anon;
grant execute on function public.ckb_staff() to authenticated;

-- ---------------------------------------------------------------------
-- Session lifecycle
-- ---------------------------------------------------------------------
create or replace function public.ckb_create_stocktake(p_customer uuid, p_import uuid, p_scope_type text,
  p_scope_values text[], p_warehouse text, p_blind boolean, p_counters uuid[], p_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_values text[] := coalesce((select array_agg(distinct upper(trim(v))) from unnest(p_scope_values) v
                               where trim(coalesce(v, '')) <> ''), '{}');
  v_tasks int;
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

  insert into public.ckb_count_tasks (stocktake_id, seq, origin, identity_key, material_code, description, plant,
    storage_location, storage_bin, batch, expiry_date, uom, stock_type, baseline_qty, baseline_rows, identity_issue)
  select v_id, row_number() over (order by min(r.storage_bin), min(r.material_code), min(r.batch), r.identity_key),
    'BASELINE', r.identity_key, min(r.material_code), min(r.description), min(r.plant), min(r.storage_location),
    min(r.storage_bin), min(r.batch), min(r.expiry_date), min(r.uom), min(r.stock_type),
    sum(r.quantity), count(*), case when count(*) > 1 then 'DUPLICATE_ROWS' end
  from public.ckb_sap_snapshot_rows r
  where r.import_id = p_import
    and (p_scope_type = 'FULL'
      or (p_scope_type = 'BINS' and upper(r.storage_bin) = any(v_values))
      or (p_scope_type = 'MATERIALS' and upper(r.material_code) = any(v_values)))
  group by r.identity_key;
  get diagnostics v_tasks = row_count;
  if v_tasks = 0 then raise exception 'Tidak ada baris snapshot dalam cakupan ini'; end if;

  insert into public.ckb_stocktake_counters (stocktake_id, user_id)
    select v_id, u from unnest(coalesce(p_counters, '{}')) u on conflict do nothing;

  perform public.ckb_audit('STOCKTAKE_CREATE', 'stocktake', v_id::text, p_customer, jsonb_build_object(
    'baseline_import_id', p_import, 'scope_type', p_scope_type, 'scope_values', to_jsonb(v_values),
    'blind', coalesce(p_blind, true), 'tasks', v_tasks, 'counters', to_jsonb(coalesce(p_counters, '{}'))));
  return v_id;
end $$;

-- Lock + status check shared by the transition RPCs.
create or replace function public.ckb_lock_stocktake(p_id uuid, p_allowed text[]) returns public.ckb_stocktakes
language plpgsql security definer set search_path = public as $$
declare s public.ckb_stocktakes%rowtype;
begin
  select * into s from public.ckb_stocktakes where id = p_id for update;
  if s.id is null then raise exception 'Sesi stock take tidak ditemukan'; end if;
  if not (s.status = any(p_allowed)) then
    raise exception 'Sesi % berstatus %: tindakan ini tidak diizinkan', s.ref_no, s.status;
  end if;
  return s;
end $$;
revoke execute on function public.ckb_lock_stocktake(uuid, text[]) from public, anon, authenticated;

create or replace function public.ckb_start_stocktake(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.ckb_stocktakes%rowtype;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  s := public.ckb_lock_stocktake(p_id, array['DRAFT']);
  update public.ckb_stocktakes set status = 'COUNTING', started_at = now() where id = p_id;
  perform public.ckb_audit('STOCKTAKE_START', 'stocktake', p_id::text, s.customer_id, '{}'::jsonb);
end $$;

create or replace function public.ckb_close_counting(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.ckb_stocktakes%rowtype;
  v_uncounted int;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  s := public.ckb_lock_stocktake(p_id, array['COUNTING']);
  select count(*) into v_uncounted from public.ckb_count_tasks where stocktake_id = p_id and status = 'OPEN';
  update public.ckb_stocktakes set status = 'REVIEW', review_started_at = now() where id = p_id;
  perform public.ckb_audit('STOCKTAKE_REVIEW', 'stocktake', p_id::text, s.customer_id,
    jsonb_build_object('uncounted_tasks', v_uncounted));
end $$;

create or replace function public.ckb_close_stocktake(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.ckb_stocktakes%rowtype;
  v_open int;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  s := public.ckb_lock_stocktake(p_id, array['REVIEW']);
  select count(*) into v_open from public.ckb_count_tasks
    where stocktake_id = p_id and status not in ('ACCEPTED', 'EXCLUDED');
  if v_open > 0 then raise exception 'Masih ada % tugas hitung yang belum diputuskan', v_open; end if;
  update public.ckb_stocktakes set status = 'CLOSED', closed_at = now(), closed_by_name = public.ckb_actor_name(),
    notes = coalesce(nullif(trim(p_note), ''), notes) where id = p_id;
  perform public.ckb_audit('STOCKTAKE_CLOSE', 'stocktake', p_id::text, s.customer_id,
    jsonb_build_object('note', nullif(trim(p_note), '')));
end $$;

create or replace function public.ckb_cancel_stocktake(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.ckb_stocktakes%rowtype;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then raise exception 'Hanya supervisor atau admin CKB'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan pembatalan wajib diisi'; end if;
  s := public.ckb_lock_stocktake(p_id, array['DRAFT', 'COUNTING', 'REVIEW']);
  if exists (select 1 from public.ckb_adjustments where stocktake_id = p_id) then
    raise exception 'Sesi sudah punya penyesuaian; tidak bisa dibatalkan';
  end if;
  update public.ckb_stocktakes set status = 'CANCELLED', cancelled_at = now(), cancel_reason = trim(p_reason) where id = p_id;
  perform public.ckb_audit('STOCKTAKE_CANCEL', 'stocktake', p_id::text, s.customer_id, jsonb_build_object('reason', trim(p_reason)));
end $$;

-- ---------------------------------------------------------------------
-- Counting
-- ---------------------------------------------------------------------
create or replace function public.ckb_assert_can_count(s public.ckb_stocktakes) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB yang bisa menghitung'; end if;
  if public.ckb_role() = 'operator'
     and exists (select 1 from public.ckb_stocktake_counters where stocktake_id = s.id)
     and not exists (select 1 from public.ckb_stocktake_counters where stocktake_id = s.id and user_id = auth.uid()) then
    raise exception 'Anda tidak ditugaskan menghitung sesi %', s.ref_no;
  end if;
end $$;
revoke execute on function public.ckb_assert_can_count(public.ckb_stocktakes) from public, anon, authenticated;

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

-- Stock on the floor that is not on the count list: a new FOUND task with its count.
create or replace function public.ckb_add_found_item(p_stocktake uuid, p_material text, p_description text,
  p_bin text, p_batch text, p_expiry date, p_uom text, p_qty numeric, p_note text, p_client_key uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.ckb_stocktakes%rowtype;
  v_task uuid;
  v_seq int;
  v_key text;
  v_match int;
begin
  if p_client_key is null then raise exception 'Kunci pengiriman wajib ada'; end if;
  if exists (select 1 from public.ckb_counts where client_key = p_client_key) then
    return (select task_id from public.ckb_counts where client_key = p_client_key);
  end if;
  s := public.ckb_lock_stocktake(p_stocktake, array['COUNTING']);
  perform public.ckb_assert_can_count(s);
  if coalesce(trim(p_material), '') = '' or coalesce(trim(p_uom), '') = '' or coalesce(trim(p_bin), '') = '' then
    raise exception 'Material, bin dan satuan wajib diisi';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Qty barang temuan harus lebih dari 0'; end if;

  select seq into v_match from public.ckb_count_tasks
    where stocktake_id = p_stocktake and origin = 'BASELINE'
      and upper(material_code) = upper(trim(p_material)) and upper(storage_bin) = upper(trim(p_bin))
      and upper(batch) = upper(trim(coalesce(p_batch, ''))) and expiry_date is not distinct from p_expiry
      and upper(uom) = upper(trim(p_uom))
    limit 1;
  if v_match is not null then raise exception 'Barang ini ada di daftar hitung (tugas #%): hitung di sana', v_match; end if;

  v_key := 'FOUND|' || public.ckb_identity_key(p_material, '', '', p_bin, p_batch, p_expiry, p_uom, '');
  if exists (select 1 from public.ckb_count_tasks where stocktake_id = p_stocktake and identity_key = v_key) then
    raise exception 'Barang temuan ini sudah dicatat; tambahkan hitungan di tugasnya';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from public.ckb_count_tasks where stocktake_id = p_stocktake;
  insert into public.ckb_count_tasks (stocktake_id, seq, origin, identity_key, material_code, description, storage_bin,
    batch, expiry_date, uom, baseline_qty, baseline_rows, status)
  values (p_stocktake, v_seq, 'FOUND', v_key, upper(trim(p_material)), coalesce(trim(p_description), ''),
    upper(trim(p_bin)), coalesce(trim(p_batch), ''), p_expiry, upper(trim(p_uom)), 0, 0, 'COUNTED')
  returning id into v_task;
  insert into public.ckb_counts (task_id, round, qty, note, counter_id, counter_name, client_key)
  values (v_task, 1, p_qty, nullif(trim(p_note), ''), auth.uid(), public.ckb_actor_name(), p_client_key);
  perform public.ckb_audit('COUNT_FOUND_ITEM', 'count_task', v_task::text, s.customer_id, jsonb_build_object(
    'stocktake', s.ref_no, 'seq', v_seq, 'material', upper(trim(p_material)), 'bin', upper(trim(p_bin)), 'qty', p_qty));
  return v_task;
end $$;

create or replace function public.ckb_add_task_note(p_task uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_customer uuid;
begin
  if not public.ckb_is_staff() then raise exception 'Hanya staf CKB'; end if;
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Catatan terlalu pendek'; end if;
  select s.customer_id into v_customer from public.ckb_count_tasks t join public.ckb_stocktakes s on s.id = t.stocktake_id
    where t.id = p_task;
  if v_customer is null then raise exception 'Tugas hitung tidak ditemukan'; end if;
  insert into public.ckb_task_notes (task_id, kind, note, by_id, by_name)
    values (p_task, 'INVESTIGATION', trim(p_note), auth.uid(), public.ckb_actor_name());
  perform public.ckb_audit('TASK_NOTE', 'count_task', p_task::text, v_customer, jsonb_build_object('note', trim(p_note)));
end $$;

-- ---------------------------------------------------------------------
-- Review: ACCEPT (a chosen count), RECOUNT, or EXCLUDE — per task.
-- ---------------------------------------------------------------------
create or replace function public.ckb_decide_task(p_task uuid, p_decision text, p_count uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.ckb_count_tasks%rowtype;
  s public.ckb_stocktakes%rowtype;
  c public.ckb_counts%rowtype;
  v_cls text;
  v_var numeric;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya supervisor atau admin CKB yang bisa memutuskan hasil hitung';
  end if;
  select * into t from public.ckb_count_tasks where id = p_task for update;
  if t.id is null then raise exception 'Tugas hitung tidak ditemukan'; end if;
  select * into s from public.ckb_stocktakes where id = t.stocktake_id for update;
  if s.status <> 'REVIEW' then raise exception 'Keputusan hanya saat sesi dalam tahap review'; end if;
  if t.status in ('ACCEPTED', 'EXCLUDED') then raise exception 'Tugas #% sudah diputuskan', t.seq; end if;

  if p_decision = 'RECOUNT' then
    if v_reason is null then raise exception 'Alasan hitung ulang wajib diisi'; end if;
    update public.ckb_count_tasks set status = 'RECOUNT_REQUESTED', round = round + 1 where id = p_task;
    insert into public.ckb_task_notes (task_id, kind, note, by_id, by_name)
      values (p_task, 'RECOUNT_REQUEST', v_reason, auth.uid(), public.ckb_actor_name());
    perform public.ckb_audit('COUNT_RECOUNT_REQUEST', 'count_task', p_task::text, s.customer_id,
      jsonb_build_object('stocktake', s.ref_no, 'seq', t.seq, 'round', t.round + 1, 'reason', v_reason));
    return;
  end if;

  if p_decision = 'EXCLUDE' then
    if v_reason is null then raise exception 'Alasan pengecualian wajib diisi'; end if;
    select * into c from public.ckb_counts where task_id = p_task order by entry_no desc limit 1;
    update public.ckb_count_tasks set status = 'EXCLUDED', decision_reason = v_reason, decided_by = auth.uid(),
      decided_by_name = public.ckb_actor_name(), decided_at = now(),
      classification = public.ckb_classify(t.origin, t.identity_issue, c.id is not null, t.baseline_qty, c.qty,
        c.batch_matches, c.expiry_matches)
    where id = p_task;
    insert into public.ckb_task_notes (task_id, kind, note, by_id, by_name)
      values (p_task, 'DECISION', 'Dikecualikan: ' || v_reason, auth.uid(), public.ckb_actor_name());
    perform public.ckb_audit('COUNT_EXCLUDE', 'count_task', p_task::text, s.customer_id,
      jsonb_build_object('stocktake', s.ref_no, 'seq', t.seq, 'reason', v_reason));
    return;
  end if;

  if p_decision <> 'ACCEPT' then raise exception 'Keputusan tidak dikenal: %', p_decision; end if;
  if t.status = 'RECOUNT_REQUESTED' then raise exception 'Tugas #% menunggu hitung ulang', t.seq; end if;
  if p_count is null then
    select * into c from public.ckb_counts where task_id = p_task order by entry_no desc limit 1;
  else
    select * into c from public.ckb_counts where id = p_count and task_id = p_task;
  end if;
  if c.id is null then raise exception 'Tugas #% belum punya hitungan untuk diterima', t.seq; end if;

  v_cls := public.ckb_classify(t.origin, t.identity_issue, true, t.baseline_qty, c.qty, c.batch_matches, c.expiry_matches);
  if v_cls in ('AMBIGUOUS', 'BATCH_MISMATCH') then
    raise exception 'Tugas #% (%): identitas stok belum pasti; minta hitung ulang atau kecualikan dengan alasan', t.seq, v_cls;
  end if;
  v_var := c.qty - t.baseline_qty;
  if v_var <> 0 and v_reason is null then raise exception 'Selisih % wajib disertai alasan', v_var; end if;

  update public.ckb_count_tasks set status = 'ACCEPTED', accepted_count_id = c.id, accepted_qty = c.qty,
    variance = v_var, classification = v_cls, decision_reason = v_reason, decided_by = auth.uid(),
    decided_by_name = public.ckb_actor_name(), decided_at = now()
  where id = p_task;
  if v_reason is not null then
    insert into public.ckb_task_notes (task_id, kind, note, by_id, by_name)
      values (p_task, 'DECISION', 'Diterima: ' || v_reason, auth.uid(), public.ckb_actor_name());
  end if;

  if v_var <> 0 then
    insert into public.ckb_adjustments (customer_id, stocktake_id, task_id, accepted_count_id, material_code, description,
      plant, storage_location, storage_bin, batch, expiry_date, uom, stock_type, baseline_qty, accepted_qty, delta,
      classification, proposed_by, proposed_by_name)
    values (s.customer_id, s.id, t.id, c.id, t.material_code, t.description, t.plant, t.storage_location, t.storage_bin,
      t.batch, t.expiry_date, t.uom, t.stock_type, t.baseline_qty, c.qty, v_var, v_cls, auth.uid(), public.ckb_actor_name());
  end if;
  perform public.ckb_audit('COUNT_ACCEPT', 'count_task', p_task::text, s.customer_id, jsonb_build_object(
    'stocktake', s.ref_no, 'seq', t.seq, 'count_id', c.id, 'baseline', t.baseline_qty, 'accepted', c.qty,
    'variance', v_var, 'classification', v_cls, 'reason', v_reason));
end $$;

-- ---------------------------------------------------------------------
-- Adjustment approval. A batch is one transaction: any invalid id fails the whole batch.
-- The approver may not be the person whose count is being accepted.
-- ---------------------------------------------------------------------
create or replace function public.ckb_decide_adjustments(p_ids uuid[], p_approve boolean, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare
  a public.ckb_adjustments%rowtype;
  v_n int := 0;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if not public.ckb_has_role(array['admin', 'supervisor']) then
    raise exception 'Hanya supervisor atau admin CKB yang bisa menyetujui penyesuaian';
  end if;
  if p_approve is null then raise exception 'Pilih setujui atau tolak'; end if;
  if not p_approve and v_reason is null then raise exception 'Alasan penolakan wajib diisi'; end if;
  if cardinality(coalesce(p_ids, '{}')) = 0 then raise exception 'Tidak ada penyesuaian yang dipilih'; end if;

  foreach v_id in array (select array_agg(distinct x order by x) from unnest(p_ids) x) loop
    select * into a from public.ckb_adjustments where id = v_id for update;
    if a.id is null then raise exception 'Penyesuaian tidak ditemukan'; end if;
    if a.status <> 'PROPOSED' then raise exception '% sudah diputuskan (%)', a.ref_no, a.status; end if;
    if p_approve and exists (select 1 from public.ckb_counts where id = a.accepted_count_id and counter_id = auth.uid()) then
      raise exception '%: penghitung tidak boleh menyetujui hitungannya sendiri', a.ref_no;
    end if;
    update public.ckb_adjustments set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
      decided_by = auth.uid(), decided_by_name = public.ckb_actor_name(), decided_at = now(), decision_reason = v_reason
    where id = v_id;
    perform public.ckb_audit(case when p_approve then 'ADJUSTMENT_APPROVE' else 'ADJUSTMENT_REJECT' end,
      'adjustment', v_id::text, a.customer_id, jsonb_build_object('ref', a.ref_no, 'delta', a.delta,
      'material', a.material_code, 'bin', a.storage_bin, 'reason', v_reason));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke execute on function public.ckb_stocktake_tasks(uuid), public.ckb_create_stocktake(uuid, uuid, text, text[], text, boolean, uuid[], text),
  public.ckb_start_stocktake(uuid), public.ckb_close_counting(uuid), public.ckb_close_stocktake(uuid, text),
  public.ckb_cancel_stocktake(uuid, text),
  public.ckb_submit_count(uuid, numeric, boolean, boolean, text, date, text, uuid),
  public.ckb_add_found_item(uuid, text, text, text, text, date, text, numeric, text, uuid),
  public.ckb_add_task_note(uuid, text), public.ckb_decide_task(uuid, text, uuid, text),
  public.ckb_decide_adjustments(uuid[], boolean, text) from public, anon;
grant execute on function public.ckb_stocktake_tasks(uuid), public.ckb_create_stocktake(uuid, uuid, text, text[], text, boolean, uuid[], text),
  public.ckb_start_stocktake(uuid), public.ckb_close_counting(uuid), public.ckb_close_stocktake(uuid, text),
  public.ckb_cancel_stocktake(uuid, text),
  public.ckb_submit_count(uuid, numeric, boolean, boolean, text, date, text, uuid),
  public.ckb_add_found_item(uuid, text, text, text, text, date, text, numeric, text, uuid),
  public.ckb_add_task_note(uuid, text), public.ckb_decide_task(uuid, text, uuid, text),
  public.ckb_decide_adjustments(uuid[], boolean, text) to authenticated;
