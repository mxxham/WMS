/**
 * Per-line bin choice (allocator.ts): FEFO first, then full pallets, then the
 * loose rest from the pickface / one bin / open pallets. Guards what these
 * rules must never break: FEFO, pallets opened, quantities.
 */
import { strict as assert } from 'node:assert';
import { withConfig } from '../lib/allocator/config';
import { allocate, relocateByWaveOrder } from '../lib/allocator/allocator';
import { derivePickfaces } from '../lib/allocator/pickface';
import { sisaPrinted } from '../lib/allocator/picklist';
import { computeStockAfterMovements } from '../lib/allocator/ledger';
import type { DemandLine, StockBin } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const UPP = 48;
const bin = (location: string, batch: string, expiry: string, qty: number): StockBin => ({
  binId: `${location}|S|${batch}`, location, aisle: location.slice(0, 2), bay: parseInt(location.slice(2, 4)),
  level: location.slice(4, 5), position: parseInt(location.slice(5, 7)), sku: 'S', description: 'S', batch,
  expiryDate: new Date(`${expiry}T00:00:00Z`), grDate: null, qtyCartons: qty, upp: UPP, uom: 'CAR', isFullPallet: qty === UPP,
});
const order = (qty: number): DemandLine => ({ shipmentNumber: 'SH1', waveNo: '1', orderNos: ['O1'], sku: 'S', description: 'S', qtyCartons: qty,
  upp: UPP, destination: '', shipToLocation: '', transport: null, truckType: null, slotTime: '01:00', deliveryDate: null });
const config = withConfig({ asOf: new Date('2026-09-21T00:00:00Z'), pickfaceOverrides: { S: 'CD36A02' } });
function run(stock: StockBin[], qty: number) {
  const res = allocate(stock, [order(qty)], config);
  relocateByWaveOrder(res.lines, derivePickfaces(stock, config), config, stock);
  return res;
}
const rows = (res: ReturnType<typeof run>) => res.lines.map((l) => `${l.location} ${l.qtyPick}${l.breaksPallet ? ' buka' : ''}${l.moveTo ? ` ->${l.moveTo}` : ''} sisa ${sisaPrinted(l)}`);
console.log('\nOne order line, one bin when possible');

test('21 Sep case: pickface 11 + sealed pallet same batch, order 30 -> one row of 30, 18 carried, pickface ends at 29', () => {
  const stock = [bin('CD36A02', '20H26JJ', '2030-08-20', 11), bin('CE14D02', '20H26JJ', '2030-08-20', 48)];
  const res = run(stock, 30);
  assert.deepEqual(rows(res), ['CE14D02 30 buka ->CD36A02 sisa 18']);
  assert.equal(res.lines[0].moveQty, 18);
});

test('FEFO wins: pickface holds the OLDER batch -> it is used first, even if that means two rows', () => {
  const stock = [bin('CD36A02', 'OLD', '2030-01-01', 11), bin('CE14D02', 'NEW', '2030-08-20', 48)];
  const res = run(stock, 30);
  assert.equal(res.lines[0].location, 'CD36A02');
  assert.equal(res.lines[0].qtyPick, 11);
  assert.equal(res.lines.reduce((n, l) => n + l.qtyPick, 0), 30);
});

test('never opens an extra pallet: pickface 5 + open pallet 10 covers 15 -> keeps the split, no pallet opened', () => {
  const stock = [bin('CD36A02', 'B', '2030-08-20', 5), bin('CE20B01', 'B', '2030-08-20', 10), bin('CE14D02', 'B', '2030-08-20', 48)];
  const res = run(stock, 15);
  assert.equal(res.lines.filter((l) => l.breaksPallet).length, 0, rows(res).join(' | '));
  assert.deepEqual(res.lines.map((l) => l.location).sort(), ['CD36A02', 'CE20B01']);
});

test('an already-open pallet that covers the whole line is used alone', () => {
  const stock = [bin('CD36A02', 'B', '2030-08-20', 5), bin('CE20B01', 'B', '2030-08-20', 20)];
  const res = run(stock, 15);
  assert.deepEqual(res.lines.map((l) => [l.location, l.qtyPick]), [['CE20B01', 15]]);
});

