# Remainder wave on re-run (Tunda mid-run) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a run meets a shipment whose wave was Tunda'd mid-run, saving the plan retracts that shipment's open tasks in the carried wave and lands the sheet-minus-done remainder as a brand-new wave with fresh picklists.

**Architecture:** Pure remainder-planning math stays in `lib/allocator/carry-over.ts` (demand-lines re-waved client-side, fresh FEFO run as ordinary demand); the destructive half (retract + settle residue + save) is one new SECURITY DEFINER RPC (`save_plan_with_retract`) whose save step *is* the existing `save_plan` logic, so kept/replaceable/clash invariants never fork.

**Tech Stack:** PostgreSQL 16 RPC (Supabase), TypeScript 5 strict, the repo's standalone `tsx` tests, Next.js 15 client.

**Spec:** `docs/superpowers/specs/2026-10-24-remainder-wave-replan-design.md`

## Global Constraints

- Quantities are cartons (CAR); `UPP` = cartons per pallet (types.ts header).
- FEFO is absolute; one bin-choice rule only (`binselect.ts: selectNextBin`) — the remainder run is ordinary demand to the engine, nothing copies bins.
- `movements` is append-only; retraction adds only the settle movements `0074`'s cancel path already writes.
- An empty batch is `''`, never NULL (carried rows already comply; new rows via `buildPlan` inherit `batch_lot: l.batch ?? ''`).
- Lists paginate at 1,000 rows (`fetchAll`).
- UI strings Indonesian; code/comments/docs English.
- `tsconfig` strict, `noUncheckedIndexedAccess` **off**.
- Tests: standalone `tsx` files with the inline `test()` helper + `passed`/`failed` counters; SQL tests print PASS/FAIL per row in `supabase/tests/57_save_plan_with_retract.sql`; register the tsx file in the `&&` chain in `package.json`.
- New migration number: `0090` (confirmed current max is `0089`).
- Commit per task on green (user-approved). Conventional Commits — scope `feat(allocate):` / `fix(allocate):` / `test(sql):` / `docs(readme):` matching the README scheme; imperative mood, no emoji.

## Review Focus

1. **Aborted run:** a `Jalankan alokasi` that is never saved must not retract or create anything — retraction lives only inside the save RPC. Test: Task 2's SQL test asserts no state change from a rolled-back call; Task 1's pure functions never mutate.
2. **Multi-shipment carried wave:** retracting one shipment must not touch sibling shipments' tasks in the same wave. Test: Task 2 SQL test row set.
3. **Staged part never double-picks:** sheet 80, picked 30 → remainder 50 planned; nothing allocates against the 30 at STAGING. Test: Task 1 unit test + Task 4's tsx integration.
4. **Wave-NO collision:** the remainder wave's NO must never clash with a kept wave's NO on the run date. Test: Task 1 unit test (`nextFreeWaveNo`).
5. **Sisa truth across two waves sharing a shipment:** old wave's posted picks replay at actuals; the new wave replays as planned; interleaved by slot/NO in one fixed order. Test: Task 4's replay test.

---

### Task 1: Pure remainder planning (`carry-over.ts`)

**Files:**
- Modify: `lib/allocator/carry-over.ts`
- Test: `tests/carry-over.test.ts`

