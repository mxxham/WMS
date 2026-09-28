# Picking audit — design

Date: 2026-09-28 · Branch: `integrate-bin-system` · Scope: picking audit only (putaway audit unchanged)

## Goal

Every picked line is checked by a second person at staging, blind, before the
shipment is loaded. A shipment cannot be loaded until every line has passed.
Errors are attributed to the picker and measured as pick accuracy KPIs.

## Decisions (agreed)

| Topic | Decision |
|---|---|
| When | At staging, before loading. Loading is gated. |
| Coverage | 100 % of picked lines. |
| Checker | Any staff, identified by typed name (shared Gudang session). Checker name ≠ picker name. |
| Blind | Checker never sees the picker's qty / batch / expiry before saving. |
| Mismatch | Fix on the floor + re-audit. Supervisor exceptions: accept short, accept other batch (name ≠ picker and ≠ checker). First error still counts. |
| Loading | Final. After loading nothing on the shipment can be audited or resolved. |
| Storage | New attempt-based tables (`pick_audits`, `shipment_loads`); `audits` stays for putaway. |

## Facts this builds on

- A PICK task has `to_bin_id` null: posting it (`post_task`, 0007) moves the
  stock out of the system. Physically the cartons sit at staging.
- So floor fixes (re-pick a short, return an over-pick, swap SKU/batch) need
  **no stock change** — the system already holds the planned/reported result.
  Only the two supervisor acceptances change stock.
- `post_task_by` (0023) validates the carton scan and sets `app.by_name`,
  which the movements trigger (0018) copies to `movements.by_name`.
  The task itself does not keep the picker name or the scanned code, and
  `pick_audit_detail` shows `profiles.name` (the shared account). Fixed below.
- `complete_wave_by` bulk-posts the rest of a wave without a scan.
- `create_count_task(bin, reason, source)` (0019) opens a blind count; one open
  task per bin.
- `person_name()` / `same_person()` (0016) normalise and compare typed names.

## 1. Data model — migration `0024_pick_audit.sql`

### 1.1 `pick_tasks` additions

| column | type | set by |
|---|---|---|
| `picked_by_name` | text | `post_task_by` / `complete_wave_by` (from `app.by_name`) |
| `scanned_code` | text | `post_task_by` (`p_scanned`, trimmed) |
| `bulk_posted` | boolean not null default false | `complete_wave_by` |

Existing completed tasks: `picked_by_name` backfilled from the task's picking
movement `by_name` where present, else null (shown as "(tidak tercatat)").

### 1.2 `pick_audits` — one row per attempt

| column | notes |
|---|---|
| `id` uuid pk | |
| `task_id` uuid not null → `pick_tasks` | |
| `attempt_no` int not null | 1, 2, …; unique (`task_id`, `attempt_no`) |
| `checker_name` text not null | `person_name()` |
| `found_sku` text | from scan (`item_by_barcode`) or typed SKU |
| `found_scanned_code` text | raw scan, null if typed |
| `found_batch` text not null | normalised: trim + upper |
| `found_expiry` date | |
| `counted_qty` numeric not null ≥ 0 | |
| `damaged` boolean not null default false | |
| `expected_sku`, `expected_batch`, `expected_expiry`, `expected_qty` | snapshot of the task's actuals at audit time |
| `errors` text[] not null default '{}' | subset of `SHORT, OVER, WRONG_SKU, WRONG_BATCH, WRONG_EXPIRY, DAMAGED` |
| `result` text not null | `OK` \| `MISMATCH` (`OK` ⇔ `errors = '{}'`) |
| `note` text | required when `MISMATCH` |
| `resolution` text | null \| `ACCEPT_SHORT` \| `ACCEPT_BATCH` (only on a `MISMATCH` row) |
| `resolved_by_name`, `resolved_at`, `resolution_note` | |
| `legacy` boolean not null default false | migrated from `audits` |
| `created_at` timestamptz default now() | |

Derived, not entered: `errors` is computed in the database.

- `WRONG_SKU` — `found_sku` ≠ expected SKU (then qty/batch are not compared).
- `SHORT` / `OVER` — `counted_qty` < / > `expected_qty`.
- `WRONG_BATCH` — normalised batch differs.
- `WRONG_EXPIRY` — both expiries known and different.
- `DAMAGED` — checker ticked it.

A line **passes** when its latest attempt is `OK` or is a `MISMATCH` with a
`resolution`.

### 1.3 `shipment_loads`

| column | notes |
|---|---|
| `id` uuid pk | |
| `wave_id` uuid → `waves`, `shipment_number` text | unique (`wave_id`, `shipment_number`) |
| `loaded_by_name` text not null | |
| `truck` text | optional plate / truck |
| `loaded_at` timestamptz default now() | |
| `legacy` boolean default false | pre-feature shipments |

