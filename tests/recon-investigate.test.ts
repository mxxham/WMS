// Investigasi selisih (lib/recon-investigate.ts, 0129): clues in words, the first bins to walk to,
// the pallet hint, the check form and the confirmation sentence.
import { strict as assert } from 'node:assert';
import { checkDraft, linesQty, linesText, palletHint, planSentence, reasonLabel, topSuspects, type FixPlan, type SuspectBin } from '../lib/recon-investigate';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const bin = (o: Partial<SuspectBin>): SuspectBin => ({
  bin_id: o.bin_code ?? 'x', bin_code: 'CC01A01', zone: 'CC', rack: '01', level: 'A', bin_position: '01', bin_status: 'active', kind: 'HISTORY',
  system_qty: 0, system_lines: [], other_skus: null, is_pickface: false, moves: 1, first_seen: null, last_move_at: null, last_move_type: null,
  last_move_qty: null, last_move_note: null, last_full: null, emptied_at: null, emptied_by_import: false, neighbour_of: null,
  score: 0, reasons: [], check_id: null, checked_at: null, checked_name: null, checked_qty: null, check_lines: null, check_stale: false, ...o,
});

test('topSuspects: every strong clue first, then scores of 25 and up, at most 8', () => {
  const rows = [
    bin({ bin_code: 'A', score: 60, reasons: ['CURRENT', 'RECENT_3'] }),
    bin({ bin_code: 'B', score: 105, reasons: ['EMPTIED', 'QTY_MATCH', 'RECENT_3'] }),
    bin({ bin_code: 'C', score: 4, reasons: ['NEIGHBOUR'] }),
    bin({ bin_code: 'D', score: 10, reasons: ['IMPORT_ZERO'] }),
  ];
  assert.deepEqual(topSuspects(rows).map((r) => r.bin_code), ['B', 'D', 'A']);
  const many = Array.from({ length: 12 }, (_, i) => bin({ bin_code: `S${i}`, score: 50, reasons: ['CURRENT'] }));
  assert.equal(topSuspects(many).length, 8);
  // Strong clues are never cut off, even past the cap.
  const strong = Array.from({ length: 10 }, (_, i) => bin({ bin_code: `Q${i}`, score: 90, reasons: ['QTY_MATCH'] }));
  assert.equal(topSuspects(strong).length, 10);
});

test('reasonLabel: the clue the floor reads, with the numbers', () => {
  assert.equal(reasonLabel('QTY_MATCH', bin({ last_full: 48 }), -48, '2026-11-03'), 'Terakhir berisi 48 = selisih');
  assert.equal(reasonLabel('CURRENT', bin({ system_qty: 30 }), -48, '2026-11-03'), 'WMS: 30 di sini');
  assert.equal(reasonLabel('NEIGHBOUR', bin({ neighbour_of: 'CC27D02' }), -48, '2026-11-03'), 'Sebelah CC27D02');
  assert.equal(reasonLabel('RECENT_3', bin({ last_move_at: '2026-11-01T09:00:00+07:00' }), -48, '2026-11-03'), 'Mutasi 2 hari sebelum tanggal SAP');
  assert.equal(reasonLabel('IMPORT_ZERO', bin({}), -48, '2026-11-03'), 'Dinolkan impor pagi (not in file)');
});

test('palletHint: only whole pallets of this SKU', () => {
  assert.equal(palletHint(-48, 48), 'Selisih = tepat 1 palet penuh (48 karton/palet).');
  assert.equal(palletHint(96, 48), 'Selisih = tepat 2 palet penuh (48 karton/palet).');
  assert.equal(palletHint(-47, 48), null);
  assert.equal(palletHint(-48, null), null);
  assert.equal(palletHint(0, 48), null);
});

test('checkDraft: empty rows ignored, no rows = kosong, expiry needed only for stock new to the bin', () => {
  assert.deepEqual(checkDraft([{ batch_lot: '', expiry_date: '', quantity: '' }], []), { lines: [] });
  assert.deepEqual(checkDraft([{ batch_lot: ' b48 ', expiry_date: '2030-05-01', quantity: '48' }], []),
    { lines: [{ batch_lot: 'B48', expiry_date: '2030-05-01', quantity: 48 }] });
  assert.ok('error' in checkDraft([{ batch_lot: 'B48', expiry_date: '', quantity: '48' }], []));
  assert.deepEqual(checkDraft([{ batch_lot: 'B30', expiry_date: '', quantity: '30' }], [{ batch_lot: 'B30', expiry_date: null, quantity: 30 }]),
    { lines: [{ batch_lot: 'B30', expiry_date: null, quantity: 30 }] });
  // A pre-filled batch that is not in the bin: 0 drops it, a blank still asks.
  assert.deepEqual(checkDraft([{ batch_lot: 'B30', expiry_date: '', quantity: '0' }, { batch_lot: 'B31', expiry_date: '2030-01-01', quantity: '4' }],
    [{ batch_lot: 'B30', expiry_date: null, quantity: 30 }]), { lines: [{ batch_lot: 'B31', expiry_date: '2030-01-01', quantity: 4 }] });
  assert.ok('error' in checkDraft([{ batch_lot: 'B30', expiry_date: '', quantity: '' }], [{ batch_lot: 'B30', expiry_date: null, quantity: 30 }]));
  assert.ok('error' in checkDraft([{ batch_lot: 'B', expiry_date: '2030-01-01', quantity: '-1' }], []));
  assert.ok('error' in checkDraft([{ batch_lot: 'B', expiry_date: '2030-01-01', quantity: '2.5' }], []));
});

test('linesText / linesQty', () => {
  assert.equal(linesText([]), 'kosong');
  assert.equal(linesQty([{ batch_lot: 'A', expiry_date: null, quantity: 3 }, { batch_lot: 'B', expiry_date: null, quantity: 4 }]), 7);
  assert.match(linesText([{ batch_lot: 'B48', expiry_date: null, quantity: 48 }]), /^48 · B48$/);
});

test('planSentence: what moves, what changes, what is left of the gap', () => {
  const p = {
    transfers: [{ from_bin: 'CC28A01', to_bin: 'CC28B01', batch_lot: 'Y1', expiry_date: null, quantity: 20, checked_name: 'Andi' }],
    adjustments: [{ bin_code: 'CC27D02', batch_lot: 'B48', expiry_date: null, quantity: 48, checked_name: 'Andi' }],
    net_adjust: 48, gap_after: 0,
  } as unknown as FixPlan;
  assert.equal(planSentence(p, '550024919'),
    'SKU 550024919: pindah 20 karton CC28A01 → CC28B01, tambah 48 karton di CC27D02. Stok WMS hari ini berubah +48; selisih dengan SAP menjadi 0.');
  const q = { transfers: [], adjustments: [{ bin_code: 'CE10A02', batch_lot: '', expiry_date: null, quantity: -5, checked_name: 'A' }], net_adjust: -5, gap_after: 3 } as unknown as FixPlan;
  assert.match(planSentence(q, 'X'), /kurangi 5 karton di CE10A02\. Stok WMS hari ini berubah -5; sisa selisih dengan SAP \+3\.$/);
});

console.log(`\nrecon-investigate: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
