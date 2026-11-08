# Staging Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rekap inbound `STAGE-IN` rows are booked into the `STAGING` location once per arrival day, and the Inventory team moves them into racks from a new `Staging` page, so SAP vs WMS counts staging drums the whole time.

**Architecture:** The putaway parser maps staging codes to `STAGING`. Migration 0134 redefines the `putaway_import_arrival` wrapper to split staging rows from rack rows: rack rows go to `putaway_import` (0066) unchanged; staging rows are posted additively and recorded in an append-only `staging_receipts` table keyed by arrival day, which makes a re-upload a no-op. Two RPCs, `staging_stock()` and `staging_to_rack(...)`, feed and post from the new page; existing movement triggers keep validating stock, bins and holds.

**Tech Stack:** Next.js 15 App Router, React 19, TS strict, Tailwind; Supabase Postgres 16 (plpgsql, RLS); tsx tests; psql SQL tests via `scripts/sql-test.sh`.

**Spec:** `docs/superpowers/specs/2026-11-08-staging-handling-design.md`

## Global Constraints

- UI strings Indonesian; code, comments, docs English; no emojis.
- Stock changes only through `movements`; no write policy on `inventory`; new tables append-only by trigger (`ledger_forbid_change`) with read policy `(select public.is_active())`.
- New SECURITY DEFINER functions: `set search_path = public`, `revoke ... from public, anon`, `grant ... to authenticated`.
- Never edit a pushed migration (0001-0133); everything goes in `supabase/migrations/0134_staging_handling.sql`.
- Staging stays pickable as a last resort; no allocator change.
- Staging page jobs: `Inventory`, `Admin Inbound`, `Leader`, `Admin`. Putaway page jobs unchanged (`Admin Inbound`, `Leader`, `Admin`).
- "Waiting long" = 3 days or more (same as the dashboard staging tally `d3p`).
- Bin codes shown as the yellow plate (`rounded-plate bg-plate font-cond`); phone = cards, desktop = table; one confirmation with a summary sentence; nothing after posting.
- Never run a second `next dev` in this folder; never read `.env*` / `backups/`; commit only when the user asks (the commit steps below are skipped unless asked).

## Review Focus

1. Re-uploading the same day's Rekap after the drums were already moved to a rack: must post nothing for staging rows (Task 2 test "same day twice").
2. Two Rekap days with the same SKU+batch+expiry into staging: both post (different arrival day), and `staging_stock()` shows the oldest age (Task 2/3 tests).
3. Moving more than is in staging, or quantity reserved by an open pick task: refused with a clear message, for every job level (Task 3 tests; `guard_reserved_stock` skips supervisors, so the RPC checks itself).
4. Scanning a rack that Shell may not use (CKB-owned, NOT_PRESENT, PLANNED, blocked): refused by the database, message shown on the page (Task 3 test + Task 5 error display).
5. A sheet row with blank `BIN Location`: never staged, reported as "belum diisi" (Task 1 test).

---

### Task 1: Parser maps staging codes; blank BIN Location wording

**Files:**
- Modify: `lib/putaway-sheet.ts` (`parsePutawayDetail`, add `stagingCode`)
- Modify: `app/(app)/putaway/putaway-client.tsx:62` comment and the pending-pallets notice text
- Test: `tests/putaway-sheet.test.ts`

**Interfaces:**
- Produces: `export function stagingCode(raw: string): string | null` — returns `"STAGING"` for a code (trimmed, upper-cased) that starts with `STAG` (`STAGE-IN`, `STAGE IN`, `STAGING-IN`, `STAGING`), `null` otherwise (`STG_01`, rack codes, `QUA-SHELL`, `""`).
- `parsePutawayDetail` rows: a staging code row has `bin_code: "STAGING"` and `sheet_bin` set to the original text (e.g. `"STAGE-IN"`) so the page can show what the file said.

