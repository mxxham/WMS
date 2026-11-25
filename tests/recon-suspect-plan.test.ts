import { strict as assert } from 'node:assert';
import { checklistProgress, checklistRows, checkState, nextUnchecked, suspectPlan, type PickLine } from '../lib/recon-suspect-plan';
import type { SuspectBin } from '../lib/recon-investigate';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

function bin(code: string, o: Partial<SuspectBin> = {}): SuspectBin {
  return {
    bin_id: code, bin_code: code, zone: 'A', rack: code.slice(2, 4), level: code.charAt(4), bin_position: code.slice(5), bin_status: 'active',
    kind: 'CURRENT', system_qty: 10, system_lines: [], other_skus: null, is_pickface: false,
    moves: 1, first_seen: null, last_move_at: null, last_move_type: null, last_move_qty: null, last_move_note: null,
    last_full: null, emptied_at: null, emptied_by_import: false, neighbour_of: null, score: 10, reasons: [],
    check_id: null, checked_at: null, checked_name: null, checked_qty: null, check_lines: null, check_stale: false, ...o,
  };
}
const checked = (b: SuspectBin, qty: number): SuspectBin => ({ ...b, check_id: 'c', checked_qty: qty });
function pick(from: string, o: Partial<PickLine> = {}): PickLine {
  return {
    id: from, wave_no: 'W1', planned_date: '2026-11-23', shipment_number: 'S1', seq: 1, status: 'COMPLETED', from_bin: from,
    actual_from_bin: null, batch_lot: 'B', expiry_date: '2030-01-01', quantity: 5, actual_quantity: null, picked_by_name: null, completed_by_name: null, ...o,
  };
}

const A = bin('CA01A01', { is_pickface: true, score: 50 });   // pickface, level A
const A2 = bin('CA02A01', { score: 30 });                       // level A, not the pickface
const C = bin('CA03C01', { score: 40 });                        // upper level
const gone = bin('CA04B01', { system_qty: 0, kind: 'HISTORY' });
const all = [A, A2, C, gone];
const codes = (bs: SuspectBin[]) => bs.map((b) => b.bin_code);

test('WMS more by a pallet or more: every bin holding the SKU; exactly one pallet counts as big', () => {
  for (const gap of [48, 100]) {
    const p = suspectPlan({ gap, upp: 48, suspects: all, picks: [] });
    assert.equal(p.mode, 'PLUS_ALL'); assert.equal(p.big, true);
    assert.deepEqual(codes(p.primary), ['CA01A01', 'CA03C01', 'CA02A01']);
  }
});

test('WMS more by less than a pallet: only pickface / level A bins holding the SKU', () => {
  const p = suspectPlan({ gap: 47, upp: 48, suspects: all, picks: [] });
  assert.equal(p.mode, 'PLUS_PICKFACE');
  assert.deepEqual(codes(p.primary), ['CA01A01', 'CA02A01']);
  assert.equal(p.hasFallback, true);
});

test('each SKU uses its own UPP', () => {
  assert.equal(suspectPlan({ gap: 20, upp: 24, suspects: all, picks: [] }).mode, 'PLUS_PICKFACE');
  assert.equal(suspectPlan({ gap: 20, upp: 12, suspects: all, picks: [] }).mode, 'PLUS_ALL');
});

test('WMS less by a pallet or more: the picklist bins only', () => {
  const p = suspectPlan({ gap: -48, upp: 48, suspects: all, picks: [pick('CA03C01'), pick('CA03C01', { id: 'x' })] });
  assert.equal(p.mode, 'MINUS_PICKLIST');
  assert.deepEqual(p.pickBins, ['CA03C01']);
  assert.deepEqual(codes(p.primary), ['CA03C01']);
  assert.equal(p.hasFallback, false);
});

test('WMS less by less than a pallet: picklist bins first, then pickface / level A bins', () => {
  const p = suspectPlan({ gap: -5, upp: 48, suspects: all, picks: [pick('CA03C01')] });
  assert.equal(p.mode, 'MINUS_PICKLIST_PICKFACE');
  assert.deepEqual(codes(p.primary), ['CA03C01', 'CA01A01', 'CA02A01']);
});

