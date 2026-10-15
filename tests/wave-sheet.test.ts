/**
 * Isi dari picklist (lib/wave-sheet.ts): lines built from a wave's tasks,
 * what is sent to post_wave_sheet, and the notes — warnings never block,
 * only a bin that does not exist is an error, and a source short in the
 * system shows the correction the database will book.
 */
import { strict as assert } from 'node:assert';
import type { TaskRow } from '../lib/allocator/picklist-from-tasks';
import { buildSheet, followPick, leftoverAfter, pecahLine, sheetNotes, sheetPayload, sheetSummary, type SheetLine, type SheetStock } from '../lib/wave-sheet';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

let n = 0;
const task = (o: Partial<TaskRow>): TaskRow => ({
  id: `t${++n}`, wave_id: 'w', wave_no: '1', planned_slot: null, shipment_number: 'SH1', task_type: 'PICK', seq: n, status: 'PLANNED',
  sku: '550058592', description: 'Rimula', uom: 'CAR', upp: 44, from_bin: 'CE28D02', to_bin: null, batch_lot: '05H26JJ',
  expiry_date: '2030-08-05', quantity: 10, pick_type: 'CASE', breaks_pallet: false, completed_at: null, completed_by_name: null,
  actual_quantity: null, actual_from_bin: null, actual_batch_lot: null, actual_expiry_date: null, deviation_reason: null, ...o,
});
const stock = (bin: string, qty: number, batch = '05H26JJ', expiry = '2030-08-05', sku = '550058592'): SheetStock => ({ bin, sku, batch, expiry, qty });
const BINS = new Set(['CE28D02', 'CE30A02', 'CE10A02', 'CF39A02', 'CF40B02', 'CF40C01']);

function setup(tasks: TaskRow[]) {
  const { lines, cancelled } = buildSheet(tasks);
  const initial = new Map(lines.map((l) => [l.key, structuredClone(l)]));
  // As after "Centang semua": every open line checked against the paper.
  for (const l of lines) if (!l.posted) l.done = true;
  return { lines, initial, cancelled };
}
const edit = (l: SheetLine, o: Partial<SheetLine>) => Object.assign(l, o);

console.log('\nIsi dari picklist');

test('a pick and its Bin To Bin are one line, prefilled from the plan; cancelled tasks apart', () => {
  n = 0;
  const { lines, cancelled } = setup([
    task({ seq: 1, breaks_pallet: true }),
    task({ seq: 2, task_type: 'REPLENISH', shipment_number: null, to_bin: 'CE30A02', quantity: 34 }),
    task({ seq: 3, from_bin: 'CF40C01', status: 'CANCELLED' }),
  ]);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].sources, [{ bin: 'CE28D02', batch: '05H26JJ', expiry: '2030-08-05', qty: '10' }]);
  assert.equal(lines[0].moveTo, 'CE30A02');
  assert.equal(lines[0].moveQty, '34');
  assert.equal(cancelled.length, 1);
});

test('open lines start unticked: nothing is posted until a line is checked', () => {
  n = 0;
  const { lines } = buildSheet([task({ seq: 1 }), task({ seq: 2, from_bin: 'CF39A02' })]);
  const initial = new Map(lines.map((l) => [l.key, structuredClone(l)]));
  assert.ok(lines.every((l) => !l.done));
  assert.equal(sheetPayload(lines, initial).length, 0);
  lines[0].done = true;
  assert.deepEqual(sheetPayload(lines, initial).map((p) => p.pick_id), [lines[0].pick!.id]);
});

test('a new Bin To Bin starts with what the pallet holds after the pick', () => {
  n = 0;
  const { lines } = setup([task({ seq: 1, from_bin: 'CF40C02', quantity: 8, batch_lot: '14I26JJ', expiry_date: '2030-09-14', sku: '550044709' })]);
  assert.equal(leftoverAfter(lines[0], [stock('CF40C02', 48, '14I26JJ', '2030-09-14', '550044709')]), 40);
  lines[0].posted = true;
  assert.equal(leftoverAfter(lines[0], [stock('CF40C02', 40, '14I26JJ', '2030-09-14', '550044709')]), 40, 'a posted pick has already left the stock');
});

