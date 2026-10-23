# CKB 3PL — Rebagging module: investigation + design

Date: 2026-10-21 · Status: design for implementation · Owner: orchestrator (contracts below are binding)

## 0. Investigation findings (from the actual repository)

**Architecture.** Next.js 15 App Router + React 19 + TS strict, one repo, ONE Supabase
(PostgreSQL 16) project shared by two apps over one login: Shell WMS (`app/(app)`) and
CKB 3PL (`app/ckb`, gated by `requireAppAccess("ckb_3pl")` reading `profiles.apps`,
migration 0080). CKB currently has NO operational modules — only layout, module registry
(`app/ckb/modules.ts`), and static mockup pages. Rebagging is the FIRST operational module.

**Stock model (authoritative, must not be duplicated).**
- `inventory` rows = `(bin_id, item_id, batch_lot, coalesce(expiry_date,'infinity'))`,
  `quantity numeric >= 0`; unique key migration 0017. **No write policies on `inventory`**
  — the ONLY path is `movements` inserts through the `apply_movement` trigger
  (0002, amended 0011/0013/0017/0053/0056/0060/0075): locks the source row `FOR UPDATE`,
  validates, deletes/updates/increments the destination with
  `ON CONFLICT (bin_id,item_id,batch_lot,coalesce(expiry,'infinity'))`.
- Triggers on `movements` BEFORE INSERT, name-ordered: `guard_held_stock` (0017) →
  `guard_reserved_stock` → `guard_adjustment_policy` (0018) → `apply_movement`.
- `stock_holds` (0017): scope `LINE|BATCH`, reason check
  `('QC_HOLD','DAMAGED','INVESTIGATION','RECALL','EXPIRED','RETURN')`, source check
  `('MANUAL','RECEIPT','CARRY','RECON')`, status `ACTIVE|RELEASED`. Held stock cannot be
  picked/relocated (guard blocks depletion below held except adjustment write-off and
  transfer-TO-QUARANTINE). Held rows follow cartons on identity moves (0018 sets
  `app.hold_carry='on'`).
- `movements` gained `reason_code, by_name, approved_by_name, ref_id` (0018) + `task_id`
  (0016 area) + unique index on `(task_id)` for idempotent posting. Ledger is append-only
  (`block_ledger_edit`).
- Segregation precedents: `person_name(text, text)`, `same_person(a,b)` (0016);
  blind counts (0019) and receiving (0020) enforce "someone else" via these names, not roles.
  Posting precedents: `post_receipt` / `apply_count` / `decide_adjustment` — SECURITY
  DEFINER, FOR UPDATE, status guards, `app.adjust_approved='on'` trick for threshold-bypass
  from an authorized definer flow, Indonesian `RAISE EXCEPTION`.
- **No package/LPN/pallet-identity tables exist** (confirmed by grep across migrations and
  `lib/`). `lib/allocator/ledger.ts` is a pure in-memory allocation ledger — irrelevant here.
- **No Supabase Storage usage exists** (no bucket, no `.storage.` call in app/lib/components).
- Test harness: `tests/*.test.ts` standalone tsx files (inline `test()`/`describe`+`it`,
  `passed`/`failed` counters, `process.exit(failed>0?1:0)`), chained in `package.json`
  `npm test`. SQL tests: `supabase/tests/00..51`, run via `scripts/sql-test.sh`
  (local PG, `PGUSER=postgres`, test db `k1_sql_test`, applies 00 stub + all migrations +
  seed + tests; `pg_temp.check` helper, `set request.jwt.claim.sub`, `set role authenticated`).
- Grants convention (0005 + per-feature): `grant select … to authenticated`,
  `grant all … to service_role`, RPCs `revoke execute … from public, anon` +
  `grant execute … to authenticated`.

## 1. Decisions

