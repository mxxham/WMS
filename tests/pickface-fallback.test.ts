/**
 * Pickface fallback (pickface.ts): when every Level A slot in the bays that
 * hold a SKU's bulk is taken by other SKUs, the nearest free Level A slot on
 * the walking route becomes the pickface, so the rest of an opened pallet
 * still gets a Bin To Bin. 25 Sep 2026, SKU 550025057: bulk in CE25C01/02 and
 * CF05C01, all four Level A slots of CE25/CF05 held by other SKUs.
 */
import { strict as assert } from 'node:assert';
import { withConfig } from '../lib/allocator/config';
import { allocate, relocateByWaveOrder } from '../lib/allocator/allocator';
import { derivePickfaces } from '../lib/allocator/pickface';
import { binToBin } from '../lib/allocator/picklist';
import type { DemandLine, StockBin } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const bin = (location: string, sku: string, qty: number, upp = 4): StockBin => ({
  binId: `${location}|${sku}|B`, location, aisle: location.slice(0, 2), bay: parseInt(location.slice(2, 4)),
  level: location.slice(4, 5), position: parseInt(location.slice(5, 7)), sku, description: sku, batch: 'B',
  expiryDate: new Date('2030-09-12T00:00:00Z'), grDate: null, qtyCartons: qty, upp, uom: 'Drum', isFullPallet: qty === upp,
});
const order = (sku: string, qty: number): DemandLine => ({ shipmentNumber: 'SH1', waveNo: '1', orderNos: ['O1'], sku, description: sku, qtyCartons: qty,
  upp: 4, destination: '', shipToLocation: '', transport: null, truckType: null, slotTime: '01:00', deliveryDate: null });
const config = withConfig({ asOf: new Date('2026-09-25T00:00:00Z') });

const S = '550025057';
const neighbours = [bin('CE25A01', 'X1', 3), bin('CE25A02', 'X2', 1), bin('CF05A01', 'X3', 1), bin('CF05A02', 'X4', 1)];
const stock = [bin('CE25C01', S, 4), bin('CE25C02', S, 4), bin('CF05C01', S, 4), ...neighbours,
  bin('CE24B01', 'X5', 4), bin('CE26B01', 'X6', 4), bin('CE30B01', 'X7', 4)];

console.log('\nPickface fallback');

test('bulk bays full at Level A -> pickface on the nearest free Level A slot in the same lane', () => {
  const pf = derivePickfaces(stock, config).get(S);
  assert.ok(pf, 'a pickface is chosen');
  assert.ok(!neighbours.some((n) => n.location === pf!.location), `not on an occupied slot (${pf!.location})`);
  assert.match(pf!.location, /^CE(24|26)A0[12]$/, `next bay over in the same aisle, got ${pf!.location}`);
});

test('the opened pallet gets a Bin To Bin to that pickface', () => {
  const pfs = derivePickfaces(stock, config);
  const res = allocate(stock, [order(S, 1)], config);
  relocateByWaveOrder(res.lines, pfs, config, stock);
  const l = res.lines[0];
  assert.equal(l.breaksPallet, true);
  assert.equal(l.moveTo, pfs.get(S)!.location);
  assert.equal(l.moveQty, 3);
});

test('picking from the pickface itself: no move, the printout says the rest stays', () => {
  const s2 = [bin('CB22A01', 'D', 4), bin('CB22C01', 'D', 4)];
  const res = allocate(s2, [order('D', 1)], config);
  relocateByWaveOrder(res.lines, derivePickfaces(s2, config), config, s2);
  const l = res.lines.find((x) => x.location === 'CB22A01')!;
  assert.equal(l.breaksPallet, true);
  assert.equal(l.moveTo, null);
  assert.equal(binToBin(l), 'tetap di bin');
});

test('a whole-pallet pick without a break keeps the Bin To Bin column empty', () => {
  const res = allocate(stock, [order(S, 4)], config);
  relocateByWaveOrder(res.lines, derivePickfaces(stock, config), config, stock);
  assert.equal(binToBin(res.lines[0]), '');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