test('ticked open lines post as planned; "Belum" leaves one open; posted unchanged lines are not sent', () => {
  n = 0;
  const { lines, initial } = setup([
    task({ seq: 1 }),
    task({ seq: 2, from_bin: 'CF39A02', sku: '550044709' }),
    task({ seq: 3, from_bin: 'CF40C01', status: 'COMPLETED', actual_quantity: 10 }),
  ]);
  lines[1].done = false;
  const p = sheetPayload(lines, initial);
  assert.equal(p.length, 1);
  assert.equal(p[0].pick_id, lines[0].pick!.id);
  assert.deepEqual(p[0].sources, [{ bin: 'CE28D02', batch: '05H26JJ', expiry: '2030-08-05', qty: 10 }]);
  assert.equal(p[0].move_to, null);
});

test('a posted line that differs from the paper is sent, and says it will be redone', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1, status: 'COMPLETED', actual_quantity: 10 })]);
  edit(lines[0], { sources: [{ ...lines[0].sources[0], qty: '8' }] });
  assert.equal(sheetPayload(lines, initial).length, 1);
  const notes = sheetNotes(lines, initial, [stock('CE28D02', 34)], BINS).get(lines[0].key)!;
  assert.ok(notes.some((x) => x.text.startsWith('Sudah diposting')));
  assert.ok(notes.some((x) => x.text.includes('kurang 2')));
});

test('other bin, later expiry, fewer cartons: warnings, never errors', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1 })]);
  edit(lines[0], { sources: [{ bin: 'cf39a02', batch: '20H26JJ', expiry: '2030-08-20', qty: '7' }] });
  const notes = sheetNotes(lines, initial, [stock('CF39A02', 30, '20H26JJ', '2030-08-20')], BINS).get(lines[0].key)!;
  assert.equal(notes.filter((x) => x.tone === 'bad').length, 0);
  assert.ok(notes.some((x) => x.text.startsWith('Bin lain dari rencana CE28D02')));
  assert.ok(notes.some((x) => x.text.startsWith('Tidak FEFO')));
  assert.ok(notes.some((x) => x.text.includes('kurang 3')));
  assert.equal(sheetPayload(lines, initial)[0].sources[0].bin, 'CF39A02');
});

test('a bin that does not exist is the error; a Bin To Bin to the same bin too', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1 })]);
  edit(lines[0], { sources: [{ ...lines[0].sources[0], bin: 'CE28D2' }], moveTo: 'CE28D2', moveQty: '5' });
  const notes = sheetNotes(lines, initial, [], BINS).get(lines[0].key)!;
  assert.ok(notes.some((x) => x.tone === 'bad' && x.text === 'Bin CE28D2 tidak ada.'));
  assert.ok(notes.some((x) => x.tone === 'bad' && x.text === 'Bin To Bin ke bin yang sama.'));
  assert.equal(sheetSummary(lines, initial, sheetNotes(lines, initial, [], BINS)).errors > 0, true);
});

test('stock replayed in picklist order: the second line from the same pallet sees what the first left, the gap shows as a correction', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1, quantity: 30 }), task({ seq: 2, quantity: 20, shipment_number: 'SH2' })]);
  const notes = sheetNotes(lines, initial, [stock('CE28D02', 44)], BINS);
  assert.equal(notes.get(lines[0].key)!.filter((x) => x.text.includes('koreksi picklist')).length, 0);
  const second = notes.get(lines[1].key)!.find((x) => x.text.includes('koreksi picklist'));
  assert.ok(second, 'the second line is short by 6');
  assert.ok(second!.text.includes('hanya 14, kertas 20: +6'));
});

test('the Bin To Bin counts against its pallet too: pick 10 + rest 34 from 40 shows +4', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1 }), task({ seq: 2, task_type: 'REPLENISH', shipment_number: null, to_bin: 'CE30A02', quantity: 34 })]);
  const notes = sheetNotes(lines, initial, [stock('CE28D02', 40)], BINS).get(lines[0].key)!;
  assert.ok(notes.some((x) => x.text.includes('hanya 40, kertas 44: +4')));
});

