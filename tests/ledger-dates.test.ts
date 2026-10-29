/** Buku stok date rules (lib/ledger/dates.ts): Jakarta calendar days. */
import { strict as assert } from 'node:assert';
import { addDays, isWaiting, jakartaDay, monthDays, monthOf } from '../lib/ledger/dates';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nBuku stok: dates');

test('jakartaDay: 23:30 UTC is already the next day in Jakarta', () =>
  assert.equal(jakartaDay(new Date('2026-10-27T23:30:00Z')), '2026-10-28'));
test('jakartaDay: 16:59 UTC is still the same day', () =>
  assert.equal(jakartaDay(new Date('2026-10-27T16:59:00Z')), '2026-10-27'));
test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
});
test('a day waits for its putaway until the next day is over', () => {
  assert.equal(isWaiting('2026-10-27', '2026-10-27'), true);
  assert.equal(isWaiting('2026-10-27', '2026-10-28'), true, 'the putaway of the 27th is entered on the 28th');
  assert.equal(isWaiting('2026-10-27', '2026-10-29'), false);
});
test('monthDays lists every day of the month', () => {
  const d = monthDays('2026-02');
  assert.equal(d.length, 28);
  assert.deepEqual([d[0], d[27]], ['2026-02-01', '2026-02-28']);
});
test('monthOf rejects anything but YYYY-MM and falls back to the given day', () => {
  assert.equal(monthOf('2026-09', '2026-10-28'), '2026-09');
  assert.equal(monthOf('2026-9', '2026-10-28'), '2026-10');
  assert.equal(monthOf(undefined, '2026-10-28'), '2026-10');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
