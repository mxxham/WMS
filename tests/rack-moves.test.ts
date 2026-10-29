import { strict as assert } from 'node:assert';
import { withMoves, type RackSummary } from '../app/(app)/audit/picking/rack-data';
import { auditWorkbookRows, type ExportAttempt, type ExportLine, type ExportMove } from '../lib/sheet-audit-export';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const rack = (zone: string, done: number): RackSummary =>
  ({ zone, bins: done, lines: done, todo: 0, mismatch: 0, done, state: 'DONE' });

console.log('Bin To Bin in the rack list (0114)');

test('a move CB -> CF is one check in rack CB and one in rack CF', () => {
  const out = withMoves([rack('CB', 12)], [{ zone: 'CB', to_zone: 'CF', line_state: 'TODO', from_state: 'TODO' }]);
  const cb = out.find((r) => r.zone === 'CB')!, cf = out.find((r) => r.zone === 'CF')!;
  assert.deepEqual(cb.moves, { total: 1, todo: 1, mismatch: 0, done: 0 });
  assert.deepEqual(cf.moves, { total: 1, todo: 1, mismatch: 0, done: 0 });
  assert.equal(cb.state, 'TODO', 'all picks counted, but the source bin is not: rack CB is not done');
  assert.equal(cf.bins, 0, 'rack CF had no picks but still gets a row');
  assert.deepEqual(out.map((r) => r.zone), ['CB', 'CF']);
});

test('each side carries its own state', () => {
  const out = withMoves([], [{ zone: 'CB', to_zone: 'CF', line_state: 'OK', from_state: 'MISMATCH' }]);
  assert.equal(out.find((r) => r.zone === 'CB')!.state, 'MISMATCH');
  assert.equal(out.find((r) => r.zone === 'CF')!.state, 'DONE');
});

test('a move inside one rack is two checks there', () => {
  const [cb] = withMoves([], [{ zone: 'CB', to_zone: 'CB', line_state: 'OK', from_state: 'TODO' }]);
  assert.deepEqual(cb.moves, { total: 2, todo: 1, mismatch: 0, done: 1 });
  assert.equal(cb.state, 'TODO');
});

test('a move of 0 adds nothing', () => {
  assert.deepEqual(withMoves([rack('CB', 3)], [{ zone: 'CB', to_zone: 'CF', line_state: 'AUTO_PASS', from_state: 'AUTO_PASS' }]),
    [rack('CB', 3)]);
});

const move: ExportMove = {
  task_id: 't1', wave_no: '109748922', seq: 4, from_bin: 'CE25C02', from_zone: 'CE', to_bin: 'CF05A01', to_zone: 'CF',
  sku: '550025057', description: 'Spirax', uom: 'CAR', moved_qty: 1, line_state: 'TODO',
  from_state: 'MISMATCH', from_system: 48, from_counted: 46, from_checker: 'Sari', from_found_sku: null,
  from_note: '2 hilang', from_correction: false, from_audited_at: '2026-10-28T03:00:00Z',
};
const pick: ExportLine = {
  id: 'p1', shipment_number: 'SH1', wave_no: '109748922', picklist: null, seq: 1, bin_code: 'CE25C02', sku: '550025057',
  description: 'Spirax', uom: 'CAR', batch: 'A7', expiry: null, qty: 2, bin_remaining: null, line_state: 'OK', volume_l: null,
};
const arrived: ExportAttempt = {
  line_id: 't1', attempt_no: 1, checker_name: 'Rina', method: null, result: 'OK', errors: [], counted_qty: 1,
  found_sku: '550025057', found_batch: 'A7', rack_system: null, rack_counted: null, note: null, correction: false,
  created_at: '2026-10-28T04:00:00Z',
};

console.log('Bin To Bin in the Per bin sheet');

test('a move is a source row in CE and a destination row in CF, among the picked bins', () => {
  const { bins, history } = auditWorkbookRows([pick], [arrived], 'Sisa sistem', undefined, { rows: [move] });
  assert.deepEqual(bins.map((r) => [r.Rak, r.Bin, r.Jenis]),
    [['CE', 'CE25C02', 'Bin To Bin (asal)'], ['CE', 'CE25C02', 'Pick'], ['CF', 'CF05A01', 'Bin To Bin (tujuan)']]);
  const src = bins[0], dst = bins[2];
  assert.equal(src['Bin To Bin'], 'NO 109748922 #4: CE25C02 → CF05A01');
  assert.equal(src['Qty Bin To Bin'], -1);
  assert.equal(src.Selisih, -2);
  assert.equal(src.Status, 'Selisih');
  assert.equal(dst['Qty Bin To Bin'], 1);
  assert.equal(dst['Tiba dihitung'], 1);
  assert.equal(dst.Status, 'Belum diaudit');
  assert.equal(dst.Checker, 'Rina');
  assert.equal(history.length, 0, 'the move attempt is not in the pick history (it has its own row)');
});

test('a destination counted at the rack (0115) shows the bin against the system', () => {
  const rackCount: ExportAttempt = { ...arrived, method: 'RACK', rack_system: 10, rack_counted: 9, counted_qty: 0, result: 'MISMATCH', errors: ['SHORT'] };
  const { bins } = auditWorkbookRows([], [rackCount], 'Sisa sistem', undefined, { rows: [{ ...move, line_state: 'MISMATCH' }], zone: 'CF' });
  assert.equal(bins[0]['Sisa sistem'], 10);
  assert.equal(bins[0]['Sisa dihitung'], 9);
  assert.equal(bins[0].Selisih, -1);
  assert.equal(bins[0].Status, 'Selisih');
});

test('a rack download keeps only the rows of that rack', () => {
  const { bins } = auditWorkbookRows([], [], 'Sisa sistem', undefined, { rows: [move], zone: 'CF' });
  assert.deepEqual(bins.map((r) => r.Jenis), ['Bin To Bin (tujuan)']);
});

test('before 0114 (no from_state) only the destination row', () => {
  const { from_state: _, ...old } = move;
  const { bins } = auditWorkbookRows([], [], 'Sisa sistem', undefined, { rows: [old] });
  assert.deepEqual(bins.map((r) => r.Bin), ['CF05A01']);
});

test('the WMS-file audit (no moves) keeps its columns', () => {
  const { bins } = auditWorkbookRows([pick], [], 'Sisa di file');
  assert.equal('Jenis' in bins[0], false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