- [ ] **Step 1: Write the failing tests** in `tests/putaway-sheet.test.ts` (same inline `test()` shape):
  - `stagingCode("STAGE-IN") === "STAGING"`, `stagingCode(" stage in ") === "STAGING"`, `stagingCode("STAGING") === "STAGING"`, `stagingCode("STG_01") === null`, `stagingCode("CB12A01") === null`, `stagingCode("QUA-SHELL") === null`.
  - A Rekap-shaped sheet (header with `Pallet ID`) with 3 rows `STAGE-IN`, same SKU 550046498, batch `12718466`, qty 4, different Pallet IDs, same expiry → one row `{ bin_code: "STAGING", sheet_bin: "STAGE-IN", quantity: 12, error: null }`.
  - A row with a Pallet ID and blank `BIN Location` → not in `rows`, counted in `pending` (unchanged behaviour).
- [ ] **Step 2: Run** `TZ=Asia/Jakarta npx tsx tests/putaway-sheet.test.ts` — expect FAIL (`stagingCode` not exported).
- [ ] **Step 3: Implement** `stagingCode` and apply it in `parsePutawayDetail` right after `bin_code` is read (before the summing key is built, so staging rows sum per SKU+batch+expiry by the existing rule). Change the page text for `pending` from "di staging" wording to: `"{n} palet belum diisi BIN Location di sheet ini (belum diposting)."` and fix the code comment at line 62.
- [ ] **Step 4: Run** the test again — expect all PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** (only if asked): `feat(putaway): map Rekap STAGE-IN rows to the STAGING location`

### Task 2: Migration 0134 part 1 — staging rows post once per arrival day

**Files:**
- Create: `supabase/migrations/0134_staging_handling.sql` (header comment states the 3 Nov `STAGE-IN` incident and the reused Pallet IDs)
- Create: `supabase/tests/98_staging_handling.sql` (shape of `96_plan_racks.sql`: `begin; ... rollback`, `pg_temp.check`, `pg_temp.fails`, `pg_temp.as_user`)