1. **Roles.** Reuse `operator | supervisor | admin` (no new role names). "Checker" and
   "approver/inventory-controller" are DUTIES, enforced in SQL by typed person names +
   `same_person` — exactly how blind counts and receiving already work (the site runs a
   shared account; names are the audit unit, documented in docs/INVENTORY_CONTROL.md §4/§7).
   Admin counts as supervisor for all rebagging gates (`has_role(array['supervisor','admin'])`).
2. **No independent balance system.** Posting goes through `movements` (+trigger) only.
   No provisional inventory rows ever exist: pre-posting output packages live only as job
   lines (naturally non-pickable). This answers the WIP question with the safest design.
3. **Source protection** = `stock_holds` LINE rows with `source='REBAGGING'`,
   `reason_code='REBAGGING'`, `ref_id=job_id`, placed when execution starts, released at
   posting/cancel/hold-resolution. Requires a forward-only extension of the two CHECK
   constraints on `stock_holds` (source + reason lists gain `'REBAGGING'`).
4. **Package identity (new).** `ckb_packages` registry: every output package gets a unique
   `package_no` ('PKG' + 6 digits from a dedicated sequence), status `ACTIVE|RETIRED`,
   current `bin_id`. Retired when fully consumed as a source of a later job or reversed.
   Sources of a job are either `STOCK` (bin+sku+batch+expiry+qty straight from
   `inventory_detail`) or an existing `ckb_packages` row (must be ACTIVE, in-scope).
   `ckb_package_lineage` preserves source→output links across jobs (append-only).
