/** Pick + pallet-leftover move shown as one wave row (lib/allocator/pair-moves.ts). */
import { strict as assert } from 'node:assert';
import { pairMoves } from '../lib/allocator/pair-moves';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPick + move pairs');

const t = (id: string, seq: number, o: Partial<{ task_type: string; status: string; from_bin: string; batch_lot: string }> = {}) => ({
  id, wave_id: 'w', seq, task_type: 'PICK', status: 'PLANNED', from_bin: 'CD22E02', sku: '550069888', batch_lot: '18I26JJ',
  expiry_date: '2030-09-18', ...o,
});
const shape = (items: ReturnType<typeof pairMoves>) => items.map((x) => (x.kind === 'pair' ? `${x.pick.id}+${x.move.id}` : x.task.id));

test('NO 11: pick 30 + move 6 from CD22E02 become one row, the rest stay single', () => {
  assert.deepEqual(shape(pairMoves([
    t('1', 1, { from_bin: 'CD09A02' }), t('2', 2), t('3', 3, { task_type: 'REPLENISH' }), t('4', 4, { from_bin: 'CA19C01' }),
  ])), ['1', '2+3', '4']);
});
test('older plans put the move before the pick', () => {
  assert.deepEqual(shape(pairMoves([t('m', 1, { task_type: 'REPLENISH' }), t('p', 2)])), ['p+m']);
});
test('another bin or batch is not the same pallet', () => {
  assert.deepEqual(shape(pairMoves([t('p', 1), t('m', 2, { task_type: 'REPLENISH', from_bin: 'CD22E01' })])), ['p', 'm']);
  assert.deepEqual(shape(pairMoves([t('p', 1), t('m', 2, { task_type: 'REPLENISH', batch_lot: 'X' })])), ['p', 'm']);
});
test('a half-posted or cancelled pair is shown as two rows', () => {
  assert.deepEqual(shape(pairMoves([t('p', 1, { status: 'COMPLETED' }), t('m', 2, { task_type: 'REPLENISH' })])), ['p', 'm']);
  assert.deepEqual(shape(pairMoves([t('p', 1, { status: 'CANCELLED' }), t('m', 2, { task_type: 'REPLENISH', status: 'CANCELLED' })])), ['p', 'm']);
});
test('both posted stay paired', () => {
  assert.deepEqual(shape(pairMoves([t('p', 1, { status: 'COMPLETED' }), t('m', 2, { task_type: 'REPLENISH', status: 'COMPLETED' })])), ['p+m']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