**Interfaces:**
- Produces table `public.staging_receipts(id uuid pk default gen_random_uuid(), arrival_date date not null, bin_id uuid not null references bins, item_id uuid not null references items, batch_lot text not null, expiry_date date, quantity numeric not null check (quantity > 0), movement_id uuid not null references movements, import_id uuid not null, source text, by_name text, created_by uuid default auth.uid(), created_at timestamptz default now())`, unique index on `(arrival_date, bin_id, item_id, batch_lot, coalesce(expiry_date, 'infinity'))`; append-only trigger; read policy `is_active()`.
- Produces `putaway_import_arrival(p_rows jsonb, p_source text, p_apply boolean, p_by_name text default null, p_arrival_date date default null) returns jsonb` (same signature, `create or replace`). Behaviour:
  - Date checks unchanged (apply only). On preview `p_arrival_date` may be given and is used to detect already-posted staging lines.
  - Split `p_rows`: a row whose `bin_code` is a bin with `zone = 'STAGING'` is a staging row; the rest go to `putaway_import(...)` exactly as today (skip the call when there are none, returning the same keys with `rows: []`, `movements: 0`).
  - Per staging row: unknown SKU → verdict `{line, status:'conflict', kind:'sku_unknown', ...}` as `putaway_import` reports it; key already in `staging_receipts` for that arrival date → `{line, status:'same', kind:'staging_done'}`; else `{line, status:'new', kind:'staging'}`. On apply, `new` rows insert one `movements` row `type 'putaway'`, `to_bin_id` = the staging bin, `from_bin_id` null, `received_date = p_arrival_date`, `note = 'Rekap inbound ' || p_source || ' (STAGE-IN)'`, `by_name`; then a `staging_receipts` row; then `putaway_arrivals` (one row per call, its own `gen_random_uuid()` import id when `putaway_import` produced none) and `putaway_arrival_moves` rows for these movements, so Buku stok books them on the arrival day.
  - Result: `putaway_import`'s object with staging verdicts merged into `rows` (ordered by `line`), `movements` incremented by staging posts, plus `staging: <int posted>`.
  - Role: same as `putaway_import` today (it raises for non-supervisors; keep the wrapper's staging branch behind the same `has_role(array['supervisor','admin'])` check, message `'Hanya supervisor atau admin'`).

- [ ] **Step 1: Write the failing SQL test** `98_staging_handling.sql`, first block (as a supervisor; fixture: an item `T98-SKU`, a second item already in `STAGING` so the bin is "occupied"):
  - `posts a staging row into an occupied STAGING bin` — `putaway_import_arrival('[{"line":1,"bin_code":"STAGING","sku":"T98-SKU","batch_lot":"B1","expiry_date":"2028-01-01","quantity":4}]', 'Rekap inbound 202611.xlsx', true, 'Sup', current_date - 1)` → `rows->0->>'kind' = 'staging'`, `(staging) = 1`, inventory of T98-SKU in STAGING = 4, `received_date = current_date - 1`.
  - `same day twice posts nothing` — the same call again → `rows->0->>'status' = 'same'`, `kind = 'staging_done'`, inventory still 4, movements count unchanged.
  - `preview reports staging_done without posting` — `p_apply false` with `p_arrival_date current_date - 1` → `staging_done`, no new movement.
  - `another arrival day posts again` — `current_date - 2` → inventory 8.
  - `buku stok sees the arrival day` — a `putaway_arrival_moves` row exists for the movement with `arrival_date = current_date - 1`.
  - `rack rows still go through putaway_import` — a mixed call with one rack row into an empty Shell rack bin returns `kind` null / `status 'new'` for it and posts it.
  - `staging_receipts is append-only` — `pg_temp.fails('update staging_receipts set quantity = 1', '%')`.
  - `an operator cannot post` — as an operator account → fails `'%supervisor%'`.
- [ ] **Step 2: Run** `scripts/sql-test.sh` (or the single file after migrations) — expect FAIL lines (table/behaviour missing).
- [ ] **Step 3: Implement** part 1 of `0134_staging_handling.sql` as specified above.
- [ ] **Step 4: Run** test 98 — every line PASS; run the full `scripts/sql-test.sh` — all green except the known 82.
- [ ] **Step 5: Commit** (only if asked): `feat(putaway): book STAGE-IN rows into staging once per arrival day (0134)`

### Task 3: Migration 0134 part 2 — `staging_stock()` and `staging_to_rack(...)`

**Files:**
- Modify: `supabase/migrations/0134_staging_handling.sql` (append)
- Modify: `supabase/tests/98_staging_handling.sql` (append)

**Interfaces:**
- Produces `staging_stock() returns table (bin_code text, item_id uuid, sku text, description text, uom text, batch_lot text, expiry_date date, quantity numeric, reserved numeric, arrival_date date, days_waiting int)` — SECURITY DEFINER, stable; raises `'Akses ditolak'` unless `is_active()` and `has_job(array['Inventory','Admin Inbound','Leader','Admin'])`. One row per `inventory` row with `quantity > 0` in a bin with `zone = 'STAGING'`. `arrival_date` = `inventory.received_date` (what the dashboard tally ages on); `days_waiting` = Jakarta today − `arrival_date` (null when the date is null). `reserved` = sum of `open_pick_tasks.quantity` on that bin+item+batch+expiry. Ordered by `arrival_date nulls first, bin_code, sku`.
- Produces `staging_to_rack(p_from_bin text, p_sku text, p_batch text, p_expiry date, p_qty numeric, p_to_bin text, p_by_name text) returns uuid` (the movement id) — SECURITY DEFINER; same job check as `staging_stock`; refuses (Indonesian messages):
  - source bin not `zone = 'STAGING'` → `'Bukan lokasi staging: %'`;
  - target not a rack code (`^C[A-Z]\d{2}[A-E]\d{2}$`) → `'Tujuan harus lokasi rak: %'`;
  - `p_qty <= 0` or more than on hand → `'Jumlah melebihi stok di staging (% tersedia)'`;
  - on hand − `p_qty` < reserved → `'Stok ini dipesan % unit untuk wave %. Kerjakan lewat halaman Wave.'` (the same wording as `guard_reserved_stock`, checked here for every job because that guard skips supervisors).
  Inserts one `movements` row `type 'transfer'`, `from_bin_id` staging, `to_bin_id` rack, same item/batch/expiry, `received_date` carried from the staging row, `note 'Dari staging'`, `by_name`. Bin usability (CKB, NOT_PRESENT, PLANNED, blocked) is left to the existing triggers.

- [ ] **Step 1: Write the failing tests** (append to 98), as an `Inventory`-job account unless stated:
  - `staging_stock lists the staged line with its age` — after Task 2's posts, the row for T98-SKU `arrival_date = current_date - 2` has `days_waiting = 2`.
  - `moves part of a line` — `staging_to_rack('STAGING','T98-SKU','B1','2028-01-01', 3, '<empty Shell rack>', 'Inv')` → STAGING qty for that day line drops by 3, rack holds 3, SKU total unchanged.
  - `moves the rest` and the line disappears from `staging_stock()`.
  - `refuses more than is there` → `'%melebihi%'`; `refuses a non-staging source` (a rack bin) → `'%Bukan lokasi staging%'`; `refuses a floor target` (`STG_01`) → `'%rak%'`; `refuses a CKB-owned rack` (set a bin `owner = 'CKB'` in the fixture) → fails (any message); `refuses reserved quantity` (an open pick task on the staging line for a wave) → `'%dipesan%'`, also when called as a supervisor.
  - `an Operator / Picker cannot see or move staging` → both fail `'%Akses ditolak%'`.
- [ ] **Step 2: Run** test 98 — new lines FAIL.
- [ ] **Step 3: Implement** both functions with grants.
- [ ] **Step 4: Run** test 98 (all PASS) and the full SQL suite (green except 82).
- [ ] **Step 5: Commit** (only if asked): `feat(inventory): staging list and move-to-rack RPCs (0134)`

### Task 4: Putaway page shows staging rows

**Files:**
- Modify: `app/(app)/putaway/putaway-client.tsx` (preview call, verdict display, result banner)

**Interfaces:**
- Consumes: Task 2 verdict kinds `staging` / `staging_done`, result key `staging: number`; Task 1 `sheet_bin`.

- [ ] **Step 1:** Send `p_arrival_date: arrival || null` on preview calls too (not only on apply), so a re-upload is recognised before posting.
- [ ] **Step 2:** In the review list, a `kind === 'staging'` row shows the plate `STAGING` with a small label `ke staging` (and the file's `sheet_bin` text when it differs); `staging_done` shows `sudah dicatat di staging (dilewati)` using the existing `same` styling.
- [ ] **Step 3:** In the done step, when `result.staging > 0`: one line `"{n} baris masuk staging."` with a `Link` to `/staging` labelled `Lihat Staging`.
- [ ] **Step 4:** `npm run typecheck && npm run lint` clean; screenshot the review step from a throwaway copy (rsync without `.env*`, symlinked `node_modules`, playwright-core with the cached Chromium) with a 3-row `STAGE-IN` sheet.
- [ ] **Step 5: Commit** (only if asked): `feat(putaway): show staging rows on review and result`

### Task 5: The `Staging` page

**Files:**
- Create: `lib/staging.ts`, `tests/staging.test.ts` (add to the `npm test` chain with `TZ=Asia/Jakarta`)
- Create: `app/(app)/staging/page.tsx` (server; `requirePage('/staging')`), `app/(app)/staging/staging-client.tsx`, `app/(app)/staging/move-dialog.tsx`, `app/(app)/staging/loading.tsx`
- Modify: `components/app/nav-config.ts` (Stok group, after `Inventory`: `{ href: "/staging", label: "Staging", blurb: "Barang di staging dan pindah ke rak.", icon: <lucide Warehouse or PackageOpen>, jobs: [IV, AI, LD, AD] }`)
- Modify: `tests/jobs-pages.test.ts` if it enumerates pages
- Modify: the realtime refresh list if pages subscribe by table (follow `/inventory`'s pattern so a move elsewhere refreshes the list)

**Interfaces:**
- Consumes: `staging_stock()`, `staging_to_rack(...)` (Task 3).
- Produces in `lib/staging.ts`:
  - `export const STAGING_LONG_DAYS = 3`
  - `export type StagingLine = { bin_code: string; item_id: string; sku: string; description: string; uom: string; batch_lot: string; expiry_date: string | null; quantity: number; reserved: number; arrival_date: string | null; days_waiting: number | null }`
  - `export function waitLabel(days: number | null): string` — `null` → `"tanggal datang tidak diketahui"`, `0` → `"hari ini"`, `1` → `"1 hari"`, `n` → `"{n} hari"`.
  - `export function isLong(days: number | null): boolean` — `days !== null && days >= STAGING_LONG_DAYS`.
  - `export function movable(l: StagingLine): number` — `max(0, quantity - reserved)`.
  - `export function moveSentence(l: StagingLine, qty: number, to: string): string` — `"Pindah {qty} {uom} {sku} dari {bin_code} ke {to}?"` (qty via `fmtNum`).

- [ ] **Step 1: Write failing tests** `tests/staging.test.ts`: `waitLabel(null|0|1|5)` values above; `isLong(2) === false`, `isLong(3) === true`, `isLong(null) === false`; `movable({quantity: 20, reserved: 8}) === 12`, `movable({quantity: 4, reserved: 9}) === 0`; `moveSentence(line{quantity 20, uom 'EA', sku '550046498', bin_code 'STAGING'}, 4, 'CB12A01') === 'Pindah 4 EA 550046498 dari STAGING ke CB12A01?'`.
- [ ] **Step 2: Run** `TZ=Asia/Jakarta npx tsx tests/staging.test.ts` — FAIL.
- [ ] **Step 3: Implement** `lib/staging.ts`; run — PASS.
- [ ] **Step 4: Build the page.** Header: total lines, total qty, how many are `isLong`. List oldest first (the RPC order); each line: plate of the staging bin, SKU + description, batch · exp, qty + UoM (and `"{reserved} dipesan wave"` when reserved > 0), arrival date + `waitLabel` (warn colour when `isLong`), button `Pindah ke rak` (disabled when `movable` is 0). Search box filters by SKU / description / batch. Phone: cards; desktop (`md:`): table. Empty state: `"Tidak ada barang di staging."`
- [ ] **Step 5: Build the move dialog.** Rack field doubles as scanner input (`autoFocus`, upper-cased, Enter submits; scanning the rack label types the code), qty defaults to `movable(line)`, number with − / +, `Nama Anda` field following the existing personal-account rule, then a confirm step showing `moveSentence(...)` and `Ya, pindahkan`. On success: close, `router.refresh()`, no further prompt. On error: show the database message in the dialog.
- [ ] **Step 6:** `npm run typecheck && npm run lint` clean; `npm test` (known `ckb-isolation` failure only); screenshots of the page at 400px and desktop from the throwaway copy with sample data.
- [ ] **Step 7: Commit** (only if asked): `feat(inventory): Staging page with move to rack`

### Task 6: Docs and notes

**Files:**
- Modify: `AGENTS.md` (Gotchas: one bullet "Staging (0134)" — STAGE-IN mapping, once per arrival day via `staging_receipts`, staging stays pickable last, `staging_to_rack` checks reservations itself, SQL test 98); README (feature list + §1 value `STAGING_LONG_DAYS` 3 days alongside the dashboard tally)
- Modify: memory (`project` note for 0134, next migration 0135)

- [ ] **Step 1:** Write the docs as above.
- [ ] **Step 2:** Final verification: full SQL suite, `npm test`, typecheck, lint; report results faithfully.
