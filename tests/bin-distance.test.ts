/** Nearest empty bin ordering (lib/bin-distance.ts). */
import { strict as assert } from 'node:assert';
import { binDistance, distanceLabel, parseBin } from '../lib/bin-distance';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nBin distance');

const at = parseBin('CD22E02')!;
test('parse a rack bin, not a floor location', () => {
  assert.deepEqual(parseBin('cd22e02'), { zone: 'CD', rack: '22', level: 'E', position: '02' });
  assert.equal(parseBin('STAGING'), null);
});
test('same aisle beats the next aisle, fewer racks beat more', () => {
  const order = ['CE22E02', 'CD30A01', 'CD22E01', 'CD23E02', 'CD22A02'].sort((a, b) => binDistance(at, parseBin(a)!) - binDistance(at, parseBin(b)!));
  assert.deepEqual(order, ['CD22E01', 'CD22A02', 'CD23E02', 'CD30A01', 'CE22E02']);
});
test('label', () => {
  assert.equal(distanceLabel(at, parseBin('CD24C02')!), 'lorong sama · 2 rak · 2 level');
  assert.equal(distanceLabel(at, parseBin('CE22E02')!), 'lorong CE · rak sama');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
