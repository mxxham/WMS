/**
 * Pickface-full overflow (allocator.ts relocateByWaveOrder): when a sealed
 * pallet is broken away from the pickface while the pickface is already at or
 * above target — e.g. breaking a Level-E bulk pallet while Level-A holds a
 * full pallet — the leftover goes to the nearest empty Level-A bin as a
 * one-time move instead of stranding at the source (`tetap di bin`), also
 * when the pallet is opened by an earlier line of the day (later picks of
 * that batch follow it) or the SKU has no pickface. A pallet already on
 * Level A stays. The overflow slot is never registered as a dedicated pickface.
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
const bin = (location: string, sku: string, qty: number, batch = 'B', expiry = '2030-09-04T00:00:00Z', upp = 4): StockBin => ({
  binId: `${location}|${sku}|${batch}`, location, aisle: location.slice(0, 2), bay: parseInt(location.slice(2, 4)),
  level: location.slice(4, 5), position: parseInt(location.slice(5, 7)), sku, description: sku, batch,
  expiryDate: new Date(expiry), grDate: null, qtyCartons: qty, upp, uom: 'CAR', isFullPallet: qty === upp,
});
const order = (sku: string, qty: number, ship = 'SH1', wave = '1', slot = '01:00'): DemandLine => ({ shipmentNumber: ship, waveNo: wave, orderNos: ['O1'], sku, description: sku, qtyCartons: qty,
  upp: 4, destination: '', shipToLocation: '', transport: null, truckType: null, slotTime: slot, deliveryDate: null });
const config = withConfig({ asOf: new Date('2026-09-25T00:00:00Z') });

const S = '550049045';
// Bulk pallet at Level E with the EARLIEST expiry, so FEFO picks it while the
// Level-A pickface (later expiry, full pallet) stays untouched.
const stockFull = [
  bin('CE13E02', S, 4, 'B1', '2030-09-04T00:00:00Z'),
  bin('CE13A01', S, 4, 'B2', '2030-12-01T00:00:00Z'),
];

console.log('\nPickface-full overflow');

test('pickface full + break at Level E -> leftover overflows to nearest empty Level-A (same bay)', () => {
  const pfs = derivePickfaces(stockFull, config);
  assert.equal(pfs.get(S)!.location, 'CE13A01');
  const res = allocate(stockFull, [order(S, 1)], config);
  relocateByWaveOrder(res.lines, pfs, config, stockFull);
  const l = res.lines[0];
  assert.equal(l.location, 'CE13E02');
  assert.equal(l.breaksPallet, true);
  assert.equal(l.moveTo, 'CE13A02');
  assert.equal(l.moveQty, 3);
  assert.equal(binToBin(l), 'CE13A02');
});

test('overflow slot is not registered as a dedicated pickface', () => {
  const pfs = derivePickfaces(stockFull, config);
  const res = allocate(stockFull, [order(S, 1)], config);
  relocateByWaveOrder(res.lines, pfs, config, stockFull);
  assert.equal(pfs.get(S)!.location, 'CE13A01');
  assert.equal(pfs.size, 1);
});

test('pickface below target -> old path unchanged (leftover to the pickface)', () => {
  const stock = [
    bin('CE13E02', S, 4, 'B1', '2030-09-04T00:00:00Z'),
    bin('CE13A01', S, 2, 'B2', '2030-12-01T00:00:00Z'),
  ];
  const pfs = derivePickfaces(stock, config);
  const res = allocate(stock, [order(S, 1)], config);
  relocateByWaveOrder(res.lines, pfs, config, stock);
  const l = res.lines[0];
  assert.equal(l.breaksPallet, true);
  assert.equal(l.moveTo, 'CE13A01');
  assert.equal(l.moveQty, 3);
});

test('no empty Level-A anywhere -> falls back to tetap di bin', () => {
  const stock = [
    bin('CE13E02', S, 4, 'B1', '2030-09-04T00:00:00Z'),
    bin('CE13A01', S, 4, 'B2', '2030-12-01T00:00:00Z'),
    bin('CE13A02', 'OTHER', 2),
  ];
  const pfs = derivePickfaces(stock, config);
  const res = allocate(stock, [order(S, 1)], config);
  relocateByWaveOrder(res.lines, pfs, config, stock);
  const l = res.lines.find((x) => x.sku === S)!;
  assert.equal(l.breaksPallet, true);
  assert.equal(l.moveTo, null);
  assert.equal(binToBin(l), 'tetap di bin');
});

test('two picks from one pallet: it stays for the later pick, whose rest then comes down', () => {
  const res = allocate(stockFull, [order(S, 1, 'SH1', '1', '01:00'), order(S, 2, 'SH2', '2', '02:00')], config);
  const pfs = derivePickfaces(stockFull, config);
  relocateByWaveOrder(res.lines, pfs, config, stockFull);
  const first = res.lines.find((x) => x.shipmentNumber === 'SH1')!;
  const later = res.lines.find((x) => x.shipmentNumber === 'SH2')!;
  assert.equal(first.moveTo, null);
  assert.equal(first.qtyRemainingInBin, 3);
  assert.equal(later.location, 'CE13E02');
  assert.equal(later.moveTo, 'CE13A02');
  assert.equal(later.moveQty, 1);
  assert.equal(later.qtyRemainingInBin, 0);
});

test('an already-opened reserve pallet (no *): the rest of the last pick comes down too', () => {
  // CB12E02 on 30 Sep: UPP 80, the bin already opened; here UPP 4 with 3 left, pick 2.
  const stock = [bin('CE13E02', S, 3, 'B1', '2030-09-04T00:00:00Z'), bin('CE13A01', S, 4, 'B2', '2030-12-01T00:00:00Z')];
  const pfs = derivePickfaces(stock, config);
  const res = allocate(stock, [order(S, 2)], config);
  relocateByWaveOrder(res.lines, pfs, config, stock);
  const l = res.lines.find((x) => x.sku === S)!;
  assert.equal(l.location, 'CE13E02');
  assert.equal(l.breaksPallet, false);
  assert.equal(l.moveTo, 'CE13A02');
  assert.equal(l.moveQty, 1);
});

test('already-opened pallet, pickface below target: the rest goes to the pickface', () => {
  const stock = [bin('CE13E02', S, 3, 'B1', '2030-09-04T00:00:00Z'), bin('CE13A01', S, 2, 'B2', '2030-12-01T00:00:00Z')];
  const pfs = derivePickfaces(stock, config);
  const res = allocate(stock, [order(S, 2)], config);
  relocateByWaveOrder(res.lines, pfs, config, stock);
  const l = res.lines.find((x) => x.sku === S && x.location === 'CE13E02')!;
  assert.equal(l.moveTo, 'CE13A01');
  assert.equal(l.moveQty, 1);
});

test('SKU without a pickface: the rest still comes down to Level A', () => {
  const stock = [bin('CE13E02', S, 4, 'B1', '2030-09-04T00:00:00Z'), bin('CE13A01', 'OTHER', 2)];
  const res = allocate(stock, [order(S, 1)], config);
  relocateByWaveOrder(res.lines, new Map(), config, stock);
  const l = res.lines.find((x) => x.sku === S)!;
  assert.equal(l.moveTo, 'CE13A02');
  assert.equal(l.moveQty, 3);
});

test('pallet already on Level A: stays in its bin', () => {
  const stock = [bin('CE13A02', S, 4, 'B1', '2030-09-04T00:00:00Z'), bin('CE13A01', S, 4, 'B2', '2030-12-01T00:00:00Z')];
  const pfs = derivePickfaces(stock, config);
  const res = allocate(stock, [order(S, 1)], config);
  relocateByWaveOrder(res.lines, pfs, config, stock);
  const l = res.lines.find((x) => x.sku === S)!;
  assert.equal(l.location, 'CE13A02');
  assert.equal(l.moveTo, null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
