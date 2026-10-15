/** Pick + pallet-leftover move shown as one wave row (lib/allocator/pair-moves.ts). */
import { strict as assert } from 'node:assert';
import { movesOfPicks, pairMoves } from '../lib/allocator/pair-moves';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPick + move pairs');

type Over = Partial<{ task_type: string; status: string; from_bin: string; batch_lot: string; expiry_date: string;
  actual_from_bin: string | null; actual_batch_lot: string | null; actual_expiry_date: string | null }>;
const t = (id: string, seq: number, o: Over = {}) => ({
  id, wave_id: 'w', seq, task_type: 'PICK', status: 'PLANNED', from_bin: 'CD22E02', sku: '550069888', batch_lot: '18I26JJ',
  expiry_date: '2030-09-18', actual_from_bin: null as string | null, actual_batch_lot: null as string | null,
  actual_expiry_date: null as string | null, ...o,
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

// Final review C1: a line taken from two bins. split_task (0067) puts the second piece after the move.
const done = { status: 'COMPLETED' };
test('two sources, split after the move: pick + move one row, the second piece its own row', () => {
  assert.deepEqual(shape(pairMoves([
    t('p', 1, { ...done, actual_from_bin: 'CB34D02', actual_batch_lot: '18I26JJ', actual_expiry_date: '2030-09-18' }),
    t('m', 2, { ...done, task_type: 'REPLENISH', actual_from_bin: 'CB34D02' }),
    t('n', 3, { ...done, actual_from_bin: 'CB33E02', actual_batch_lot: 'P12', actual_expiry_date: '2030-09-12' }),
  ].map((x) => ({ ...x, from_bin: 'CB34D02' })))), ['p+m', 'n']);
});
test('posted: paired by where it really came from, not by the plan (old layout: piece between pick and move)', () => {
  // n keeps p's planned bin but was taken from CB33E02: never the move's pick.
  assert.deepEqual(shape(pairMoves([
    t('p', 1, { ...done, from_bin: 'CB34D02', actual_from_bin: 'CB34D02' }),
    t('n', 2, { ...done, from_bin: 'CB34D02', actual_from_bin: 'CB33E02', actual_batch_lot: 'P12', actual_expiry_date: '2030-09-12' }),
    t('m', 3, { ...done, from_bin: 'CB34D02', task_type: 'REPLENISH', actual_from_bin: 'CB34D02' }),
  ])), ['p', 'n', 'm']);
});
test('posted from another bin than planned: pick and its move (both there) still pair', () => {
  assert.deepEqual(shape(pairMoves([
    t('p', 1, { ...done, actual_from_bin: 'CD22E01', actual_batch_lot: 'X', actual_expiry_date: '2030-10-01' }),
    t('m', 2, { ...done, task_type: 'REPLENISH', actual_from_bin: 'CD22E01', actual_batch_lot: 'X', actual_expiry_date: '2030-10-01' }),
  ])), ['p+m']);
  assert.deepEqual(shape(pairMoves([
    t('p', 1, { ...done, actual_from_bin: 'CD22E01' }),
    t('m', 2, { ...done, task_type: 'REPLENISH', actual_from_bin: 'CD22E02' }),
  ])), ['p', 'm']);
});
test('planned tasks ignore actual fields (none yet): same rows as before', () => {
  assert.deepEqual(shape(pairMoves([t('p', 1), t('m', 2, { task_type: 'REPLENISH' }), t('n', 3)])), ['p+m', 'n']);
});
// 0073: the relokasi posted alone to unblock another wave splits the row (one PLANNED pick, one
// COMPLETED move). anyState finds that pair anyway, so the page can refuse to cancel the pick.
test('0073: a half-posted pair is two rows on the page, but anyState still finds the move', () => {
  const rows = [
    t('p', 1),
    t('m', 2, { task_type: 'REPLENISH', status: 'COMPLETED', actual_from_bin: 'CB25D01', actual_batch_lot: '18I26JJ', actual_expiry_date: '2030-09-18' }),
  ];
  assert.deepEqual(shape(pairMoves(rows)), ['p', 'm']);
  const moveOf = movesOfPicks(rows, { anyState: true });
  assert.equal(moveOf.get('p')?.id, 'm');
  assert.equal(moveOf.get('m'), undefined);
  // A cancelled task is never its pick's move, in any state.
  assert.equal(movesOfPicks([...rows, t('x', 3, { status: 'CANCELLED' })], { anyState: true }).get('p')?.id, 'm');
  assert.equal(movesOfPicks([t('p', 1, { status: 'CANCELLED' }), t('m', 2, { task_type: 'REPLENISH' })], { anyState: true }).size, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