test('split over two bins, and the rest not moved: one payload line, two sources, no move', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1, quantity: 15 }), task({ seq: 2, task_type: 'REPLENISH', shipment_number: null, to_bin: 'CE30A02', quantity: 34 })]);
  edit(lines[0], {
    sources: [{ bin: 'CF39A02', batch: '05H26JJ', expiry: '2030-08-05', qty: '10' }, { bin: 'CF40B02', batch: '05H26JJ', expiry: '2030-08-05', qty: '5' }],
    moveTo: '',
  });
  const p = sheetPayload(lines, initial)[0];
  assert.equal(p.sources.length, 2);
  assert.equal(p.move_to, null);
  assert.equal(p.move_id, lines[0].move!.id, 'the planned move is sent so the database cancels it');
  const notes = sheetNotes(lines, initial, [], BINS).get(lines[0].key)!;
  assert.ok(notes.some((x) => x.text === 'Dari 2 bin: baris dipecah.'));
  assert.ok(notes.some((x) => x.text.startsWith('Sisa tidak dipindah')));
});

test('a Bin To Bin on its own (no pick): its source sends 0 cartons, the move carries the quantity', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1, task_type: 'REPLENISH', shipment_number: null, to_bin: 'CE30A02', quantity: 12 })]);
  assert.equal(lines[0].pick, null);
  edit(lines[0], { moveTo: 'CE10A02' });
  const p = sheetPayload(lines, initial)[0];
  assert.equal(p.pick_id, null);
  assert.equal(p.sources[0].qty, 0);
  assert.equal(p.move_to, 'CE10A02');
  assert.equal(p.move_qty, 12);
});

test('an open Bin To Bin into the bin is posted first: no correction shown, the move is named', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1, from_bin: 'CE30A02', quantity: 30 })]);
  const notes = sheetNotes(lines, initial, [stock('CE30A02', 0)], BINS,
    [{ id: 'm9', to: 'CE30A02', sku: '550058592', batch: '05H26JJ', expiry: '2030-08-05', qty: 32, label: 'NO 6 #4' }]).get(lines[0].key)!;
  assert.ok(notes.some((x) => x.text === 'CE30A02 baru terisi lewat Bin To Bin NO 6 #4 (32): ikut diposting dulu.'));
  assert.equal(notes.filter((x) => x.text.includes('koreksi picklist')).length, 0);
});

test('a Bin To Bin further down the same wave fills the bin first: no correction, and it is not counted twice', () => {
  n = 0;
  // #1 picks 12 from the pickface CE30A02 (empty); #3/#4 opens CE28D02 and moves 34 to CE30A02; #5 then wants 23 of the 22 left.
  const { lines, initial } = setup([
    task({ seq: 1, from_bin: 'CE30A02', quantity: 12 }),
    task({ seq: 3, quantity: 10, shipment_number: 'SH2' }),
    task({ seq: 4, task_type: 'REPLENISH', shipment_number: null, to_bin: 'CE30A02', quantity: 34 }),
    task({ seq: 5, from_bin: 'CE30A02', quantity: 23, shipment_number: 'SH3' }),
  ]);
  const notes = sheetNotes(lines, initial, [stock('CE28D02', 44)], BINS);
  const first = notes.get(lines[0].key)!;
  assert.ok(first.some((x) => x.text === 'CE30A02 baru terisi lewat Bin To Bin #3 di lembar ini (34): ikut diposting dulu.'));
  assert.equal(first.filter((x) => x.text.includes('koreksi picklist')).length, 0);
  assert.equal(notes.get(lines[1].key)!.filter((x) => x.text.includes('koreksi picklist')).length, 0, 'the pallet still covers its own pick and move');
  assert.ok(notes.get(lines[2].key)!.some((x) => x.text.includes('hanya 22, kertas 23: +1')), '34 − 12 = 22 left for #5, so 23 is short by exactly 1 (the move counted once)');
});

test('7 Oct: the paper names a batch the bin does not hold, the bin\'s own batch is taken and nothing is invented', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1, quantity: 27 })]);
  edit(lines[0], { sources: [{ bin: 'CE28D02', batch: '01I26JJ', expiry: '2030-09-01', qty: '27' }] });
  const notes = sheetNotes(lines, initial, [stock('CE28D02', 27, '19I26JJ', '2030-09-19')], BINS).get(lines[0].key)!;
  assert.ok(notes.some((x) => x.text.startsWith('Batch 01I26JJ exp 2030-09-01 tidak ada di CE28D02: diambil dari batch 19I26JJ')));
  assert.ok(!notes.some((x) => x.text.includes('koreksi picklist')), 'no correction: the 27 are in the bin');
});