5. **Job numbers (new).** `ckb_rebagging_job_seq` sequence; `job_no = 'RB' || lpad(nextval,6,'0')`
   assigned in `create_rebagging_job` (collision-proof; spec requires generation — this
   diverges from the conventions report's user-supplied suggestion on purpose).
   `p_customer_ref` captures the paper WO/DO reference separately.
6. **Material compatibility.** All source lines of a job must share
   `(item_id, batch_lot, expiry_date)` (NULL-safe). Outputs inherit the same identity —
   rebagging never changes batch/expiry/SKU (out of scope, blocked). RELABEL changes only
   packaging/label identity: no extra stock; if package_no changes, old package is RETIRED
   with lineage to the new one (never two ACTIVE packages for the same stock).
7. **Units.** One job = one unit family: all source and output lines must use the same
   `unit` string (v1 blocks mixed units — no conversion table exists to authorize
   conversion; documented as future config). Package COUNT is tracked separately from
   material qty: `pkg_count int` on lines (number of physical packages), `quantity numeric`
   = material amount (bags/kg/etc.). Gross/tare/net optional per line (weight-based ops).
   All numbers `numeric` in the DB; TS handles them as numbers for display only.
8. **Variance.** `variance = sum(actual input) − sum(output)`. Zero variance posts freely.
   ANY nonzero variance requires `variance_reason` (existing movements reason codes:
   DAMAGED/LOST/DATA_ENTRY/…) + note + `variance_decided_by` (supervisor duty, recorded);
   approval is BLOCKED until resolved. No invented numeric tolerance — review on any
   difference (a configurable tolerance can be added later in `settings`, not invented now).
   Variance materializes at posting as: cross-bin transfers per allocation + one negative
   `adjustment` movement per source bin for unrecovered material (guard satisfied via
   `app.adjust_approved='on'` + explicit reason/by_name — the 0018 precedent).
9. **Evidence.** Private bucket `ckb-rebagging`; path `{job_id}/{kind}/{ts}-{filename}`
   (kind = BEFORE|AFTER|OTHER). Storage policies: SELECT/INSERT for authenticated with
   `public.has_ckb_app()` and path-root = an existing job id (`ckb_job_exists(uuid)`);
   **no DELETE policy** (evidence is append-only audit). Rows in `ckb_rebagging_evidence`
   via RPC `add_rebagging_evidence` (no delete RPC). Viewing via client-side signed URLs
   (`createSignedUrl`) — storage RLS is the gate, no public URLs ever.
   Client validates mime (jpg/png/webp) and size (≤ 10 MB) before upload.
10. **Statuses** (text + CHECK, receipts precedent):
    `DRAFT, OPEN, IN_PROGRESS, AWAITING_VERIFICATION, VERIFIED, REJECTED, ON_HOLD,
    COMPLETED, CANCELLED, REVERSED`. (POSTING_FAILED is unnecessary: posting is one
    atomic RPC — a failure rolls the whole transaction back leaving the job VERIFIED and
    retryable; the error message is surfaced by the client and logged client-side. A
    status set by the client directly is impossible: no UPDATE policy exists.)
11. **All writes via SECURITY DEFINER RPCs** (no insert/update RLS policies on the new
    tables; select-only RLS gated on `has_ckb_app()`). Every transition records actor
    name + timestamp in the row and an append-only event in `ckb_rebagging_events`.
12. **Reversal** (`REVERSED`): compensating movements in one transaction (reverse transfers,
    positive adjustment restoring any loss adjustment — administrative undo of a mis-post),
    output packages RETIRED, source packages un-retired, blocked when output stock has
    already been consumed (checked under FOR UPDATE).

## 2. Schema (migration `0084_rebagging_module.sql`)

Forward-only; begins with dropping the unused naive 0081 tables
(`rebagging_lines`, `rebagging_photos`, `rebagging_tasks` — never used by the static
mockup pages). Non-destructive to live data otherwise.

```sql
-- constraint extensions
alter table public.stock_holds drop constraint stock_holds_source_check;   -- name from 0017
alter table public.stock_holds add constraint stock_holds_source_check
  check (source in ('MANUAL','RECEIPT','CARRY','RECON','REBAGGING'));
alter table public.stock_holds drop constraint stock_holds_reason_check;   -- exact name to verify in 0017
alter table public.stock_holds add constraint stock_holds_reason_check
  check (reason_code in ('QC_HOLD','DAMAGED','INVESTIGATION','RECALL','EXPIRED','RETURN','REBAGGING'));

create sequence public.ckb_rebagging_job_seq;
create sequence public.ckb_package_seq;

create table public.ckb_packages (
  id           uuid primary key default gen_random_uuid(),
  package_no   text not null unique,
  item_id      uuid not null references public.items(id),
  batch_lot    text not null default '',
  expiry_date  date,
  quantity     numeric not null check (quantity > 0),
  unit         text not null,
  pkg_count    int,
  bin_id       uuid references public.bins(id),
  status       text not null default 'ACTIVE' check (status in ('ACTIVE','RETIRED')),
  source_job_id uuid references public.ckb_rebagging_jobs(id),  -- see order note below
  created_at   timestamptz not null default now(),
  retired_at   timestamptz, retired_note text
);
-- FK to jobs is added after jobs exist (or declare jobs first — put ckb_rebagging_jobs
-- FIRST in the migration, then ckb_packages).

create table public.ckb_rebagging_jobs (
  id uuid primary key default gen_random_uuid(),
  job_no text not null unique default ('RB' || lpad(nextval('public.ckb_rebagging_job_seq')::text, 6, '0')),
  job_date date not null default current_date,
  shift text not null,
  warehouse text not null,
  customer_ref text,                       -- paper WO / DO reference, user-supplied
  customer text,                           -- Freeport/CGP/SIP/MNE/Boiler/SSB (optional chip)
  operation_type text not null check (operation_type in
    ('DAMAGE_REBAG','SPLIT','RELABEL','COMBINE')),
  reason text not null,
  priority int not null default 0,         -- higher = sooner
  note text,
  status text not null default 'DRAFT' check (status in (
    'DRAFT','OPEN','IN_PROGRESS','AWAITING_VERIFICATION','VERIFIED','REJECTED',
    'ON_HOLD','COMPLETED','CANCELLED','REVERSED')),
  status_before_hold text,                 -- resume point after ON_HOLD
  -- people (typed names; DB enforces segregation)
  creator_name text not null, executor_name text, verifier_name text, approver_name text,
  -- material identity (all sources must share it)
  item_id uuid not null references public.items(id),
  batch_lot text not null default '',
  expiry_date date,
  -- execution record (planned lives on source/output lines; actual here)
  actual_inputs jsonb, actual_outputs jsonb, checklist jsonb,  -- [{item,label,ok}]
  -- variance
  input_qty numeric, output_qty numeric, unit text, pkg_count_in int, pkg_count_out int,
  variance_qty numeric,  -- input − output
  variance_reason text, variance_note text,
  variance_decided_by text, variance_decided_at timestamptz,
  -- posting
  posted_ref text, posted_at timestamptz, last_post_error text,
  reversal_note text, reversed_by text, reversed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ckb_rebagging_jobs_status_idx on public.ckb_rebagging_jobs (status, job_no);
create index ckb_rebagging_jobs_item_idx on public.ckb_rebagging_jobs (item_id);

create table public.ckb_rebagging_sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ckb_rebagging_jobs(id) on delete cascade,
  line_no int not null,
  source_type text not null check (source_type in ('STOCK','PACKAGE')),
  package_id uuid references public.ckb_packages(id),   -- when source_type='PACKAGE'
  bin_id uuid not null references public.bins(id),      -- physical location (STOCK or package's bin)
  quantity numeric not null check (quantity > 0),
  unit text not null, pkg_count int,
  gross_weight numeric, tare_weight numeric, net_weight numeric,
  weight_unit text,
  start_qty numeric,                                   -- identity quantity snapshotted at start_rebagging_execution; approve_post compares against it
  created_at timestamptz not null default now()
);
create index ckb_rebagging_sources_job_idx on public.ckb_rebagging_sources (job_id, line_no);

create table public.ckb_rebagging_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ckb_rebagging_jobs(id) on delete cascade,
  line_no int not null,
  package_id uuid references public.ckb_packages(id),   -- filled at posting
  to_bin_id uuid not null references public.bins(id),
  quantity numeric not null check (quantity > 0),
  unit text not null, pkg_count int,
  gross_weight numeric, tare_weight numeric, net_weight numeric, weight_unit text,
  status text not null default 'PROVISIONAL' check (status in ('PROVISIONAL','ACTIVE')),
  created_at timestamptz not null default now()
);
create index ckb_rebagging_outputs_job_idx on public.ckb_rebagging_outputs (job_id, line_no);

create table public.ckb_package_lineage (
  id uuid primary key default gen_random_uuid(),
  source_package_id uuid references public.ckb_packages(id),
  source_job_id uuid references public.ckb_rebagging_jobs(id),
  output_package_id uuid not null references public.ckb_packages(id),
  output_job_id uuid not null references public.ckb_rebagging_jobs(id),
  quantity numeric not null,
  created_at timestamptz not null default now()
);
create index ckb_package_lineage_out_idx on public.ckb_package_lineage (output_package_id);
create index ckb_package_lineage_src_idx on public.ckb_package_lineage (source_package_id);

create table public.ckb_rebagging_evidence (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ckb_rebagging_jobs(id) on delete cascade,
  kind text not null check (kind in ('BEFORE','AFTER','OTHER')),
  storage_path text not null,              -- {job_id}/{kind}/...
  mime text not null, size_bytes bigint not null,
  note text,
  uploader uuid references public.profiles(id),
  uploader_name text not null,
  uploaded_at timestamptz not null default now()
);
create index ckb_rebagging_evidence_job_idx on public.ckb_rebagging_evidence (job_id);

create table public.ckb_rebagging_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ckb_rebagging_jobs(id) on delete cascade,
  event_type text not null,                -- CREATE / OPEN / START / RECORD / SUBMIT / VERIFY /
                                           -- REJECT / VARIANCE / HOLD / UNHOLD / POST / REVERSE / CANCEL / EVIDENCE
  by_name text, note text, details jsonb,
  at timestamptz not null default now()
);
create index ckb_rebagging_events_job_idx on public.ckb_rebagging_events (job_id, at);

-- helpers (for RLS + storage policies)
create or replace function public.has_ckb_app() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select 'ckb_3pl' = any(apps) and active from public.profiles
                   where id = auth.uid()), false);
$$;

create or replace function public.ckb_job_exists(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ckb_rebagging_jobs where id = p_id);
$$;

-- RLS: select-only, gated on CKB membership; writes ONLY via RPCs (no other policies).
alter table public.ckb_packages            enable row level security;
-- ... same for all five tables
create policy "ckb: ckb members read" on <table> for select to authenticated
  using (public.has_ckb_app());

-- Storage bucket (private) + policies
insert into storage.buckets (id, name, public) values ('ckb-rebagging','ckb-rebagging', false)
  on conflict (id) do nothing;
create policy "ckb-rebagging: read"  on storage.objects for select to authenticated
  using (bucket_id = 'ckb-rebagging' and public.has_ckb_app());
create policy "ckb-rebagging: insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'ckb-rebagging' and public.has_ckb_app()
    and public.ckb_job_exists(nullif((storage.foldername(name))[1], '')::uuid));
-- no delete/update policy: evidence is append-only

-- realtime
alter publication supabase_realtime add table public.ckb_rebagging_jobs, public.ckb_rebagging_outputs,
  public.ckb_rebagging_evidence, public.ckb_rebagging_events;

-- grants per 0005/0017/0020 convention
grant select on public.ckb_rebagging_jobs, public.ckb_rebagging_sources, public.ckb_rebagging_outputs,
  public.ckb_packages, public.ckb_package_lineage, public.ckb_rebagging_evidence,
  public.ckb_rebagging_events to authenticated;
grant all on those tables to service_role;
grant usage on public.ckb_rebagging_job_seq, public.ckb_package_seq to service_role;
```

**List view** `ckb_rebagging_job_summary` (security_invoker): jobs joined with counts —
sources (n), outputs (n), evidence before/after (n), variance flag, item sku/description,
executor/verifier names. The list page selects this directly.

## 3. RPCs (migration `0085_rebagging_rpcs.sql`)

All `SECURITY DEFINER set search_path = public`, Indonesian errors, `person_name` for every
actor, `insert into ckb_rebagging_events` on every step, `has_role` gates. Job row is
locked `FOR UPDATE` in every transition.

**Decisions resolved during implementation (binding):**
- `verify_rebagging`: verifier must NOT be same_person with executor or creator. `verify_rebagging`
  and `approve_post_rebagging` may be performed by the SAME supervisor person (verifier = approver
  is allowed — site staffing reality; the two duties stay covered by having executor/creator as
  different persons).
- Source line identity hints are OPTIONAL: a bin holding one identity needs no sku/batch/expiry;
  a bin holding several requires them (they pin one inventory row).
- `start_rebagging_execution` snapshots each source line's `start_qty` (0084 column);
  `approve_post_rebagging` blocks on ANY difference vs the current identity quantity.
- Posting allocation is per consumed PAIR (one transfer per cross-bin pair, one lineage row per
  pair; same-bin pairs produce no movement); consumption tracking lives in a transaction-local
  temp table inside the function — no columns were added for it.

| RPC | From → To | Key validations |
|---|---|---|
| `create_rebagging_job(p_operation_type, p_reason, p_warehouse, p_customer, p_customer_ref, p_shift, p_priority, p_note, p_by_name) → uuid` | → DRAFT | operator+; operation_type valid; reason ≥ 1 char |
| `set_rebagging_sources(p_job_id, p_lines jsonb, p_by_name)` | DRAFT/OPEN | lines = [{source_type:'STOCK'\|'PACKAGE', bin_code?, package_no?, sku?, batch_lot?, expiry_date?, quantity, unit, pkg_count?, gross/tare/net?}]; STOCK → bin exists + not blocked; identity hints are OPTIONAL — without them the bin must hold exactly ONE identity with stock, with them they pin the row; PACKAGE → ACTIVE package by package_no, qty ≤ package.quantity, bin = the package's bin; all lines one (item_id, batch_lot('' for null), expiry) → derives the job item/batch/expiry; all lines one unit (and must match outputs' unit if already set); quantity > 0; replace-all semantics |
| `set_rebagging_outputs(p_job_id, p_lines jsonb, p_by_name)` | DRAFT/OPEN | [{bin_code, quantity, unit, pkg_count?, gross/tare/net?}]; bins exist, active, not blocked; same unit as sources; at least 1 line; output bin ≠ blocked; QUARANTINE → supervisor only (mirror apply_movement rule) |
| `open_rebagging_job(p_job_id, p_by_name)` | DRAFT → OPEN | ≥1 source, ≥1 output planned |
| `start_rebagging_execution(p_job_id, p_by_name)` | OPEN → IN_PROGRESS | records executor_name; FOR UPDATE-locks + snapshots each source line's identity inventory row into `start_qty` (missing stock or qty < line raises 'Stok tidak cukup…'); EXCLUSIVE holds — any ACTIVE LINE hold on the same (bin, item, batch, expiry) or any BATCH hold on (item, batch) raises '…sedang di-hold…'; places LINE holds (source='REBAGGING', reason='REBAGGING', ref_id=job, qty=line qty) or the whole call fails |
| `record_rebagging_execution(p_job_id, p_inputs jsonb, p_outputs jsonb, p_checklist jsonb, p_by_name)` | IN_PROGRESS or REJECTED | executor only; replace-all actuals (planned preserved on lines); actual qty > 0; same unit; stores checklist [{item, label, ok(bool), note}] with mandatory before-condition items; job status → REJECTED stays IN_PROGRESS-eligible? REJECTED → (after edit) status back to IN_PROGRESS |
| `submit_rebagging_verification(p_job_id, p_by_name)` | IN_PROGRESS → AWAITING_VERIFICATION | executor; evidence ≥ 1 BEFORE and ≥ 1 AFTER (BLOCK, message states what is missing); inputs+outputs recorded; recompute variance; if variance ≠ 0 store input/output/variance on job |
| `verify_rebagging(p_job_id, p_approved bool, p_note, p_by_name)` | AWAITING_VERIFICATION → VERIFIED or REJECTED | NOT same_person with executor or creator (error names them); reject requires note; approved requires note optional; stores verifier_name |
| `resolve_rebagging_variance(p_job_id, p_reason_code in movements codes, p_note, p_by_name)` | any pre-posting, variance ≠ 0 | supervisor; records reason+note+decided_by/decided_at; event |
| `toggle_rebagging_hold(p_job_id, p_note, p_by_name)` | ⇄ ON_HOLD | supervisor; remembers status_before_hold (not from COMPLETED/CANCELLED/REVERSED); hold/release event |
| `cancel_rebagging(p_job_id, p_note, p_by_name)` | not COMPLETED/CANCELLED/REVERSED | supervisor; releases REBAGGING holds; CANCELLED + event; if IN_PROGRESS+, note states no inventory was touched (safe recovery: holds released, nothing else) |
| `approve_post_rebagging(p_job_id, p_note, p_by_name) → jsonb` | VERIFIED → COMPLETED | supervisor; NOT same_person with executor/creator (**verifier MAY equal approver**; error names them); **revalidates**: evidence present, variance resolved (variance=0 or decided), outputs+sources rows present; **re-locks** all source inventory rows FOR UPDATE; the identity row must still hold EXACTLY the quantity snapshotted in `start_qty` — missing row or ANY difference raises 'Stok berubah sejak eksekusi' → user re-records → re-verify; then: release our holds; greedy allocation (consumption tracked in a transaction-local temp table — no schema columns): source lines in line_no order, output lines in line_no order; per CROSS-BIN pair ONE 'transfer' movement (source bin → output bin, note 'REBAG {job_no} …', by_name=executor, approved_by_name=approver, ref_id=job id; same-bin pair gets NO movement), ONE lineage row per consumed pair; loss (input − output) spread over source lines in REVERSE line_no order as negative 'adjustment' movements (app.adjust_approved='on' + app.adjust_reason/app.by_name set — 0018 pattern, reason_code = variance_reason); per output line one ckb_packages row (package_no from ckb_package_seq, ACTIVE, bin) + outputs.package_id + status ACTIVE; mark PACKAGE-sourced source rows RETIRED; job COMPLETED, posted_ref = job_no, posted_at; last_post_error=null. One transaction; double call → 'Sudah diposting' (idempotent by status guard + FOR UPDATE) |
| `reverse_rebagging_posting(p_job_id, p_note, p_by_name)` | COMPLETED → REVERSED | supervisor; FOR UPDATE; re-locks every output inventory row FOR UPDATE (must still hold ≥ reversed qty, else 'stok sudah berpindah'); compensating movements: reverse each transfer (output bin → source bin), positive adjustment restoring each loss adjustment (reason DATA_ENTRY, note 'Pembalikan REB {job_no}', ref_id=job id); output packages RETIRED; PACKAGE-sourced sources re-ACTIVE; lineage KEPT (history, not deleted); job REVERSED + reversed_by/at/note |
| `add_rebagging_evidence(p_job_id, p_kind, p_storage_path, p_mime, p_size, p_note, p_by_name)` | any (not CANCELLED?) | caller must be creator/executor or supervisor; path must start `{job_id}/`; validates kind, mime whitelist, size > 0; event |
| `delete_rebagging_job(p_job_id, p_reason, p_by_name)` | admin only, never-posted (posted_at IS NULL, status ∉ {COMPLETED,REVERSED}) | releases REBAGGING holds (same predicate as cancel); best-effort storage cleanup; tombstone in ckb_rebagging_deleted_jobs; cascades delete job (sources/outputs/evidence/events); movements NEVER touched |

