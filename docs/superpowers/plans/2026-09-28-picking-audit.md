# Picking Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every picked line is audited blind by a second person at staging; a shipment can only be marked loaded when all its lines passed; pick accuracy is measured per picker, SKU, zone and error type.

**Architecture:** One migration (`0024_pick_audit.sql`, built up over Tasks 2–5) adds attempt-based `pick_audits`, `shipment_loads`, three views and four functions; all rules live in the database. A pure TS module (`lib/pick-audit.ts`) mirrors the error rule and computes KPIs. The UI is a shipment list, a shipment detail page with audit / resolve / load dialogs, and an accuracy tab.

**Tech Stack:** Postgres (Supabase) plpgsql, Next.js 15 App Router (server components + client components), supabase-js, Tailwind, tsx test scripts, psql SQL tests.

**Spec:** `docs/superpowers/specs/2026-09-28-picking-audit-design.md`

## Global Constraints

- Scope: picking audit only; putaway audit (`audits` kind `PUTAWAY`, `/audit/putaway`) keeps working unchanged.
- 100 % of picked lines (actual qty > 0) are audited; lines picked as 0 are `AUTO_PASS`.
- Checker, resolver and loader are identified by typed name (`person_name()`, `same_person()` from 0016); site runs one shared session.
- Checker ≠ picker; resolver (supervisor/admin role) ≠ picker and ≠ that attempt's checker.
- Blind: the UI never sends a TODO line's picked qty / batch / expiry to the browser.
- Errors are derived by the database, order fixed: `WRONG_SKU, SHORT, OVER, WRONG_BATCH, WRONG_EXPIRY, DAMAGED`. `WRONG_SKU` suppresses qty/batch/expiry comparison. Batches compared after removing all whitespace and upper-casing.
- Loading is final: after `shipment_loads` has the shipment, `record_pick_audit` and `resolve_pick_mismatch` refuse.
- Stock corrections use `adjustment` movements with reason code `PICK_AUDIT`, bypass the approval queue (`app.adjust_approved = 'on'`), and every resolution opens a recount (`create_count_task(…, 'PICK_AUDIT')`) of the source bin.
- UI copy is Indonesian, matching existing pages. Code comments English, sparse, like the surrounding code.
- Never deploy or touch the `fefo-allocator-1` Vercel project; this plan does not deploy at all.

**Spec amendments (agreed in chat 2026-09-28, apply them):**
1. A `MISMATCH` attempt does **not** require a note (requiring one would tell a blind checker "wrong" before saving and allow trial-and-error). The resolver's note stays required.
2. Completed picks of a **cancelled** wave stay visible: shipment state `CANCELLED`, not auditable, not loadable, with a warning to return the cartons.
3. **Both** resolutions open a recount of the source bin.

## Review Focus

1. Batch typed in lowercase or with spaces (`" a7 "`) must match `A7` — SQL test in Task 3, TS test in Task 1.
2. Checker name differing from the picker only by case/spacing (`budi  santoso` vs `Budi Santoso`) must be refused — SQL test in Task 3.
3. Checker scans the carton EAN instead of typing the SKU — must resolve to the SKU and keep the scanned code — SQL test in Task 3.
4. Picker reported a deviation (qty 4 instead of 5) — the audit's expected qty is the reported 4, not the plan — SQL test in Task 3.
5. A shipment with a line picked as 0 next to audited lines must load — SQL test in Task 5.

## Test commands

- SQL: `scripts/sql-test.sh` (all) or `scripts/sql-test.sh supabase/tests/10_pick_audit.sql` (created in Task 2; needs the local Postgres at `/run/postgresql`, user `postgres`). Every assertion prints `NOTICE:  PASS …` or `NOTICE:  FAIL …`; the script exits non-zero on any FAIL or error. It rebuilds a scratch DB `k1_sql_test` from migrations + seed each run — it never touches Supabase.
- TS: `npm test`, `npm run typecheck`, `npm run lint`.

## File map

| File | Responsibility |
|---|---|
| `lib/pick-audit.ts` (new) | vocabulary, `normBatch`, `pickAuditErrors`, `allowedResolutions`, KPI helpers |
| `tests/pick-audit.test.ts` (new) | unit tests for the above |
| `scripts/sql-test.sh` (new) | rebuild scratch DB, run SQL tests |
| `supabase/migrations/0024_pick_audit.sql` (new) | all schema, views, functions, backfill |
| `supabase/tests/10_pick_audit.sql` (new) | SQL tests of 0024 |
| `supabase/tests/06_audits.sql` | PICK part replaced by "refused" check |
| `lib/inventory-control.ts` | `PICK_AUDIT` reason, `pick_accuracy_target_pct` policy |
| `components/app/item-scan-input.tsx` | `onItem(item, code)` passes the raw code |
| `components/app/live-refresh.tsx` | `pick_audits`, `shipment_loads` live tables |
| `components/app/nav.tsx` | Audit picking for all roles |
| `app/(app)/admin/settings/policy-form.tsx` | target field |
| `app/(app)/counts/counts-client.tsx` | `PICK_AUDIT` source label |
| `app/(app)/audit/audit-header.tsx` | `live`, `putaway` props |
| `app/(app)/audit/picking/page.tsx` | tabs: shipments / accuracy |
| `app/(app)/audit/picking/shipment-list.tsx` (new) | shipment table |
| `app/(app)/audit/picking/accuracy-view.tsx` (new) | KPI tab |
| `app/(app)/audit/picking/[wave]/[shipment]/page.tsx` (new) | shipment detail (server, blind mapping) |
| `app/(app)/audit/picking/[wave]/[shipment]/shipment-audit-client.tsx` (new) | lines + audit / resolve / load dialogs |
| `app/(app)/waves/page.tsx`, `waves-client.tsx` | shipment audit badges |
| `app/(app)/dashboard/page.tsx` | pick accuracy from `pick_audit_first`, waiting tile |
| `README.md`, `docs/INVENTORY_CONTROL.md` | test list, how it works |

---

### Task 1: Pure picking-audit rules (`lib/pick-audit.ts`)

**Files:**
- Create: `lib/pick-audit.ts`
- Create: `tests/pick-audit.test.ts`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Produces:
  - `PICK_ERRORS`, `type PickError`, `PICK_ERROR_LABEL`
  - `type LineState = "AUTO_PASS" | "TODO" | "OK" | "MISMATCH" | "RESOLVED"`, `LINE_STATE_LABEL`
  - `type ShipmentState = "PICKING" | "READY_AUDIT" | "HAS_MISMATCH" | "READY_LOAD" | "LOADED" | "CANCELLED"`, `SHIPMENT_STATE_LABEL`, `SHIPMENT_STATE_TONE`
  - `type Resolution = "ACCEPT_SHORT" | "ACCEPT_BATCH"`, `RESOLUTION_LABEL`
  - `normBatch(b: string | null | undefined): string`
  - `pickAuditErrors(e: Expected, f: Found): PickError[]`
  - `allowedResolutions(errors: PickError[], counted: number, expected: number): Resolution[]`
  - `type FirstAttempt`, `summarizeAccuracy(rows: FirstAttempt[]): AccuracySummary`
  - `shipmentFirstPass(loaded: ShipmentKey[], rows: FirstAttempt[]): number | null`
  - `auditCoverage(loaded: { todo: number; mismatch: number }[]): number | null`
  - `scanCompliance(scanned: boolean[]): number | null`
  - `median(xs: number[]): number | null`

- [ ] **Step 1: Write the failing test** — create `tests/pick-audit.test.ts`:

```ts
/** Picking audit rules (lib/pick-audit.ts, same rule as 0024 pick_audit_errors). */
import { strict as assert } from 'node:assert';
import {
  allowedResolutions, auditCoverage, median, normBatch, pickAuditErrors, scanCompliance, shipmentFirstPass, summarizeAccuracy,
  type FirstAttempt,
} from '../lib/pick-audit';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPicking audit');

const exp = { sku: '550044709', batch: 'A7', expiry: '2031-05-05', qty: 10 };
const found = (o: Partial<{ sku: string; batch: string; expiry: string | null; qty: number; damaged: boolean }>) =>
  ({ sku: '550044709', batch: 'A7', expiry: null, qty: 10, damaged: false, ...o });

test('batch compare ignores case and every space', () => {
  assert.equal(normBatch(' a7 '), 'A7');
  assert.equal(normBatch('14h 26jj'), '14H26JJ');
  assert.equal(normBatch(null), '');
  assert.deepEqual(pickAuditErrors(exp, found({ batch: ' a7 ' })), []);
});
test('short, over, batch, expiry, damaged in fixed order', () => {
  assert.deepEqual(pickAuditErrors(exp, found({ qty: 8, batch: 'B8', expiry: '2031-06-06', damaged: true })),
    ['SHORT', 'WRONG_BATCH', 'WRONG_EXPIRY', 'DAMAGED']);
  assert.deepEqual(pickAuditErrors(exp, found({ qty: 11 })), ['OVER']);
});
test('expiry only compared when both are known', () => {
  assert.deepEqual(pickAuditErrors(exp, found({ expiry: null })), []);
  assert.deepEqual(pickAuditErrors({ ...exp, expiry: null }, found({ expiry: '2031-01-01' })), []);
  assert.deepEqual(pickAuditErrors(exp, found({ expiry: '2031-05-05T00:00:00' })), []);
});
test('wrong SKU: nothing else compared, damage still counts', () => {
  assert.deepEqual(pickAuditErrors(exp, found({ sku: '550024919', qty: 1, batch: 'ZZ' })), ['WRONG_SKU']);
  assert.deepEqual(pickAuditErrors(exp, found({ sku: '550024919', damaged: true })), ['WRONG_SKU', 'DAMAGED']);
});
test('resolutions: short alone, or batch/expiry with the full count', () => {
  assert.deepEqual(allowedResolutions(['SHORT'], 8, 10), ['ACCEPT_SHORT']);
  assert.deepEqual(allowedResolutions(['SHORT', 'WRONG_BATCH'], 8, 10), []);
  assert.deepEqual(allowedResolutions(['WRONG_BATCH'], 10, 10), ['ACCEPT_BATCH']);
  assert.deepEqual(allowedResolutions(['WRONG_BATCH', 'WRONG_EXPIRY'], 10, 10), ['ACCEPT_BATCH']);
  assert.deepEqual(allowedResolutions(['WRONG_EXPIRY', 'DAMAGED'], 10, 10), []);
  assert.deepEqual(allowedResolutions(['WRONG_SKU'], 10, 10), []);
  assert.deepEqual(allowedResolutions([], 10, 10), []);
});

const row = (o: Partial<FirstAttempt>): FirstAttempt => ({
  task_id: 't', result: 'OK', errors: [], expected_qty: 10, counted_qty: 10, picked_by_name: 'Budi', sku: '550044709',
  description: 'Oli', zone: 'CF', bulk_posted: false, minutes_to_audit: 10, wave_id: 'w1', shipment_number: 'S1', ...o,
});
test('accuracy: first attempts per line, units, per picker / SKU / zone / error', () => {
  const rows = [
    row({ task_id: 'a' }),
    row({ task_id: 'b', result: 'MISMATCH', errors: ['SHORT'], counted_qty: 8, minutes_to_audit: 30 }),
    row({ task_id: 'c', result: 'MISMATCH', errors: ['WRONG_BATCH'], picked_by_name: 'Rina', zone: 'CA', bulk_posted: true, minutes_to_audit: 20 }),
    row({ task_id: 'd', picked_by_name: null, sku: '550024919', description: 'Gemuk', minutes_to_audit: null }),
  ];
  const s = summarizeAccuracy(rows);
  assert.equal(s.lines, 4);
  assert.equal(s.ok, 2);
  assert.equal(s.lineAccuracy, 50);
  // 40 units expected; 2 short + 10 of the wrong batch are wrong.
  assert.equal(s.unitAccuracy, 70);
  assert.equal(s.mispicksPer1000, 500);
  assert.equal(s.medianMinutes, 20);
  assert.deepEqual(s.byError, [{ error: 'SHORT', n: 1 }, { error: 'WRONG_BATCH', n: 1 }]);
  assert.deepEqual(s.byPicker[0], { name: 'Rina', lines: 1, errors: 1, accuracy: 0, bulk: 1 });
  assert.deepEqual(s.byPicker.map((p) => p.name), ['Rina', 'Budi', '(tidak tercatat)']);
  assert.deepEqual(s.bySku[0], { sku: '550044709', description: 'Oli', lines: 3, errors: 2 });
  assert.deepEqual(s.byZone[0], { zone: 'CA', lines: 1, errors: 1 });
});
test('accuracy of nothing is unknown, not 100 %', () => {
  const s = summarizeAccuracy([]);
  assert.equal(s.lineAccuracy, null);
  assert.equal(s.unitAccuracy, null);
  assert.equal(s.mispicksPer1000, null);
  assert.equal(s.medianMinutes, null);
});
test('shipment first pass, coverage, scan compliance, median', () => {
  const rows = [row({ wave_id: 'w1', shipment_number: 'S1' }), row({ wave_id: 'w1', shipment_number: 'S2', result: 'MISMATCH', errors: ['OVER'] })];
  assert.equal(shipmentFirstPass([{ wave_id: 'w1', shipment_number: 'S1' }, { wave_id: 'w1', shipment_number: 'S2' }], rows), 50);
  assert.equal(shipmentFirstPass([], rows), null);
  assert.equal(auditCoverage([{ todo: 0, mismatch: 0 }, { todo: 1, mismatch: 0 }]), 50);
  assert.equal(auditCoverage([]), null);
  assert.equal(scanCompliance([true, false, false, true]), 50);
  assert.equal(scanCompliance([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx tests/pick-audit.test.ts`
Expected: FAIL — `Cannot find module '../lib/pick-audit'`.

- [ ] **Step 3: Implement** — create `lib/pick-audit.ts`:

```ts
/**
 * Picking audit (migration 0024): vocabulary, the error rule and the KPI
 * maths. The database derives and enforces every result; this file mirrors
 * the rule for labels, the result preview and the accuracy page.
 */

export const PICK_ERRORS = ["WRONG_SKU", "SHORT", "OVER", "WRONG_BATCH", "WRONG_EXPIRY", "DAMAGED"] as const;
export type PickError = (typeof PICK_ERRORS)[number];
export const PICK_ERROR_LABEL: Record<PickError, string> = {
  WRONG_SKU: "SKU salah",
  SHORT: "Kurang",
  OVER: "Lebih",
  WRONG_BATCH: "Batch salah",
  WRONG_EXPIRY: "Expired beda",
  DAMAGED: "Rusak",
};

export type LineState = "AUTO_PASS" | "TODO" | "OK" | "MISMATCH" | "RESOLVED";
export const LINE_STATE_LABEL: Record<LineState, string> = {
  AUTO_PASS: "Tidak dipick (0)",
  TODO: "Belum diaudit",
  OK: "OK",
  MISMATCH: "Selisih",
  RESOLVED: "Diterima supervisor",
};

export type ShipmentState = "PICKING" | "READY_AUDIT" | "HAS_MISMATCH" | "READY_LOAD" | "LOADED" | "CANCELLED";
export const SHIPMENT_STATE_LABEL: Record<ShipmentState, string> = {
  PICKING: "Picking",
  READY_AUDIT: "Siap audit",
  HAS_MISMATCH: "Ada selisih",
  READY_LOAD: "Siap muat",
  LOADED: "Dimuat",
  CANCELLED: "Dibatalkan",
};
export const SHIPMENT_STATE_TONE: Record<ShipmentState, string> = {
  PICKING: "bg-steel-100 text-steel",
  READY_AUDIT: "bg-plate text-steel",
  HAS_MISMATCH: "bg-bad text-white",
  READY_LOAD: "bg-ok text-white",
  LOADED: "bg-ckb text-white",
  CANCELLED: "bg-steel-100 text-steel-500 line-through",
};

export type Resolution = "ACCEPT_SHORT" | "ACCEPT_BATCH";
export const RESOLUTION_LABEL: Record<Resolution, string> = {
  ACCEPT_SHORT: "Terima kurang",
  ACCEPT_BATCH: "Terima batch ini",
};

/** Same as norm_batch() in 0024: no whitespace, upper case. */
export function normBatch(b: string | null | undefined): string {
  return (b ?? "").replace(/\s/g, "").toUpperCase();
}

export type Expected = { sku: string; batch: string; expiry: string | null; qty: number };
export type Found = { sku: string; batch: string; expiry: string | null; qty: number; damaged: boolean };

/** Same rule and order as pick_audit_errors() in 0024. */
export function pickAuditErrors(e: Expected, f: Found): PickError[] {
  const out: PickError[] = [];
  if (f.sku !== e.sku) out.push("WRONG_SKU");
  else {
    if (f.qty < e.qty) out.push("SHORT");
    if (f.qty > e.qty) out.push("OVER");
    if (normBatch(f.batch) !== normBatch(e.batch)) out.push("WRONG_BATCH");
    if (f.expiry && e.expiry && f.expiry.slice(0, 10) !== e.expiry.slice(0, 10)) out.push("WRONG_EXPIRY");
  }
  if (f.damaged) out.push("DAMAGED");
  return out;
}

/** What a supervisor may accept instead of a floor fix (resolve_pick_mismatch guards the same). */
export function allowedResolutions(errors: PickError[], counted: number, expected: number): Resolution[] {
  if (errors.length === 1 && errors[0] === "SHORT") return ["ACCEPT_SHORT"];
  if (errors.length > 0 && counted === expected && errors.every((e) => e === "WRONG_BATCH" || e === "WRONG_EXPIRY")) return ["ACCEPT_BATCH"];
  return [];
}

/** One row of pick_audit_first: the first attempt of a line. */
export type FirstAttempt = {
  task_id: string; result: "OK" | "MISMATCH"; errors: PickError[]; expected_qty: number; counted_qty: number;
  picked_by_name: string | null; sku: string; description: string; zone: string; bulk_posted: boolean;
  minutes_to_audit: number | null; wave_id: string; shipment_number: string;
};
export type ShipmentKey = { wave_id: string; shipment_number: string };

export type AccuracySummary = {
  lines: number; ok: number;
  lineAccuracy: number | null; unitAccuracy: number | null; mispicksPer1000: number | null; medianMinutes: number | null;
  byError: { error: PickError; n: number }[];
  byPicker: { name: string; lines: number; errors: number; accuracy: number; bulk: number }[];
  bySku: { sku: string; description: string; lines: number; errors: number }[];
  byZone: { zone: string; lines: number; errors: number }[];
};

const pct = (part: number, whole: number) => (whole ? (part * 100) / whole : null);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Wrong units of one first attempt: all of them when the item itself is wrong, else the count difference. */
function wrongUnits(r: FirstAttempt): number {
  const exp = Number(r.expected_qty);
  if (r.errors.some((e) => e === "WRONG_SKU" || e === "WRONG_BATCH" || e === "WRONG_EXPIRY" || e === "DAMAGED")) return exp;
  return Math.abs(Number(r.counted_qty) - exp);
}

export function summarizeAccuracy(rows: FirstAttempt[]): AccuracySummary {
  const ok = rows.filter((r) => r.result === "OK").length;
  const expected = rows.reduce((s, r) => s + Number(r.expected_qty), 0);
  const wrong = rows.reduce((s, r) => s + wrongUnits(r), 0);
  const bad = (r: FirstAttempt) => (r.result === "MISMATCH" ? 1 : 0);

  const byError = new Map<PickError, number>();
  for (const r of rows) for (const e of r.errors) byError.set(e, (byError.get(e) ?? 0) + 1);

  const group = <K extends string>(key: (r: FirstAttempt) => K) => {
    const m = new Map<K, FirstAttempt[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m.entries()];
  };
  const worstFirst = <T extends { errors: number; lines: number }>(a: T, b: T) => b.errors / b.lines - a.errors / a.lines || b.errors - a.errors || b.lines - a.lines;

  return {
    lines: rows.length,
    ok,
    lineAccuracy: pct(ok, rows.length),
    unitAccuracy: expected ? (Math.max(0, expected - wrong) * 100) / expected : null,
    mispicksPer1000: rows.length ? ((rows.length - ok) * 1000) / rows.length : null,
    medianMinutes: median(rows.map((r) => r.minutes_to_audit).filter((m): m is number => m !== null).map(Number)),
    byError: PICK_ERRORS.filter((e) => byError.has(e)).map((e) => ({ error: e, n: byError.get(e)! })).sort((a, b) => b.n - a.n),
    byPicker: group((r) => r.picked_by_name ?? "(tidak tercatat)")
      .map(([name, rs]) => {
        const errors = rs.reduce((s, r) => s + bad(r), 0);
        return { name, lines: rs.length, errors, accuracy: ((rs.length - errors) * 100) / rs.length, bulk: rs.filter((r) => r.bulk_posted).length };
      })
      .sort(worstFirst),
    bySku: group((r) => r.sku)
      .map(([sku, rs]) => ({ sku, description: rs[0].description, lines: rs.length, errors: rs.reduce((s, r) => s + bad(r), 0) }))
      .sort((a, b) => b.errors - a.errors || b.lines - a.lines),
    byZone: group((r) => r.zone)
      .map(([zone, rs]) => ({ zone, lines: rs.length, errors: rs.reduce((s, r) => s + bad(r), 0) }))
      .sort(worstFirst),
  };
}

/** Loaded shipments whose every line passed on the first attempt. */
export function shipmentFirstPass(loaded: ShipmentKey[], rows: FirstAttempt[]): number | null {
  const failed = new Set(rows.filter((r) => r.result === "MISMATCH").map((r) => `${r.wave_id}|${r.shipment_number}`));
  return pct(loaded.filter((s) => !failed.has(`${s.wave_id}|${s.shipment_number}`)).length, loaded.length);
}

/** Loaded shipments with nothing left unaudited or unresolved; anything under 100 % is a bug. */
export function auditCoverage(loaded: { todo: number; mismatch: number }[]): number | null {
  return pct(loaded.filter((s) => Number(s.todo) === 0 && Number(s.mismatch) === 0).length, loaded.length);
}

export function scanCompliance(scanned: boolean[]): number | null {
  return pct(scanned.filter(Boolean).length, scanned.length);
}
```

Then in `package.json` append ` && tsx tests/pick-audit.test.ts` to the end of the `"test"` script (after `tsx tests/sap-stock.test.ts`).

- [ ] **Step 4: Run tests**

Run: `npx tsx tests/pick-audit.test.ts && npm run typecheck`
Expected: `8 passed, 0 failed`, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/pick-audit.ts tests/pick-audit.test.ts package.json
git commit -m "feat(pick-audit): error rule and accuracy maths"
```

---

### Task 2: Schema, picker stamping, views, SQL test runner

**Files:**
- Create: `scripts/sql-test.sh`
- Create: `supabase/migrations/0024_pick_audit.sql`
- Create: `supabase/tests/10_pick_audit.sql`

**Interfaces:**
- Consumes: `person_name`, `same_person`, `item_by_barcode`, `inventory_policy` (0016), `post_task`, `complete_wave` (0007), `save_plan` (0004).
- Produces (SQL):
  - `pick_tasks.picked_by_name text`, `.scanned_code text`, `.bulk_posted boolean`
  - `norm_batch(text) → text`
  - `pick_audit_errors(p_expected_sku text, p_expected_batch text, p_expected_expiry date, p_expected_qty numeric, p_found_sku text, p_found_batch text, p_found_expiry date, p_counted numeric, p_damaged boolean) → text[]`
  - tables `pick_audits`, `shipment_loads`
  - views `pick_audit_line`, `pick_audit_shipment`, `pick_audit_first` (columns listed in the SQL below)
  - policy key `pick_accuracy_target_pct` (default 99.5); movement reason `PICK_AUDIT`; count source `PICK_AUDIT`

- [ ] **Step 1: Create the SQL test runner** — `scripts/sql-test.sh`:

```bash
#!/usr/bin/env bash
# Rebuild a scratch database from the migrations + seed and run the SQL tests.
#   scripts/sql-test.sh                      all tests
#   scripts/sql-test.sh supabase/tests/10_pick_audit.sql
# Local Postgres only (default user postgres); never points at Supabase.
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."
export PGUSER="${PGUSER:-postgres}"
db="${SQL_TEST_DB:-k1_sql_test}"
log="$(mktemp)"; trap 'rm -f "$log"' EXIT

psql -d postgres -q -c "drop database if exists $db" -c "create database $db" >/dev/null
export PGDATABASE="$db"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/00_local_auth_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$log" || { echo "migration failed: $f"; cat "$log"; exit 1; }
done
psql -q -v ON_ERROR_STOP=1 -f supabase/seed.sql >/dev/null
# 01 grants table rights and shows expected errors; it is read by eye, not asserted.
psql -q -f supabase/tests/01_rls_and_stock_rules.sql >/dev/null 2>&1 || true

tests=("$@")
[ ${#tests[@]} -eq 0 ] && tests=(supabase/tests/0[2-9]_*.sql supabase/tests/1[0-9]_*.sql)
status=0
for t in "${tests[@]}"; do
  if ! out=$(psql -v ON_ERROR_STOP=1 -f "$t" 2>&1); then
    echo "ERROR in $t"; grep -E "ERROR|FAIL" <<<"$out" || true; status=1; continue
  fi
  pass=$(grep -c "NOTICE:  PASS" <<<"$out" || true)
  fail=$(grep -c "NOTICE:  FAIL" <<<"$out" || true)
  echo "$t: $pass PASS, $fail FAIL"
  if [ "$fail" -ne 0 ]; then grep "NOTICE:  FAIL" <<<"$out"; status=1; fi
done
exit $status
```

Run: `chmod +x scripts/sql-test.sh && scripts/sql-test.sh`
Expected (baseline, before any 0024 work): `02` 17 PASS, `03` 21, `04` 14, `05` 26, `06` 12, `07` 16, `08` 12, `09` 73, all `0 FAIL`, exit 0.

- [ ] **Step 2: Write the failing test** — create `supabase/tests/10_pick_audit.sql` (later tasks insert their sections **before the final `rollback;`**):

```sql
-- Picking audit (0024). Runs in a transaction and rolls back.
-- Run with scripts/sql-test.sh. Every line prints PASS/FAIL.
\set ON_ERROR_STOP on
\pset tuples_only on
begin;
reset role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','op@x','{"name":"Operator"}'),
                              ('22222222-2222-2222-2222-222222222222','sup@x','{"name":"Supervisor"}') on conflict do nothing;
update profiles set role='supervisor' where id='22222222-2222-2222-2222-222222222222';

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then
  if sqlerrm not like p_like then raise notice 'got: %', sqlerrm; end if;
  return sqlerrm like p_like; end $$;
create or replace function pg_temp.task(p_ship text, p_seq int) returns uuid language sql as $$
  select t.id from pick_tasks t join waves w on w.id = t.wave_id
  where w.planned_date = '2026-10-06' and t.shipment_number = p_ship and t.seq = p_seq $$;
create or replace function pg_temp.wave(p_no text) returns uuid language sql as $$
  select id from waves where planned_date = '2026-10-06' and wave_no = p_no $$;
create or replace function pg_temp.qty(p_bin text, p_batch text) returns numeric language sql as $$
  select coalesce(sum(i.quantity), 0) from inventory i join bins b on b.id = i.bin_id
  where b.bin_code = p_bin and i.batch_lot = p_batch $$;
create or replace function pg_temp.line(p_ship text, p_seq int) returns pick_audit_line language sql as $$
  select * from pick_audit_line where task_id = pg_temp.task(p_ship, p_seq) $$;
create or replace function pg_temp.ship(p_ship text) returns pick_audit_shipment language sql as $$
  select * from pick_audit_shipment where planned_date = '2026-10-06' and shipment_number = p_ship $$;

-- Fixture: carton barcode for 550044709; A7 x48 in CF38C01, B8 x10 in CF38C02, C1 x30 (550024919) in CF37C01.
update items set ean = '8994123456789' where sku = '550044709';
delete from inventory where bin_id in (select id from bins where bin_code in ('CF38C01', 'CF38C02', 'CF37C01'));
insert into movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, note)
select 'adjustment', (select id from items where sku = s), bt, q, (select id from bins where bin_code = b), e::date, 'fixture'
from (values ('CF38C01', '550044709', 'A7', 48, '2031-05-05'), ('CF38C02', '550044709', 'B8', 10, '2031-06-06'),
             ('CF37C01', '550024919', 'C1', 30, '2031-07-07')) v(b, s, bt, q, e);

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select save_plan('2026-10-06', '{
  "waves":[{"wave_no":"1","shipment_numbers":["PA1","PA2","PA4","PA5"]},{"wave_no":"2","shipment_numbers":["PA3"]}],
  "tasks":[
    {"wave_no":"1","shipment_number":"PA1","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":10,"seq":1},
    {"wave_no":"1","shipment_number":"PA1","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":5,"seq":2},
    {"wave_no":"1","shipment_number":"PA2","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":6,"seq":3},
    {"wave_no":"1","shipment_number":"PA4","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":2,"seq":4},
    {"wave_no":"1","shipment_number":"PA1","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":3,"seq":5},
    {"wave_no":"1","shipment_number":"PA5","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":2,"seq":6},
    {"wave_no":"2","shipment_number":"PA3","task_type":"PICK","sku":"550044709","from_bin":"CF38C01","batch_lot":"A7","expiry_date":"2031-05-05","quantity":4,"seq":1}],
  "outbound":[
    {"wave_no":"1","shipment_number":"PA1","sku":"550044709","quantity_requested":10,"quantity_allocated":10},
    {"wave_no":"1","shipment_number":"PA1","sku":"550024919","quantity_requested":8,"quantity_allocated":8},
    {"wave_no":"1","shipment_number":"PA2","sku":"550044709","quantity_requested":6,"quantity_allocated":6},
    {"wave_no":"1","shipment_number":"PA4","sku":"550024919","quantity_requested":2,"quantity_allocated":2},
    {"wave_no":"1","shipment_number":"PA5","sku":"550024919","quantity_requested":2,"quantity_allocated":2},
    {"wave_no":"2","shipment_number":"PA3","sku":"550044709","quantity_requested":4,"quantity_allocated":4}]}'::jsonb);

-- ---- A. Error rule, who picked, views ------------------------------------
select pg_temp.check('errors: batch compare ignores case and spaces',
  pick_audit_errors('S', 'A7', '2031-05-05', 10, 'S', ' a7 ', null, 10, false) = '{}');
select pg_temp.check('errors: short + batch + expiry + damaged in fixed order',
  pick_audit_errors('S', 'A7', '2031-05-05', 10, 'S', 'B8', '2031-06-06', 8, true) = '{SHORT,WRONG_BATCH,WRONG_EXPIRY,DAMAGED}');
select pg_temp.check('errors: over',
  pick_audit_errors('S', 'A7', null, 10, 'S', 'A7', null, 11, false) = '{OVER}');
select pg_temp.check('errors: wrong SKU compares nothing else',
  pick_audit_errors('S', 'A7', null, 10, 'T', 'ZZ', null, 3, false) = '{WRONG_SKU}');

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select post_task_by(pg_temp.task('PA1', 1), p_by_name => 'Budi Santoso');
select post_task_by(pg_temp.task('PA1', 2), 4, null, null, null, 'karton kurang', 'Budi Santoso', null);
select post_task_by(pg_temp.task('PA1', 5), 0, null, null, null, 'stok tidak ada', 'Budi Santoso', null);
select post_task_by(pg_temp.task('PA2', 3), p_by_name => 'Budi Santoso', p_scanned => ' 8994123456789 ');
select post_task_by(pg_temp.task('PA5', 6), p_by_name => 'Budi Santoso');
select complete_wave_by(pg_temp.wave('2'), 'Rina');

select pg_temp.check('the picker''s typed name is kept on the task, not the shared account',
  (select picked_by_name = 'Budi Santoso' and scanned_code is null and not bulk_posted from pick_tasks where id = pg_temp.task('PA1', 1)));
select pg_temp.check('the scanned carton code is kept (spaces removed)',
  (select scanned_code = '8994123456789' and not bulk_posted from pick_tasks where id = pg_temp.task('PA2', 3)));
select pg_temp.check('a scan does not leak onto the next task of the same transaction',
  (select scanned_code is null from pick_tasks where id = pg_temp.task('PA5', 6)));
select pg_temp.check('bulk completion keeps the name and flags the line',
  (select picked_by_name = 'Rina' and bulk_posted from pick_tasks where id = pg_temp.task('PA3', 1)));
select pg_temp.check('line shows what the picker reported (4 of 5), not yet audited',
  (select picked_qty = 4 and planned_qty = 5 and line_state = 'TODO' and attempts = 0 from pg_temp.line('PA1', 2)));
select pg_temp.check('a line picked as 0 passes without audit',
  (select line_state = 'AUTO_PASS' from pg_temp.line('PA1', 5)));
select pg_temp.check('shipment states: PA1 ready to audit, PA4 still picking, PA3 ready to audit',
  (pg_temp.ship('PA1')).state = 'READY_AUDIT' and (pg_temp.ship('PA4')).state = 'PICKING' and (pg_temp.ship('PA3')).state = 'READY_AUDIT');
select pg_temp.check('policy has the pick accuracy target',
  (inventory_policy()->>'pick_accuracy_target_pct')::numeric = 99.5);
select pg_temp.check('no direct writes to pick_audits',
  pg_temp.fails(format($q$insert into pick_audits (task_id, attempt_no, checker_name, found_sku, counted_qty, expected_sku, expected_qty, result)
    values (%L, 1, 'X', '550044709', 10, '550044709', 10, 'OK')$q$, pg_temp.task('PA1', 1)), '%row-level security%'));

rollback;
```

- [ ] **Step 3: Run it to verify it fails**

Run: `scripts/sql-test.sh supabase/tests/10_pick_audit.sql`
Expected: `ERROR in supabase/tests/10_pick_audit.sql` (type `pick_audit_line` / function `pick_audit_errors` does not exist).

- [ ] **Step 4: Implement** — create `supabase/migrations/0024_pick_audit.sql`:

```sql
-- =====================================================================
-- 0024  Picking audit: every picked line is checked blind by someone
--       other than the picker, before the shipment is loaded
--
--  pick_tasks      + picked_by_name / scanned_code / bulk_posted, stamped
--                    when a task completes from what post_task_by and
--                    complete_wave_by set for their transaction.
--  pick_audits     one row per attempt. The checker records what is on the
--                  pallet (carton scan or SKU, batch, expiry, count, damage)
--                  without seeing the picker's numbers; the database derives
--                  the errors. A line passes when its latest attempt is OK or
--                  a supervisor accepted it (short / other batch).
--  shipment_loads  a shipment is loaded only when every picked line passed;
--                  after that nothing on it is audited or resolved again.
--  Picked stock has already left the system (PICK has no to_bin), so a
--  mismatch fixed on the floor needs no stock change; only the two
--  acceptances post PICK_AUDIT adjustments.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Vocabulary: reason code, count source, policy target
-- ---------------------------------------------------------------------
alter table public.movements drop constraint movements_reason_code_check;
alter table public.movements add constraint movements_reason_code_check check (reason_code in (
  'COUNT_VARIANCE', 'DAMAGED', 'EXPIRED', 'DATA_ENTRY', 'MISPICK', 'FOUND', 'LOST',
  'RECEIVING_DIFF', 'RETURN', 'OPENING', 'OTHER', 'PICK_AUDIT'));
alter table public.count_tasks drop constraint count_tasks_source_check;
alter table public.count_tasks add constraint count_tasks_source_check
  check (source in ('MANUAL', 'PUTAWAY', 'DATA_QUALITY', 'CYCLE', 'RECON', 'RECEIPT', 'PICK_AUDIT'));

create or replace function public.inventory_policy_defaults()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'default_shelf_life_months', 48,   -- Shell packaged lubricants: production + 4 years
    'min_dispatch_days', 0,            -- refuse to ship stock with fewer days left
    'near_expiry_days', 180,           -- "ship first / report to Shell" window
    'adjust_approval_qty', 20,         -- |adjustment| above this (cartons) needs a second person
    'count_tolerance_qty', jsonb_build_object('A', 0, 'B', 0, 'C', 0),  -- per bin, cartons
    'recount_on_variance', true,       -- a count off by more than the tolerance is recounted blind
    'ira_target_pct', 98,
    'require_scan_on_pick', false,     -- pick confirmation needs the carton barcode
    'pick_accuracy_target_pct', 99.5   -- first-attempt line accuracy of the picking audit
  );