test('two other batches: the earliest expiry is taken first, the rest from the other batch; nothing invented', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1, quantity: 12 })]);
  edit(lines[0], { sources: [{ bin: 'CE28D02', batch: '01I26JJ', expiry: '2030-09-01', qty: '12' }] });
  const notes = sheetNotes(lines, initial, [stock('CE28D02', 10, '21I26JJ', '2030-09-21'), stock('CE28D02', 10, '19I26JJ', '2030-09-19')], BINS).get(lines[0].key)!;
  assert.ok(notes.some((x) => x.text.includes('diambil dari batch 19I26JJ exp 2030-09-19')));
  assert.ok(notes.some((x) => x.text.startsWith('2 diambil dari batch 21I26JJ')), '0062: the bin holds 20, the 2 come from 21I26JJ');
  assert.ok(!notes.some((x) => x.text.includes('koreksi picklist')));
});

test('the paper batch with another expiry: the bin\'s expiry is used; a bin without the SKU keeps the paper batch', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1, quantity: 5 }), task({ seq: 2, quantity: 3, from_bin: 'CF39A02' })]);
  edit(lines[0], { sources: [{ bin: 'CE28D02', batch: '05H26JJ', expiry: '2030-08-04', qty: '5' }] });
  const notes = sheetNotes(lines, initial, [stock('CE28D02', 20, '05H26JJ', '2030-08-05')], BINS);
  assert.ok(notes.get(lines[0].key)!.some((x) => x.text.includes('diambil dari batch 05H26JJ exp 2030-08-05')));
  assert.ok(!notes.get(lines[0].key)!.some((x) => x.text.includes('koreksi picklist')));
  assert.ok(notes.get(lines[1].key)!.some((x) => x.text.includes('CF39A02 batch 05H26JJ hanya 0, kertas 3: +3 koreksi picklist')));
});

test('7 Oct CD13A01: the pallet moved to the pickface further down the paper comes first; the short batch is filled from the other', () => {
  n = 0;
  const { lines, initial } = setup([
    task({ seq: 1, sku: '550048593', from_bin: 'CD13A01', batch_lot: '13H26JJ', expiry_date: '2030-08-13', quantity: 1 }),
    task({ seq: 2, sku: '550048593', from_bin: 'CF11D02', batch_lot: '21H26JJ', expiry_date: '2030-08-21', quantity: 35, breaks_pallet: true }),
    task({ seq: 3, sku: '550048593', task_type: 'REPLENISH', shipment_number: null, from_bin: 'CF11D02', to_bin: 'CD13A01', batch_lot: '21H26JJ', expiry_date: '2030-08-21', quantity: 13 }),
  ]);
  edit(lines[0], { sources: [{ bin: 'CD13A01', batch: '13H26JJ', expiry: '2030-08-13', qty: '31' }] });
  edit(lines[1], { sources: [{ bin: 'CF11E01', batch: '21H26JJ', expiry: '2030-08-21', qty: '5' }], moveTo: 'CD13A01', moveQty: '43' });
  const stockNow = [stock('CD13A01', 1, '13H26JJ', '2030-08-13', '550048593'), stock('CF11E01', 48, '21H26JJ', '2030-08-21', '550048593')];
  const notes = sheetNotes(lines, initial, stockNow, new Set([...BINS, 'CD13A01', 'CF11E01', 'CF11D02']));
  const first = notes.get(lines[0].key)!;
  assert.ok(first.some((x) => x.text.startsWith('Bin To Bin #2 di lembar ini membawa 43 ke CD13A01')), first.map((x) => x.text).join(' | '));
  assert.ok(first.some((x) => x.text.startsWith('30 diambil dari batch 21H26JJ')));
  assert.ok(![...notes.values()].flat().some((x) => x.text.includes('koreksi picklist')), 'nothing invented: 1 + 48 covers 31 + 5 + 43');
});

test('a bin really short over all its batches: only what the whole bin lacks is a correction', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1, quantity: 8 })]);
  edit(lines[0], { sources: [{ bin: 'CE28D02', batch: '19I26JJ', expiry: '2030-09-19', qty: '8' }] });
  const notes = sheetNotes(lines, initial, [stock('CE28D02', 3, '19I26JJ', '2030-09-19'), stock('CE28D02', 2, '21I26JJ', '2030-09-21')], BINS).get(lines[0].key)!;
  assert.ok(notes.some((x) => x.text.startsWith('2 diambil dari batch 21I26JJ')));
  assert.ok(notes.some((x) => x.text.includes('hanya 5, kertas 8: +3 koreksi picklist')), notes.map((x) => x.text).join(' | '));
});