**Interfaces:**
- Consumes: `matchParked()` (existing, unchanged), `ParkedOrder.quantity_picked` (already exposed by the `parked_orders` RPC row shape).
- Produces for later tasks:
  - `export function nextFreeWaveNo(taken: ReadonlySet<string>): string` — min numeric NO ≥ 1 not in `taken`, as `String(n)`.
  - `export interface RemainderSave { retracts: { wave_id: string; shipment_number: string; reason: string }[]; skippedFrom: string[] }`
  - `export function planRemainders(demand: DemandLine[], matches: CarryMatch[], parked: ParkedOrder[], takenWaveNos: ReadonlySet<string>): { demand: DemandLine[]; remainders: RemainderSave }` — for `ambiguous: true` carry matches: leave demand untouched, add wave no to `skippedFrom` (today's skip behavior); for ordinary `carry`: each demand line matched to that wave gets `qtyCartons = newQty − picked(matched ParkedOrder)` and a fresh `waveNo = nextFreeWaveNo(takenWaveNos)`; ≤ 0 drops the line; the retract entry uses reason `'sisanya direncanakan ulang'`.

- [ ] **Step 1: Update `tests/carry-over.test.ts` carry expectations** — the `mode: 'carry'` fixture (wave with posted rows, same shipment number again) now asserts: matched demand line survives with `qtyCartons = newQty − quantity_picked`, `waveNo` = a fresh numeric NO not among `takenWaveNos`; a line whose `quantity_picked ≥ newQty` is dropped; `retracts` contains exactly `{ wave_id, shipment_number, reason: 'sisanya direncanakan ulang' }`.
- [ ] **Step 2: Add `nextFreeWaveNo` test** — `taken = new Set(['1','2','9'])` → `'3'`; empty set → `'1'`.
- [ ] **Step 3: Run** `npx tsx tests/carry-over.test.ts` — expected FAIL (functions not defined).
- [ ] **Step 4: Implement in `lib/allocator/carry-over.ts`** per the signatures above; carry-over's existing `matchedDemand` delete-block (carry waves keep their lines out) moves *into* `planRemainders`; `matchParked` keeps returning `matchedDemand` unchanged for compatibility.
- [ ] **Step 5: Run** `npx tsx tests/carry-over.test.ts` — PASS.
- [ ] **Step 6: Commit** `feat(allocate): plan the sheet-minus-done remainder of a Tunda'd mid-run wave`

### Task 2: Atomic save RPC (migration `0090`)

**Files:**
- Create: `supabase/migrations/0090_save_plan_with_retract.sql`
- Test: `supabase/tests/57_save_plan_with_retract.sql`

**Interfaces:**
- Consumes: `set_wave_status`'s CANCELLED settle helpers (0074: reuse the same per-pick pallet-break settle the cancel path runs — read `0074` for the exact helper name — and `0075:settle_stranded_residue` before retract when `stranded_residue` flags the wave), `save_plan(p_date, p_plan)` (0007/0007+0036 landing), `plan_context` (0007).
- Produces: `public.retract_shipment_open_tasks(p_wave_id uuid, p_shipment_number text, p_reason text)` and `public.save_plan_with_retract(p_date date, p_plan jsonb, p_retract jsonb)`, both `security definer`, `grant execute` to `authenticated` following `0005`'s grants; return type = `save_plan`'s jsonb.
- Retract semantics (spec §design): only that `(wave_id, shipment_number)`'s open tasks; posted tasks and their movements untouched; sibling shipments untouched; stranded residue first, then per-open-pick settle, then task → `CANCELLED`; then the function calls `public.save_plan(p_date, p_plan)` internally; on any exception everything rolls back.

- [ ] **Step 1: Write `supabase/tests/57_save_plan_with_retract.sql`** — fixtures: a 2-shipment wave (`NO 5`), shipment A with a posted pick + posted bin-to-bin (move row) + one open pick, shipment B one open pick; payload = a one-wave plan (`NO 6`) for shipment A only. Assert rows: A's open tasks → `CANCELLED` with reason; A's reserve source bin ends at 0 or `UPP` multiples after settle; A's posted task rows unchanged; B's open task still `PLANNED`; wave `NO 5` still exists with `shipment_numbers` unchanged; wave `NO 6` exists `PENDING` with the payload's tasks/outbound; `open_pick_tasks` no longer contains A's retracted rows; a second call whose payload reuses `NO 5` raises the 0007 clash error and changes nothing (follow the rollback pattern the `04`–`22` SQL tests use).
- [ ] **Step 2: Run** `psql -f supabase/tests/57_save_plan_with_retract.sql` after applying migrations + seed per AGENTS commands — expected FAIL (function does not exist).
- [ ] **Step 3: Implement `0090_save_plan_with_retract.sql`** — one function body that internally calls the existing settle/save helpers; no new tables, no new movement classes.
- [ ] **Step 4: Run** the SQL test again + `scripts/sql-test.sh` tail — expected PASS on every row.
- [ ] **Step 5: Commit** `feat(allocate): retract-and-save remainder waves atomically`

### Task 3: Client wiring (`plan-client.ts` + `allocate-client.tsx`)

**Files:**
- Modify: `lib/allocator/browser/plan-client.ts` (`savePlan` call), `app/(app)/allocate/allocate-client.tsx` (run assembly, skip list, save call, summary strings)
- Test: `tests/carry-over.test.ts` (pure side), typecheck for the rest

**Interfaces:**
- Consumes: Task 1's `planRemainders`/`RemainderSave`; Task 2's `save_plan_with_retract`.
- Produces: `savePlan(db, date, run, demand, retracts)` — when `retracts.length === 0` it calls `save_plan` exactly as today; otherwise `save_plan_with_retract` with `p_retract = retracts`. `SaveResult` gains optional `remainder_wave_nos?: string[]` passthrough (from `p_plan.waves` client-side; the RPC returns save_plan's shape).

- [ ] **Step 1: Unit-test the demand assembly** in `tests/carry-over.test.ts` (pure fn from Task 1 already covers it; asserts here stay green after wiring), then wire `execute()` in `allocate-client.tsx`: after `matchParked`, call `planRemainders(...)` with `takenWaveNos` built from `ctx.replaceable/kept` wave NOs; feed the result into `runPipeline` demand; remove the carried shipments from the *skip* listing — they now appear in a new run-status line: `"sisa wave Tunda <NO> diteruskan sebagai wave baru (X tugas, Y kar)"` (Indonesian, one sentence, role=status).
- [ ] **Step 2: Save path** — `savePlan(...)` gains the `retracts` param (default `[]`); build the confirmation sentence addition `"...sisa N wave Tunda diteruskan sebagai wave baru (NO <NO>)"`; pass `retracts` through and read the returned `remainder_wave_nos` for the saved confirmation line.
- [ ] **Step 3: Run** `npm run typecheck` + `npx tsx tests/carry-over.test.ts` + `npx tsx tests/earlier-waves.test.ts` (the earlier-waves/open/'picked' skip behavior must be untouched) — all PASS.
- [ ] **Step 4: Commit** `feat(allocate): run and save the remainder wave in the Alokasi page`

### Task 4: Replay truth across two waves sharing a shipment

**Files:**
- Test: `tests/remainder-replay.test.ts` (new; register in `package.json` chain, no TZ prefix needed — fixture dates are fixed, not today)

**Interfaces:**
- Consumes: `picklist-from-tasks.ts` (`executionOrder`, `sisaFromTasks`) + the plan payload shape from `plan.ts` — a synthetic two-wave payload (old wave: one posted pick at actuals, one CANCELLED pick; new wave: two planned picks touching the same bin/batch) asserts the replay invariants below.

- [ ] **Step 1: Write the failing test** — (a) `executionOrder` excludes CANCELLED tasks; (b) posted picks replay with `actual_quantity`; (c) the new wave's planned picks against the same bin/batch produce Sisa rows agreeing with the physical arithmetic (sum `qtyPick` per bin/batch le actuals); (d) printing order by slot/NO interleave holds.
- [ ] **Step 2: Run** `npx tsx tests/remainder-replay.test.ts` — expected PASS or FAIL; if FAIL, fix the test's assumptions against `picklist-from-tasks.ts` reality (the replay already handles CANCELLED + actuals — this test pins it; a FAIL here means the fixture is wrong, not the engine, unless a real defect surfaces — stop and reconcile before continuing).
- [ ] **Step 3: Add to chain** in `package.json` `npm test` (same `&&` style, final position before `form-checker-parse.test.ts`).
- [ ] **Step 4: Run** `npm test` full chain — exit 0 (notices suite excluded as pre-existing red per 2026-10-24 session note; if it now passes, note it green).
- [ ] **Step 5: Commit** `test(allocate): replay invariants for two waves sharing a shipment`

### Task 5: Docs

**Files:**
- Modify: `README.md` ("Alokasi & wave" section — one new sentence: re-running allocation on a Tunda'd mid-run shipment plans the remainder as a new wave automatically; staged quantity is subtracted, old wave keeps its record).

- [ ] **Step 1: Write the sentence** (English doc text; screen names quoted in `backticks` per README convention).
- [ ] **Step 2: Commit** `docs(readme): remainder wave on Tunda re-run`
- [ ] **Step 3: Final verification** — `npm run typecheck` && `npm run lint` && `npm test` tail green; `git status` clean of unintended files (config/warehouse.ts colors hunks et al. must remain untouched/dirty).