**Decision (21 Oct 2026, late addition):** `delete_rebagging_job` added as admin-only hard delete for never-posted jobs only (DRAFT/OPEN/IN_PROGRESS/AWAITING_VERIFICATION/VERIFIED/REJECTED/ON_HOLD/CANCELLED with posted_at NULL). Cancel (CANCELLED) is not removal — it keeps the audit row. This RPC provides permanent removal for test junk (e.g., RB000001) while keeping a tombstone in `ckb_rebagging_deleted_jobs`. Movements are NEVER touched. Storage objects cleaned up best-effort (errors ignored).

Guard interactions verified against existing triggers: holds released BEFORE movement
inserts (guard_held_stock then sees no REBAGGING holds); `app.adjust_approved='on'` set
before variance adjustment inserts (guard_adjustment_policy threshold satisfied,
reason/by_name present); QUARANTINE destination only for supervisor (apply_movement rule).
Allocation algorithm inside posting (deterministic, documented): source lines in line_no
order, output lines in line_no order; fill each output from the earliest remaining source.

## 4. Pure library `lib/ckb/rebagging.ts`

Status machine metadata for the UI (labels, tone, which actions are visible per status+role),
operation-type field config, variance computation (`inputQty − outputQty`), unit-compatibility
check, evidence kind labels, allocation preview (same greedy algorithm as SQL, for display).
Zero I/O. This is what the tsx test asserts.

