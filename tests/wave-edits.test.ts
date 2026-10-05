/**
 * Tambah item edits (lib/wave-edits.ts): the new rows follow the printed
 * picklist — any source, any Bin To Bin, a sisa that matches the new bin.
 * Guards: quantities, the move travelling with its pick, FEFO warned not
 * blocked, and nothing changed when nothing was edited.
 */
import { strict as assert } from 'node:assert';
import type { PlanTask } from '../lib/allocator/plan';
import { applyLineEdits, optionKey, OTHER_BIN, type BinOption } from '../lib/wave-edits';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const SKU = '550049044';
const task = (p: Partial<PlanTask>): PlanTask => ({
  wave_no: '8', shipment_number: '109694907', task_type: 'PICK', sku: SKU, from_bin: 'CD39E02', to_bin: null,
  batch_lot: '15I26JJ', expiry_date: '2030-09-15', quantity: 6, pick_type: 'CASE', breaks_pallet: true, seq: 1, ...p,
});
const opt = (location: string, batch: string, expiryDate: string, qtyCartons: number): BinOption =>
  ({ key: optionKey(location, batch, expiryDate), location, batch, expiryDate, qtyCartons });
// NO 8 #1: 6 from the CD39E02 pallet (44), the rest 38 to the pickface CC34A02.
const plan = [
  task({}),
  task({ task_type: 'REPLENISH', shipment_number: null, to_bin: 'CC34A02', quantity: 38, seq: 2 }),
  task({ sku: '550059938', from_bin: 'CD22A01', batch_lot: '05I26JJ', expiry_date: '2030-09-05', quantity: 33, breaks_pallet: false, seq: 3 }),
];
const options = new Map([[SKU, [
  opt('CD39E02', '15I26JJ', '2030-09-15', 44), opt('CD40E01', '15I26JJ', '2030-09-15', 20),
  opt('CE10A01', '20I26JJ', '2030-09-20', 48), opt('CC34A02', '15I26JJ', '2030-09-15', 4), opt('CB05A01', '15I26JJ', '2030-09-15', 4),
]]]);
const pickfaces = new Set([`${SKU}|CC34A02`]);

console.log('\nTambah item edits');

test('no edits: the plan exactly as the engine built it, nothing to log', () => {
  const r = applyLineEdits(plan, {}, options, pickfaces);
  assert.equal(r.changed, false);
  assert.equal(r.error, null);
  assert.deepEqual(r.tasks.map((t) => ({ ...t })), plan);
  assert.ok(r.tasks.every((t) => t.planned === undefined));
});

test('30 Sep NO 8 #1: Bin To Bin redirected to CC33A02, sisa stays 38, logged against CC34A02', () => {
  const r = applyLineEdits(plan, { 0: { moveTo: 'cc33a02' } }, options, pickfaces);
  assert.equal(r.error, null);
  const move = r.tasks[1];
  assert.equal(move.task_type, 'REPLENISH');
  assert.equal(move.from_bin, 'CD39E02');
  assert.equal(move.to_bin, 'CC33A02');
  assert.equal(move.quantity, 38);
  assert.equal(move.planned?.to_bin, 'CC34A02');
  assert.equal(r.tasks[0].planned, undefined, 'the pick itself did not change');
});

test('source moved to a smaller pallet: the move follows it and its sisa is that bin\'s rest (20 - 6 = 14), not 38', () => {
  const r = applyLineEdits(plan, { 0: { sourceKey: optionKey('CD40E01', '15I26JJ', '2030-09-15') } }, options, pickfaces);
  assert.equal(r.error, null);
  assert.equal(r.tasks[0].from_bin, 'CD40E01');
  assert.equal(r.tasks[0].quantity, 6);
  assert.equal(r.tasks[0].planned?.from_bin, 'CD39E02');
  assert.equal(r.tasks[1].from_bin, 'CD40E01');
  assert.equal(r.tasks[1].to_bin, 'CC34A02');
  assert.equal(r.tasks[1].quantity, 14);
});

test('a typed sisa wins over the computed one (the paper\'s number)', () => {
  const r = applyLineEdits(plan, { 0: { sourceKey: optionKey('CD40E01', '15I26JJ', '2030-09-15'), moveQty: '10' } }, options, pickfaces);
  assert.equal(r.tasks[1].quantity, 10);
});

