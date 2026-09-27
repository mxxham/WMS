/** Minimum days of life left to dispatch: global, overridden per SKU (item master). */
import { strict as assert } from 'node:assert';
import { withConfig } from '../lib/allocator/config';
import { allocate } from '../lib/allocator/allocator';
import { parseLocation } from '../lib/allocator/pickpath';
import type { DemandLine, StockBin } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const bin = (location: string, sku: string, qty: number, expiry: string): StockBin => {
  const p = parseLocation(location)!;
  return { binId: `${location}|${sku}|B`, location, aisle: p.aisle, bay: p.bay, level: p.level, position: p.position,
    sku, description: sku, batch: 'B' + expiry, expiryDate: new Date(`${expiry}T00:00:00Z`), grDate: null,
    qtyCartons: qty, upp: 10, uom: 'CAR', isFullPallet: false };
};
const demand = (sku: string, qty: number): DemandLine => ({ shipmentNumber: 'S1', waveNo: '1', orderNos: ['O1'], sku, description: sku,
  qtyCartons: qty, upp: 10, destination: 'D', shipToLocation: 'X', transport: null, truckType: null, slotTime: null, deliveryDate: null });
console.log('\nMinimum shelf life to dispatch');

// Both SKUs: 5 cartons expiring in 60 days, 5 in 400 days. asOf 2026-10-01.
const stock = ['X', 'Y'].flatMap((sku, i) => [bin(`CA0${i + 1}A01`, sku, 5, '2026-11-30'), bin(`CA0${i + 1}C01`, sku, 5, '2027-11-05')]);
const asOf = new Date('2026-10-01T00:00:00Z');

test('global minimum 0: FEFO takes the 60-day stock first', () => {
  const r = allocate(stock, [demand('X', 5)], withConfig({ asOf }));
  assert.deepEqual(r.lines.map((l) => l.location), ['CA01A01']);
});
test('a per-SKU minimum of 90 days refuses the 60-day stock for that SKU only', () => {
  const config = withConfig({ asOf, minRemainingShelfLifeDaysBySku: { X: 90 } });
  const r = allocate(stock, [demand('X', 5), demand('Y', 5)], config);
  assert.deepEqual(r.lines.map((l) => `${l.sku}@${l.location}`).sort(), ['X@CA01C01', 'Y@CA02A01']);
  assert.ok(r.warnings.some((w) => w.code === 'SHELF_LIFE_BLOCKED' && w.message.includes('CA01A01')));
});
test('the per-SKU value also lowers a global minimum', () => {
  const config = withConfig({ asOf, minRemainingShelfLifeDays: 90, minRemainingShelfLifeDaysBySku: { Y: 0 } });
  const r = allocate(stock, [demand('X', 5), demand('Y', 5)], config);
  assert.deepEqual(r.lines.map((l) => `${l.sku}@${l.location}`).sort(), ['X@CA01C01', 'Y@CA02A01']);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
