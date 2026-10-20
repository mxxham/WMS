/**
 * A split line (pick, its Bin To Bin, the split piece) reprints its Bin To Bin
 * once, on the pick: sisaFromTasks pairs like pairMoves (residual N1).
 */
import { strict as assert } from 'node:assert';
import { picklistsFromTasks, restNotesFromTasks, sisaFromTasks, type StockNow, type TaskRow, type WaveRow } from '../lib/allocator/picklist-from-tasks';
import { pairMoves } from '../lib/allocator/pair-moves';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nSplit line: Bin To Bin listed once');

const waves: WaveRow[] = [{ id: 'w', wave_no: '1', planned_date: '2026-11-09', shipment_numbers: ['SH9'], truck: null,
  destination: 'X', planned_slot: '08:00', status: 'PENDING' }];
const task = (id: string, seq: number, o: Partial<TaskRow> = {}): TaskRow => ({
  id, wave_id: 'w', wave_no: '1', planned_slot: '08:00', shipment_number: 'SH9', task_type: 'PICK', seq, status: 'PLANNED',
  sku: '550070614', description: 'HX7', uom: 'CAR', upp: 36, from_bin: 'CC06A01', to_bin: null, batch_lot: 'P11',
  expiry_date: '2030-09-11', quantity: 0, pick_type: 'CASE', breaks_pallet: false, completed_at: null, completed_by_name: null,
  actual_quantity: null, actual_from_bin: null, actual_batch_lot: null, actual_expiry_date: null, deviation_reason: null, ...o,
});
const moveRows = (pls: ReturnType<typeof picklistsFromTasks>) =>
  pls.flatMap((pl) => pl.lines).filter((l) => l.moveQty > 0).map((l) => `${l.location}:${l.qtyPick}:${l.moveQty}>${l.moveTo}`);
const shape = (items: ReturnType<typeof pairMoves>) => items.map((x) => (x.kind === 'pair' ? `${x.pick.id}+${x.move.id}` : x.task.id));

// Supervisor Pecah of a planned breaking pick: 36 on the pallet, pick 13 split 10 + 3, the rest 23 to the pickface.
const pecah = [
  task('p', 1, { quantity: 10 }),
  task('m', 2, { task_type: 'REPLENISH', shipment_number: null, to_bin: 'CC06A02', quantity: 23, breaks_pallet: true }),
  task('n', 3, { quantity: 3 }),
];
const pecahStock: StockNow[] = [{ bin_code: 'CC06A01', sku: '550070614', batch_lot: 'P11', expiry_date: '2030-09-11', quantity: 36 }];

test('Pecah of a planned breaking pick: the move is on the pick only', () => {
  const s = sisaFromTasks(waves, pecah, pecahStock);
  assert.deepEqual(s.get('p'), { sisa: 3, moveQty: 23, moveTo: 'CC06A02', restNote: null });
  assert.equal(s.get('n')?.moveQty, 0);
  assert.equal(s.get('n')?.moveTo, null);
  assert.equal(s.get('n')?.sisa, 0);
});
test('Pecah: the reprinted picklist lists the Bin To Bin once, same rows as the wave page', () => {
  assert.deepEqual(moveRows(picklistsFromTasks(waves, pecah, [], pecahStock)), ['CC06A01:10:23>CC06A02']);
  assert.deepEqual(shape(pairMoves(pecah)), ['p+m', 'n']);
});

// Posted two-source line: 10 from CC06A01 (rest 26 to the pickface), 3 from CC07A01 (another pallet, P12).
const posted = { status: 'COMPLETED' as const, completed_at: '2026-11-09T01:00:00Z' };
const twoSource = [
  task('p', 1, { ...posted, quantity: 13, breaks_pallet: true, actual_quantity: 10, actual_from_bin: 'CC06A01', actual_batch_lot: 'P11', actual_expiry_date: '2030-09-11' }),
  task('m', 2, { ...posted, task_type: 'REPLENISH', shipment_number: null, to_bin: 'CC06A02', quantity: 26, breaks_pallet: true,
    actual_quantity: 26, actual_from_bin: 'CC06A01', actual_batch_lot: 'P11', actual_expiry_date: '2030-09-11' }),
  task('n', 3, { ...posted, quantity: 3, actual_quantity: 3, actual_from_bin: 'CC07A01', actual_batch_lot: 'P12', actual_expiry_date: '2030-09-12' }),
];
const twoSourceStock: StockNow[] = [
  { bin_code: 'CC07A01', sku: '550070614', batch_lot: 'P12', expiry_date: '2030-09-12', quantity: 33 },
  { bin_code: 'CC06A02', sku: '550070614', batch_lot: 'P11', expiry_date: '2030-09-11', quantity: 26 },
];
test('posted two-source line: the CC07A01 piece carries no Bin To Bin', () => {
  const s = sisaFromTasks(waves, twoSource, twoSourceStock);
  assert.deepEqual(s.get('p'), { sisa: 0, moveQty: 26, moveTo: 'CC06A02', restNote: null });
  assert.equal(s.get('n')?.moveQty, 0);
  assert.equal(s.get('n')?.moveTo, null);
  assert.equal(s.get('n')?.sisa, 33);
});
test('posted two-source line: the reprint lists the Bin To Bin once, on the pick, as the wave page pairs it', () => {
  assert.deepEqual(moveRows(picklistsFromTasks(waves, twoSource, [], twoSourceStock)), ['CC06A01:13:26>CC06A02']);
  assert.deepEqual(shape(pairMoves(twoSource)), ['p+m', 'n']);
});
test('the wave page rest notes treat only the pick as owning the move', () => {
  assert.equal(restNotesFromTasks(waves, twoSource).has('p'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
