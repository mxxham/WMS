import { strict as assert } from 'node:assert';
import { centuryFix } from '../lib/data-quality';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

test('1930 becomes 2030, month and day kept', () => {
  assert.equal(centuryFix('1930-10-28'), '2030-10-28');
  assert.equal(centuryFix('1930-11-11'), '2030-11-11');
});
test('timestamp suffix is tolerated', () => {
  assert.equal(centuryFix('1930-11-11T00:00:00'), '2030-11-11');
});
test('real years are left alone', () => {
  assert.equal(centuryFix('2026-11-11'), null);
  assert.equal(centuryFix('2030-01-01'), null);
});
test('empty or malformed input is null', () => {
  assert.equal(centuryFix(null), null);
  assert.equal(centuryFix(undefined), null);
  assert.equal(centuryFix(''), null);
  assert.equal(centuryFix('11 Nov 1930'), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