$$;

create or replace function public.set_inventory_policy(p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; merged jsonb;
begin
  if not public.has_role(array['admin']::public.user_role[]) then
    raise exception 'Hanya admin yang bisa mengubah aturan inventory';
  end if;
  if jsonb_typeof(p_value) <> 'object' then raise exception 'Format aturan tidak valid'; end if;
  for k, v in select * from jsonb_each(p_value) loop
    if not public.inventory_policy_defaults() ? k then raise exception 'Aturan % tidak dikenal', k; end if;
    if k in ('recount_on_variance', 'require_scan_on_pick') then
      if jsonb_typeof(v) <> 'boolean' then raise exception '% harus ya/tidak', k; end if;
    elsif k = 'count_tolerance_qty' then
      if jsonb_typeof(v) <> 'object' or not (v ?& array['A', 'B', 'C']) then raise exception 'Toleransi hitung butuh nilai A, B dan C'; end if;
      if exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'number' or (e.value)::numeric < 0) then
        raise exception 'Toleransi hitung harus angka ≥ 0';
      end if;
    elsif jsonb_typeof(v) <> 'number' or (v)::numeric < 0 then
      raise exception '% harus angka ≥ 0', k;
    end if;
  end loop;
  if (p_value ? 'default_shelf_life_months') and ((p_value->>'default_shelf_life_months')::numeric not between 1 and 240) then
    raise exception 'Umur simpan 1–240 bulan';
  end if;
  if (p_value ? 'ira_target_pct') and ((p_value->>'ira_target_pct')::numeric > 100) then
    raise exception 'Target akurasi maksimal 100%%';
  end if;
  if (p_value ? 'pick_accuracy_target_pct') and ((p_value->>'pick_accuracy_target_pct')::numeric > 100) then
    raise exception 'Target akurasi picking maksimal 100%%';
  end if;
  merged := public.inventory_policy() || p_value;
  insert into public.settings (key, value, updated_at) values ('inventory_policy', merged, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return merged;
end $$;

-- ---------------------------------------------------------------------
-- 2. Who picked, what was scanned, bulk-posted
-- ---------------------------------------------------------------------
alter table public.pick_tasks
  add column picked_by_name text,
  add column scanned_code   text,
  add column bulk_posted    boolean not null default false;

-- Earlier picks: the name typed on the floor went to the movement (0023).
update public.pick_tasks t set picked_by_name = m.by_name
from public.movements m
where m.task_id = t.id and t.status = 'COMPLETED' and nullif(trim(m.by_name), '') is not null;

create or replace function public.stamp_pick_confirmation()
returns trigger language plpgsql as $$
begin
  if new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED' then
    new.picked_by_name := coalesce(nullif(trim(new.picked_by_name), ''), nullif(current_setting('app.by_name', true), ''));
    new.scanned_code := coalesce(new.scanned_code, nullif(current_setting('app.pick_scanned', true), ''));
    new.bulk_posted := new.bulk_posted or coalesce(current_setting('app.pick_bulk', true), '') = 'on';
  end if;
  return new;
end $$;
create trigger pick_tasks_stamp_confirmation before update on public.pick_tasks
  for each row execute function public.stamp_pick_confirmation();
revoke execute on function public.stamp_pick_confirmation() from public, anon, authenticated;

-- post_task_by (0023) + the scanned code for the stamp. Settings are reset
-- so a later post in the same transaction does not inherit them.
create or replace function public.post_task_by(
  p_task_id uuid, p_actual_qty numeric default null, p_from_bin text default null, p_batch_lot text default null,
  p_expiry date default null, p_reason text default null, p_by_name text default null, p_scanned text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := public.person_name(p_by_name, 'Nama picker'); t record; v_scan_sku text; v_res jsonb;
begin
  select pt.task_type, it.sku, it.ean into t
  from public.pick_tasks pt join public.items it on it.id = pt.item_id where pt.id = p_task_id;
  if t.sku is null then raise exception 'Tugas tidak ada'; end if;
  if nullif(trim(p_scanned), '') is not null then
    select sku into v_scan_sku from public.item_by_barcode(p_scanned) limit 1;
    if v_scan_sku is null then raise exception 'Barcode % tidak dikenal di master item', trim(p_scanned); end if;
    if v_scan_sku <> t.sku then raise exception 'Barang salah: yang di-scan SKU %, tugas ini SKU %', v_scan_sku, t.sku; end if;
  elsif t.task_type = 'PICK' and t.ean is not null and (public.inventory_policy()->>'require_scan_on_pick')::boolean then
    raise exception 'Scan barcode karton SKU % dulu', t.sku;
  end if;
  perform set_config('app.by_name', v_name, true);
  perform set_config('app.pick_scanned', regexp_replace(coalesce(p_scanned, ''), '\s', '', 'g'), true);
  perform set_config('app.pick_bulk', '', true);
  v_res := public.post_task(p_task_id, p_actual_qty, p_from_bin, p_batch_lot, p_expiry, p_reason);
  perform set_config('app.pick_scanned', '', true);
  return v_res;
end $$;
revoke execute on function public.post_task_by(uuid, numeric, text, text, date, text, text, text) from public, anon;
grant execute on function public.post_task_by(uuid, numeric, text, text, date, text, text, text) to authenticated;

-- complete_wave_by (0023): the lines it posts are marked bulk (no scan).
create or replace function public.complete_wave_by(p_wave_id uuid, p_by_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res jsonb;
begin
  perform set_config('app.by_name', public.person_name(p_by_name), true);
  perform set_config('app.pick_scanned', '', true);
  perform set_config('app.pick_bulk', 'on', true);
  v_res := public.complete_wave(p_wave_id);
  perform set_config('app.pick_bulk', '', true);
  return v_res;
end $$;
revoke execute on function public.complete_wave_by(uuid, text) from public, anon;
grant execute on function public.complete_wave_by(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. The error rule (lib/pick-audit.ts mirrors it)
-- ---------------------------------------------------------------------
create or replace function public.norm_batch(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '\s', '', 'g'));
$$;

create or replace function public.pick_audit_errors(
  p_expected_sku text, p_expected_batch text, p_expected_expiry date, p_expected_qty numeric,
  p_found_sku text, p_found_batch text, p_found_expiry date, p_counted numeric, p_damaged boolean)
returns text[] language sql immutable as $$
  select array_remove(array[
    case when p_found_sku is distinct from p_expected_sku then 'WRONG_SKU' end,
    case when p_found_sku = p_expected_sku and p_counted < p_expected_qty then 'SHORT' end,
    case when p_found_sku = p_expected_sku and p_counted > p_expected_qty then 'OVER' end,
    case when p_found_sku = p_expected_sku
          and public.norm_batch(p_found_batch) <> public.norm_batch(p_expected_batch) then 'WRONG_BATCH' end,
    case when p_found_sku = p_expected_sku and p_found_expiry is not null and p_expected_expiry is not null
          and p_found_expiry <> p_expected_expiry then 'WRONG_EXPIRY' end,
    case when p_damaged then 'DAMAGED' end
  ], null);
$$;

-- ---------------------------------------------------------------------
-- 4. Attempts and loads
-- ---------------------------------------------------------------------
create table public.pick_audits (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references public.pick_tasks(id) on delete cascade,
  attempt_no         int not null check (attempt_no >= 1),
  checker_name       text not null,
  found_sku          text not null,
  found_scanned_code text,
  found_batch        text not null default '',
  found_expiry       date,
  counted_qty        numeric not null check (counted_qty >= 0),
  damaged            boolean not null default false,
  expected_sku       text not null,
  expected_batch     text not null default '',
  expected_expiry    date,
  expected_qty       numeric not null,
  errors             text[] not null default '{}'
                       check (errors <@ array['WRONG_SKU','SHORT','OVER','WRONG_BATCH','WRONG_EXPIRY','DAMAGED']),
  result             text not null check (result in ('OK', 'MISMATCH')),
  note               text,
  resolution         text check (resolution in ('ACCEPT_SHORT', 'ACCEPT_BATCH')),
  resolved_by_name   text,
  resolved_at        timestamptz,
  resolution_note    text,
  legacy             boolean not null default false,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  unique (task_id, attempt_no),
  constraint pick_audit_result check ((result = 'OK') = (errors = '{}')),
  constraint pick_audit_resolution check (
    resolution is null or (result = 'MISMATCH' and resolved_by_name is not null and resolved_at is not null
                           and nullif(trim(resolution_note), '') is not null))
);
create index pick_audits_created_idx on public.pick_audits (created_at desc);

create table public.shipment_loads (
  id              uuid primary key default gen_random_uuid(),
  wave_id         uuid not null references public.waves(id) on delete cascade,
  shipment_number text not null,
  loaded_by_name  text not null,
  truck           text,
  legacy          boolean not null default false,
  created_by      uuid references public.profiles(id),
  loaded_at       timestamptz not null default now(),
  unique (wave_id, shipment_number)
);

alter table public.pick_audits enable row level security;
alter table public.shipment_loads enable row level security;
create policy "pick_audits: read" on public.pick_audits for select to authenticated using (true);
create policy "shipment_loads: read" on public.shipment_loads for select to authenticated using (true);
-- No write policies: written only through the functions below.

-- ---------------------------------------------------------------------
-- 5. Views
-- ---------------------------------------------------------------------
-- One row per completed PICK task with its latest attempt.
create or replace view public.pick_audit_line with (security_invoker = true) as
with latest as (
  select distinct on (task_id) * from public.pick_audits order by task_id, attempt_no desc
), n as (
  select task_id, count(*)::int as attempts from public.pick_audits group by task_id
)
select t.id as task_id, t.wave_id, w.wave_no, w.planned_date, w.status as wave_status, t.shipment_number, t.seq,
       it.sku, it.description, it.uom,
       coalesce(ab.bin_code, fb.bin_code) as from_bin, coalesce(ab.zone, fb.zone) as zone,
       coalesce(t.actual_batch_lot, t.batch_lot) as batch_lot, coalesce(t.actual_expiry_date, t.expiry_date) as expiry_date,
       t.quantity as planned_qty, coalesce(t.actual_quantity, t.quantity) as picked_qty, t.deviation_reason,
       t.completed_at, t.picked_by_name, t.bulk_posted, t.scanned_code,
       l.id as audit_id, l.attempt_no, l.result, l.errors, l.resolution, l.checker_name, l.created_at as audited_at,
       coalesce(n.attempts, 0) as attempts,
       case when coalesce(t.actual_quantity, t.quantity) = 0 then 'AUTO_PASS'
            when l.id is null then 'TODO'
            when l.result = 'OK' then 'OK'
            when l.resolution is not null then 'RESOLVED'
            else 'MISMATCH' end as line_state,
       sl.id is not null as loaded
from public.pick_tasks t
join public.waves w on w.id = t.wave_id
join public.items it on it.id = t.item_id
join public.bins fb on fb.id = t.from_bin_id
left join public.bins ab on ab.id = t.actual_from_bin_id
left join latest l on l.task_id = t.id
left join n on n.task_id = t.id
left join public.shipment_loads sl on sl.wave_id = t.wave_id and sl.shipment_number = t.shipment_number
where t.task_type = 'PICK' and t.status = 'COMPLETED';

-- One row per wave + shipment with PICK tasks.
create or replace view public.pick_audit_shipment with (security_invoker = true) as
with tasks as (
  select wave_id, shipment_number,
         count(*) filter (where status in ('PLANNED', 'RESCHEDULED'))::int as open_tasks,
         count(*) filter (where status = 'COMPLETED')::int as lines
  from public.pick_tasks where task_type = 'PICK' group by wave_id, shipment_number
), st as (
  select wave_id, shipment_number,
         count(*) filter (where line_state = 'TODO')::int as todo,
         count(*) filter (where line_state in ('OK', 'AUTO_PASS'))::int as ok,
         count(*) filter (where line_state = 'MISMATCH')::int as mismatch,
         count(*) filter (where line_state = 'RESOLVED')::int as resolved
  from public.pick_audit_line group by wave_id, shipment_number
)
select w.id as wave_id, w.wave_no, w.planned_date, w.planned_slot, w.status as wave_status, w.truck as planned_truck,
       t.shipment_number, t.open_tasks, t.lines,
       coalesce(st.todo, 0) as todo, coalesce(st.ok, 0) as ok, coalesce(st.mismatch, 0) as mismatch, coalesce(st.resolved, 0) as resolved,
       case when sl.id is not null then 'LOADED'
            when w.status = 'CANCELLED' or (t.open_tasks = 0 and t.lines = 0) then 'CANCELLED'
            when t.open_tasks > 0 then 'PICKING'
            when coalesce(st.mismatch, 0) > 0 then 'HAS_MISMATCH'
            when coalesce(st.todo, 0) > 0 then 'READY_AUDIT'
            else 'READY_LOAD' end as state,
       sl.loaded_at, sl.loaded_by_name, sl.truck, coalesce(sl.legacy, false) as load_legacy
from tasks t
join public.waves w on w.id = t.wave_id
left join st on st.wave_id = t.wave_id and st.shipment_number = t.shipment_number
left join public.shipment_loads sl on sl.wave_id = t.wave_id and sl.shipment_number = t.shipment_number;

-- First attempt per line (not migrated ones): the basis of every accuracy KPI.
create or replace view public.pick_audit_first with (security_invoker = true) as
select a.id, a.task_id, a.created_at as audited_at, a.checker_name, a.expected_qty, a.counted_qty, a.errors, a.result,
       l.wave_id, l.wave_no, l.planned_date, l.shipment_number, l.sku, l.description, l.zone, l.from_bin,
       l.picked_by_name, l.bulk_posted, l.scanned_code is not null as scanned, l.completed_at,
       round((extract(epoch from a.created_at - l.completed_at) / 60)::numeric, 1) as minutes_to_audit
from public.pick_audits a
join public.pick_audit_line l on l.task_id = a.task_id
where a.attempt_no = 1 and not a.legacy;

-- ---------------------------------------------------------------------
-- Privileges (see 0005: nothing is granted by default)
-- ---------------------------------------------------------------------
grant select on public.pick_audits, public.shipment_loads,
  public.pick_audit_line, public.pick_audit_shipment, public.pick_audit_first to authenticated;
grant all on public.pick_audits, public.shipment_loads to service_role;
revoke execute on function public.norm_batch(text),
  public.pick_audit_errors(text, text, date, numeric, text, text, date, numeric, boolean) from public, anon;
grant execute on function public.norm_batch(text),
  public.pick_audit_errors(text, text, date, numeric, text, text, date, numeric, boolean) to authenticated;
```

- [ ] **Step 5: Run the SQL tests**

Run: `scripts/sql-test.sh`
Expected: `10_pick_audit.sql: 13 PASS, 0 FAIL`; 02–09 unchanged counts, 0 FAIL; exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/sql-test.sh supabase/migrations/0024_pick_audit.sql supabase/tests/10_pick_audit.sql
git commit -m "feat(pick-audit): attempts, loads, views and picker stamping"
```

---

### Task 3: `record_pick_audit` — the blind audit

**Files:**
- Modify: `supabase/migrations/0024_pick_audit.sql` (append section 6 before the `Privileges` section)
- Modify: `supabase/tests/10_pick_audit.sql` (insert section B before `rollback;`)

**Interfaces:**
- Consumes: Task 2 tables, views, `pick_audit_errors`, `norm_batch`.
- Produces: `record_pick_audit(p_task_id uuid, p_checker_name text, p_found text, p_counted numeric, p_batch text, p_expiry date, p_damaged boolean, p_note text) → jsonb` returning `{result, errors[], attempt, expected:{sku,batch,expiry,qty}, found:{sku,code,batch,expiry,qty,damaged}}`.

- [ ] **Step 1: Write the failing test** — insert before `rollback;` in `10_pick_audit.sql`:

```sql
-- ---- B. record_pick_audit -------------------------------------------------
-- (session: operator; any staff may audit)
select pg_temp.check('a pick that is not completed cannot be audited',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550024919', 2, 'C1', null, false, null)$q$, pg_temp.task('PA4', 4)),
    'Tugas pick belum selesai%'));
select pg_temp.check('a line picked as 0 is not audited',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550024919', 0, 'C1', null, false, null)$q$, pg_temp.task('PA1', 5)),
    'Baris ini tidak dipick%'));
select pg_temp.check('the picker cannot audit own line (name compared ignoring case and spaces)',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'budi  santoso', '550044709', 10, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    'Checker tidak boleh picker%'));
select pg_temp.check('a checker name is required',
  pg_temp.fails(format($q$select record_pick_audit(%L, ' ', '550044709', 10, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    'Nama checker wajib%'));
select pg_temp.check('an unknown carton code is refused',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '0000000000000', 10, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    '%tidak dikenal%'));
select pg_temp.check('a negative count is refused',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550044709', -1, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    'Jumlah hitung tidak valid%'));

select pg_temp.check('carton EAN + batch typed " a7 " + full count -> OK',
  record_pick_audit(pg_temp.task('PA1', 1), 'Sari', '8994123456789', 10, ' a7 ', null, false, null)->>'result' = 'OK');
select pg_temp.check('the attempt keeps the scanned code and the SKU it resolved to',
  (select found_sku = '550044709' and found_scanned_code = '8994123456789' and found_batch = 'A7' and attempt_no = 1
     and checker_name = 'Sari' and expected_qty = 10 from pick_audits where task_id = pg_temp.task('PA1', 1)));
select pg_temp.check('a passed line cannot be audited again',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550044709', 9, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    'Baris ini sudah lolos audit%'));
select pg_temp.check('expected = what the picker reported (4), not the plan (5)',
  record_pick_audit(pg_temp.task('PA1', 2), 'Sari', '550024919', 4, 'C1', '2031-07-07', false, null)->>'result' = 'OK');

select pg_temp.check('count 5 of 6 -> MISMATCH SHORT; no note needed (blind)',
  (select r->>'result' = 'MISMATCH' and r->'errors' = '["SHORT"]'::jsonb and (r->'expected'->>'qty')::numeric = 6
   from (select record_pick_audit(pg_temp.task('PA2', 3), 'Sari', '550044709', 5, 'A7', null, false, null) r) x));
select pg_temp.check('re-audit after the floor fix: other batch -> attempt 2, WRONG_BATCH',
  (select r->>'attempt' = '2' and r->'errors' = '["WRONG_BATCH"]'::jsonb
   from (select record_pick_audit(pg_temp.task('PA2', 3), 'Sari', '550044709', 6, 'B8', null, false, 'palet isi B8') r) x));
select pg_temp.check('wrong item on the pallet -> WRONG_SKU only',
  record_pick_audit(pg_temp.task('PA3', 1), 'Sari', '550024919', 4, 'C1', null, false, null)->'errors' = '["WRONG_SKU"]'::jsonb);
select pg_temp.check('damaged cartons -> DAMAGED',
  record_pick_audit(pg_temp.task('PA3', 1), 'Sari', '550044709', 4, 'A7', null, true, 'karton penyok')->'errors' = '["DAMAGED"]'::jsonb);
select pg_temp.check('line shows the latest attempt; shipment states follow',
  (select line_state = 'MISMATCH' and attempts = 2 from pg_temp.line('PA2', 3))
  and (pg_temp.ship('PA1')).state = 'READY_LOAD' and (pg_temp.ship('PA2')).state = 'HAS_MISMATCH');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `scripts/sql-test.sh supabase/tests/10_pick_audit.sql`
Expected: `ERROR in …10_pick_audit.sql` — `function record_pick_audit(…) does not exist`.

- [ ] **Step 3: Implement** — in `0024_pick_audit.sql`, insert before the `-- Privileges` block:

```sql
-- ---------------------------------------------------------------------
-- 6. Recording an attempt
-- ---------------------------------------------------------------------
create or replace function public.record_pick_audit(
  p_task_id uuid, p_checker_name text, p_found text, p_counted numeric,
  p_batch text, p_expiry date, p_damaged boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checker text := public.person_name(p_checker_name, 'Nama checker');
  t record; v_prev public.pick_audits%rowtype; v_found_sku text; v_code text;
  v_errors text[]; v_result text; v_attempt int;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  select pt.id, pt.wave_id, pt.shipment_number, pt.task_type, pt.status, pt.picked_by_name, it.sku,
         coalesce(pt.actual_quantity, pt.quantity) as qty, coalesce(pt.actual_batch_lot, pt.batch_lot) as batch,
         coalesce(pt.actual_expiry_date, pt.expiry_date) as expiry, w.status as wave_status
    into t
  from public.pick_tasks pt join public.items it on it.id = pt.item_id join public.waves w on w.id = pt.wave_id
  where pt.id = p_task_id
  for update of pt;
  if not found or t.task_type <> 'PICK' or t.status <> 'COMPLETED' then
    raise exception 'Tugas pick belum selesai atau tidak ditemukan';
  end if;
  if t.wave_status = 'CANCELLED' then raise exception 'Wave dibatalkan: baris ini tidak diaudit'; end if;
  if exists (select 1 from public.shipment_loads where wave_id = t.wave_id and shipment_number = t.shipment_number) then
    raise exception 'Shipment % sudah dimuat', t.shipment_number;
  end if;
  if t.qty = 0 then raise exception 'Baris ini tidak dipick (0): tidak perlu diaudit'; end if;
  if public.same_person(v_checker, t.picked_by_name) then
    raise exception 'Checker tidak boleh picker baris ini (%)', t.picked_by_name;
  end if;
  select * into v_prev from public.pick_audits where task_id = p_task_id order by attempt_no desc limit 1;
  if v_prev.id is not null and (v_prev.result = 'OK' or v_prev.resolution is not null) then
    raise exception 'Baris ini sudah lolos audit';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;
  if nullif(trim(p_found), '') is null then raise exception 'Scan karton atau ketik SKU yang ada di palet'; end if;
  select sku into v_found_sku from public.item_by_barcode(p_found) limit 1;
  if v_found_sku is null then raise exception 'Barcode / SKU % tidak dikenal di master item', trim(p_found); end if;
  v_code := regexp_replace(p_found, '\s', '', 'g');
  if v_code = v_found_sku then v_code := null; end if;

  v_errors := public.pick_audit_errors(t.sku, t.batch, t.expiry, t.qty,
                                       v_found_sku, p_batch, p_expiry, p_counted, coalesce(p_damaged, false));
  v_result := case when v_errors = '{}' then 'OK' else 'MISMATCH' end;
  v_attempt := coalesce(v_prev.attempt_no, 0) + 1;

  insert into public.pick_audits (task_id, attempt_no, checker_name, found_sku, found_scanned_code, found_batch, found_expiry,
    counted_qty, damaged, expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note, created_by)
  values (p_task_id, v_attempt, v_checker, v_found_sku, v_code, public.norm_batch(p_batch), p_expiry,
    p_counted, coalesce(p_damaged, false), t.sku, t.batch, t.expiry, t.qty, v_errors, v_result, nullif(trim(p_note), ''), auth.uid());

  -- The expected values leave the database only here, after the count is saved.
  return jsonb_build_object('result', v_result, 'errors', to_jsonb(v_errors), 'attempt', v_attempt,
    'expected', jsonb_build_object('sku', t.sku, 'batch', t.batch, 'expiry', t.expiry, 'qty', t.qty),
    'found', jsonb_build_object('sku', v_found_sku, 'code', v_code, 'batch', public.norm_batch(p_batch),
                                'expiry', p_expiry, 'qty', p_counted, 'damaged', coalesce(p_damaged, false)));
end $$;
```

And add to the `Privileges` block at the end of the file:

```sql
revoke execute on function public.record_pick_audit(uuid, text, text, numeric, text, date, boolean, text) from public, anon;
grant execute on function public.record_pick_audit(uuid, text, text, numeric, text, date, boolean, text) to authenticated;
```

- [ ] **Step 4: Run the SQL tests**

Run: `scripts/sql-test.sh supabase/tests/10_pick_audit.sql`
Expected: `28 PASS, 0 FAIL`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0024_pick_audit.sql supabase/tests/10_pick_audit.sql
git commit -m "feat(pick-audit): blind audit attempts with derived errors"
```

---

### Task 4: `resolve_pick_mismatch` — the two supervisor acceptances

**Files:**
- Modify: `supabase/migrations/0024_pick_audit.sql` (append section 7 before `Privileges`; grants in `Privileges`)
- Modify: `supabase/tests/10_pick_audit.sql` (insert section C before `rollback;`)

**Interfaces:**
- Consumes: `pick_audits`, `held_qty` (0017), `open_pick_tasks` (0007), `create_count_task` (0019), adjustment guard settings `app.by_name`, `app.adjust_reason`, `app.adjust_approved` (0018).
- Produces: `resolve_pick_mismatch(p_audit_id uuid, p_action text, p_by_name text, p_note text, p_bin text default null) → jsonb` `{result:'RESOLVED', action, count_task}`.

- [ ] **Step 1: Write the failing test** — insert before `rollback;`:

```sql
-- ---- C. resolve_pick_mismatch -------------------------------------------
select set_config('t.pa2_1', (select id::text from pick_audits where task_id = pg_temp.task('PA2', 3) and attempt_no = 1), false);
select set_config('t.pa2_2', (select id::text from pick_audits where task_id = pg_temp.task('PA2', 3) and attempt_no = 2), false);
select set_config('t.pa3_2', (select id::text from pick_audits where task_id = pg_temp.task('PA3', 1) and attempt_no = 2), false);

select pg_temp.check('an operator cannot accept a mismatch',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'ACCEPT_BATCH', 'Pak Joko', 'ok', 'CF38C02')$q$, current_setting('t.pa2_2')),
    'Hanya supervisor%'));
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check('only the latest attempt of a line can be decided',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'ACCEPT_SHORT', 'Pak Joko', 'ok')$q$, current_setting('t.pa2_1')),
    'Hanya audit terakhir%'));
select pg_temp.check('accept short only when short is the only error',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'ACCEPT_SHORT', 'Pak Joko', 'ok')$q$, current_setting('t.pa2_2')),
    'Terima kurang hanya%'));
select pg_temp.check('accept batch only for batch / expiry differences',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'ACCEPT_BATCH', 'Pak Joko', 'ok', 'CF38C01')$q$, current_setting('t.pa3_2')),
    'Terima batch hanya%'));
select pg_temp.check('the checker cannot decide',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'ACCEPT_BATCH', 'sari', 'ok', 'CF38C02')$q$, current_setting('t.pa2_2')),
    'Yang memutuskan harus orang lain%'));
select pg_temp.check('the picker cannot decide',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'ACCEPT_BATCH', 'Budi Santoso', 'ok', 'CF38C02')$q$, current_setting('t.pa2_2')),
    'Yang memutuskan harus orang lain%'));
select pg_temp.check('a reason is required',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'ACCEPT_BATCH', 'Pak Joko', ' ', 'CF38C02')$q$, current_setting('t.pa2_2')),
    'Alasan wajib%'));
select pg_temp.check('unknown action is refused',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'SHIP_ANYWAY', 'Pak Joko', 'ok')$q$, current_setting('t.pa2_2')),
    'Tindakan tidak dikenal%'));
select pg_temp.check('accept batch needs the found batch free in the named bin',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'ACCEPT_BATCH', 'Pak Joko', 'ok', 'CF37C01')$q$, current_setting('t.pa2_2')),
    'Stok batch B8 di bin CF37C01 tidak cukup%'));

select pg_temp.check('accept batch B8 from CF38C02',
  resolve_pick_mismatch(current_setting('t.pa2_2')::uuid, 'ACCEPT_BATCH', 'Pak Joko', 'B8 ikut terkirim', 'CF38C02')->>'result' = 'RESOLVED');
select pg_temp.check('A7 back in CF38C01 (48 - 10 - 6 - 4 + 6 = 34), B8 out of CF38C02 (10 - 6 = 4)',
  pg_temp.qty('CF38C01', 'A7') = 34 and pg_temp.qty('CF38C02', 'B8') = 4);
select pg_temp.check('the pick now records what was shipped',
  (select actual_batch_lot = 'B8' and actual_expiry_date = '2031-06-06' and actual_quantity = 6
     and actual_from_bin_id = (select id from bins where bin_code = 'CF38C02') from pick_tasks where id = pg_temp.task('PA2', 3)));
select pg_temp.check('two PICK_AUDIT adjustments by the supervisor, linked to the attempt',
  (select count(*) = 2 and bool_and(reason_code = 'PICK_AUDIT' and by_name = 'Pak Joko')
   from movements where ref_id = current_setting('t.pa2_2')::uuid));
select pg_temp.check('the source bin gets a recount',
  exists (select 1 from count_tasks c join bins b on b.id = c.bin_id
          where b.bin_code = 'CF38C01' and c.source = 'PICK_AUDIT' and c.status = 'OPEN'));
select pg_temp.check('line resolved, shipment ready to load',
  (pg_temp.line('PA2', 3)).line_state = 'RESOLVED' and (pg_temp.ship('PA2')).state = 'READY_LOAD');
select pg_temp.check('a decided attempt cannot be decided again',
  pg_temp.fails(format($q$select resolve_pick_mismatch(%L, 'ACCEPT_BATCH', 'Pak Joko', 'ok', 'CF38C02')$q$, current_setting('t.pa2_2')),
    'Audit ini tidak perlu diputuskan%'));
select pg_temp.check('a resolved line cannot be audited again',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550044709', 6, 'B8', null, false, null)$q$, pg_temp.task('PA2', 3)),
    'Baris ini sudah lolos audit%'));

select pg_temp.check('PA3 re-audited after replacing the damaged cartons: 3 of 4 -> SHORT',
  record_pick_audit(pg_temp.task('PA3', 1), 'Sari', '550044709', 3, 'A7', null, false, null)->'errors' = '["SHORT"]'::jsonb);
select pg_temp.check('accept short',
  resolve_pick_mismatch((select id from pick_audits where task_id = pg_temp.task('PA3', 1) and attempt_no = 3),
    'ACCEPT_SHORT', 'Pak Joko', 'kirim 3, sisa 1 dicari')->>'result' = 'RESOLVED');
select pg_temp.check('the missing carton is back on the books in CF38C01 (35), pick and outbound say 3',
  pg_temp.qty('CF38C01', 'A7') = 35
  and (select actual_quantity = 3 from pick_tasks where id = pg_temp.task('PA3', 1))
  and (select quantity_picked = 3 from outbound where shipment_number = 'PA3'));
select pg_temp.check('one open recount for CF38C01 (the second request is merged)',
  (select count(*) = 1 from count_tasks c join bins b on b.id = c.bin_id
   where b.bin_code = 'CF38C01' and c.status in ('OPEN', 'COUNTED', 'RECOUNT')));
select pg_temp.check('adjustment settings do not leak out of the function',
  coalesce(current_setting('app.adjust_approved', true), '') = '' and coalesce(current_setting('app.adjust_reason', true), '') = '');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `scripts/sql-test.sh supabase/tests/10_pick_audit.sql`
Expected: `ERROR in …` — `function resolve_pick_mismatch(…) does not exist`.

- [ ] **Step 3: Implement** — in `0024_pick_audit.sql`, before `-- Privileges`:

```sql
-- ---------------------------------------------------------------------
-- 7. A supervisor accepts a mismatch instead of a floor fix
--    ACCEPT_SHORT  ship what is there; the missing cartons go back on the
--                  books in the source bin.
--    ACCEPT_BATCH  ship the batch that is there; the planned batch goes
--                  back to the source bin, the found batch comes out of
--                  the bin it was taken from.
--    Both open a recount of the source bin: its records were wrong or
--    cartons are unaccounted for. No approval queue: the resolver is
--    already a second person (≠ picker, ≠ checker).
-- ---------------------------------------------------------------------
create or replace function public.resolve_pick_mismatch(
  p_audit_id uuid, p_action text, p_by_name text, p_note text, p_bin text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; a public.pick_audits%rowtype; t record; v_latest int; v_src uuid; v_src_code text;
  v_diff numeric; v_bin uuid; v_rows int; r public.inventory%rowtype; v_free numeric; v_count uuid; v_note text;
begin
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa menerima selisih';
  end if;
  v_name := public.person_name(p_by_name, 'Nama supervisor');
  if p_action not in ('ACCEPT_SHORT', 'ACCEPT_BATCH') then raise exception 'Tindakan tidak dikenal: %', p_action; end if;
  v_note := nullif(trim(p_note), '');
  if v_note is null then raise exception 'Alasan wajib diisi'; end if;

  select * into a from public.pick_audits where id = p_audit_id;
  if a.id is null then raise exception 'Audit tidak ditemukan'; end if;
  select pt.id, pt.wave_id, pt.shipment_number, pt.item_id, pt.picked_by_name,
         coalesce(pt.actual_from_bin_id, pt.from_bin_id) as src
    into t
  from public.pick_tasks pt where pt.id = a.task_id for update;
  if exists (select 1 from public.shipment_loads where wave_id = t.wave_id and shipment_number = t.shipment_number) then
    raise exception 'Shipment % sudah dimuat', t.shipment_number;
  end if;
  select max(attempt_no) into v_latest from public.pick_audits where task_id = a.task_id;
  if a.attempt_no <> v_latest then raise exception 'Hanya audit terakhir baris ini yang bisa diputuskan'; end if;
  if a.result <> 'MISMATCH' or a.resolution is not null then raise exception 'Audit ini tidak perlu diputuskan'; end if;
  if public.same_person(v_name, t.picked_by_name) or public.same_person(v_name, a.checker_name) then
    raise exception 'Yang memutuskan harus orang lain dari picker dan checker';
  end if;
  v_src := t.src;
  select bin_code into v_src_code from public.bins where id = v_src;

  perform set_config('app.by_name', v_name, true);
  perform set_config('app.adjust_reason', 'PICK_AUDIT', true);
  perform set_config('app.adjust_approved', 'on', true);

  if p_action = 'ACCEPT_SHORT' then
    if a.errors <> array['SHORT'] then
      raise exception 'Terima kurang hanya untuk selisih kurang saja (SKU, batch dan kondisi sesuai)';
    end if;
    v_diff := a.expected_qty - a.counted_qty;
    insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, ref_id)
    values ('adjustment', t.item_id, a.expected_batch, v_diff, v_src, a.expected_expiry, 'PICK_AUDIT',
            format('Audit picking SH %s: kurang %s karton, dicatat kembali di bin. %s', t.shipment_number, v_diff, v_note), a.id);
    update public.pick_tasks set actual_quantity = a.counted_qty where id = t.id;
    update public.outbound set quantity_picked = greatest(quantity_picked - v_diff, 0)
    where wave_id = t.wave_id and shipment_number = t.shipment_number and item_id = t.item_id;
  else
    if a.errors = '{}' or not (a.errors <@ array['WRONG_BATCH', 'WRONG_EXPIRY']) or a.counted_qty <> a.expected_qty then
      raise exception 'Terima batch hanya untuk batch / expired yang beda dengan jumlah sesuai';
    end if;
    select id into v_bin from public.bins where bin_code = upper(trim(coalesce(p_bin, '')));
    if v_bin is null then raise exception 'Isi bin asal batch % yang ada di palet', a.found_batch; end if;
    select count(*) into v_rows from public.inventory
    where bin_id = v_bin and item_id = t.item_id and public.norm_batch(batch_lot) = a.found_batch
      and (a.found_expiry is null or expiry_date = a.found_expiry);
    if v_rows > 1 then
      raise exception 'Batch % ada dengan beberapa tanggal expired di bin %: audit ulang dengan tanggal expired', a.found_batch, upper(p_bin);
    end if;
    select * into r from public.inventory
    where bin_id = v_bin and item_id = t.item_id and public.norm_batch(batch_lot) = a.found_batch
      and (a.found_expiry is null or expiry_date = a.found_expiry)
    for update;
    v_free := coalesce(r.quantity, 0);
    if r.id is not null then
      v_free := v_free - public.held_qty(r.bin_id, r.item_id, r.batch_lot, r.expiry_date, r.quantity)
                - coalesce((select sum(o.quantity) from public.open_pick_tasks o
                            where o.from_bin_id = r.bin_id and o.item_id = r.item_id and o.batch_lot = r.batch_lot
                              and o.expiry_date = r.expiry_date), 0);
    end if;
    if v_free < a.counted_qty then
      raise exception 'Stok batch % di bin % tidak cukup (bebas %): adjust atau hitung dulu', a.found_batch, upper(trim(p_bin)), v_free;
    end if;
    insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, reason_code, note, ref_id)
    values ('adjustment', t.item_id, a.expected_batch, a.expected_qty, v_src, a.expected_expiry, 'PICK_AUDIT',
            format('Audit picking SH %s: batch %s tidak terkirim, dicatat kembali. %s', t.shipment_number, a.expected_batch, v_note), a.id),
           ('adjustment', t.item_id, r.batch_lot, -a.counted_qty, v_bin, r.expiry_date, 'PICK_AUDIT',
            format('Audit picking SH %s: batch %s terkirim. %s', t.shipment_number, r.batch_lot, v_note), a.id);
    update public.pick_tasks set actual_batch_lot = r.batch_lot, actual_expiry_date = r.expiry_date, actual_from_bin_id = v_bin
    where id = t.id;
  end if;

  v_count := public.create_count_task(v_src_code, format('Audit picking SH %s: %s', t.shipment_number,
    case p_action when 'ACCEPT_SHORT' then 'terima kurang' else 'terima batch lain' end), 'PICK_AUDIT');

  update public.pick_audits set resolution = p_action, resolved_by_name = v_name, resolved_at = now(), resolution_note = v_note
  where id = a.id;

  perform set_config('app.adjust_approved', '', true);
  perform set_config('app.adjust_reason', '', true);
  return jsonb_build_object('result', 'RESOLVED', 'action', p_action, 'count_task', v_count);
end $$;
```

And in the `Privileges` block:

```sql
revoke execute on function public.resolve_pick_mismatch(uuid, text, text, text, text) from public, anon;
grant execute on function public.resolve_pick_mismatch(uuid, text, text, text, text) to authenticated;
```

- [ ] **Step 4: Run the SQL tests**

Run: `scripts/sql-test.sh supabase/tests/10_pick_audit.sql`
Expected: `50 PASS, 0 FAIL`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0024_pick_audit.sql supabase/tests/10_pick_audit.sql
git commit -m "feat(pick-audit): supervisor accepts short or other batch with stock correction"
```

---

### Task 5: Loading gate, old PICK audits, legacy backfill, realtime

**Files:**
- Modify: `supabase/migrations/0024_pick_audit.sql` (sections 8–10 before `Privileges`; realtime + backfill call at the very end)
- Modify: `supabase/tests/10_pick_audit.sql` (section D before `rollback;`)
- Modify: `supabase/tests/06_audits.sql` (PICK part)

**Interfaces:**
- Produces:
  - `mark_shipment_loaded(p_wave_id uuid, p_shipment text, p_by_name text, p_truck text default null) → jsonb` `{result:'LOADED', shipment, lines}`
  - `record_audit(...)` now refuses `PICK` with `Pakai audit picking baru`
  - `pick_audit_backfill_legacy(p_before date) → jsonb` `{attempts, loads}` (not granted to users)

- [ ] **Step 1: Write the failing tests**

Insert before `rollback;` in `10_pick_audit.sql`:

```sql
-- ---- D. Loading, freeze, cancelled wave, old audits ---------------------
select pg_temp.check('a shipment with open pick tasks cannot load',
  pg_temp.fails(format($q$select mark_shipment_loaded(%L, 'PA4', 'Andi')$q$, pg_temp.wave('1')), 'Masih ada tugas pick%'));
select pg_temp.check('a shipment with an unaudited line cannot load, and says which',
  pg_temp.fails(format($q$select mark_shipment_loaded(%L, 'PA5', 'Andi')$q$, pg_temp.wave('1')),
    'Belum boleh dimuat: #6 550024919 (belum diaudit)%'));
select record_pick_audit(pg_temp.task('PA5', 6), 'Sari', '550024919', 1, 'C1', null, false, null);
select pg_temp.check('a shipment with a mismatch cannot load',
  pg_temp.fails(format($q$select mark_shipment_loaded(%L, 'PA5', 'Andi')$q$, pg_temp.wave('1')), '%#6 550024919 (selisih)%'));
select pg_temp.check('unknown shipment',
  pg_temp.fails(format($q$select mark_shipment_loaded(%L, 'NOPE', 'Andi')$q$, pg_temp.wave('1')), 'Shipment NOPE tidak ada%'));
select pg_temp.check('a loader name is required',
  pg_temp.fails(format($q$select mark_shipment_loaded(%L, 'PA1', '')$q$, pg_temp.wave('1')), 'Nama petugas muat wajib%'));

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.check('PA1 (two OK lines + one picked as 0) loads; any staff may load',
  mark_shipment_loaded(pg_temp.wave('1'), 'PA1', 'Andi', ' B 1234 XY ')->>'result' = 'LOADED');
select pg_temp.check('loaded state, who and which truck',
  (select state = 'LOADED' and loaded_by_name = 'Andi' and truck = 'B 1234 XY' and not load_legacy from pg_temp.ship('PA1')));
select pg_temp.check('a shipment loads once',
  pg_temp.fails(format($q$select mark_shipment_loaded(%L, 'PA1', 'Andi')$q$, pg_temp.wave('1')), 'Shipment PA1 sudah dimuat%'));
select pg_temp.check('nothing on a loaded shipment is audited again',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550044709', 10, 'A7', null, false, null)$q$, pg_temp.task('PA1', 1)),
    'Shipment PA1 sudah dimuat%'));
select pg_temp.check('PA2 (resolved line) loads',
  mark_shipment_loaded(pg_temp.wave('1'), 'PA2', 'Andi')->>'result' = 'LOADED');

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select set_wave_status(pg_temp.wave('1'), 'CANCELLED', 'test');
select pg_temp.check('cancelled wave: its shipments show CANCELLED, loaded ones stay LOADED',
  (pg_temp.ship('PA5')).state = 'CANCELLED' and (pg_temp.ship('PA4')).state = 'CANCELLED' and (pg_temp.ship('PA1')).state = 'LOADED');
select pg_temp.check('cancelled wave: no loading',
  pg_temp.fails(format($q$select mark_shipment_loaded(%L, 'PA5', 'Andi')$q$, pg_temp.wave('1')), 'Wave dibatalkan%'));
select pg_temp.check('cancelled wave: no audit',
  pg_temp.fails(format($q$select record_pick_audit(%L, 'Sari', '550024919', 2, 'C1', null, false, null)$q$, pg_temp.task('PA5', 6)),
    'Wave dibatalkan%'));
select pg_temp.check('the old audit function no longer takes picks',
  pg_temp.fails(format($q$select record_audit('PICK', %L, 4, true, true, null)$q$, pg_temp.task('PA3', 1)), 'Pakai audit picking baru%'));
select pg_temp.check('first attempts only: 5 lines, 2 OK (PA1 #1, #2)',
  (select count(*) = 5 and count(*) filter (where result = 'OK') = 2 and bool_and(minutes_to_audit is not null)
   from pick_audit_first where planned_date = '2026-10-06'));

-- Legacy: a pick audited the old way before this migration.
select save_plan('2026-09-01', '{"waves":[{"wave_no":"1","shipment_numbers":["LG1"]}],
  "tasks":[{"wave_no":"1","shipment_number":"LG1","task_type":"PICK","sku":"550024919","from_bin":"CF37C01","batch_lot":"C1","expiry_date":"2031-07-07","quantity":1,"seq":1}],
  "outbound":[{"wave_no":"1","shipment_number":"LG1","sku":"550024919","quantity_requested":1,"quantity_allocated":1}]}'::jsonb);
select set_config('app.by_name', '', true);
select post_task((select t.id from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-09-01'));
reset role;
insert into audits (kind, task_id, expected_qty, counted_qty, sku_ok, batch_ok, result, note, history, audited_by, audited_at)
select 'PICK', t.id, 1, 1, true, true, 'OK', null,
  '[{"counted_qty":0,"sku_ok":true,"batch_ok":false,"result":"MISMATCH","note":"kosong","audited_by":"22222222-2222-2222-2222-222222222222","audited_at":"2026-09-01T10:00:00+07:00"}]'::jsonb,
  '22222222-2222-2222-2222-222222222222', '2026-09-01 11:00+07'
from pick_tasks t join waves w on w.id = t.wave_id where w.planned_date = '2026-09-01';
select pg_temp.check('backfill: 2 legacy attempts, 1 legacy load',
  pick_audit_backfill_legacy('2026-09-28') = '{"attempts": 2, "loads": 1}'::jsonb);
select pg_temp.check('legacy attempts keep order, derived errors and the profile name',
  (select array_agg(result || ':' || array_to_string(errors, ',') || ':' || checker_name order by attempt_no)
     = array['MISMATCH:SHORT,WRONG_BATCH:Supervisor', 'OK::Supervisor'] and bool_and(legacy)
   from pick_audits a join pick_tasks t on t.id = a.task_id join waves w on w.id = t.wave_id where w.planned_date = '2026-09-01'));
select pg_temp.check('legacy shipment counts as loaded',
  (select state = 'LOADED' and load_legacy and loaded_by_name = '(sebelum audit wajib)'
   from pick_audit_shipment where planned_date = '2026-09-01' and shipment_number = 'LG1'));
select pg_temp.check('legacy attempts are not in the KPIs',
  not exists (select 1 from pick_audit_first where planned_date = '2026-09-01'));
select pg_temp.check('backfill twice changes nothing',
  pick_audit_backfill_legacy('2026-09-28') = '{"attempts": 0, "loads": 0}'::jsonb);
```

In `supabase/tests/06_audits.sql` replace the whole `-- Pick audit` block (from the line `-- Pick audit` through the check `'one audit per task; the earlier OK is kept in history'` inclusive) with:

```sql
-- Pick audit moved to record_pick_audit (0024); the old function refuses picks.
select post_task(current_setting('t.task')::uuid, 18, null, null, null, 'karton rusak');
select pg_temp.check('picking is audited with record_pick_audit now (0024)',
  pg_temp.fails(format($q$select record_audit('PICK', %L, 18, true, true, null)$q$, current_setting('t.task')), 'Pakai audit picking baru%'));
```

- [ ] **Step 2: Run it to verify it fails**

Run: `scripts/sql-test.sh supabase/tests/10_pick_audit.sql supabase/tests/06_audits.sql`
Expected: `ERROR in …10_pick_audit.sql` (`mark_shipment_loaded` does not exist) and `06_audits.sql: … 1 FAIL` (old function still accepts PICK).

- [ ] **Step 3: Implement** — in `0024_pick_audit.sql`, before `-- Privileges`:

```sql
-- ---------------------------------------------------------------------
-- 8. Loading: only when every picked line passed; final
-- ---------------------------------------------------------------------
create or replace function public.mark_shipment_loaded(p_wave_id uuid, p_shipment text, p_by_name text, p_truck text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; w public.waves%rowtype; v_open int; v_lines int; v_block text;
begin
  if not public.has_role(array['operator','supervisor','admin']::public.user_role[]) then
    raise exception 'Sesi situs tidak tersedia';
  end if;
  v_name := public.person_name(p_by_name, 'Nama petugas muat');
  select * into w from public.waves where id = p_wave_id for update;
  if not found then raise exception 'Wave tidak ditemukan'; end if;
  -- Audits and decisions lock their task; take the same locks so none slips in.
  perform 1 from public.pick_tasks where wave_id = w.id and shipment_number = p_shipment and task_type = 'PICK' for update;
  select count(*) filter (where status in ('PLANNED', 'RESCHEDULED')), count(*) filter (where status = 'COMPLETED')
    into v_open, v_lines
  from public.pick_tasks where wave_id = w.id and shipment_number = p_shipment and task_type = 'PICK';
  if v_open + v_lines = 0 and not exists (select 1 from public.pick_tasks where wave_id = w.id and shipment_number = p_shipment) then
    raise exception 'Shipment % tidak ada di wave ini', p_shipment;
  end if;
  if exists (select 1 from public.shipment_loads where wave_id = w.id and shipment_number = p_shipment) then
    raise exception 'Shipment % sudah dimuat', p_shipment;
  end if;
  if w.status = 'CANCELLED' then raise exception 'Wave dibatalkan: shipment % tidak dimuat', p_shipment; end if;
  if v_open > 0 then raise exception 'Masih ada tugas pick yang belum selesai (%)', v_open; end if;
  if v_lines = 0 then raise exception 'Tidak ada barang yang dipick untuk shipment %', p_shipment; end if;
  select string_agg(format('#%s %s (%s)', seq, sku, case line_state when 'TODO' then 'belum diaudit' else 'selisih' end), ', ' order by seq)
    into v_block
  from public.pick_audit_line
  where wave_id = w.id and shipment_number = p_shipment and line_state in ('TODO', 'MISMATCH');
  if v_block is not null then raise exception 'Belum boleh dimuat: %', v_block; end if;

  insert into public.shipment_loads (wave_id, shipment_number, loaded_by_name, truck, created_by)
  values (w.id, p_shipment, v_name, nullif(trim(p_truck), ''), auth.uid());
  return jsonb_build_object('result', 'LOADED', 'shipment', p_shipment, 'lines', v_lines);
end $$;

-- ---------------------------------------------------------------------
-- 9. record_audit (0012): picks go through record_pick_audit now
-- ---------------------------------------------------------------------
create or replace function public.record_audit(
  p_kind text, p_ref uuid, p_counted numeric, p_sku_ok boolean, p_batch_ok boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_expected numeric; v_result text; v_prev public.audits%rowtype;
begin
  if p_kind = 'PICK' then
    raise exception 'Pakai audit picking baru (Audit picking → shipment)';
  end if;
  if not public.has_role(array['supervisor','admin']::public.user_role[]) then
    raise exception 'Hanya supervisor atau admin yang bisa mengaudit';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Jumlah hitung tidak valid'; end if;

  if p_kind = 'PUTAWAY' then
    select quantity into v_expected from public.movements
    where id = p_ref and type in ('putaway', 'inbound');
    if v_expected is null then raise exception 'Mutasi putaway tidak ditemukan'; end if;
  else
    raise exception 'Jenis audit tidak dikenal: %', p_kind;
  end if;

  v_result := case when p_counted = v_expected and p_sku_ok and p_batch_ok then 'OK' else 'MISMATCH' end;
  if v_result = 'MISMATCH' and nullif(trim(p_note), '') is null then
    raise exception 'Ada selisih: catatan wajib diisi';
  end if;

  select * into v_prev from public.audits where movement_id = p_ref for update;

  if v_prev.id is null then
    insert into public.audits (kind, task_id, movement_id, expected_qty, counted_qty, sku_ok, batch_ok, result, note, audited_by)
    values (p_kind, null, p_ref, v_expected, p_counted, p_sku_ok, p_batch_ok, v_result, nullif(trim(p_note), ''), auth.uid());
  else
    update public.audits set
      history = v_prev.history || jsonb_build_object(
        'counted_qty', v_prev.counted_qty, 'sku_ok', v_prev.sku_ok, 'batch_ok', v_prev.batch_ok,
        'result', v_prev.result, 'note', v_prev.note, 'audited_by', v_prev.audited_by, 'audited_at', v_prev.audited_at),
      expected_qty = v_expected, counted_qty = p_counted, sku_ok = p_sku_ok, batch_ok = p_batch_ok,
      result = v_result, note = nullif(trim(p_note), ''), audited_by = auth.uid(), audited_at = now()
    where id = v_prev.id;
  end if;

  return jsonb_build_object('result', v_result, 'expected', v_expected, 'counted', p_counted);
end $$;

-- ---------------------------------------------------------------------
-- 10. Before this migration: old PICK audits become legacy attempts, and
--     shipments picked before p_before count as loaded, so history does
--     not block anything. Idempotent. Legacy rows are left out of KPIs.
-- ---------------------------------------------------------------------
create or replace function public.pick_audit_backfill_legacy(p_before date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_attempts int; v_loads int;
begin
  with src as (
    select a.task_id, a.expected_qty, e.ord, e.v
    from public.audits a
    cross join lateral (
      select h.ord, h.v from jsonb_array_elements(a.history) with ordinality as h(v, ord)
      union all
      select 1000000, jsonb_build_object('counted_qty', a.counted_qty, 'sku_ok', a.sku_ok, 'batch_ok', a.batch_ok,
        'note', a.note, 'audited_by', a.audited_by, 'audited_at', a.audited_at)
    ) e
    where a.kind = 'PICK' and not exists (select 1 from public.pick_audits p where p.task_id = a.task_id)
  ), picked as (
    select s.task_id, row_number() over (partition by s.task_id order by s.ord)::int as attempt_no,
           coalesce(p.name, '(tidak tercatat)') as checker_name,
           (s.v->>'sku_ok')::boolean as sku_ok, (s.v->>'batch_ok')::boolean as batch_ok,
           (s.v->>'counted_qty')::numeric as counted, s.expected_qty, s.v->>'note' as note,
           (s.v->>'audited_by')::uuid as audited_by, (s.v->>'audited_at')::timestamptz as audited_at,
           it.sku, coalesce(t.actual_batch_lot, t.batch_lot) as batch, coalesce(t.actual_expiry_date, t.expiry_date) as expiry
    from src s
    join public.pick_tasks t on t.id = s.task_id
    join public.items it on it.id = t.item_id
    left join public.profiles p on p.id = (s.v->>'audited_by')::uuid
  ), ins as (
    insert into public.pick_audits (task_id, attempt_no, checker_name, found_sku, found_batch, counted_qty,
      expected_sku, expected_batch, expected_expiry, expected_qty, errors, result, note, legacy, created_by, created_at)
    select r.task_id, r.attempt_no, r.checker_name,
           case when r.sku_ok then r.sku else '(lain)' end,
           case when r.batch_ok then public.norm_batch(r.batch) else '(lain)' end,
           r.counted, r.sku, r.batch, r.expiry, r.expected_qty, e.errs,
           case when e.errs = '{}' then 'OK' else 'MISMATCH' end, r.note, true, r.audited_by, coalesce(r.audited_at, now())
    from picked r
    cross join lateral (select array_remove(array[
      case when not r.sku_ok then 'WRONG_SKU' end,
      case when r.sku_ok and r.counted < r.expected_qty then 'SHORT' end,
      case when r.sku_ok and r.counted > r.expected_qty then 'OVER' end,
      case when r.sku_ok and not r.batch_ok then 'WRONG_BATCH' end], null) as errs) e
    returning 1
  )
  select count(*) into v_attempts from ins;

  with ins as (
    insert into public.shipment_loads (wave_id, shipment_number, loaded_by_name, legacy, loaded_at)
    select distinct t.wave_id, t.shipment_number, '(sebelum audit wajib)', true, now()
    from public.pick_tasks t join public.waves w on w.id = t.wave_id
    where t.task_type = 'PICK' and t.status = 'COMPLETED' and w.planned_date < p_before
    on conflict (wave_id, shipment_number) do nothing
    returning 1
  )
  select count(*) into v_loads from ins;

  return jsonb_build_object('attempts', v_attempts, 'loads', v_loads);
end $$;
```

Add to the `Privileges` block:

```sql
revoke execute on function public.mark_shipment_loaded(uuid, text, text, text) from public, anon;
grant execute on function public.mark_shipment_loaded(uuid, text, text, text) to authenticated;
revoke execute on function public.pick_audit_backfill_legacy(date) from public, anon, authenticated;
```

Append at the very end of the file (after `Privileges`):

```sql
-- ---------------------------------------------------------------------
-- Live updates (see 0015) and the one-time backfill
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  end if;
  foreach t in array array['pick_audits', 'shipment_loads'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

select public.pick_audit_backfill_legacy((now() at time zone 'Asia/Jakarta')::date);
```

- [ ] **Step 4: Run all SQL tests**

Run: `scripts/sql-test.sh`
Expected: `10_pick_audit.sql: 70 PASS, 0 FAIL`; `06_audits.sql: 8 PASS, 0 FAIL`; all other files unchanged and 0 FAIL; exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0024_pick_audit.sql supabase/tests/10_pick_audit.sql supabase/tests/06_audits.sql
git commit -m "feat(pick-audit): loading gate, legacy backfill, old PICK audit retired"
```

---

### Task 6: Shared vocabulary and small UI plumbing

**Files:**
- Modify: `lib/inventory-control.ts`
- Modify: `app/(app)/admin/settings/policy-form.tsx`
- Modify: `app/(app)/counts/counts-client.tsx`
- Modify: `components/app/item-scan-input.tsx`
- Modify: `components/app/live-refresh.tsx`
- Modify: `components/app/nav.tsx`
- Modify: `app/(app)/audit/audit-header.tsx`

**Interfaces:**
- Produces: `InventoryPolicy.pick_accuracy_target_pct: number`; `ItemScanInput` prop `onItem?: (item: ScannedItem | null, code: string) => void`; `LiveTable` includes `"pick_audits" | "shipment_loads"`; `AuditHeader` props `live?: LiveTable[]`, `putaway?: boolean`.

- [ ] **Step 1: `lib/inventory-control.ts`**

In `REASON_CODES` add after `OTHER: "Lainnya",`:

```ts
  PICK_AUDIT: "Koreksi audit picking",
```

Replace the `MANUAL_REASONS` line and its comment with:

```ts
/** Codes a person picks by hand (OPENING is set by imports, PICK_AUDIT by the picking audit). */
export const MANUAL_REASONS = (Object.keys(REASON_CODES) as ReasonCode[]).filter((c) => c !== "OPENING" && c !== "PICK_AUDIT");
```

In `type InventoryPolicy` add after `require_scan_on_pick: boolean;`:

```ts
  pick_accuracy_target_pct: number;
```

In `POLICY_DEFAULTS` add after `require_scan_on_pick: false,`:

```ts
  pick_accuracy_target_pct: 99.5,
```

In `POLICY_LABEL` add after the `require_scan_on_pick` entry:

```ts
  pick_accuracy_target_pct: { label: "Target akurasi picking (%)", help: "Baris yang lolos audit pada percobaan pertama. Umumnya 99,5%." },
```

- [ ] **Step 2: `policy-form.tsx`** — change the `NUMBERS` line to:

```ts
const NUMBERS = ["default_shelf_life_months", "min_dispatch_days", "near_expiry_days", "adjust_approval_qty", "ira_target_pct", "pick_accuracy_target_pct"] as const;
```

and give the number input decimals: in the `NUMBERS.map` input, add `step="any"` after `min={0}`.

- [ ] **Step 3: `counts-client.tsx`** — in the `SOURCE` record add `, PICK_AUDIT: "Audit picking"` before the closing `}`.

- [ ] **Step 4: `item-scan-input.tsx`** — change the `onItem` type in the props to `onItem?: (item: ScannedItem | null, code: string) => void;` and in `resolve` change `onItem?.(item);` to `onItem?.(item, c);`.

- [ ] **Step 5: `live-refresh.tsx`** — extend the union:

```ts
export type LiveTable = "waves" | "pick_tasks" | "outbound" | "movements" | "count_tasks" | "execution_events" | "audits" | "pickfaces"
  | "stock_holds" | "adjustment_requests" | "receipts" | "receipt_actuals" | "stock_recons" | "stock_recon_lines" | "settings" | "items"
  | "pick_audits" | "shipment_loads";
```

- [ ] **Step 6: `nav.tsx`** — change the Audit picking link roles from `SUP` to `ALL`:

```ts
    { href: "/audit/picking", label: "Audit picking", icon: PackageCheck, roles: ALL },
```

- [ ] **Step 7: `audit-header.tsx`** — replace the `AuditHeader` function with:

```tsx
export function AuditHeader({ title, date, active, live = ["audits", "movements", "pick_tasks"], putaway = true }: {
  title: string; date: string; active: "picking" | "putaway"; live?: LiveTable[];
  /** show the picking / putaway switch (putaway audit is supervisor-only) */
  putaway?: boolean;
}) {
  return (
    <PageHeader title={title} live={live}>
      <div className="flex flex-wrap items-center gap-2">
        {putaway && (
          <nav className="flex rounded-md border border-steel-300 bg-white text-sm">
            {(["picking", "putaway"] as const).map((k) => (
              <Link key={k} href={`/audit/${k}?date=${date}`}
                className={cn("px-3 py-2 first:rounded-l-md last:rounded-r-md", active === k ? "bg-ckb text-white" : "hover:bg-steel-100")}>
                {k === "picking" ? "Picking" : "Putaway"}
              </Link>
            ))}
          </nav>
        )}
        <form className="flex items-center gap-2">
          <Input type="date" name="date" defaultValue={date} className="w-auto" aria-label="Tanggal" />
          <Button type="submit" variant="outline">Tampilkan</Button>
        </form>
      </div>
    </PageHeader>
  );
}
```

and add `import type { LiveTable } from "@/components/app/live-refresh";` to its imports.

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean/passing. (The picking audit page still imports the old list — that is replaced in Task 7; typecheck must still pass here because nothing removed yet.)

- [ ] **Step 9: Commit**

```bash
git add lib/inventory-control.ts "app/(app)/admin/settings/policy-form.tsx" "app/(app)/counts/counts-client.tsx" components/app/item-scan-input.tsx components/app/live-refresh.tsx components/app/nav.tsx "app/(app)/audit/audit-header.tsx"
git commit -m "feat(pick-audit): policy target, reason code, scan code and live tables"
```

---

### Task 7: `/audit/picking` — shipment list and accuracy tab

**Files:**
- Replace: `app/(app)/audit/picking/page.tsx`
- Create: `app/(app)/audit/picking/shipment-list.tsx`
- Create: `app/(app)/audit/picking/accuracy-view.tsx`

**Interfaces:**
- Consumes: views `pick_audit_shipment`, `pick_audit_first`, `pick_audit_line`; `lib/pick-audit.ts` (Task 1); `AuditHeader` (Task 6); `TabsNav`.
- Produces: `ShipmentRow` type (exported from `shipment-list.tsx`), used again in Task 8.

- [ ] **Step 1: Create `shipment-list.tsx`**

```tsx
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { SHIPMENT_STATE_LABEL, SHIPMENT_STATE_TONE, type ShipmentState } from "@/lib/pick-audit";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

/** One row of pick_audit_shipment. */
export type ShipmentRow = {
  wave_id: string; wave_no: string; planned_date: string; planned_slot: string | null; wave_status: string; planned_truck: string | null;
  shipment_number: string; open_tasks: number; lines: number; todo: number; ok: number; mismatch: number; resolved: number;
  state: ShipmentState; loaded_at: string | null; loaded_by_name: string | null; truck: string | null; load_legacy: boolean;
};

export function StateBadge({ state }: { state: ShipmentState }) {
  return <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", SHIPMENT_STATE_TONE[state])}>{SHIPMENT_STATE_LABEL[state]}</span>;
}

export const shipmentHref = (s: { wave_id: string; shipment_number: string }) =>
  `/audit/picking/${s.wave_id}/${encodeURIComponent(s.shipment_number)}`;

/** Shipments with their audit progress; a row opens the shipment. */
export function ShipmentList({ rows, empty, showDate }: { rows: ShipmentRow[]; empty: string; showDate?: boolean }) {
  if (!rows.length) return <p className="text-sm text-steel-500">{empty}</p>;
  return (
    <Card>
      <CardContent>
        <Table>
          <thead><tr>
            <Th>Shipment</Th>{showDate && <Th>Tanggal</Th>}<Th>NO</Th><Th>Truk</Th><Th>Lolos audit</Th><Th>Status</Th><Th>Dimuat</Th>
          </tr></thead>
          <tbody>{rows.map((s) => {
            const passed = s.ok + s.resolved;
            return (
              <tr key={`${s.wave_id}|${s.shipment_number}`} className={cn(s.state === "HAS_MISMATCH" && "bg-bad/5")}>
                <Td><Link className="font-semibold underline" href={shipmentHref(s)}>{s.shipment_number}</Link></Td>
                {showDate && <Td className="whitespace-nowrap">{fmtDate(s.planned_date)}</Td>}
                <Td>{s.wave_no}{s.planned_slot ? ` · ${s.planned_slot}` : ""}</Td>
                <Td className="text-xs">{s.truck ?? s.planned_truck ?? "–"}</Td>
                <Td className="min-w-40">
                  <div className="text-xs tabular">{fmtNum(passed)}/{fmtNum(s.lines)} baris
                    {s.mismatch > 0 && <span className="text-bad"> · {fmtNum(s.mismatch)} selisih</span>}
                    {s.open_tasks > 0 && <span className="text-steel-500"> · {fmtNum(s.open_tasks)} belum dipick</span>}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-steel-100">
                    <div className={cn("h-full", s.mismatch ? "bg-bad" : "bg-ok")} style={{ width: `${s.lines ? (passed / s.lines) * 100 : 0}%` }} />
                  </div>
                </Td>
                <Td><StateBadge state={s.state} /></Td>
                <Td className="whitespace-nowrap text-xs">
                  {s.state === "LOADED" ? (s.load_legacy ? "sebelum audit wajib" : <>{fmtDateTime(s.loaded_at)}<br /><span className="text-steel-500">{s.loaded_by_name}</span></>) : "–"}
                </Td>
              </tr>
            );
          })}</tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create `accuracy-view.tsx`**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { parsePolicy } from "@/lib/inventory-control";
import {
  auditCoverage, PICK_ERROR_LABEL, scanCompliance, shipmentFirstPass, summarizeAccuracy, type FirstAttempt,
} from "@/lib/pick-audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtDateTime, fmtNum } from "@/lib/utils";
import { shipmentHref } from "./shipment-list";

const pct = (x: number | null) => (x === null ? "–" : `${fmtNum(x, 1)}%`);

/**
 * Pick accuracy from first attempts only (a fixed line still counts as an
 * error), with where the errors come from.
 */
export async function AccuracyView({ days }: { days: number }) {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [firsts, lines, loads, { data: policyRaw }] = await Promise.all([
    fetchAll<FirstAttempt & { audited_at: string }>((a, b) => supabase.from("pick_audit_first")
      .select("task_id, audited_at, result, errors, expected_qty, counted_qty, picked_by_name, sku, description, zone, bulk_posted, minutes_to_audit, wave_id, shipment_number")
      .gte("audited_at", since).order("audited_at").order("task_id").range(a, b)),
    fetchAll<{ scanned_code: string | null }>((a, b) => supabase.from("pick_audit_line").select("scanned_code")
      .gte("completed_at", since).gt("picked_qty", 0).order("task_id").range(a, b)),
    fetchAll<{ wave_id: string; shipment_number: string; todo: number; mismatch: number }>((a, b) => supabase.from("pick_audit_shipment")
      .select("wave_id, shipment_number, todo, mismatch").eq("state", "LOADED").eq("load_legacy", false).gte("loaded_at", since)
      .order("wave_id").order("shipment_number").range(a, b)),
    supabase.rpc("inventory_policy"),
  ]);
  const target = parsePolicy(policyRaw).pick_accuracy_target_pct;
  const s = summarizeAccuracy(firsts);
  const tiles: { label: string; value: string; note: string; bad?: boolean }[] = [
    { label: "Akurasi baris", value: pct(s.lineAccuracy), note: `${fmtNum(s.ok)} OK dari ${fmtNum(s.lines)} · target ${fmtNum(target, 1)}%`, bad: s.lineAccuracy !== null && s.lineAccuracy < target },
    { label: "Akurasi karton", value: pct(s.unitAccuracy), note: "karton benar dari yang diaudit" },
    { label: "Salah pick / 1.000 baris", value: s.mispicksPer1000 === null ? "–" : fmtNum(s.mispicksPer1000, 1), note: "di atas 5 = masalah proses" },
    { label: "Shipment lolos sekali audit", value: pct(shipmentFirstPass(loads, firsts)), note: `${fmtNum(loads.length)} shipment dimuat` },
    { label: "Cakupan audit", value: pct(auditCoverage(loads)), note: "harus 100%: semua baris dimuat sudah lolos", bad: loads.length > 0 && auditCoverage(loads) !== 100 },
    { label: "Kepatuhan scan", value: pct(scanCompliance(lines.map((l) => !!l.scanned_code))), note: `${fmtNum(lines.length)} baris dipick` },
    { label: "Pick → audit", value: s.medianMinutes === null ? "–" : `${fmtNum(s.medianMinutes)} mnt`, note: "median" },
  ];
  const recent = firsts.filter((f) => f.result === "MISMATCH").slice(-20).reverse();

  return (
    <div className="space-y-4">
      <nav className="flex gap-2 text-sm">
        {[7, 30, 90].map((d) => (
          <Link key={d} href={`/audit/picking?tab=akurasi&days=${d}`} aria-current={d === days ? "page" : undefined}
            className={cn("rounded-md border px-3 py-1.5", d === days ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white")}>{d} hari</Link>
        ))}
      </nav>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {tiles.map((t) => (
          <div key={t.label} className={cn("rounded-lg border-l-4 bg-white p-3", t.bad ? "border-bad" : "border-ckb")}>
            <div className="font-cond text-3xl font-semibold tabular">{t.value}</div>
            <div className="text-sm font-medium">{t.label}</div>
            <div className="text-xs text-steel-500">{t.note}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Jenis kesalahan</CardTitle></CardHeader><CardContent>
          {s.byError.length === 0 ? <p className="text-sm text-steel-500">Tidak ada kesalahan.</p> : (
            <Table><thead><tr><Th>Jenis</Th><Th className="text-right">Baris</Th></tr></thead>
              <tbody>{s.byError.map((e) => <tr key={e.error}><Td>{PICK_ERROR_LABEL[e.error]}</Td><Td className="text-right tabular">{fmtNum(e.n)}</Td></tr>)}</tbody></Table>
          )}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Per picker</CardTitle></CardHeader><CardContent>
          {s.byPicker.length === 0 ? <p className="text-sm text-steel-500">Belum ada audit.</p> : (
            <Table><thead><tr><Th>Picker</Th><Th className="text-right">Baris</Th><Th className="text-right">Salah</Th><Th className="text-right">Akurasi</Th><Th className="text-right">Tanpa scan (massal)</Th></tr></thead>
              <tbody>{s.byPicker.map((p) => (
                <tr key={p.name} className={cn(p.accuracy < target && "bg-bad/5")}>
                  <Td>{p.name}</Td><Td className="text-right tabular">{fmtNum(p.lines)}</Td><Td className="text-right tabular">{fmtNum(p.errors)}</Td>
                  <Td className="text-right tabular">{pct(p.accuracy)}</Td><Td className="text-right tabular">{fmtNum(p.bulk)}</Td>
                </tr>))}</tbody></Table>
          )}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>SKU paling sering salah</CardTitle></CardHeader><CardContent>
          <Table><thead><tr><Th>SKU</Th><Th className="text-right">Salah</Th><Th className="text-right">Baris</Th></tr></thead>
            <tbody>{s.bySku.filter((x) => x.errors > 0).slice(0, 10).map((x) => (
              <tr key={x.sku}><Td><b>{x.sku}</b><br /><span className="text-xs text-steel-500">{x.description}</span></Td>
                <Td className="text-right tabular">{fmtNum(x.errors)}</Td><Td className="text-right tabular">{fmtNum(x.lines)}</Td></tr>))}</tbody></Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Per aisle asal</CardTitle></CardHeader><CardContent>
          <Table><thead><tr><Th>Aisle</Th><Th className="text-right">Salah</Th><Th className="text-right">Baris</Th></tr></thead>
            <tbody>{s.byZone.map((z) => (
              <tr key={z.zone}><Td>{z.zone}</Td><Td className="text-right tabular">{fmtNum(z.errors)}</Td><Td className="text-right tabular">{fmtNum(z.lines)}</Td></tr>))}</tbody></Table>
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Selisih terakhir</CardTitle></CardHeader><CardContent>
        {recent.length === 0 ? <p className="text-sm text-steel-500">Tidak ada selisih pada periode ini.</p> : (
          <Table><thead><tr><Th>Waktu audit</Th><Th>Shipment</Th><Th>SKU</Th><Th>Picker</Th><Th>Kesalahan</Th></tr></thead>
            <tbody>{recent.map((r) => (
              <tr key={r.task_id}>
                <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.audited_at)}</Td>
                <Td><Link className="underline" href={shipmentHref(r)}>{r.shipment_number}</Link></Td>
                <Td>{r.sku}</Td><Td>{r.picked_by_name ?? "(tidak tercatat)"}</Td>
                <Td className="text-bad">{r.errors.map((e) => PICK_ERROR_LABEL[e]).join(", ")}</Td>
              </tr>))}</tbody></Table>
        )}
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 3: Replace `app/(app)/audit/picking/page.tsx`**

```tsx
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TabsNav } from "@/components/app/tabs-nav";
import { SHIPMENT_STATE_LABEL, type ShipmentState } from "@/lib/pick-audit";
import { fmtNum } from "@/lib/utils";
import { AuditHeader, auditDate } from "../audit-header";
import { AccuracyView } from "./accuracy-view";
import { ShipmentList, type ShipmentRow } from "./shipment-list";

export const dynamic = "force-dynamic";

const OPEN: ShipmentState[] = ["PICKING", "READY_AUDIT", "HAS_MISMATCH", "READY_LOAD"];

/**
 * Every picked line is audited at staging by someone other than the picker;
 * a shipment is loaded only when all its lines passed (0024).
 */
export default async function PickingAuditPage({ searchParams }: { searchParams: Promise<{ date?: string; tab?: string; days?: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const sp = await searchParams;
  const date = auditDate(sp.date);
  const supervisor = user.role !== "operator";
  const tab = supervisor && sp.tab === "akurasi" ? "akurasi" : "shipment";
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const supabase = await createClient();

  let body: React.ReactNode;
  if (tab === "akurasi") body = <AccuracyView days={days} />;
  else {
    const [{ data: today }, { data: carried }] = await Promise.all([
      supabase.from("pick_audit_shipment").select("*").eq("planned_date", date).order("wave_no").order("shipment_number"),
      supabase.from("pick_audit_shipment").select("*").lt("planned_date", date).in("state", OPEN).order("planned_date").order("shipment_number"),
    ]);
    const rows = (today ?? []) as ShipmentRow[];
    const earlier = (carried ?? []) as ShipmentRow[];
    const count = (s: ShipmentState) => rows.filter((r) => r.state === s).length;
    body = (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(["READY_AUDIT", "HAS_MISMATCH", "READY_LOAD", "LOADED", "PICKING"] as ShipmentState[]).map((s) => (
            <div key={s} className="rounded-lg border-l-4 border-ckb bg-white p-3">
              <div className="font-cond text-3xl font-semibold tabular">{fmtNum(count(s))}</div>
              <div className="text-xs text-steel-500">{SHIPMENT_STATE_LABEL[s]}</div>
            </div>
          ))}
        </div>
        <ShipmentList rows={rows} empty="Belum ada shipment dengan pick di tanggal ini." />
        {earlier.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-cond text-lg font-semibold text-bad">Belum dimuat dari tanggal sebelumnya</h2>
            <ShipmentList rows={earlier} empty="" showDate />
          </section>
        )}
      </div>
    );
  }

  return (
    <main>
      <AuditHeader title="Audit picking" date={date} active="picking" putaway={supervisor}
        live={["pick_tasks", "pick_audits", "shipment_loads", "waves"]} />
      {supervisor && <TabsNav base="/audit/picking" active={tab}
        tabs={[{ key: "shipment", label: "Shipment" }, { key: "akurasi", label: "Akurasi picking" }]} />}
      <div className="p-4 lg:p-8">{body}</div>
    </main>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/audit/picking"
git commit -m "feat(pick-audit): shipment list and accuracy tab"
```

---

### Task 8: Shipment detail — blind audit, resolve and load dialogs

**Files:**
- Create: `app/(app)/audit/picking/[wave]/[shipment]/page.tsx`
- Create: `app/(app)/audit/picking/[wave]/[shipment]/shipment-audit-client.tsx`

**Interfaces:**
- Consumes: RPCs `record_pick_audit`, `resolve_pick_mismatch`, `mark_shipment_loaded` (Tasks 3–5, argument names exactly as there); `ShipmentRow`, `StateBadge` (Task 7); `ItemScanInput` with `onItem(item, code)` (Task 6); `lib/pick-audit.ts`.

- [ ] **Step 1: Create the server page** — `[wave]/[shipment]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import type { LineState, PickError } from "@/lib/pick-audit";
import type { ShipmentRow } from "../../shipment-list";
import { ShipmentAuditClient, type AttemptView, type LineView } from "./shipment-audit-client";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LineRow = {
  task_id: string; seq: number; sku: string; description: string; uom: string | null; from_bin: string; batch_lot: string;
  expiry_date: string | null; planned_qty: number; picked_qty: number; deviation_reason: string | null;
  picked_by_name: string | null; bulk_posted: boolean; line_state: LineState; attempts: number;
};

/** One shipment's lines. A line's picked qty / batch / expiry is not sent to the browser until it has been audited. */
export default async function ShipmentAuditPage({ params }: { params: Promise<{ wave: string; shipment: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const { wave, shipment } = await params;
  const ship = decodeURIComponent(shipment);
  if (!UUID.test(wave)) notFound();
  const supabase = await createClient();
  const [{ data: s }, { data: lines }, { data: attempts }] = await Promise.all([
    supabase.from("pick_audit_shipment").select("*").eq("wave_id", wave).eq("shipment_number", ship).maybeSingle(),
    supabase.from("pick_audit_line")
      .select("task_id, seq, sku, description, uom, from_bin, batch_lot, expiry_date, planned_qty, picked_qty, deviation_reason, picked_by_name, bulk_posted, line_state, attempts")
      .eq("wave_id", wave).eq("shipment_number", ship).order("seq"),
    supabase.from("pick_audits").select("*, pick_tasks!inner(wave_id, shipment_number)")
      .eq("pick_tasks.wave_id", wave).eq("pick_tasks.shipment_number", ship).order("attempt_no"),
  ]);
  if (!s) notFound();

  const view: LineView[] = ((lines ?? []) as LineRow[]).map((l) => ({
    task_id: l.task_id, seq: l.seq, sku: l.sku, description: l.description, uom: l.uom, from_bin: l.from_bin,
    picked_by_name: l.picked_by_name, bulk_posted: l.bulk_posted, state: l.line_state, attempts: l.attempts,
    picked: l.line_state === "TODO" ? undefined : {
      qty: Number(l.picked_qty), planned_qty: Number(l.planned_qty), batch: l.batch_lot, expiry: l.expiry_date, deviation: l.deviation_reason,
    },
  }));
  const tries: AttemptView[] = ((attempts ?? []) as (AttemptView & { errors: PickError[] })[]).map((a) => ({
    id: a.id, task_id: a.task_id, attempt_no: a.attempt_no, checker_name: a.checker_name, found_sku: a.found_sku,
    found_batch: a.found_batch, found_expiry: a.found_expiry, counted_qty: Number(a.counted_qty), damaged: a.damaged,
    expected_sku: a.expected_sku, expected_batch: a.expected_batch, expected_expiry: a.expected_expiry, expected_qty: Number(a.expected_qty),
    errors: a.errors, result: a.result, note: a.note, resolution: a.resolution, resolved_by_name: a.resolved_by_name,
    resolved_at: a.resolved_at, resolution_note: a.resolution_note, created_at: a.created_at, legacy: a.legacy,
  }));

  return (
    <main>
      <PageHeader title={`Audit shipment ${ship}`} live={["pick_tasks", "pick_audits", "shipment_loads", "waves"]} />
      <div className="p-4 lg:p-8">
        <ShipmentAuditClient shipment={s as ShipmentRow} lines={view} attempts={tries} supervisor={user.role !== "operator"} />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create the client** — `[wave]/[shipment]/shipment-audit-client.tsx`:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Truck, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { OtherPersonField, PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { expectedExpiry } from "@/lib/batch-code";
import {
  allowedResolutions, LINE_STATE_LABEL, PICK_ERROR_LABEL, RESOLUTION_LABEL,
  type LineState, type PickError, type Resolution,
} from "@/lib/pick-audit";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { StateBadge, type ShipmentRow } from "../../shipment-list";

export type LineView = {
  task_id: string; seq: number; sku: string; description: string; uom: string | null; from_bin: string;
  picked_by_name: string | null; bulk_posted: boolean; state: LineState; attempts: number;
  /** only once the line has been audited (or was picked as 0): what the picker reported */
  picked?: { qty: number; planned_qty: number; batch: string; expiry: string | null; deviation: string | null };
};
export type AttemptView = {
  id: string; task_id: string; attempt_no: number; checker_name: string; found_sku: string; found_batch: string; found_expiry: string | null;
  counted_qty: number; damaged: boolean; expected_sku: string; expected_batch: string; expected_expiry: string | null; expected_qty: number;
  errors: PickError[]; result: "OK" | "MISMATCH"; note: string | null; resolution: Resolution | null; resolved_by_name: string | null;
  resolved_at: string | null; resolution_note: string | null; created_at: string; legacy: boolean;
};
type SaveResult = {
  result: "OK" | "MISMATCH"; errors: PickError[]; attempt: number;
  expected: { sku: string; batch: string; expiry: string | null; qty: number };
  found: { sku: string; batch: string; expiry: string | null; qty: number; damaged: boolean };
};

const LINE_TONE: Record<LineState, string> = {
  AUTO_PASS: "text-steel-500", TODO: "text-steel-500", OK: "text-ok", MISMATCH: "text-bad", RESOLVED: "text-warn",
};

/**
 * The checker records what is on the pallet without seeing what the picker
 * reported; the database compares. A mismatch is fixed on the floor and
 * audited again, or accepted by a supervisor. Loading needs every line passed.
 */
export function ShipmentAuditClient({ shipment: s, lines, attempts, supervisor }: {
  shipment: ShipmentRow; lines: LineView[]; attempts: AttemptView[]; supervisor: boolean;
}) {
  const [audit, setAudit] = useState<LineView | null>(null);
  const [resolve, setResolve] = useState<{ line: LineView; attempt: AttemptView; action: Resolution } | null>(null);
  const [loading, setLoading] = useState(false);
  const frozen = s.state === "LOADED" || s.state === "CANCELLED";
  const byTask = new Map<string, AttemptView[]>();
  for (const a of attempts) byTask.set(a.task_id, [...(byTask.get(a.task_id) ?? []), a]);

  return (
    <div className="space-y-4">
      <Link href={`/audit/picking?date=${s.planned_date}`} className="inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" />Semua shipment</Link>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2"><h2 className="font-cond text-2xl font-semibold">SH {s.shipment_number}</h2><StateBadge state={s.state} /></div>
            <p className="text-sm text-steel-500">NO {s.wave_no} · {fmtDate(s.planned_date)} · truk {s.truck ?? s.planned_truck ?? "–"}</p>
            <p className="text-sm">{fmtNum(s.ok + s.resolved)}/{fmtNum(s.lines)} baris lolos
              {s.todo > 0 && ` · ${fmtNum(s.todo)} belum diaudit`}{s.mismatch > 0 && <span className="text-bad"> · {fmtNum(s.mismatch)} selisih</span>}
              {s.open_tasks > 0 && ` · ${fmtNum(s.open_tasks)} tugas belum dipick`}</p>
          </div>
          {s.state === "LOADED"
            ? <p className="text-sm">Dimuat {s.load_legacy ? "(sebelum audit wajib)" : `${fmtDateTime(s.loaded_at)} oleh ${s.loaded_by_name}`}</p>
            : !frozen && <Button size="lg" disabled={s.state !== "READY_LOAD"} onClick={() => setLoading(true)}
                title={s.state === "READY_LOAD" ? undefined : "Semua baris harus lolos audit dulu"}><Truck className="h-5 w-5" />Muat shipment</Button>}
        </CardContent>
      </Card>
      {s.state === "CANCELLED" && (
        <p role="alert" className="rounded-md bg-bad/10 p-3 text-sm">Wave dibatalkan. Barang yang sudah dipick untuk shipment ini ada di staging:
          kembalikan ke rak dan catat lewat <Link className="underline" href="/adjust">Adjust stok</Link>.</p>
      )}

      <Card>
        <CardContent>
          <Table>
            <thead><tr><Th>#</Th><Th>SKU</Th><Th>Bin asal</Th><Th>Picker</Th><Th>Status</Th><Th>Dipick / audit</Th><Th /></tr></thead>
            <tbody>{lines.map((l) => {
              const hist = byTask.get(l.task_id) ?? [];
              const last = hist[hist.length - 1];
              const options = last && l.state === "MISMATCH" ? allowedResolutions(last.errors, last.counted_qty, last.expected_qty) : [];
              return (
                <tr key={l.task_id} className={cn(l.state === "MISMATCH" && "bg-bad/5")}>
                  <Td className="tabular">{l.seq}</Td>
                  <Td><span className="font-semibold">{l.sku}</span><br /><span className="text-xs text-steel-500">{l.description}</span></Td>
                  <Td className="font-semibold">{l.from_bin}</Td>
                  <Td className="text-xs">{l.picked_by_name ?? "(tidak tercatat)"}
                    {l.bulk_posted && <span className="block text-warn">diposting massal, tanpa scan</span>}</Td>
                  <Td className={cn("text-xs font-semibold", LINE_TONE[l.state])}>{LINE_STATE_LABEL[l.state]}</Td>
                  <Td className="space-y-1 text-xs">
                    {l.picked
                      ? <p>{fmtNum(l.picked.qty)} {l.uom ?? ""} · batch {l.picked.batch || "–"} · exp {fmtDate(l.picked.expiry)}
                          {l.picked.qty !== l.picked.planned_qty && <span className="text-warn"> (rencana {fmtNum(l.picked.planned_qty)}{l.picked.deviation ? `: ${l.picked.deviation}` : ""})</span>}</p>
                      : <p className="text-steel-500">disembunyikan sampai diaudit</p>}
                    {hist.map((a) => <AttemptLine key={a.id} a={a} />)}
                  </Td>
                  <Td className="space-y-1 text-right">
                    {!frozen && (l.state === "TODO" || l.state === "MISMATCH") && (
                      <Button size="sm" variant={l.state === "TODO" ? "default" : "outline"} onClick={() => setAudit(l)}>
                        <ClipboardCheck className="h-4 w-4" />{l.state === "TODO" ? "Audit" : "Audit ulang"}
                      </Button>
                    )}
                    {!frozen && supervisor && last && options.map((action) => (
                      <Button key={action} size="sm" variant="outline" onClick={() => setResolve({ line: l, attempt: last, action })}>{RESOLUTION_LABEL[action]}</Button>
                    ))}
                  </Td>
                </tr>
              );
            })}</tbody>
          </Table>
        </CardContent>
      </Card>

      {audit && <AuditDialog line={audit} onClose={() => setAudit(null)} />}
      {resolve && <ResolveDialog {...resolve} onClose={() => setResolve(null)} />}
      {loading && <LoadDialog shipment={s} onClose={() => setLoading(false)} />}
    </div>
  );
}

function AttemptLine({ a }: { a: AttemptView }) {
  return (
    <div className="rounded border border-steel-100 p-1.5">
      <p>
        {a.result === "OK"
          ? <span className="inline-flex items-center gap-1 font-semibold text-ok"><CheckCircle2 className="h-3.5 w-3.5" />OK</span>
          : <span className="inline-flex items-center gap-1 font-semibold text-bad"><XCircle className="h-3.5 w-3.5" />{a.errors.map((e) => PICK_ERROR_LABEL[e]).join(", ")}</span>}
        {" "}· audit {a.attempt_no}{a.legacy ? " (lama)" : ""} · {a.checker_name} · {fmtDateTime(a.created_at)}
      </p>
      {a.result === "MISMATCH" && (
        <p className="text-steel-700">ditemukan {a.found_sku} · {fmtNum(a.counted_qty)} · batch {a.found_batch || "–"}{a.found_expiry ? ` · exp ${fmtDate(a.found_expiry)}` : ""}{a.damaged ? " · rusak" : ""}</p>
      )}
      {a.note && <p className="text-steel-700">{a.note}</p>}
      {a.resolution && <p className="text-warn">{RESOLUTION_LABEL[a.resolution]} oleh {a.resolved_by_name} · {fmtDateTime(a.resolved_at)}: {a.resolution_note}</p>}
    </div>
  );
}

function AuditDialog({ line, onClose }: { line: LineView; onClose: () => void }) {
  const router = useRouter();
  const [checker, setChecker] = usePersonName();
  const [skuInput, setSkuInput] = useState("");
  const [found, setFound] = useState<{ code: string; sku: string } | null>(null);
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [counted, setCounted] = useState("");
  const [damaged, setDamaged] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);

  const n = Number(counted);
  const valid = checker.trim().length >= 2 && !!found && counted.trim() !== "" && Number.isFinite(n) && n >= 0;
  const hint = expectedExpiry(batch);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return setError("Isi nama checker, scan karton / SKU dan jumlah karton.");
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc("record_pick_audit", {
      p_task_id: line.task_id, p_checker_name: checker, p_found: found!.code, p_counted: n,
      p_batch: batch, p_expiry: expiry || null, p_damaged: damaged, p_note: note,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(data as SaveResult);
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Audit #${line.seq} · ${line.sku}`} description={`${line.description} · dari ${line.from_bin}`}>
        {saved ? <SavedResult r={saved} onClose={onClose} /> : (
          <form onSubmit={save} className="space-y-4">
            <p className="rounded-md bg-plate/30 p-3 text-sm">Hitung dan catat apa yang ada di palet. Jumlah dan batch dari picker tidak ditampilkan.</p>
            <PersonNameField value={checker} onChange={setChecker} label="Nama checker (bukan picker baris ini)" id="checker" />
            <div>
              <Label htmlFor="found">Scan karton / ketik SKU yang ada di palet</Label>
              <ItemScanInput id="found" value={skuInput} autoFocus
                onChange={(v) => { setSkuInput(v); if (found && v !== found.sku && v !== found.code) setFound(null); }}
                onItem={(it, code) => setFound(it ? { code, sku: it.sku } : null)} />
              {found && <p className="mt-1 text-xs font-semibold text-ok">Terbaca: {found.sku}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="batch">Batch di karton</Label>
                <Input id="batch" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="mis. 14H26JJ" autoCapitalize="characters" />
              </div>
              <div>
                <Label htmlFor="expiry">Expired (kalau tercetak)</Label>
                <Input id="expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                {hint && !expiry && <button type="button" className="mt-1 text-xs underline" onClick={() => setExpiry(hint)}>perkiraan dari batch: {fmtDate(hint)}</button>}
              </div>
            </div>
            <div>
              <Label htmlFor="counted">Jumlah karton dihitung</Label>
              <Input id="counted" type="number" inputMode="numeric" min={0} step="any" value={counted} onChange={(e) => setCounted(e.target.value)} required />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} />Ada karton rusak</label>
            <div>
              <Label htmlFor="note">Catatan (opsional)</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. 2 karton penyok, label batch pudar" />
            </div>
            {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Menyimpan…" : "Simpan audit"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SavedResult({ r, onClose }: { r: SaveResult; onClose: () => void }) {
  const rows: [string, string, string][] = [
    ["SKU", r.found.sku, r.expected.sku],
    ["Batch", r.found.batch || "–", r.expected.batch || "–"],
    ["Expired", fmtDate(r.found.expiry), fmtDate(r.expected.expiry)],
    ["Jumlah", fmtNum(r.found.qty), fmtNum(r.expected.qty)],
  ];
  return (
    <div className="space-y-4">
      <p className={cn("rounded-md p-3 text-base font-semibold", r.result === "OK" ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad")}>
        {r.result === "OK" ? "Sesuai. Baris lolos audit." : `Selisih: ${r.errors.map((e) => PICK_ERROR_LABEL[e]).join(", ")}`}
      </p>
      <Table>
        <thead><tr><Th /><Th>Di palet</Th><Th>Dilaporkan picker</Th></tr></thead>
        <tbody>{rows.map(([k, f, x]) => (
          <tr key={k} className={cn(f !== x && k !== "Expired" && "text-bad")}><Td>{k}</Td><Td className="font-semibold">{f}</Td><Td>{x}</Td></tr>
        ))}</tbody>
      </Table>
      {r.found.damaged && <p className="text-sm text-bad">Ada karton rusak: ganti dengan karton baik.</p>}
      {r.result === "MISMATCH" && (
        <p className="text-sm">Perbaiki di lantai: ambil yang kurang, kembalikan yang lebih, tukar barang atau batch yang salah. Setelah itu audit ulang.
          Supervisor bisa menerima kurang atau batch lain bila memang itu yang dikirim.</p>
      )}
      <Button size="lg" className="w-full" onClick={onClose}>Tutup</Button>
    </div>
  );
}

function ResolveDialog({ line, attempt: a, action, onClose }: { line: LineView; attempt: AttemptView; action: Resolution; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [bin, setBin] = useState(line.from_bin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = a.expected_qty - a.counted_qty;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("resolve_pick_mismatch", {
      p_audit_id: a.id, p_action: action, p_by_name: name, p_note: note, p_bin: action === "ACCEPT_BATCH" ? bin : null,
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${RESOLUTION_LABEL[action]} · #${line.seq} ${line.sku}`} description={`Audit ${a.attempt_no} oleh ${a.checker_name}`}>
        <form onSubmit={save} className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-sm">
            {action === "ACCEPT_SHORT"
              ? `Kirim ${fmtNum(a.counted_qty)} dari ${fmtNum(a.expected_qty)}. ${fmtNum(short)} karton dicatat kembali di ${line.from_bin} (batch ${a.expected_batch || "–"}) dan bin itu dijadwalkan hitung ulang.`
              : `Kirim batch ${a.found_batch} yang ada di palet. Batch ${a.expected_batch || "–"} dicatat kembali di ${line.from_bin}; batch ${a.found_batch} dikurangi dari bin di bawah. ${line.from_bin} dijadwalkan hitung ulang.`}
          </p>
          <OtherPersonField value={name} onChange={setName} label="Nama supervisor (bukan picker / checker)" id="resolver" notSameAs={a.checker_name} />
          {action === "ACCEPT_BATCH" && (
            <div>
              <Label htmlFor="bin">Bin asal batch {a.found_batch}</Label>
              <Input id="bin" value={bin} onChange={(e) => setBin(e.target.value.toUpperCase())} required />
            </div>
          )}
          <div>
            <Label htmlFor="rnote">Alasan (wajib)</Label>
            <Input id="rnote" value={note} onChange={(e) => setNote(e.target.value)} required placeholder="mis. stok memang habis, pelanggan setuju" />
          </div>
          {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Menyimpan…" : RESOLUTION_LABEL[action]}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LoadDialog({ shipment: s, onClose }: { shipment: ShipmentRow; onClose: () => void }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [truck, setTruck] = useState(s.planned_truck ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("mark_shipment_loaded", {
      p_wave_id: s.wave_id, p_shipment: s.shipment_number, p_by_name: person, p_truck: truck,
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Muat shipment ${s.shipment_number}`} description={`${fmtNum(s.lines)} baris, semua lolos audit`}>
        <form onSubmit={save} className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-sm">Setelah dimuat, shipment ini tidak bisa diaudit atau diubah lagi.</p>
          <PersonNameField value={person} onChange={setPerson} label="Nama petugas muat" id="loader" />
          <div>
            <Label htmlFor="truck">Truk / nomor polisi</Label>
            <Input id="truck" value={truck} onChange={(e) => setTruck(e.target.value)} placeholder="mis. B 1234 XY" />
          </div>
          {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}><Truck className="h-5 w-5" />{busy ? "Menyimpan…" : "Muat"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/audit/picking/[wave]"
git commit -m "feat(pick-audit): shipment page with blind audit, acceptances and loading"
```

---

### Task 9: Waves badges, dashboard, docs

**Files:**
- Modify: `app/(app)/waves/page.tsx`, `app/(app)/waves/waves-client.tsx`
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `README.md`, `docs/INVENTORY_CONTROL.md`

**Interfaces:**
- Consumes: `pick_audit_shipment`, `pick_audit_first`, `SHIPMENT_STATE_LABEL`, `SHIPMENT_STATE_TONE`, `ShipmentState`.
- Produces: `WavesClient` prop `audit: Record<string, ShipmentState>` keyed `${wave_id}|${shipment_number}`.

- [ ] **Step 1: Waves page** — in `app/(app)/waves/page.tsx`:
  - add `import type { ShipmentState } from "@/lib/pick-audit";`
  - extend the destructuring to `const [{ data: waves }, tasks, { data: outbound }, { data: recent }, { data: shortfalls }, { data: auditStates }] = await Promise.all([` and append to the array:
    ```ts
        supabase.from("pick_audit_shipment").select("wave_id, shipment_number, state").eq("planned_date", date),
    ```
  - change the header `live` to `["waves", "pick_tasks", "outbound", "movements", "pick_audits", "shipment_loads"]`
  - pass to `WavesClient`:
    ```tsx
          audit={Object.fromEntries((auditStates ?? []).map((a) => [`${a.wave_id}|${a.shipment_number}`, a.state as ShipmentState]))}
    ```

- [ ] **Step 2: Waves client** — in `waves-client.tsx`:
  - add `import { SHIPMENT_STATE_LABEL, SHIPMENT_STATE_TONE, type ShipmentState } from "@/lib/pick-audit";`
  - `WavesClient` props: add `audit` to the destructuring and `/** audit / loading state per `${wave_id}|${shipment}` (0024) */ audit: Record<string, ShipmentState>;` to its type
  - pass `audit={audit}` on `<WaveCard …>`; add `audit` to `WaveCard`'s destructuring and `audit: Record<string, ShipmentState>;` to its prop type
  - replace `· shipment {w.shipment_numbers.join(", ")}` with:
    ```tsx
            · shipment {w.shipment_numbers.map((sh, i) => {
              const st = audit[`${w.id}|${sh}`];
              return (
                <span key={sh}>{i > 0 && ", "}{sh}
                  {st && <Link href={`/audit/picking/${w.id}/${encodeURIComponent(sh)}`}
                    className={cn("ml-1 rounded px-1.5 text-xs font-semibold", SHIPMENT_STATE_TONE[st])}>{SHIPMENT_STATE_LABEL[st]}</Link>}
                </span>
              );
            })}
    ```

- [ ] **Step 3: Dashboard** — in `app/(app)/dashboard/page.tsx`:
  - extend the destructuring after `{ data: lastRecon }` with `, pickFirsts, { count: shipmentsWaiting }, { data: policyRaw }` and append to the `Promise.all` array:
    ```ts
        fetchAll<{ result: string }>((a, b) => supabase.from("pick_audit_first").select("result").gte("audited_at", accSince).order("task_id").range(a, b)),
        supabase.from("pick_audit_shipment").select("wave_id", { count: "exact", head: true }).in("state", ["READY_AUDIT", "HAS_MISMATCH", "READY_LOAD"]),
        supabase.rpc("inventory_policy"),
    ```
  - add `import { parsePolicy } from "@/lib/inventory-control";`
  - replace `const pickAcc = acc("PICK"), putAcc = acc("PUTAWAY");` with:
    ```ts
      const pickAcc = { n: pickFirsts.length, ok: pickFirsts.filter((x) => x.result === "OK").length };
      const putAcc = acc("PUTAWAY");
      const pickTarget = parsePolicy(policyRaw).pick_accuracy_target_pct;
    ```
  - replace the "Akurasi picking (audit)" `Kpi` line with:
    ```tsx
            <Kpi label="Akurasi picking (audit)" value={pct(pickAcc)} note={`percobaan pertama · ${fmtNum(pickAcc.ok)} OK dari ${fmtNum(pickAcc.n)} · target ≥ ${fmtNum(pickTarget, 1)}%`} href="/audit/picking?tab=akurasi" tone={pickAcc.n && (pickAcc.ok / pickAcc.n) * 100 < pickTarget ? "warn" : undefined} />
            <Kpi label="Shipment menunggu audit / muat" value={fmtNum(shipmentsWaiting ?? 0)} note="semua baris harus lolos audit sebelum dimuat" href="/audit/picking" tone={shipmentsWaiting ? "warn" : undefined} />
    ```
  - add `"pick_audits", "shipment_loads"` to the dashboard `PageHeader` `live` array.

- [ ] **Step 4: Docs**
  - `README.md` §2.2: add after the `09_inventory_control.sql` line:
    ```
    psql -f supabase/tests/10_pick_audit.sql     # audit picking (0024), idem
    ```
    and under it: ``Atau semuanya sekaligus di database lokal sementara: `scripts/sql-test.sh`.``
  - `docs/INVENTORY_CONTROL.md`: add before `## 5. Mengukur`:
    ```markdown
    ## 4a. Audit picking sebelum muat

    Setiap baris yang dipick dihitung ulang di staging oleh orang lain (bukan pickernya), tanpa melihat jumlah dan batch dari picker. Checker scan karton atau ketik SKU, tulis batch, expired (bila tercetak), jumlah dan tanda rusak; sistem yang membandingkan: kurang, lebih, SKU salah, batch salah, expired beda, rusak.

    - Selisih diperbaiki di lantai lalu diaudit ulang. Supervisor (bukan picker, bukan checker) boleh **terima kurang** atau **terima batch lain**; stok dikoreksi dengan kode `PICK_AUDIT` dan bin asal dijadwalkan hitung ulang.
    - Shipment hanya bisa **dimuat** bila semua barisnya lolos. Setelah dimuat tidak bisa diubah.
    - Akurasi picking dihitung dari percobaan pertama (Audit picking → Akurasi picking): per picker, SKU, aisle dan jenis kesalahan, plus kepatuhan scan.
    ```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean; all TS tests pass.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/waves" "app/(app)/dashboard/page.tsx" README.md docs/INVENTORY_CONTROL.md
git commit -m "feat(pick-audit): wave badges, dashboard tiles, docs"
```

---

### Task 10: End-to-end verification

**Files:** none new (fixes only if something fails).

- [ ] **Step 1: Full automated suite**

Run: `scripts/sql-test.sh && npm run typecheck && npm run lint && npm test && npm run build`
Expected: every SQL file 0 FAIL (10: 70 PASS), TS tests pass, build succeeds.

- [ ] **Step 2: Walk the flow in the app** — apply 0024 to the **local** Supabase stack (`supabase_db_ckb-warehouse` container, `supabase migration up` or `psql` on its port) — never a hosted project — then `npm run dev` and, using the `run` skill if needed:
  1. `/waves`: post a pick with name "Budi" → shipment badge "Siap audit" (after all its picks are posted).
  2. `/audit/picking` → open the shipment: the line shows "disembunyikan sampai diaudit".
  3. Audit as "Budi" → refused (checker = picker). Audit as "Sari" with a short count → result shows "Selisih: Kurang" and the side-by-side table.
  4. "Muat shipment" is disabled. "Terima kurang" as "Sari" → refused; as "Joko" with a reason → line "Diterima supervisor".
  5. "Muat shipment" as "Andi" → state "Dimuat"; the Audit buttons are gone.
  6. Accuracy tab shows 1 line, 0 % line accuracy, picker Budi; dashboard tile counts drop.
  7. `/counts` shows a new "Audit picking" recount for the source bin.

- [ ] **Step 3: Report** — list anything that did not behave as above with the exact error text; do not claim done until Steps 1–2 pass.
