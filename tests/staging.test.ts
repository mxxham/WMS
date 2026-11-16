/** The Staging page's rules (0134): how long a line has waited, what may move, the confirmation sentence. */
import { strict as assert } from 'node:assert';
import { STAGING_LONG_DAYS, isLong, movable, moveSentence, waitLabel, type StagingLine } from '../lib/staging';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const line = (over: Partial<StagingLine> = {}): StagingLine => ({
  bin_code: 'STAGING', item_id: 'i1', sku: '550046498', description: 'Drum', uom: 'EA', batch_lot: '12718466',
  expiry_date: '2029-03-01', quantity: 20, reserved: 0, arrival_date: '2026-11-03', days_waiting: 6, ...over,
});
console.log('\nStaging');

test('waiting label', () => {
  assert.equal(waitLabel(null), 'tanggal datang tidak diketahui');
  assert.equal(waitLabel(0), 'hari ini');
  assert.equal(waitLabel(1), '1 hari');
  assert.equal(waitLabel(5), '5 hari');
});

test('waiting long is 3 days or more, the dashboard tally rule', () => {
  assert.equal(STAGING_LONG_DAYS, 3);
  assert.equal(isLong(2), false);
  assert.equal(isLong(3), true);
  assert.equal(isLong(null), false);
});

test('only the part no wave reserved can move', () => {
  assert.equal(movable(line({ quantity: 20, reserved: 8 })), 12);
  assert.equal(movable(line({ quantity: 4, reserved: 9 })), 0);
  assert.equal(movable(line()), 20);
});

test('confirmation sentence', () => {
  assert.equal(moveSentence(line(), 4, 'CB12A01'), 'Pindah 4 EA 550046498 dari STAGING ke CB12A01?');
  assert.equal(moveSentence(line(), 1200, 'CB12A01'), 'Pindah 1.200 EA 550046498 dari STAGING ke CB12A01?');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
