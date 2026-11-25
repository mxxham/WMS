import { strict as assert } from 'node:assert';
import { buildTimeline, nextAction, resolutionOptions, sheetHtml, type CheckRecord } from '../lib/recon-flow';
import { MIA_KIND_LABEL, type MiaEvent } from '../lib/mia';
import type { FixPlan, FixRow } from '../lib/recon-investigate';
import { handledStats, type CompareLine } from '../lib/sap-compare';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const prog = (todo: number, stale = 0, ok = 0, diff = 0) => ({ total: todo + stale + ok + diff, done: ok + diff, ok, diff, stale, todo });
const plan = (o: Partial<FixPlan> = {}): FixPlan => ({
  checks: [], stale: [], check_ids: [], checkers: [], transfers: [], adjustments: [], blockers: [], transfer_qty: 0, net_adjust: 0,
  adjust_abs: 0, limit: 20, needs_other_person: false, gap_before: 0, gap_after: 0, last_fix_at: null, ...o,
});

test('next action: unchecked bins first, then a ready fix, then what is left of the gap', () => {
  const base = { gap: -5, planWork: 0, blockers: 0, editable: true };
  assert.deepEqual(nextAction({ ...base, progress: prog(3, 1) }), { step: 1, tone: 'todo', text: '4 bin belum dicek di daftar cek (langkah 1).' });
  assert.equal(nextAction({ ...base, progress: prog(0, 0, 4), planWork: 2 }).step, 3);
  assert.match(nextAction({ ...base, progress: prog(0, 0, 4), planWork: 2, blockers: 1 }).text, /menghalangi/);
  assert.equal(nextAction({ ...base, progress: prog(0, 0, 4) }).step, 2);
  assert.equal(nextAction({ ...base, gap: 0, progress: prog(0, 0, 4) }).tone, 'done');
  assert.match(nextAction({ ...base, gap: 7, progress: prog(0, 0, 4) }).text, /WMS masih lebih/);
});

test('next action: a closed reconciliation only informs', () => {
  assert.equal(nextAction({ gap: -5, progress: prog(3), planWork: 0, blockers: 0, editable: false }).tone, 'info');
});

test('resolution options: adjustment uses the plan, MIA move shrinks the gap by what is short, MIA book keeps it', () => {
  const sys = [{ batch_lot: 'B1', expiry_date: '2030-01-01', quantity: 12 }];
  const p = plan({
    checks: [{ check_id: 'c', bin_code: 'CA01A01', checked_name: 'x', checked_at: 't', counted: 0, system: 12, lines: [], system_lines: sys }],
    adjustments: [{ bin_code: 'CA01A01', batch_lot: 'B1', expiry_date: '2030-01-01', quantity: -12, checked_name: 'x' }], net_adjust: -12, gap_after: 0,
  });
  const o = resolutionOptions({ gap: 12, plan: p });
  assert.deepEqual(o.map((x) => x.key), ['ADJUST', 'MIA_MOVE']);
  assert.equal(o[0].gapAfter, 0); assert.equal(o[0].wmsChange, -12);
  assert.equal(o[1].gapAfter, 0); assert.equal(o[1].wmsChange, -12);
  const minus = resolutionOptions({ gap: -8, plan: null });
  assert.deepEqual(minus.map((x) => x.key), ['ADJUST', 'MIA_MOVE', 'MIA_BOOK']);
  assert.equal(minus[0].gapAfter, null); assert.equal(minus[1].gapAfter, null);
  assert.equal(minus[2].gapAfter, -8);
});

test('timeline: checks, fixes and MIA moves in one list, newest first', () => {
  const checks: CheckRecord[] = [{ id: '1', checked_at: '2026-11-24T08:00:00Z', checked_name: 'Ani', counted_qty: 0, note: null, bins: { bin_code: 'CA01A01' } }];
  const fixes = [{ id: 'f', applied_at: '2026-11-24T10:00:00Z', applied_name: 'Budi', checker_names: ['Ani'], transfer_qty: 4, net_adjust: -6, adjust_abs: 6, cause: 'COUNT', note: 'ok', plan: plan() }] as FixRow[];
  const mia: MiaEvent[] = [{ id: 'm', kind: 'MOVE_IN', sku: 'S', description: null, batch_lot: 'B1', expiry_date: null, quantity: 3, bin_code: 'CA01A01', note: 'tidak ada', by_name: 'Cici', created_at: '2026-11-24T09:00:00Z', line_id: 'l' }];
  const t = buildTimeline({ checks, fixes, mia }, (k) => MIA_KIND_LABEL[k]);
  assert.deepEqual(t.map((x) => x.kind), ['FIX', 'MIA', 'CHECK']);
  assert.equal(t[2].detail, 'kosong (0 karton)');
  assert.match(t[0].detail, /Bin To Bin 4 · adjustment -6/);
  assert.match(t[1].title, /Dipindah ke MIA/);
});

test('check sheet: one row per bin with blank columns, user text is escaped', () => {
  const h = sheetHtml('550044360', 'Rimula <R4>', '2026-11-24', -5, [{ bin: 'CD22C02', source: 'Picklist', system: '4 · 12721126' }]);
  assert.match(h, /CD22C02/); assert.match(h, /Rimula &lt;R4&gt;/); assert.match(h, /selisih WMS − SAP -5/);
  assert.equal((h.match(/<td class="w"><\/td>/g) ?? []).length, 3);
});

const cl = (o: Partial<CompareLine>): CompareLine => ({
  sku: 'S', description: null, item_id: 'i', sap_uom: null, wms_uom: null, sap_unrestricted: 10, sap_blocked: 0, wms_unrestricted: 10, wms_blocked: 0,
  pending_gi: 0, pending_gr: 0, auto_gi: 0, diff_unrestricted: 0, diff_blocked: 0, sap_other: null, status: 'OPEN', cause: null, ...o,
});

test('handled stats: only SKUs with a gap count; explained and resolved are handled, recounts wait', () => {
  const lines = [
    cl({ sku: 'A' }),                                                                  // no gap: not counted
    cl({ sku: 'B', diff_unrestricted: 5 }),                                            // untouched
    cl({ sku: 'C', diff_unrestricted: -3, status: 'EXPLAINED', cause: 'PENDING_GI' }), // handled
    cl({ sku: 'D', diff_unrestricted: 2, status: 'RESOLVED', cause: 'COUNT' }),        // handled
    cl({ sku: 'E', diff_unrestricted: 1, status: 'COUNT_REQUESTED' }),                 // waits for a count
  ];
  assert.deepEqual(handledStats(lines), { withGap: 4, handled: 2, requested: 1, untouched: 1 });
  assert.deepEqual(handledStats([]), { withGap: 0, handled: 0, requested: 0, untouched: 0 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