test('summary counts what will happen', () => {
  n = 0;
  const { lines, initial } = setup([task({ seq: 1 }), task({ seq: 2, quantity: 5 }), task({ seq: 3, from_bin: 'CF39A02' })]);
  edit(lines[1], { sources: [{ ...lines[1].sources[0], qty: '4' }] });
  lines[2].done = false;
  const notes = sheetNotes(lines, initial, [stock('CE28D02', 44)], BINS);
  const s = sheetSummary(lines, initial, notes);
  assert.deepEqual({ send: s.send, asPlanned: s.asPlanned, changed: s.changed, left: s.left, errors: s.errors }, { send: 2, asPlanned: 1, changed: 1, left: 1, errors: 0 });
});

// 12 Oct NO 6 #1: CB11C01 (level C) held one pallet of 48; plan pick 35 + Bin To Bin 13 to the pickface.
// The paper said 32 and the sisa was left at 13: 3 phantom cartons stayed at CB11C01, and the pickface
// booked +3 as a koreksi picklist when its 3 extra cartons were picked.
const cb11 = () => {
  n = 0;
  return setup([
    task({ seq: 1, sku: '550044709', from_bin: 'CB11C01', batch_lot: '20I26JJ', expiry_date: '2030-09-20', quantity: 35, upp: 48, breaks_pallet: true }),
    task({ seq: 2, sku: '550044709', task_type: 'REPLENISH', shipment_number: null, from_bin: 'CB11C01', to_bin: 'CB08A02', batch_lot: '20I26JJ', expiry_date: '2030-09-20', quantity: 13, upp: 48 }),
  ]);
};
const cb11Stock = [stock('CB11C01', 48, '20I26JJ', '2030-09-20', '550044709')];
const cb11Bins = new Set(['CB11C01', 'CB08A02', 'CB11D01']);

test('12 Oct CB11C01: a lower pick moves its cartons with the sisa, so the opened pallet still ends empty', () => {
  const { lines, initial } = cb11();
  const l = lines[0];
  assert.equal(followPick(l, initial.get(l.key)!, '32'), '16');
  assert.equal(followPick(l, initial.get(l.key)!, '40'), '8');
  // Taken whole: nothing left to move, the sisa is not invented.
  assert.equal(followPick(l, initial.get(l.key)!, '48'), '13');
  // Not a number yet (being typed): the sisa stays.
  assert.equal(followPick(l, initial.get(l.key)!, ''), '13');
});

test('a sisa the paper already changed is not overwritten by the pick', () => {
  const { lines, initial } = cb11();
  const l = lines[0];
  edit(l, { moveQty: '16' });
  assert.equal(followPick(l, initial.get(l.key)!, '32'), '16');
  // A line without a Bin To Bin has nothing to follow.
  n = 0;
  const plain = setup([task({ seq: 1 })]);
  assert.equal(followPick(plain.lines[0], plain.initial.get(plain.lines[0].key)!, '4'), '');
});

test('12 Oct CB11C01: a reserve pallet left with loose cartons after pick + Bin To Bin is a warning that names the sisa', () => {
  const { lines, initial } = cb11();
  edit(lines[0], { sources: [{ ...lines[0].sources[0], qty: '32' }] });
  const notes = sheetNotes(lines, initial, cb11Stock, cb11Bins).get(lines[0].key)!;
  const w = notes.find((x) => x.text.includes('masih 3'));
  assert.ok(w && w.tone === 'warn', notes.map((x) => x.text).join(' | '));
  assert.ok(w.text.includes('CB11C01') && w.text.includes('level C') && w.text.includes('Sisa 16?'), w.text);
  // With the sisa following the pick, the pallet ends at 0 and nothing is said.
  edit(lines[0], { moveQty: '16' });
  const ok = sheetNotes(lines, initial, cb11Stock, cb11Bins).get(lines[0].key)!;
  assert.ok(!ok.some((x) => x.text.includes('masih')), ok.map((x) => x.text).join(' | '));
});