test('the bin a picker really took from beats the planned bin', () => {
  const p = suspectPlan({ gap: -48, upp: 48, suspects: all, picks: [pick('CA03C01', { actual_from_bin: 'CA02A01' })] });
  assert.deepEqual(p.pickBins, ['CA02A01']);
  assert.deepEqual(codes(p.primary), ['CA02A01']);
});

test('fallback to every pickface bin opens only when all first bins are checked and none differs', () => {
  const open = (bs: SuspectBin[]) => suspectPlan({ gap: 5, upp: 48, suspects: bs, picks: [] }).fallbackOpen;
  assert.equal(open([A, A2, C]), false);                       // nothing checked
  assert.equal(open([checked(A, 10), A2, C]), false);          // one left
  assert.equal(open([checked(A, 10), checked(A2, 10), C]), true); // all match the system
  assert.equal(open([checked(A, 7), checked(A2, 10), C]), false); // one differs: something was found
});

test('minus: the fallback also waits for the picklist bins to be checked', () => {
  const picks = [pick('CA03C01')];
  const p = (bs: SuspectBin[]) => suspectPlan({ gap: -5, upp: 48, suspects: bs, picks }).fallbackOpen;
  assert.equal(p([checked(A, 10), checked(A2, 10), C]), false);
  assert.equal(p([checked(A, 10), checked(A2, 10), checked(C, 10)]), true);
});

test('checklist: picklist bins first, with their picklist lines and the source of each bin', () => {
  const pk = [pick('CA03C01'), pick('CA03C01', { id: 'y', wave_no: 'W2' })];
  const plan = suspectPlan({ gap: -5, upp: 48, suspects: all, picks: pk });
  const rows = checklistRows(plan, pk, all);
  assert.deepEqual(rows.map((r) => r.code), ['CA03C01', 'CA01A01', 'CA02A01']);
  assert.deepEqual(rows[0].picks.map((p) => p.wave_no), ['W1', 'W2']);
  assert.deepEqual(rows.map((r) => r.sources), [['PICKLIST'], ['PICKFACE'], ['LEVEL_A']]);
});

test('checklist: a picklist bin the suspect list does not know is still a row', () => {
  const pk = [pick('CZ99A01')];
  const plan = suspectPlan({ gap: -48, upp: 48, suspects: all, picks: pk });
  const rows = checklistRows(plan, pk, all);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bin, null); assert.equal(rows[0].state, 'TODO');
});

test('check state: todo, stale, ok, diff with the signed difference', () => {
  assert.deepEqual(checkState(A), { state: 'TODO', diff: 0 });
  assert.deepEqual(checkState({ ...checked(A, 10), check_stale: true }), { state: 'STALE', diff: 0 });
  assert.deepEqual(checkState(checked(A, 10)), { state: 'OK', diff: 0 });
  assert.deepEqual(checkState(checked(A, 7)), { state: 'DIFF', diff: -3 });
  assert.deepEqual(checkState(checked(A, 0)), { state: 'DIFF', diff: -10 });      // counted 0 is a count
  assert.deepEqual(checkState(null), { state: 'TODO', diff: 0 });
});

test('checklist progress and the next bin to do', () => {
  const plan = suspectPlan({ gap: 5, upp: 48, suspects: [checked(A, 10), A2, checked(C, 4)], picks: [] });
  const rows = checklistRows(plan, [], [checked(A, 10), A2, checked(C, 4)]);
  assert.deepEqual(rows.map((r) => r.code), ['CA01A01', 'CA02A01']);
  assert.deepEqual(checklistProgress(rows), { total: 2, done: 1, ok: 1, diff: 0, stale: 0, todo: 1 });
  assert.equal(nextUnchecked(rows, 'CA01A01')?.code, 'CA02A01');
  assert.equal(nextUnchecked(rows, 'CA02A01'), null);
  const all3 = checklistRows(suspectPlan({ gap: 100, upp: 48, suspects: all, picks: [] }), [], all);
  assert.equal(nextUnchecked(all3, all3[all3.length - 1].code)?.code, all3[0].code); // wraps round
});

test('no UPP or no gap keeps the score list', () => {
  assert.equal(suspectPlan({ gap: 5, upp: null, suspects: all, picks: [] }).mode, 'WIDE');
  assert.equal(suspectPlan({ gap: 0, upp: 48, suspects: all, picks: [] }).mode, 'WIDE');
  assert.equal(suspectPlan({ gap: 5, upp: 0, suspects: all, picks: [] }).mode, 'WIDE');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
