/** Paperless picking: one line's validation, sentence and payload, and the wave's progress (database side: supabase/tests/39_pick_line.sql). */
import { strict as assert } from 'node:assert';
import { buildSheet } from '../lib/wave-sheet';
import { draftNotes, lineProblem, linePayload, lineSummary, isPlannedSource, restAtOpen, samePerson, unitOf, waveProgress, type OrderLine,
  normBin, scanCheck, scanMatches, scanTarget, takeFrom } from '../lib/pick-line';
import type { TaskRow } from '../lib/allocator/picklist-from-tasks';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPaperless picking');

const base: TaskRow = {
  id: '', wave_id: 'w1', wave_no: '5', planned_slot: '08:00', shipment_number: '109711290', task_type: 'PICK', seq: 1,
  status: 'PLANNED', sku: '550070614', description: 'HlxHX610W40SP_4*4L_A04W', uom: 'CAR', upp: 36, from_bin: 'CB34D02', to_bin: null,
  batch_lot: '11I26JJ', expiry_date: '2030-09-11', quantity: 13, pick_type: 'CASE', breaks_pallet: true, completed_at: null,
  completed_by_name: null, actual_quantity: null, actual_from_bin: null, actual_batch_lot: null, actual_expiry_date: null, deviation_reason: null,
};
const pick = { ...base, id: 'p2', seq: 2 };
const move: TaskRow = { ...base, id: 'm3', seq: 3, task_type: 'REPLENISH', shipment_number: null, to_bin: 'CB18A02', quantity: 23 };
const drum: TaskRow = { ...base, id: 'p9', seq: 9, sku: '550044360', description: 'RimR4X15W40CI4E7DH1_1*209L_A227', uom: 'Drum', from_bin: 'CF17B02', batch_lot: '12704140', quantity: 4, pick_type: 'PALLET', breaks_pallet: false };
const line = () => buildSheet([pick, move]).lines[0];
const BINS = new Set(['CB34D02', 'CB18A02', 'CB18A01', 'CB33E02', 'CF17B02']);

test('unit comes from the item master: Carton, Drum, never "karton"', () => {
  assert.equal(unitOf('550070614', 'CAR'), 'Carton');
  assert.equal(unitOf('550044360', null), 'Drum');
});

test('as planned: no problem, sentence names pick and rest in the unit', () => {
  const l = line();
  assert.equal(lineProblem(l, BINS), null);
  assert.equal(lineSummary(l, 'Carton'), 'Ambil 13 Carton 550070614 dari CB34D02, sisa 23 Carton ke CB18A02.');
});

test('a drum line says Drum', () => {
  const l = buildSheet([drum]).lines[0];
  assert.equal(lineSummary(l, unitOf(drum.sku, drum.uom)), 'Ambil 4 Drum 550044360 dari CF17B02.');
});

test('two sources and the rest to another bin', () => {
  const l = line();
  l.sources = [{ ...l.sources[0], qty: '10' }, { bin: 'cb33e02', batch: '11I26JJ', expiry: '2030-09-11', qty: '3' }];
  l.moveTo = 'cb18a01';
  assert.equal(lineProblem(l, BINS), null);
  assert.equal(lineSummary(l, 'Carton'), 'Ambil 10 Carton 550070614 dari CB34D02 + 3 Carton dari CB33E02, sisa 23 Carton ke CB18A01.');
  assert.deepEqual(linePayload(l), {
    pick_id: 'p2', move_id: 'm3',
    sources: [{ bin: 'CB34D02', batch: '11I26JJ', expiry: '2030-09-11', qty: 10 }, { bin: 'CB33E02', batch: '11I26JJ', expiry: '2030-09-11', qty: 3 }],
    move_to: 'CB18A01', move_qty: 23,
  });
});

test('rest kept in the bin: no move in the sentence, move_to null', () => {
  const l = line(); l.moveTo = '';
  assert.equal(lineSummary(l, 'Carton'), 'Ambil 13 Carton 550070614 dari CB34D02.');
  assert.equal(linePayload(l).move_to, null);
});

