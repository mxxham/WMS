/** Penugasan helpers: the confirmation sentences and which statuses can still be (re)assigned. */
import { strict as assert } from 'node:assert';
import { assignConfirm, canAssign, unassignConfirm } from '../lib/assign-board';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPenugasan helpers');

test('assignConfirm names the shipment and the operator', () => {
  assert.equal(assignConfirm('109717235', 'Budi'), 'Tugaskan shipment 109717235 ke Budi?');
});
test('unassignConfirm names the shipment and the operator', () => {
  assert.equal(unassignConfirm('109717235', 'Budi'), 'Lepas shipment 109717235 dari Budi?');
});
test('Belum and Dipicking can be assigned; Selesai and Dimuat cannot', () => {
  assert.equal(canAssign('Belum'), true);
  assert.equal(canAssign('Dipicking'), true);
  assert.equal(canAssign('Selesai'), false);
  assert.equal(canAssign('Dimuat'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