test('pickface enough -> picks only from the pickface', () => {
  const stock = [bin('CD36A02', 'B', '2030-08-20', 40), bin('CE14D02', 'B', '2030-08-20', 48)];
  const res = run(stock, 30);
  assert.deepEqual(res.lines.map((l) => [l.location, l.qtyPick]), [['CD36A02', 30]]);
});

test('more than a pallet still works: order 60 = full pallet + rest, every carton accounted for', () => {
  const stock = [bin('CD36A02', 'B', '2030-08-20', 11), bin('CE14D02', 'B', '2030-08-20', 48), bin('CE18D01', 'B', '2030-08-20', 48)];
  const res = run(stock, 60);
  assert.equal(res.lines.reduce((n, l) => n + l.qtyPick, 0), 60);
  assert.equal(res.shortages.length, 0);
  const before = stock.reduce((n, b) => n + b.qtyCartons, 0);
  const after = computeStockAfterMovements(stock, res.lines, derivePickfaces(stock, config)).reduce((n, b) => n + b.qtyCartons, 0);
  assert.equal(after, before - 60, 'stock after = stock before - picked (moves only shift cartons)');
});

test('FEFO beats the pickface: pickface holds a NEWER batch, an older open pallet is in reserve -> older first', () => {
  const stock = [bin('CD36A02', 'NEW', '2030-09-01', 20), bin('CE14D02', 'OLD', '2030-01-01', 30)];
  assert.deepEqual(run(stock, 10).lines.map((l) => [l.location, l.batch, l.qtyPick]), [['CE14D02', 'OLD', 10]]);
});

test('full pallets before the pickface: order 70, pickface 26 -> 1 full pallet + 22 from pickface, no pallet opened', () => {
  const stock = [bin('CB07A01', 'B', '2030-09-03', 26), bin('CB20D01', 'B', '2030-09-03', 48), bin('CB20D02', 'B', '2030-09-03', 48)];
  const res = run([...stock].map((b) => ({ ...b })), 70);
  assert.equal(res.lines.filter((l) => l.breaksPallet).length, 0, rows(res).join(' | '));
  assert.deepEqual(res.lines.map((l) => l.qtyPick).sort((a, b) => a - b), [22, 48]);
});

test('no pallet opened for 1 carton: order 164 (upp 44), pickface 31 -> 3 full pallets + 32 from one pallet', () => {
  const b44 = (loc: string, qty: number) => ({ ...bin(loc, 'B', '2030-08-05', qty), upp: 44, isFullPallet: qty === 44 });
  const stock = [b44('CD36A02', 31), b44('CE30B01', 44), b44('CE30B02', 44), b44('CE30C01', 44), b44('CE30C02', 44)];
  const res = allocate(stock, [{ ...order(164), upp: 44 }], config);
  relocateByWaveOrder(res.lines, derivePickfaces(stock, config), config, stock);
  assert.equal(res.lines.length, 4, rows(res).join(' | '));
  assert.ok(res.lines.every((l) => l.qtyPick >= 32), rows(res).join(' | '));
});

test('exact pallets: order 108 (upp 36) with 5 loose in the pickface -> 3 full pallets, pickface untouched', () => {
  const b36 = (loc: string, qty: number) => ({ ...bin(loc, 'B', '2030-08-23', qty), upp: 36, isFullPallet: qty === 36 });
  const stock = [b36('CD36A02', 5), b36('CF05D01', 36), b36('CF22E01', 36), b36('CF23E02', 36)];
  const res = allocate(stock, [{ ...order(108), upp: 36 }], config);
  assert.deepEqual(res.lines.map((l) => [l.location, l.qtyPick, l.breaksPallet]).sort(), [['CF05D01', 36, false], ['CF22E01', 36, false], ['CF23E02', 36, false]]);
});

test("the pickface's own sealed pallet is kept for the loose part (opened in place, no bin-to-bin)", () => {
  const stock = [bin('CD36A02', 'B', '2030-08-18', 48), bin('CC18C01', 'B', '2030-08-18', 48)];
  const res = run(stock, 84); // 1 full pallet + 36 loose
  assert.deepEqual(res.lines.map((l) => [l.location, l.qtyPick]).sort(), [['CC18C01', 48], ['CD36A02', 36]]);
  assert.equal(res.lines.filter((l) => l.moveTo).length, 0);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