test('Qty 0 is allowed (nothing found = short pick)', () => {
  const l = line(); l.sources[0].qty = '0';
  assert.equal(lineProblem(l, BINS), null);
});

test('problems: above the order, empty or unknown bin, destination = source, rest without quantity', () => {
  const over = line(); over.sources[0].qty = '14';
  assert.match(lineProblem(over, BINS)!, /paling banyak 13/);
  const empty = line(); empty.sources[0].bin = ' ';
  assert.match(lineProblem(empty, BINS)!, /Isi bin asal/);
  const unknown = line(); unknown.sources[0].bin = 'CX99A01';
  assert.match(lineProblem(unknown, BINS)!, /CX99A01 tidak ada/);
  const same = line(); same.moveTo = 'cb34d02';
  assert.match(lineProblem(same, BINS)!, /sama dengan bin asal/);
  const noQty = line(); noQty.moveQty = '';
  assert.match(lineProblem(noQty, BINS)!, /Qty sisa/);
  const notNum = line(); notNum.sources[0].qty = 'x';
  assert.match(lineProblem(notNum, BINS)!, /Qty/);
});

test('progress: units never summed, short pick vs shortage, two shipments, per picker', () => {
  const t1: TaskRow = { ...base, id: 'a', seq: 1, shipment_number: 'S1', quantity: 13, status: 'COMPLETED', actual_quantity: 10, picked_by_name: 'Ani' };
  const t2: TaskRow = { ...base, id: 'b', seq: 2, shipment_number: 'S1', quantity: 20, status: 'PLANNED' };
  const t3: TaskRow = { ...drum, id: 'c', seq: 3, shipment_number: 'S2', quantity: 4, status: 'COMPLETED', actual_quantity: 4, picked_by_name: 'Budi' };
  const orders: OrderLine[] = [
    { shipment_number: 'S1', sku: '550070614', quantity_requested: 40, shortage_reason: 'NO_STOCK' },
    { shipment_number: 'S2', sku: '550044360', quantity_requested: 4 },
  ];
  const p = waveProgress([t1, t2, t3], orders);
  assert.deepEqual(p.lines, { done: 2, total: 3 });
  assert.deepEqual(p.units, { Carton: { needed: 40, picked: 10 }, Drum: { needed: 4, picked: 4 } });
  const s1 = p.orders.find((o) => o.shipment === 'S1')!;
  assert.equal(s1.planned, 33);
  assert.equal(s1.lackUnplanned, 7);
  assert.equal(s1.shortageReason, 'NO_STOCK');
  assert.equal(s1.lackShort, 3);
  assert.deepEqual(s1.shortSeqs, [1]);
  assert.equal(s1.openLines, 1);
  const s2 = p.shipments.find((s) => s.shipment === 'S2')!;
  assert.equal(s2.open, 0);
  assert.deepEqual(s2.lack, {});
  assert.deepEqual(p.pickers, [{ name: 'Ani', lines: 1, units: { Carton: 10 } }, { name: 'Budi', lines: 1, units: { Drum: 4 } }]);
});

test('a move-only line needs its destination and quantity; valid one reads as a Pindah sentence', () => {
  const mo = buildSheet([move]).lines[0];
  assert.equal(mo.pick, null);
  mo.moveTo = '';
  assert.equal(lineProblem(mo, BINS), 'Isi bin tujuan');
  mo.moveTo = 'CB18A02'; mo.moveQty = '0';
  assert.match(lineProblem(mo, BINS)!, /Isi Qty sisa/);
  mo.moveQty = '23';
  assert.equal(lineProblem(mo, BINS), null);
  assert.equal(lineSummary(mo, 'Carton'), 'Pindah 23 Carton 550070614 dari CB34D02 ke CB18A02.');
});