test('a later expiry is allowed with a FEFO warning, batch and expiry travel with pick and move', () => {
  const r = applyLineEdits(plan, { 0: { sourceKey: optionKey('CE10A01', '20I26JJ', '2030-09-20') } }, options, pickfaces);
  assert.equal(r.error, null);
  assert.ok(r.lines.get(0)!.warnings.some((w) => w.startsWith('FEFO dilewati')));
  assert.deepEqual([r.tasks[0].batch_lot, r.tasks[0].expiry_date, r.tasks[1].batch_lot, r.tasks[1].quantity], ['20I26JJ', '2030-09-20', '20I26JJ', 42]);
});

test('source with no rest left: the move is dropped, the rows renumber, the pick logs the dropped destination', () => {
  const r = applyLineEdits(plan, { 0: { sourceKey: optionKey('CB05A01', '15I26JJ', '2030-09-15') } }, options, pickfaces);
  assert.equal(r.error, null);
  assert.deepEqual(r.tasks.map((t) => `${t.seq} ${t.task_type} ${t.from_bin}`), ['1 PICK CB05A01', '2 PICK CD22A01']);
  assert.equal(r.tasks[0].planned?.to_bin, 'CC34A02');
  assert.ok(r.lines.get(0)!.warnings.some((w) => w.includes('kurang 2')), 'a 4-carton bin for a 6-carton pick is warned');
});

test('a Bin To Bin added to a line the engine gave none, with the paper\'s sisa', () => {
  const r = applyLineEdits(plan, { 2: { moveTo: 'CD38A01', moveQty: '11' } }, options, pickfaces);
  assert.equal(r.error, null);
  assert.deepEqual(r.tasks.map((t) => `${t.seq} ${t.task_type} ${t.from_bin}${t.to_bin ? `->${t.to_bin}` : ''} ${t.quantity}`),
    ['1 PICK CD39E02 6', '2 REPLENISH CD39E02->CC34A02 38', '3 PICK CD22A01 33', '4 REPLENISH CD22A01->CD38A01 11']);
  assert.deepEqual(r.tasks[3].planned, { from_bin: null, to_bin: null, batch_lot: null, expiry_date: null, quantity: null });
});

test('an added Bin To Bin without a sisa is refused rather than silently dropped', () => {
  const r = applyLineEdits(plan, { 2: { moveTo: 'CD38A01' } }, options, pickfaces);
  assert.match(r.error ?? '', /#3: isi jumlah sisa/);
});

test('a typed bin outside planning stock keeps the plan\'s batch/expiry and is warned, not refused', () => {
  const r = applyLineEdits(plan, { 0: { sourceKey: OTHER_BIN, typedBin: 'cf19a01' } }, options, pickfaces);
  assert.equal(r.error, null);
  assert.deepEqual([r.tasks[0].from_bin, r.tasks[0].batch_lot, r.tasks[1].from_bin, r.tasks[1].quantity], ['CF19A01', '15I26JJ', 'CF19A01', 38]);
  assert.ok(r.lines.get(0)!.warnings.some((w) => w.includes('tidak ada di stok yang bisa dipick')));
});

test('a typed bin holding one row of the SKU takes that row\'s batch/expiry', () => {
  const r = applyLineEdits(plan, { 0: { sourceKey: OTHER_BIN, typedBin: 'CE10A01' } }, options, pickfaces);
  assert.deepEqual([r.tasks[0].batch_lot, r.tasks[0].expiry_date], ['20I26JJ', '2030-09-20']);
});

test('destination equal to the source, or not a bin code, blocks saving', () => {
  assert.match(applyLineEdits(plan, { 0: { moveTo: 'CD39E02' } }, options, pickfaces).error ?? '', /tidak boleh sama/);
  assert.match(applyLineEdits(plan, { 0: { moveTo: 'C-1' } }, options, pickfaces).error ?? '', /bukan format bin/);
});

test('a move out of the SKU\'s pickface is warned, not refused', () => {
  const r = applyLineEdits(plan, { 0: { sourceKey: optionKey('CC34A02', '15I26JJ', '2030-09-15'), moveTo: 'CB12A01', moveQty: '4' } }, options, pickfaces);
  assert.equal(r.error, null);
  assert.ok(r.lines.get(0)!.warnings.some((w) => w.includes('pickface')));
});

test('sisa 0 typed on a planned move drops it', () => {
  const r = applyLineEdits(plan, { 0: { moveQty: '0' } }, options, pickfaces);
  assert.deepEqual(r.tasks.map((t) => t.task_type), ['PICK', 'PICK']);
  assert.equal(r.changed, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