## 5. UI

- `app/ckb/rebagging/page.tsx` — server: `requireRole(["operator","supervisor","admin"], "ckb_3pl")`,
  select `ckb_rebagging_job_summary` (latest 100, `fetchAll` not needed at this size but use
  `.range` pattern), render `RebaggingClient` (client): search (job_no/package/sku),
  filters (status, operation, warehouse, date, assignee, exception), sort, Muat lebih via
  range param; `PageHeader live={["ckb_rebagging_jobs","ckb_rebagging_outputs"]}`.
  Empty/loading/error states; `Buat pekerjaan` button (all roles per spec).
- `app/ckb/rebagging/rebagging-list.tsx` — list + filters + create flow (Dialog with
  operation type picker, source lines w/ bin/SKU lookup via `inventory_detail`-style
  client query, planned outputs, PersonNameField, ConfirmButton).
- `app/ckb/rebagging/[id]/page.tsx` + `[id]/workspace-client.tsx` — status-aware guided
  sections: info/assignment → sources (+stock validation state) → before checklist+photos →
  execution (inputs/outputs) → reconciliation → outputs/destinations → after photos →
  verification → approval/posting → history/audit trail (events + evidence). Photo upload:
  `<input type=file accept="image/jpeg,image/png,image/webp">`, ≤10 MB, client
  `supabase.storage.from('ckb-rebagging').upload(path)` then `add_rebagging_evidence`;
  previews via signed URLs (client `createSignedUrl`); white-theme drop zones.