test('two order lines for one shipment and SKU add up, not overwrite', () => {
  const t1: TaskRow = { ...base, id: 'a', seq: 1, shipment_number: 'S1', quantity: 13, status: 'PLANNED' };
  const p = waveProgress([t1], [
    { shipment_number: 'S1', sku: '550070614', quantity_requested: 25 },
    { shipment_number: 'S1', sku: '550070614', quantity_requested: 15, shortage_reason: 'NO_STOCK' },
  ]);
  assert.equal(p.orders.length, 1);
  assert.equal(p.orders[0]!.needed, 40);
  assert.equal(p.orders[0]!.shortageReason, 'NO_STOCK');
});

// Final review I3 + minors: the editor's notes, the rest it starts with, own line.
const STOCK = [
  { bin: 'CB34D02', sku: '550070614', batch: '11I26JJ', expiry: '2030-09-11', qty: 36 },
  { bin: 'CB33E02', sku: '550070614', batch: '11I26JJ', expiry: '2030-09-11', qty: 2 },
];
test("own line: names compared like same_person; no name is nobody's line", () => {
  assert.equal(samePerson('  Ani  Sari ', 'ani sari'), true);
  assert.equal(samePerson('Ani', 'Budi'), false);
  assert.equal(samePerson(null, 'Ani'), false);
  assert.equal(samePerson('', ''), false);
});
test('rest at open: the plan until stock has loaded, then what the bin really keeps (0 included)', () => {
  const l = line();
  assert.equal(restAtOpen(l, [], false), '23');
  assert.equal(restAtOpen(l, STOCK, true), '23');
  assert.equal(restAtOpen(l, [{ ...STOCK[0], qty: 30 }], true), '17');
  assert.equal(restAtOpen(l, [], true), '0');
});
test('editor notes: sheetNotes for the line plus the rest against the system', () => {
  const l = line();
  // As planned against a pallet of 36: no warning.
  assert.deepEqual(draftNotes(l, l, STOCK, BINS, 'Carton', true).filter((n) => n.tone !== 'info'), []);
  // Second source with 3 where the system has 2: a correction, in yellow.
  const two = structuredClone(l);
  two.sources = [{ ...l.sources[0], qty: '10' }, { bin: 'CB33E02', batch: '11I26JJ', expiry: '2030-09-11', qty: '3' }];
  two.moveQty = '26';
  const n2 = draftNotes(two, l, STOCK, BINS, 'Carton', true);
  assert.ok(n2.some((n) => n.tone === 'warn' && n.text.includes('koreksi picklist') && n.text.includes('CB33E02')), JSON.stringify(n2));
  assert.ok(!n2.some((n) => n.text.startsWith('Qty sisa')), 'rest 26 = 36 - 10 is not above the bin');
  // Rest above what the bin keeps: a yellow warning, not a block.
  const over = structuredClone(l); over.moveQty = '30';
  const n3 = draftNotes(over, l, STOCK, BINS, 'Carton', true);
  assert.ok(n3.some((n) => n.tone === 'warn' && n.text.startsWith('Qty sisa 30 Carton lebih dari')), JSON.stringify(n3));
  assert.equal(lineProblem(over, BINS), null);
  // The system's rest differs from the plan: said once stock has loaded, not before.
  const short = [{ ...STOCK[0], qty: 30 }];
  assert.ok(draftNotes(l, l, short, BINS, 'Carton', true).some((n) => n.text.includes('rencana 23')));
  assert.ok(!draftNotes(l, l, [], BINS, 'Carton', false).some((n) => n.text.startsWith('Sistem: sisa')));
  // An unknown bin is red.
  const typo = structuredClone(l); typo.sources[0].bin = 'CB99Z99';
  assert.ok(draftNotes(typo, l, STOCK, BINS, 'Carton', true).some((n) => n.tone === 'bad'));
});
test('source suggestions mark the planned row', () => {
  const l = line();
  assert.equal(isPlannedSource(STOCK[0], l), true);
  assert.equal(isPlannedSource(STOCK[1], l), false);
  assert.equal(isPlannedSource({ ...STOCK[0], batch: 'X' }, l), false);
  assert.equal(isPlannedSource({ ...STOCK[0], expiry: '2030-09-11T00:00:00' }, l), true);
});

