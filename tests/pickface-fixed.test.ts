/** Fixed pickfaces (config.pickfaceOverrides, stored in the pickfaces table, 0009). */
import { strict as assert } from 'node:assert';
import { withConfig } from '../lib/allocator/config';
import { derivePickfaces } from '../lib/allocator/pickface';
import { parseLocation } from '../lib/allocator/pickpath';
import type { StockBin } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const bin = (location: string, sku: string, qty: number): StockBin => {
  const p = parseLocation(location)!;
  return { binId: `${location}|${sku}|B`, location, aisle: p.aisle, bay: p.bay, level: p.level, position: p.position,
    sku, description: sku, batch: 'B', expiryDate: new Date('2031-01-01T00:00:00Z'), grDate: null,
    qtyCartons: qty, upp: 48, uom: 'CAR', isFullPallet: qty === 48 };
};
console.log('\nFixed pickfaces');

test('a fixed pickface wins over the automatic choice', () => {
  const stock = [bin('CA01A01', 'X', 10), bin('CA05C01', 'X', 48)];
  const pf = derivePickfaces(stock, withConfig({ pickfaceOverrides: { X: 'ca09a02' } })).get('X')!;
  assert.deepEqual([pf.location, pf.isAuto], ['CA09A02', false]);
});

test("another SKU's fixed bin is never auto-chosen, even when this SKU sits in it", () => {
  // X's only level-A stock is in CA01A01, which is Y's fixed pickface -> X falls to its next level-A bin.
  const stock = [bin('CA01A01', 'X', 5), bin('CA02A01', 'X', 20), bin('CA03A01', 'Y', 4)];
  const pf = derivePickfaces(stock, withConfig({ pickfaceOverrides: { Y: 'CA01A01' } }));
  assert.equal(pf.get('X')!.location, 'CA02A01');
  assert.equal(pf.get('Y')!.location, 'CA01A01');
});

test('a synthetic pickface (no level-A stock) skips empty bins fixed for other SKUs', () => {
  // X only in bulk at bay CA04; CA04A01 is fixed for Y (empty) -> X gets CA04A02.
  const stock = [bin('CA04C01', 'X', 48), bin('CA10A01', 'Y', 3)];
  const pf = derivePickfaces(stock, withConfig({ pickfaceOverrides: { Y: 'CA04A01' } }));
  assert.equal(pf.get('X')!.location, 'CA04A02');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
