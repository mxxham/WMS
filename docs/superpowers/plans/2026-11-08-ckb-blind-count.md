# CKB Blind Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supervisors assign CKB stock-take lines to counters by location; counters count blind on a two-screen phone page (`Hitung saya`); photos are required by the database for 0 counts, found stock, recounts, accepting a variance, and per-customer on every count.

**Architecture:** Migration 0133 (CKB tables only) adds per-line assignment, per-round evidence, session/customer photo flags, rewrites the count/read/decide/evidence RPCs and narrows operator RLS. Pure rules live in `lib/ckb/count-rules.ts`; pages are rebuilt on the existing CKB components.

**Tech Stack:** PostgreSQL 16 (Supabase) + psql tests, Next.js 15, React 19, TypeScript strict, Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-08-ckb-blind-count-design.md` (approved 8 Nov 2026). Mockup: `.superpowers/brainstorm/62364-1794133787/content/count-page.html` (screens 1 and 3).

## Global Constraints

- UI Indonesian, code/docs English. Screen names: `Hitung saya`, `Penugasan hitung`, `Tugaskan`, `Diminta hitung lagi`, `Foto hitung`, `Foto wajib: …`, `Ambil foto dulu`, `foto wajib di setiap hitungan`.
- Migration `supabase/migrations/0133_ckb_blind_count.sql`: alters only `ckb_*` objects; no Shell table or RPC. Extend `tests/ckb-isolation.test.ts`'s CKB migration list to include 0133.
- CKB rules (AGENTS.md CKB section): writes only via SECURITY DEFINER RPCs that check the CKB role and call `ckb_audit()`; policies use `(select public.account_active())`; counts/evidence/notes stay append-only.
- Role names: `ckb_role()` ∈ `admin`, `supervisor`, `operator`, `customer`; "lead" = admin or supervisor.
- SQL test `supabase/tests/97_ckb_blind_count.sql`, `begin … rollback`, PASS/FAIL per line, built on the fixtures of `supabase/tests/67_ckb_stocktake.sql`.
- Do not commit; run test files individually (the `npm test` chain has a stray `&&&&`).
- Every action: one confirmation with a summary sentence.

## Review Focus

1. A counter retries `Kirim` after a dropped connection on a recount whose photo was uploaded: the retry returns the first count, never a "photo required" error. → Task 2 test `client_key retry on a photographed recount returns the first count`.
2. A supervisor reassigns a location mid-count from counter A to B: A's list loses the lines, B gets them, A's earlier counts stay. → Task 1 test `reassigning moves the line, keeps earlier counts`.
3. A photo uploaded by a different operator not assigned to the line: refused at upload, so it can never satisfy the rule. → Task 3 test `an unassigned operator cannot add a photo to someone else's line`.
4. A session created before 0133 (photo_rules false) in REVIEW gets a recount: no photo demanded. → Task 2 test `sessions from before 0133 keep today's rules`.
5. An operator reads `/ckb/inventory` or calls PostgREST on `ckb_sap_snapshot_rows`: no quantities. → Task 4 test `an operator reads no snapshot rows, adjustments, counts or notes`.

---

### Task 1: Assignment

**Files:** Create `supabase/migrations/0133_ckb_blind_count.sql` (section 1), `supabase/tests/97_ckb_blind_count.sql`; modify `tests/ckb-isolation.test.ts:47` (regex includes 0133).

**Interfaces — Produces:**
- `ckb_count_tasks.assigned_to uuid null references profiles(id)`, `assigned_at timestamptz`, `assigned_by_name text`.
- `ckb_count_tasks.round_started_at timestamptz not null default now()` (backfilled from `created_at`).
- `public.ckb_assign_count_tasks(p_stocktake uuid, p_bins text[], p_counter uuid, p_by_name text) returns int` — lead only; session status in `DRAFT`, `COUNTING`, `REVIEW`; `p_counter` null = unassign, else must pass the same staff check as `ckb_create_stocktake` (CKB role ≠ customer, active, app `ckb_3pl`); assigns every task of the session whose `storage_bin = any(p_bins)`; inserts the counter into `ckb_stocktake_counters` if missing; one `ckb_audit` event; returns the number of lines changed.
- `public.ckb_can_count_task(p_task uuid) returns boolean` (internal): lead → true; operator → `assigned_to = auth.uid()` when assigned, else the 0101 session rule.
- `ckb_assert_can_count` callers switch to the per-line check.
- [ ] Step 1: test 97 checks: `a supervisor assigns two locations`, `an operator cannot assign`, `assigning a customer account is refused`, `reassigning moves the line, keeps earlier counts`, `an operator cannot count a line assigned to someone else`, `an unassigned line follows the session counter list`, `unassign with null`.
- [ ] Step 2: run `scripts/sql-test.sh supabase/tests/97_ckb_blind_count.sql` → FAIL.
- [ ] Step 3: implement section 1. Step 4: 97, 65, 67 PASS; `npx tsx tests/ckb-isolation.test.ts` (0133 checked).