// Rack scan (0068): the bin label confirms the line, the same first source post_pick_line checks.
test('scan target: the first source as the engine reads it; a move-only line its pallet', () => {
  assert.equal(scanTarget(line()), 'CB34D02');
  const berbeda = line(); berbeda.sources[0].bin = ' cb33e02 ';
  assert.equal(scanTarget(berbeda), 'CB33E02');
  const zeroFirst = line();
  zeroFirst.sources = [{ ...zeroFirst.sources[0], qty: '0' }, { bin: 'CB33E02', batch: '11I26JJ', expiry: '2030-09-11', qty: '13' }];
  assert.equal(scanTarget(zeroFirst), 'CB33E02', 'a first source with 0 is skipped when there are several');
  const allZero = line(); allZero.sources = [{ ...allZero.sources[0], qty: '0' }];
  assert.equal(scanTarget(allZero), 'CB34D02', 'a single source with 0 is still the source');
  assert.equal(scanTarget(buildSheet([move]).lines[0]), 'CB34D02', 'move-only: its source, never the destination');
});
test('scan match: case and spaces ignored; the neighbouring level, an item code or nothing do not match', () => {
  const l = line();
  assert.equal(normBin(' cb34 d02\n'), 'CB34D02');
  assert.equal(scanMatches(l, ' cb34d02 '), true);
  assert.equal(scanMatches(l, 'CB34C02'), false);
  assert.equal(scanMatches(l, 'CB34E02'), false);
  assert.equal(scanMatches(l, '550070614'), false);
  assert.equal(scanMatches(l, ''), false);
  assert.equal(scanMatches(l, null), false);
});
test('scan messages: green with the bin, red naming both bins', () => {
  const l = line();
  assert.deepEqual(scanCheck(l, 'cb34d02'), { ok: true, bin: 'CB34D02', text: '✓ CB34D02' });
  assert.deepEqual(scanCheck(l, 'cb34c02'), { ok: false, bin: 'CB34D02', scanned: 'CB34C02', text: 'Bin salah: kamu scan CB34C02, baris ini CB34D02' });
  assert.equal(scanCheck(l, '  '), null);
});
test('Ambil dari the scanned bin: it becomes the first source, batch and expiry filled when the bin holds one batch', () => {
  const l = line();
  const stock = [...STOCK, { bin: 'CB34C02', sku: '550070614', batch: 'X9', expiry: '2030-10-01', qty: 20 },
    { bin: 'CB34E02', sku: '550070614', batch: 'A1', expiry: '2030-08-01', qty: 5 }, { bin: 'CB34E02', sku: '550070614', batch: 'A2', expiry: '2030-08-02', qty: 5 },
    { bin: 'CB34C02', sku: '999', batch: 'Z', expiry: null, qty: 1 }];
  const d = takeFrom(l, ' cb34c02 ', stock);
  assert.deepEqual(d.sources, [{ bin: 'CB34C02', batch: 'X9', expiry: '2030-10-01', qty: '13' }]);
  assert.equal(scanMatches(d, 'CB34C02'), true);
  assert.deepEqual(l.sources[0].bin, 'CB34D02', 'the line itself is not changed');
  const two = takeFrom(l, 'CB34E02', stock);
  assert.deepEqual(two.sources[0], { bin: 'CB34E02', batch: '11I26JJ', expiry: '2030-09-11', qty: '13' }, 'two batches: the plan stays, the picker picks');
  const mo = takeFrom(buildSheet([move]).lines[0], 'CB34C02', stock);
  assert.equal(mo.sources[0].bin, 'CB34C02');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