### 1.4 Policy

`inventory_policy` gains `pick_accuracy_target_pct` (default 99.5), editable
in `/admin/settings`.

### 1.5 Views

- `pick_audit_line` — one row per COMPLETED PICK task of a non-cancelled wave:
  task fields, `picked_by_name`, `bulk_posted`, `scanned_code`, latest attempt
  (result, errors, resolution), `attempts`, `line_state`
  (`AUTO_PASS` when actual qty = 0, `TODO`, `OK`, `MISMATCH`, `RESOLVED`),
  loaded flag.
- `pick_audit_shipment` — per wave + shipment: open tasks, lines, todo, ok,
  mismatch, resolved, `state` (`PICKING`, `READY_AUDIT`, `HAS_MISMATCH`,
  `READY_LOAD`, `LOADED`), load info.
- `pick_audit_first` — first attempt per task (non-legacy) with picker, SKU,
  zone, error list, pick→audit minutes; basis for every KPI.

RLS: read for `authenticated`; no write policies — writes only via functions.
Realtime publication: `pick_audits`, `shipment_loads`.

## 2. Functions

All `security definer`, `set search_path = public`, granted to `authenticated`.

### 2.1 `post_task_by` / `complete_wave_by` (replace)

Same behaviour as 0023, plus: store `picked_by_name`, `scanned_code`;
`complete_wave_by` sets `bulk_posted = true` on the tasks it posts.

### 2.2 `record_pick_audit(p_task_id, p_checker_name, p_found, p_counted, p_batch, p_expiry, p_damaged, p_note) → jsonb`

`p_found` is a scanned code or a SKU (resolved like `ItemScanInput`).

1. Lock the task row. Must be a COMPLETED PICK of a non-cancelled wave.
2. Shipment not loaded → else `Shipment sudah dimuat`.
3. Actual qty = 0 → refuse (`Baris ini tidak dipick`; it auto-passes).
4. `same_person(checker, picked_by_name)` → refuse
   (`Checker tidak boleh picker baris ini`).
5. Latest attempt already passes → refuse (`Baris ini sudah lolos audit`).
6. Unknown barcode / SKU → refuse.
7. Compute `errors`, `result`; `MISMATCH` without note → refuse.
8. Insert attempt `max(attempt_no)+1`.
9. Return `{result, errors, expected:{sku,batch,expiry,qty}, found:{…}}` —
   the expected values leave the database only here, after saving.

### 2.3 `resolve_pick_mismatch(p_audit_id, p_action, p_by_name, p_note, p_bin default null) → jsonb`

Supervisor or admin role; name ≠ picker and ≠ that attempt's checker; note
required; target must be the task's latest attempt, `MISMATCH`, unresolved,
shipment not loaded.