### Task 2: Photo rules and blind recounts at count time

**Files:** 0133 section 2; test 97.

**Interfaces — Produces:**
- `ckb_evidence.round int null` (set at registration for `COUNT_TASK` = the task's round); `ckb_evidence.kind` allows `COUNT` (constraint replaced).
- `ckb_stocktakes.photo_rules boolean not null default true`; `update … set photo_rules = false` for every existing session in the migration.
- `ckb_customers.count_photo_required boolean not null default false`; `public.ckb_set_customer_count_photo(p_customer uuid, p_required boolean) returns void` (admin, audited).
- `public.ckb_photo_reason(p_task uuid, p_qty numeric) returns text` — null when no photo is needed, else `'hitungan 0'` / `'barang temuan'` / `'hitungan ulang'` / `'wajib untuk pelanggan ini'` (first match in that order); null whenever the session's `photo_rules` is false.
- `ckb_submit_count` (same signature): after the idempotent `client_key` lookup (a retry returns the first row before any rule), refuse `Foto wajib: <reason>` unless an evidence row exists with `entity_type='COUNT_TASK'`, `entity_id = task`, `round = task.round`, `deleted_at is null`.
- `ckb_add_found_item` gains a twin `ckb_add_found_line(p_stocktake uuid, p_material text, p_description text, p_bin text, p_batch text, p_expiry date, p_uom text, p_note text) returns uuid` that creates the FOUND task only (assigned to the caller, no count); the page counts it through `ckb_submit_count`. The old function stays for compatibility.
- Recount: wherever `ckb_decide_task` sets `RECOUNT_REQUESTED` it also sets `round_started_at = now()` (round increments as today).
- [ ] Step 1: test 97 checks: `count 0 without a photo is refused`, `count 0 with a photo of this round passes`, `a found line needs a photo`, `a recount needs a photo taken in the recount`, `a photo from round 1 does not satisfy round 2`, `client_key retry on a photographed recount returns the first count`, `customer setting requires a photo on every count`, `sessions from before 0133 keep today's rules`, `a matching count needs no photo`.
- [ ] Step 2 FAIL → Step 3 implement → Step 4 PASS (97, 67, 69).

### Task 3: Evidence ownership, withdrawal, accepting a variance

**Files:** 0133 section 3; test 97; `lib/ckb/evidence.ts` (kind `COUNT`, label `Foto hitung`), `app/api/ckb/evidence/route.ts` (accepts `COUNT`).

**Interfaces — Produces:**
- `ckb_register_evidence` (same signature): for `COUNT_TASK`, refuse unless `ckb_can_count_task(entity)`; set `round`.
- `ckb_withdraw_evidence` (same signature): an operator cannot withdraw a `COUNT_TASK` photo when a count of that task exists in the photo's round (`Foto ini dipakai hitungan yang sudah dikirim`); leads unchanged.
- `ckb_decide_task(…,'ACCEPT',…)` with a non-zero variance refuses without ≥1 non-withdrawn photo on the task (any round), only when `photo_rules`.
- [ ] Step 1: checks `an unassigned operator cannot add a photo to someone else's line`, `the counter cannot withdraw a photo their count used`, `a supervisor can withdraw it with a reason`, `accepting a variance without a photo is refused`, `accepting a match needs no photo`.
- [ ] Steps 2–4 as above.

### Task 4: Blind reads

**Files:** 0133 section 4; test 97; `app/ckb/inventory/page.tsx`, `app/ckb/stock-take/[id]/page.tsx`, `app/ckb/stock-take/[id]/task-history.tsx`.

**Interfaces — Produces:**
- RLS: `ckb_sap_snapshot_rows`, `ckb_adjustments`, `ckb_counts`, `ckb_task_notes` select policies exclude `ckb_role() = 'operator'` (recreate each policy with the old condition `and public.ckb_role() <> 'operator'`).
- `ckb_stocktake_tasks` (same columns): for an operator, only lines `ckb_can_count_task` allows; in a blind session additionally null `latest_qty`, `latest_counter`, `latest_counted_at`, `accepted_qty`, `decision_reason`, `decided_by_name` for rounds before the current one — concretely: `latest_*` only when the latest count's round = current round.
- `public.ckb_inventory_locations(p_customer uuid) returns table(storage_bin text, material_code text, description text, uom text)` — staff; what an operator's Inventaris shows (no quantities).
- `ckb_dashboard` (0107): `discrepancies_awaiting_review` null for operators.
- [ ] Step 1: checks `an operator reads no snapshot rows, adjustments, counts or notes`, `a supervisor still reads them`, `an operator's task list has only their lines and no earlier-round numbers`, `the operator dashboard has no discrepancy count`.
- [ ] Steps 2–4; Step 5: Inventaris for operators uses `ckb_inventory_locations`; session page hides adjustments for operators; typecheck.

### Task 5: Pure rules for the pages

**Files:** Create `lib/ckb/count-rules.ts`, `tests/ckb-count-rules.test.ts` (add to `npm test`).

**Interfaces — Produces:**
- `photoReason(t: { origin: string; round: number }, qty: number | null, opts: { photoRules: boolean; customerAlways: boolean }): string | null` — mirror of `ckb_photo_reason`.
- `groupLocations(bins: { storage_bin: string; lines: number; assigned_to: string | null; counted: number }[]): { prefix: string; bins: …[] }[]` — prefix = text before the last run of digits (`SIP-15` → `SIP-`, `0101NP0104` → `0101NP`, no digits → whole code).
- `listOrder(tasks)` — `RECOUNT_REQUESTED` first, then `OPEN`, then counted; within a group by `storage_bin`, then `seq`.
- `progress(tasks): { done: number; total: number }` — done = status not in `OPEN`, `RECOUNT_REQUESTED`.
- [ ] Step 1 tests: the four functions with the spec's examples (`SIP-15`→`SIP-`, `0101NP0104`→`0101NP`, `photoReason` precedence `hitungan 0` > `barang temuan` > `hitungan ulang` > customer, null when `photoRules` false). Steps 2–4.

### Task 6: Counter pages

**Files:** Create `app/ckb/count/page.tsx`, `app/ckb/count/loading.tsx`; rebuild `app/ckb/stock-take/[id]/count/count-client.tsx` into `count-list.tsx` + `count-screen.tsx` (+ keep `page.tsx`); modify `lib/ckb/permissions.ts` (`/ckb/count` STAFF; nav entry `Hitung saya` first in Operasional), `app/ckb/modules.ts`.

**Interfaces — Consumes:** Tasks 2–5. **Produces:** `CountList({ session, tasks, onOpen })`, `CountScreen({ task, photoReason, onSent, onBack })`.
- Behaviour per spec §6.1–§6.2 and the mockup: list (header with progress, scan box, `Belum` / `Hitung lagi` / `Selesai` segmented filter, recounts first, `+ Barang tidak ada di daftar`); tapping a row opens the count screen; empty quantity field with − / +; photo block before the button (uses the evidence upload with kind `COUNT`, shows only current-round photos to operators); button `Ambil foto dulu` until required photo exists; after send, next line opens; `‹ Kembali ke daftar`. Leads see SAP qty and status; operators never.
- [ ] Step 1: load `frontend-design`; implement. Step 2: typecheck, lint, `npx tsx tests/ckb-access.test.ts tests/ckb-stocktake.test.ts`. Step 3: screenshot check from a throwaway copy (phone 390 px and desktop) with fixture data.

### Task 7: Assignment page and customer switch

**Files:** Create `app/ckb/stock-take/[id]/assign/page.tsx`, `assign-client.tsx`; modify `app/ckb/stock-take/[id]/page.tsx` (link `Penugasan hitung`), `app/ckb/stock-take/new/new-form.tsx` (after create → assign page), `lib/ckb/permissions.ts` (`/ckb/stock-take/*/assign` LEAD), `app/ckb/customers/customers-client.tsx` (switch `Foto wajib di setiap hitungan` → `ckb_set_customer_count_photo`).
- Behaviour per spec §6.3: locations grouped by `groupLocations`, select single / group / filter, counter picker from `ckb_staff`, `Tugaskan` with one confirmation ("Tugaskan 14 baris di SIP-10–SIP-18 ke Andi"), per-counter progress.
- [ ] Step 1 implement; Step 2 typecheck, lint, `tests/ckb-access.test.ts`; Step 3 screenshot check.

### Task 8: Docs and full checks

- [ ] `docs/CKB_3PL.md` §5 (assignment, blind reads, photo rules, 0133), `AGENTS.md` gotcha line, memory note.
- [ ] `scripts/sql-test.sh` (all green except known 82 in the full run), every CKB tsx test, typecheck, lint.
