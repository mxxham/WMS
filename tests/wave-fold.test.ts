/** Folding finished lines on the Wave page (both layouts): a posted line must always stay reachable. */
import { strict as assert } from 'node:assert';
import { foldDone } from '../app/(app)/waves/wave-model';
import type { LineItem } from '../app/(app)/waves/line-menu';
import type { TaskRow } from '../lib/allocator/picklist-from-tasks';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nWave page: folded finished lines');

const line = (id: string, status: string): LineItem => ({ kind: 'single', task: { id, status } as TaskRow }) as LineItem;

test('every line posted on a running wave: nothing listed until shown, but the toggle is there', () => {
  const f = foldDone([line('a', 'COMPLETED'), line('b', 'COMPLETED')], false);
  assert.equal(f.listed.length, 0);
  assert.equal(f.doneCount, 2);
  assert.equal(f.toggle, true, 'no way to reach Batalkan posting / Riwayat of a posted line');
});
test('mixed: open lines listed, finished folded behind the toggle', () => {
  const f = foldDone([line('a', 'COMPLETED'), line('b', 'PLANNED')], false);
  assert.deepEqual(f.listed.map((it) => (it as { task: TaskRow }).task.id), ['b']);
  assert.equal(f.toggle, true);
});
test('shown: everything listed; nothing finished: no toggle', () => {
  assert.equal(foldDone([line('a', 'COMPLETED'), line('b', 'PLANNED')], true).listed.length, 2);
  assert.equal(foldDone([line('b', 'PLANNED')], false).toggle, false);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
