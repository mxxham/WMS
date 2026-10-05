# AGENTS.md — CKB Warehouse WMS

Warehouse management system for **PT Cipta Krida Bahari · WSM SUB 2 Surabaya** (Shell lubricant
warehouse). One application, one database, one stock ledger.

Bin labels · barcode scanning · 3D stock · FEFO allocation · picklists · waves · putaway ·
cycle count · inventory control · audits.

## What matters most

Two rules decide whether a change is correct. Break either one and the warehouse is wrong, not
just the code:

1. **Stock only changes through the `movements` table.** The `apply_movement` trigger validates and
   mutates `inventory`. `inventory` has *no write policy at all*. Never add one.
2. **FEFO is absolute.** Every other picking rule operates *inside* a single expiry date. No bin with
   a later expiry is ever touched while stock of an earlier one remains.

When a change touches picking, replenishment, or `Sisa`, read `docs/ALLOCATOR.md` first. It is the
specification, not a summary. `lib/allocator/` implements it and nothing else.

## Stack

Next.js 15 (App Router, RSC) · React 19 · TypeScript 5 (`strict`) · Tailwind 3 + shadcn/ui
(`components.json`, `rsc: true`, aliases `@/components`, `@/lib/utils`) · Supabase (PostgreSQL 16)
· Three.js 0.186 · ExcelJS + SheetJS · jsPDF · Node >= 20.

`tsconfig` is `strict`. `noUncheckedIndexedAccess` is **off** — if you want index-safety, assert it;
do not assume the compiler is doing it for you.

## Commands

```bash
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run lint         # eslint, next/core-web-vitals
npm run build        # next build
npm test             # whole TypeScript suite, 31 files
```

Phone cameras need HTTPS or localhost. `npx next dev --experimental-https` for device testing.

Other scripts: `npm run allocate:file -- data/file.xlsx --out out --as-of 2026-09-24 [--db] [--pdf]`
(CLI entry into the same engine), `npm run seed:generate`, `scripts/sql-test.sh` (all SQL tests).

### SQL tests

Requires local Postgres. Apply in filename order — never the SQL Editor, never partially:

```bash
psql -f supabase/tests/00_local_auth_stub.sql   # auth schema + role stub
for f in supabase/migrations/*.sql; do psql -f "$f"; done
psql -f supabase/seed.sql
psql -f supabase/tests/01_rls_and_stock_rules.sql
```

`supabase/tests/00`–`22` each print PASS/FAIL per row and **every row must PASS**. Tests `04`–`22`
roll back, so they are safe on local Supabase. `00_local_auth_stub.sql` is a stub, not real Supabase
Auth — passing locally does not prove Auth behaviour.

`supabase db push` applies migrations `0001_schema.sql`–`0048_add_wave_items.sql`. Two that are
easy to miss: `0005` adds the explicit `authenticated` grants without which *every query fails with
"permission denied"* on new projects, and `0015_realtime.sql` powers the `Live` dot and page refresh
(pages work without it, they just never update).

## Architecture

```
app/(app)/<feature>/     route + client component per page; Indonesian UI
app/api/                 route handlers
components/<area>/       bin, scan, warehouse, app/nav.tsx (role-gated nav)
lib/allocator/           FEFO engine — pure functions, zero I/O
lib/*.ts                 feature logic: labels, import, audit, SAP, batch codes
supabase/migrations/     48 files; the real index of what exists
supabase/seed.sql        2,570 bins / 106 SKUs / 1,790 stock rows
tests/*.test.ts          31 standalone tsx files
```

### The allocator engine

`lib/allocator/` was a standalone repo. It is **pure functions with no I/O** — stock in, allocation
out. Keep it that way; adapters are the only place that touches a workbook or a database.

| File | Owns |
|---|---|
| `types.ts`, `config.ts` | domain model; every business rule in one place |
| `binselect.ts` | `selectNextBin` — the FEFO bin-choice rule; the only place *source* bins get ranked |
| `allocator.ts` | outbound allocation + `relocateByWaveOrder` |
| `pickface.ts` | derives each SKU's dedicated pick bin |
| `ledger.ts` | physical-identity ledger (location + SKU + batch + expiry) |
| `picklist.ts`, `pickpath.ts` | task grouping, serpentine travel order, check digit |
| `plan.ts` | allocation → `save_plan` RPC payload |
| `picklist-from-tasks.ts` | rebuilds printable picklists from a saved plan |
| `adapters/`, `browser/`, `cli.ts` | ExcelJS / SheetJS / Supabase / PDF edges |

**One bin-choice rule.** `selectNextBin` in `binselect.ts` ranks source bins for outbound picking,
and it is the only place that ranking exists. Do not re-implement it or copy its ordering — a second
copy is how a feature silently leaves FEFO order.

**Replenishment is not a second pass over stock.** `relocateByWaveOrder` runs *after* allocation,
replays the run's real bin balances in `executionOrder`, and writes each line's `moveQty`/`moveTo`;
`plan.ts:96` turns those into the `REPLENISH` tasks. `docs/ALLOCATOR.md` states the invariant — the
source choice is "literally the same function", so replenishment can never leave FEFO order — but
read it as the rule to hold to, not as a description of the call graph today. A pickface bin is
topped up, never drawn from, even when it holds another SKU.