test('Pecah: the cartons short of the plan become a second bin on the line, the sisa back to the plan', () => {
  const { lines, initial } = cb11();
  const l = lines[0];
  const init = initial.get(l.key)!;
  // Nothing short: no Pecah.
  assert.equal(pecahLine(l, init), null);
  // 32 typed (the sisa followed to 16), then Pecah: 32 here + 3 from a bin still to type, sisa 13 as planned.
  edit(l, { sources: [{ ...l.sources[0], qty: '32' }], moveQty: followPick(l, init, '32') });
  assert.equal(l.moveQty, '16');
  const p = pecahLine(l, init)!;
  assert.deepEqual(p.sources.map((s) => [s.bin, s.batch, s.qty]), [['CB11C01', '20I26JJ', '32'], ['', '20I26JJ', '3']]);
  assert.equal(p.moveQty, '13');
  assert.equal(l.sources.length, 1, 'pecahLine returns a copy');
  // A sisa typed apart from the pick (paper says 20) is kept.
  edit(l, { moveQty: '20' });
  assert.equal(pecahLine(l, init)!.moveQty, '20');
  // The second bin is still to be typed: the line cannot post until it is.
  edit(l, { moveQty: '13' });
  const notes = sheetNotes([p], initial, cb11Stock, cb11Bins).get(l.key)!;
  assert.ok(notes.some((x) => x.tone === 'bad' && x.text === 'Isi kode bin.'), notes.map((x) => x.text).join(' | '));
});

test('Pecah posts as one line from two bins: no order raised, no leftover at the pallet', () => {
  const { lines, initial } = cb11();
  const l = lines[0];
  const p = pecahLine(Object.assign(l, { sources: [{ ...l.sources[0], qty: '32' }] }), initial.get(l.key)!)!;
  p.sources[1] = { bin: 'CB11D01', batch: '20I26JJ', expiry: '2030-09-20', qty: '3' };
  // The pallet held 45 (32 for the truck + 13 down); CB11D01 has the 3.
  const st = [stock('CB11C01', 45, '20I26JJ', '2030-09-20', '550044709'), stock('CB11D01', 48, '20I26JJ', '2030-09-20', '550044709')];
  const notes = sheetNotes([p], initial, st, cb11Bins).get(l.key)!;
  assert.ok(!notes.some((x) => x.tone === 'bad' || x.text.includes('koreksi') || x.text.includes('masih')), notes.map((x) => x.text).join(' | '));
  assert.ok(notes.some((x) => x.text === 'Dari 2 bin: baris dipecah.'));
  const [row] = sheetPayload([p], initial);
  assert.deepEqual(row.sources.map((s) => [s.bin, s.qty]), [['CB11C01', 32], ['CB11D01', 3]]);
  assert.equal(row.move_qty, 13);
});

test('no leftover warning when a later line of the paper takes the rest, or the source is a level A pickface', () => {
  n = 0;
  const later = setup([
    task({ seq: 1, sku: '550044709', from_bin: 'CB11C01', batch_lot: '20I26JJ', expiry_date: '2030-09-20', quantity: 30, upp: 48, breaks_pallet: true }),
    task({ seq: 2, sku: '550044709', task_type: 'REPLENISH', shipment_number: null, from_bin: 'CB11C01', to_bin: 'CB08A02', batch_lot: '20I26JJ', expiry_date: '2030-09-20', quantity: 13, upp: 48 }),
    task({ seq: 3, sku: '550044709', from_bin: 'CB11C01', batch_lot: '20I26JJ', expiry_date: '2030-09-20', quantity: 5, upp: 48, shipment_number: 'SH2' }),
  ]);
  const a = sheetNotes(later.lines, later.initial, cb11Stock, cb11Bins).get(later.lines[0].key)!;
  assert.ok(!a.some((x) => x.text.includes('masih')), a.map((x) => x.text).join(' | '));

  n = 0;
  const pf = setup([
    task({ seq: 1, from_bin: 'CE30A02', quantity: 10, breaks_pallet: true }),
    task({ seq: 2, task_type: 'REPLENISH', shipment_number: null, from_bin: 'CE30A02', to_bin: 'CE10A02', quantity: 20 }),
  ]);
  const b = sheetNotes(pf.lines, pf.initial, [stock('CE30A02', 44)], BINS).get(pf.lines[0].key)!;
  assert.ok(!b.some((x) => x.text.includes('masih')), b.map((x) => x.text).join(' | '));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