- The old static mockup page is REPLACED by this module (the mockup's content lives on as
  the workspace's sections). `inspections`/`stock-take` mockups untouched.
- Sidebar: `app/ckb/layout.tsx` "Segera" chip on the rebagging rail item can be dropped when
  this ships (cosmetic, separate small edit — flag for user).

## 6. Tests

- `tests/ckb-rebagging.test.ts` (tsx, inline runner, added to `package.json` chain):
  status machine (valid/invalid transitions, hold/resume), operation-type config,
  variance calc (incl. negative + zero), unit compatibility block, allocation preview
  (multi-source→multi-output, same-bin, cross-bin), evidence requirement logic.
- `supabase/tests/52_rebagging.sql`: create→open→start (holds exist; picking that bin now
  FAILS — regression of guard), record→submit (missing evidence BLOCKS), verify
  (same-person BLOCKS), approve_post (same-bin output: only variance adjustment when delta;
  cross-bin: transfer movement exists; ledger rows carry ref_id=job; retry post → error,
  no duplicate movements; concurrent second job on same source blocked by holds; inventory
  changed since execution → post blocked; relabel: no stock change, package lineage set,
  no second active package; reversal restores balances; RLS: non-ckb member cannot select;
  direct table UPDATE as client fails).
- Regression: existing `npm test` chain + `scripts/sql-test.sh` (51 existing files) must
  still pass. `npm run typecheck` + `npm run lint` clean.

## 7. Deployment / manual steps (require user approval — NOT executed by the orchestrator)

1. `supabase db push` applies 0084+0085 to the remote (shared) database.
2. Bucket creation + storage policies ride the migration; verify bucket exists in dashboard.
3. If `app/ckb/layout.tsx` "Segera" chip removal is wanted: one-line edit per module.

## 8. Known limitations / assumptions

- Typed names are the segregation mechanism (shared-account reality, per INVENTORY_CONTROL §7).
- No unit-conversion table exists; mixed-unit jobs are blocked in v1.
- No numeric loss tolerance invented: any variance needs review (future: configurable).
- Storage DELETE is intentionally unpoliced-inaccessible: remove photos never (audit).
- CKB shares the DB with Shell by design (routing spec 0080); rebagging touches only
  shared primitives (items/bins/inventory/movements/stock_holds) — no Shell workflow tables.
- SQL tests need local Postgres (`scripts/sql-test.sh`); if the environment lacks a working
  local PG role, that suite runs where local PG exists (this is how the repo already works).