Quantities are **cartons (CAR)** everywhere — allocator, SAP `Delivery quantity`, WMS `Qty`. `UPP` is
cartons per pallet, read from the WMS row and falling back to `MASTER DATA`.

## Domain invariants

**Stock identity is `bin + SKU + batch + expiry`.** Two expiry dates inside one batch in one bin are
two stock rows. Never collapse them.

**Pickable bins.** Rack location `C[A-Z]dd[A-E]dd` (`RACK_BIN_REGEX`, `config/warehouse.ts:11`; aisle
`CG` exists in the data but is missing from the mapping table), status `Aktif`, qty > 0, not blocked,
at least `minRemainingShelfLifeDays` of life left at the run date. `STAGING`, `STAGING_INB` and
`Quarantine` are never picked from.

**Pick order, inside one expiry date:**
1. ≥1 pallet still needed → a sealed full pallet, nearest on the route. Reserve pallets beat the
   pickface's own sealed pallet, which is kept for loose cartons.
2. The loose rest → the pickface, when it covers the rest.
3. One order line, one bin → a single reserve bin covering the rest at no extra pallet cost.
4. Otherwise pickface first, then an already-open pallet (best fit); a sealed pallet opens last
   (`breaksPallet`, *buka palet*). Never break a pallet for 1 carton.

**Shortages carry a reason**, never a false stock-out: `ALREADY_STAGED`, `BLOCKED_SHELF_LIFE`,
`NO_STOCK`.

**`Sisa` is computed by replaying** all lines against real bin balances in one fixed order — NO
waves by *earliest* slot then NO, shipments by slot then number, then printed walking order. That one
order is the print order, the task-numbering order, and the Wave-page reprint order. Change it in
one place or the picklists disagree with each other.

**Replenishment runs after allocation**, against stock left after today's orders are reserved, so it
never takes a carton an order needs. **A pickface bin is never a replenishment source** — it is
topped up, never drawn from, even when it holds another SKU.

**Pick path is travel order, not SKU order.** Back-to-back blocks: one aisle code = one block, bays
01–20 left face, 21–40 right face, bay 21 behind bay 01 (`baysPerSide: 20`). Serpentine lanes, no
empty return leg. `baysPerSide: 0` restores the old one-row-per-aisle route.

**Forklift and handpick are separate picklists per shipment** (`-FL` / `-HP`) so nobody switches
equipment mid-run. `splitPalletAndCaseTasks: false` combines them.

## Database rules

- **Stock is validated in the database, not the UI.** The stock row is locked `FOR UPDATE` before
  decrement, so two operators picking the same carton stay safe.
- **`movements` cannot be edited or deleted.** A correction is a *new* movement. This is normal
  warehouse audit practice, not an oversight.
- **The author of a movement is forced to the session account** by the trigger. A `user_id` from the
  client is ignored.
- **Roles live in `profiles`**, checked through a `has_role()` SECURITY DEFINER function so a policy
  never recursively reads the table it protects. RLS *and* a role check, both.
- **Plan tables have no write policy.** Every change goes through a role-checking SECURITY DEFINER RPC
  (`save_plan`, `post_task`, `import_snapshot`).
- **An empty batch is `''`, never NULL.** A unique key on `(bin, SKU, batch)` does not consider two
  NULLs equal.
- **Posting is idempotent and atomic** — unique index on `movements(task_id)`; `Selesaikan wave` runs
  in one transaction.
- **Plans roll forward.** `save_plan` replaces only untouched waves; running waves stay.
- **Reservation, not locking.** Physical stock stays one number; open tasks only reduce it *for
  planning*. Operators cannot manually move reserved stock.
- **A plan is not an execution.** Saving writes `waves`, `pick_tasks`, `outbound`. Stock moves when a
  task is posted.
- **Use `Remain Qty`, not `Qty`** — it already accounts for the day's picks, putaways and transfers.
- **List queries paginate at 1,000 rows.** Supabase's default limit silently truncates 2,570 bins.
- **The Excel reader stops at the last non-empty cell.** The WMS sheet declares a range to row
  1,048,563; reading only what exists cut import from ~21s to ~2s.

Roles: `operator` (Scan, Penerimaan, Wave, Inventory, Gudang 3D, Cycle count, audits) ·
`supervisor` (adds Dashboard, Alokasi, Putaway, Pickface, Adjust stok, Mutasi, Kualitas data,
Lacak batch, Label, Master item) · `admin` (adds Import, Pengaturan).

## Conventions

- **UI strings are Indonesian. Code, comments, and docs are English.** The README quotes on-screen
  names in `backticks` so instructions match the screen. Keep that convention.
- Pages are cards on a phone, tables on a desktop.
- Every action has a confirmation step with a summary sentence — a mis-tap on the floor costs more
  than one extra tap.
- Roles gate the navigation in `components/app/nav.tsx`. Hiding a nav item is not authorization; RLS
  is.
- Client components are the default in `app/(app)/`; keep server components server-side and push
  `'use client'` down to the leaf that needs it.