- `ACCEPT_SHORT` — allowed only when `errors = {SHORT}`.
  - Movement (`type 'adjustment'`, `reason_code` for a pick correction, to the
    task's actual source bin, actual batch/expiry) of
    `expected_qty − counted_qty` back into stock.
  - `pick_tasks.actual_quantity := counted_qty`;
    `outbound.quantity_picked -= difference`.
  - Mark resolved.
- `ACCEPT_BATCH` — allowed only when errors ⊆ {`WRONG_BATCH`, `WRONG_EXPIRY`}
  and `counted_qty = expected_qty`.
  - `p_bin` required: the bin the found batch came from; it must hold ≥
    `counted_qty` of (SKU, found batch, found expiry) that is not held →
    else `Stok batch ini di bin tidak cukup: adjust atau hitung dulu`.
  - Return the original batch to the actual source bin (adjustment in) and
    take the found batch out of `p_bin` (adjustment out) in one transaction.
  - `pick_tasks.actual_batch_lot/actual_expiry_date/actual_from_bin_id`
    updated to the found values.
  - `create_count_task(source bin, 'Audit picking: batch beda', 'PICK_AUDIT')`
    unless one is already open.
  - Mark resolved.
- Anything else (wrong SKU, over, damaged, mixed) can only be fixed on the
  floor and re-audited.

Stock corrections here are `adjustment` movements posted the same way as
Adjust stok (0011/0018), with a new reason code `PICK_AUDIT` added to the
`movements.reason_code` check. They do **not** go through the adjustment
approval queue: the resolver is already a supervisor who is neither picker
nor checker, which is the same separation the queue enforces.

### 2.4 `mark_shipment_loaded(p_wave_id, p_shipment, p_by_name, p_truck) → jsonb`

Refuse unless: wave not cancelled; the shipment has no PLANNED PICK task; every
COMPLETED PICK task passes (`AUTO_PASS`, `OK`, `RESOLVED`); not already loaded.
The error lists the blocking lines. Insert `shipment_loads`.

### 2.5 Loaded shipments are frozen

`record_pick_audit` and `resolve_pick_mismatch` refuse after loading (above).
There is no unload.

### 2.6 Old `record_audit`

Replaced so `p_kind = 'PICK'` raises `Pakai audit picking baru`. PUTAWAY
unchanged.

## 3. Migration of existing data

- Each `audits` row with `kind = 'PICK'`: its `history` entries then the
  current row become `pick_audits` attempts (`legacy = true`, `checker_name`
  from the profile name, `errors` derived from qty/`sku_ok`/`batch_ok`:
  `SHORT`/`OVER`/`WRONG_SKU`/`WRONG_BATCH`).
- Every wave + shipment with a COMPLETED PICK task and `planned_date` before
  the migration date gets a `shipment_loads` row (`legacy = true`,
  `loaded_by_name = '(sebelum audit wajib)'`), so history does not block.
- Legacy rows are excluded from KPIs.

## 4. UI

### 4.1 `/audit/picking` — shipments

Shipments of the chosen date from `pick_audit_shipment`: shipment, wave NO,
truck, progress (ok+resolved / lines), state badge. Filter by state. Opens the
shipment.

### 4.2 `/audit/picking/[wave]/[shipment]` — lines

Per line: SKU, description, source bin, picker, bulk flag, state. **No
expected qty / batch / expiry before the line has an attempt.** After an
attempt: found vs expected, errors, attempt history.

- **Audit** button (TODO or failed line) → dialog:
  checker name (`person-name`, remembered per device), carton scan
  (`ItemScanInput`) or SKU, batch (Shell code decoded to fill expiry,
  editable), expiry, counted qty, damaged, note.
  After save: OK, or found-vs-expected with the errors and
  "Perbaiki di lantai, lalu audit ulang".
- Failed line, supervisor: **Terima kurang** (only when errors = SHORT) and
  **Terima batch ini** (asks source bin) → `resolve_pick_mismatch`.
- **Muat shipment**: enabled when state = `READY_LOAD`; asks name + truck.
  After loading the page is read-only.

### 4.3 `/audit/picking?tab=akurasi` — supervisor

Period 7 / 30 / 90 days, first attempts only (`pick_audit_first`):

- Tiles: line accuracy % (vs policy target), unit accuracy %, mispicks per
  1,000 lines, shipment first-pass %, coverage % (loaded shipments with all
  lines audited — should be 100 %), scan compliance %, median pick→audit
  minutes.
- Error type Pareto.
- By picker: lines, errors, accuracy %, bulk-posted lines; worst first.
- By SKU and by source zone: top error sources.
- Latest mismatches linking to their shipment.

### 4.4 Elsewhere

- Waves page: per-shipment audit / load badge.
- Dashboard: tile "Shipment menunggu audit / muat".
- Nav: "Audit picking" visible to operators too. Old `audit-list` stays for
  putaway only.
- `lib/pick-audit.ts`: pure `compareLine(expected, found)` → errors, used for
  UI copy and unit-tested; the database remains the authority.

## 5. Edge cases

| Case | Behaviour |
|---|---|
| Line picked 0 | `AUTO_PASS`, shown "tidak dipick"; not auditable |
| Wave rescheduled / cancelled | Its tasks leave the views |
| Audit after loading | Refused |
| Re-audit | Name ≠ picker; same checker allowed |
| Two checkers at once | Task row lock; attempt numbers stay sequential |
| Unknown scan | Refused before saving |
| Accept batch, bin short of that batch | Refused: adjust or count first |
| Accept short down to 0 | Passes; outbound shows the short |
| Resolver = picker or checker | Refused |
| Line already passed | New attempt refused |
| Live changes | `pick_audits`, `shipment_loads` in realtime |

## 6. Testing

- `supabase/tests/10_pick_audit.sql` (style of `06_audits.sql`): error
  derivation for every type; checker = picker refused; attempt numbering;
  audit on passed line refused; `ACCEPT_SHORT` stock + outbound effect and
  guard (only SHORT); `ACCEPT_BATCH` stock effect, insufficient-bin refusal,
  recount task; resolver ≠ picker/checker; loading refused with open, TODO or
  failed lines and allowed when all pass; frozen after loading; `record_audit`
  PICK refused; legacy migration; KPI view numbers on a fixed dataset.
- `tests/pick-audit.test.ts`: `compareLine`.
- `npm run typecheck`, `npm run lint`, `npm test`, manual walkthrough on the
  dev server.

## Out of scope

Putaway audit, printed audit labels, damage photos, unloading.