- **Bin codes are shown like the yellow location plates on the rack.**
- Changing a physical assumption (label colours, arrow direction, rack dimensions, shelf life,
  near-expiry days, approval thresholds) belongs in `config/warehouse.ts` or `inventory_policy` —
  README §1 lists all 12 and where each one lives. Never scatter a value.
- Print labels at **100% scale**. Labels are vectors, not PNGs, so 203 dpi stays sharp. Keep the
  3 mm QR/Code 128 quiet zone — scanners need it to find the start and end.
- 3D uses one instanced mesh (one draw call for 2,570 bins) and `frameloop="demand"`. Bin
  coordinates are computed in the database from layout config — change a dimension once.

## Tests

31 standalone files in `tests/`, run by `tsx`. **No jest, no vitest, no test runner.** Each file
declares its own `test()` helper and its own `passed`/`failed` counters on `node:assert`'s `strict`:

```ts
import { strict as assert } from 'node:assert';
import { withConfig } from '../lib/allocator/config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
```

Follow that shape exactly — inline helpers, no shared framework, and the process must exit non-zero
when `failed > 0`. `npm test` chains all 31 files with `&&`, so one failure stops the rest.

Most tests construct `StockBin`/`DemandLine` fixtures inline against `withConfig({ asOf })` and run
the real engine against real workbooks in `data/`. When you add a test for an allocator rule, assert
on quantities, pallet openings and FEFO order — not just "it didn't throw".

7 of the 31 files are prefixed `TZ=Asia/Jakarta` in the `npm test` chain —
`excel-date`, `picklist-sisa-replay`, `b2b-sisa-consistency`, `picklist-stress`,
`picklist-stress-dedicated`, `putaway-sheet`, `sheet-picklist`. They assert on dates at day
boundaries (Excel serial parsing, `asOf` comparisons), so they would pass or fail depending on the
machine's timezone. Prefix any new test the same way if it touches a date boundary, and add it to
the chain in `package.json` — a file that is not in the chain never runs.

Regression guards worth knowing: `one-bin-per-line.test.ts` (FEFO at every pick),
`picklist-sisa-replay.test.ts` (`Sisa` and the bin-to-bin move on the real workbooks),
`stock-adapter.test.ts` (database and workbook produce identical stock).

## Environment

`.env.example` → `.env.local`. Five variables:

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | safe for the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only.** Bypasses RLS. Never prefix with `NEXT_PUBLIC_`, never send to the browser. |
| `SITE_ACCOUNT_EMAIL` | shared site account (an admin in Supabase Auth) |
| `SITE_ACCOUNT_PASSWORD` | |

Every visitor shares this one session, so the app opens without a login screen. Public sign-up is
disabled. Do not add per-user auth to a feature.

`.env.local`, `.env.ckb-wms-v2.local`, `.env.local.bak-allocator`, and `backups/` exist in the working
tree — **never read, print, or commit them.**

## Git

Branch `integrate-bin-system`. Conventional Commits with a scope: `feat(waves):`, `fix(allocator):`,
`docs(readme):`, `test(sql):`, `feat(allocate):`, `style:`, `feat(inventory):`. Imperative mood, no
emoji.

Migration and test numbers are named in the message when relevant — several migration headers record
the real floor incident that motivated them, and that context is the point.

## Gotchas

- **Working tree is dirty.** `lib/allocator/config.ts` (phantom-rack `blockedBins`: full CE33 row,
  CE32 position 02, CE34 position 01 — pillars on the floor, rows deleted from the DB but listed so
  the engine never picks from or relocates into them) and `tests/stock-adapter.test.ts` have
  uncommitted edits. `.vercel.bak-allocator/` and `.vercel.bak-ckb-warehouse/` are untracked. Do not
  revert or overwrite them.
- **`npm` `xlsx@0.18.5` has advisories** (prototype pollution / ReDoS) fixed in the official CDN build:
  `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Outstanding before production.
- **Direct thermal printers are black-only.** Label colour mode needs pre-printed labels, a colour
  printer, or the B/W mode in the Label menu.
- **Data issues are real, not hypothetical** — `docs/DATA_ISSUES.md`: bin CC01C01 holds `#VALUE!`,
  CE08A01 expired in 1930, batches CD39C01/C02 that Excel read as dates, 129 bins with qty 0, 57
  duplicate `Lokasi` rows. Column mapping is `docs/DATA_MAPPING.md`. Import
  reports these; it does not reject them, and neither should you — the goods are physically there.
- **12 go-live assumptions in README §1 are still assumptions.** Rack 3D dimensions, ABC classes,
  missing aisle CG, racks CC19/CC20/CE33, and the 90-day near-expiry threshold all need field
  confirmation. Do not treat them as settled.
- **Docs:** `README.md` (features, setup, phase-by-phase, design decisions) · `docs/ALLOCATOR.md`
  (FEFO spec) · `docs/INVENTORY_CONTROL.md` · `docs/DATA_ISSUES.md` · `docs/DATA_MAPPING.md` ·
  `docs/archive/allocator/` is **obsolete** — it describes code that has been replaced.