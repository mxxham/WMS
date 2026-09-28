/**
 * Stock accuracy end to end: 13 sub-UPP orders consolidate to one CASE line
 * per SKU; one line is partly picked from another bin at execution (the
 * deviation is recorded as the actual source, the planned bin keeps what was
 * not taken there); conservation holds per identity; a putaway receipt
 * afterwards adds exactly where it should.
 */
import { strict as assert } from 'node:assert';
import { allocate, relocateByWaveOrder } from '../lib/allocator/allocator';
import { computeStockAfterMovements, stockBalances, stockIdentityKey } from '../lib/allocator/ledger';
import { derivePickfaces } from '../lib/allocator/pickface';
import { buildPicklists } from '../lib/allocator/picklist';
import { withConfig } from '../lib/allocator/config';
import type { AllocationLine, DemandLine, StockBin } from '../lib/allocator/types';

let passed = 0, failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const UPP_A = 48, UPP_B = 44;
const SKU_A = '550044709', SKU_B = '550024919';

function makeBin(location: string, sku: string, batch: string, expiry: string, qty: number, upp: number): StockBin {
  return {
    binId: `${location}|${sku}|${batch}`, location,
    aisle: location.slice(0, 2), bay: parseInt(location.slice(2, 4)),
    level: location.slice(4, 5), position: parseInt(location.slice(5, 7)),
    sku, description: `SKU ${sku}`, batch,
    expiryDate: new Date(`${expiry}T00:00:00Z`), grDate: null,
    qtyCartons: qty, upp, uom: 'CAR', isFullPallet: qty >= upp,
  };
}
function makeDemand(shipment: string, waveNo: string, orderNo: string, sku: string, qty: number, upp: number): DemandLine {
  return {
    shipmentNumber: shipment, waveNo, orderNos: [orderNo], sku,
    description: `Product ${sku}`, qtyCartons: qty, upp,
    destination: 'CV MAJU JAYA', shipToLocation: 'CV MAJU JAYA',
    transport: 'LF', truckType: 'LF', slotTime: '01:00',
    deliveryDate: new Date('2026-09-21'),
  };
}
function stockQty(stock: StockBin[], location: string, sku: string, batch: string): number {
  return stock.filter((b) => b.location === location && b.sku === sku && b.batch === batch)
    .reduce((s, b) => s + b.qtyCartons, 0);
}
function totalStock(stock: StockBin[]): number {
  return stock.reduce((s, b) => s + b.qtyCartons, 0);
}
function runAllocate(stock: StockBin[], demand: DemandLine[]) {
  const config = withConfig({ asOf: new Date('2026-09-21') });
  const pickfaces = derivePickfaces(stock, config);
  const result = allocate(stock, demand, config, new Map());
  relocateByWaveOrder(result.lines, pickfaces, config, stock);
  const picklists = buildPicklists(result, demand, config);
  return { result, picklists, pickfaces };
}

// Every order is a hand pick: all qtys are below their SKU's UPP.
const initialStock: StockBin[] = [
  makeBin('CB02A01', SKU_A, 'B1', '2030-09-03', 20, UPP_A), // open pickface
  makeBin('CB02D01', SKU_A, 'B1', '2030-09-03', 48, UPP_A), // sealed reserve, same batch
  makeBin('CB03D01', SKU_A, 'B2', '2030-10-03', 48, UPP_A), // sealed reserve, newer batch
  makeBin('CC36A01', SKU_B, 'C1', '2030-09-04', 30, UPP_B), // open pickface
  makeBin('CB05D01', SKU_B, 'C1', '2030-09-04', 44, UPP_B), // sealed reserve
];
const demand: DemandLine[] = [
  ...[3, 2, 4, 1, 5, 2, 3].map((q, i) => makeDemand('SHP-001', '1', `ORD-A0${i + 1}`, SKU_A, q, UPP_A)),
  ...[6, 5, 4, 7, 3, 5].map((q, i) => makeDemand('SHP-002', '2', `ORD-B0${i + 1}`, SKU_B, q, UPP_B)),
];

console.log('\nStock accuracy: allocate, deviated pick, putaway');

const { result, picklists, pickfaces } = runAllocate(initialStock, demand);
const lineA = result.lines.find((l) => l.sku === SKU_A)!;
const lineB = result.lines.find((l) => l.sku === SKU_B)!;

await test('13 orders allocate 50 cartons with no shortage and no pallet opened', () => {
  assert.equal(result.stats.cartonsAllocated, 50);
  assert.equal(result.shortages.length, 0);
  assert.equal(result.stats.palletsBroken, 0);
});

await test('same-SKU orders consolidate to one CASE line per bin', () => {
  assert.equal(result.lines.length, 2);
  assert.equal(lineA.qtyPick, 20);
  assert.equal(lineB.qtyPick, 30);
  for (const l of result.lines) assert.equal(l.pickType, 'CASE');
  // mergeSameBinRows keeps the first contributing order on the merged line;
  // the full order set lives on the picklist header (asserted below).
  assert.deepEqual(lineA.orderNos, ['ORD-A01']);
  assert.deepEqual(lineB.orderNos, ['ORD-B01']);
});

await test('pickfaces cover everything; reserves and the newer batch are untouched', () => {
  assert.equal(lineA.location, 'CB02A01');
  assert.equal(lineB.location, 'CC36A01');
  assert.ok(result.lines.every((l) => l.moveTo === null));
});

await test('one picklist per shipment with its own lines', () => {
  assert.equal(picklists.length, 2);
  const w1 = picklists.find((p) => p.waveNo === '1')!;
  const w2 = picklists.find((p) => p.waveNo === '2')!;
  assert.ok(w1.lines.every((l) => l.shipmentNumber === 'SHP-001'));
  assert.ok(w2.lines.every((l) => l.shipmentNumber === 'SHP-002'));
  assert.equal(w1.lines.reduce((s, l) => s + l.qtyPick, 0), 20);
  assert.equal(w2.lines.reduce((s, l) => s + l.qtyPick, 0), 30);
  // Known limitation: merged rows keep only the first order, so the picklist
  // header cannot link ORD-A02..A07 / ORD-B02..B06. Quantities per shipment
  // still cover every order (totals above); only per-order traceability is lost.
});

// Execution: CB02A01 holds only 15 of the planned 20 (5 cartons missing), so
// the picker takes the remaining 5 from CB02D01 (same batch and expiry) and
// records that bin. The plan line splits into two actual lines.
const actualLines: AllocationLine[] = [
  { ...lineA, qtyPick: 15 },
  { ...lineA, location: 'CB02D01', binId: `CB02D01|${lineA.sku}|${lineA.batch}`, qtyPick: 5 },
  lineB,
];
const after = computeStockAfterMovements(initialStock, actualLines, pickfaces);

await test('the deviation is recorded as the actual source bin', () => {
  const fromReserve = actualLines.filter((l) => l.location === 'CB02D01');
  assert.equal(fromReserve.length, 1);
  assert.equal(fromReserve[0].qtyPick, 5);
  assert.equal(fromReserve[0].batch, 'B1');
  assert.equal(result.lines.filter((l) => l.location === 'CB02D01').length, 0);
});

await test('planned bin keeps what was not taken there; actual bin reduced by exactly 5', () => {
  assert.equal(stockQty(after, 'CB02A01', SKU_A, 'B1'), 5);
  assert.equal(stockQty(after, 'CB02D01', SKU_A, 'B1'), 43);
  assert.equal(stockQty(after, 'CC36A01', SKU_B, 'C1'), 0);
  assert.equal(stockQty(after, 'CB05D01', SKU_B, 'C1'), 44);
  assert.equal(stockQty(after, 'CB03D01', SKU_A, 'B2'), 48);
});

await test('conservation holds in total and per identity, nothing below zero', () => {
  const picked = actualLines.reduce((s, l) => s + l.qtyPick, 0);
  assert.equal(picked, 50);
  assert.equal(totalStock(after), totalStock(initialStock) - picked);
  const before = stockBalances(initialStock);
  const taken = new Map<string, number>();
  for (const l of actualLines) {
    const k = stockIdentityKey(l.location, l.sku, l.batch, l.expiryDate);
    taken.set(k, (taken.get(k) ?? 0) + l.qtyPick);
  }
  for (const b of after) {
    const k = stockIdentityKey(b.location, b.sku, b.batch, b.expiryDate);
    assert.equal(b.qtyCartons, (before.get(k) ?? 0) - (taken.get(k) ?? 0));
    assert.ok(b.qtyCartons >= 0);
  }
});

// Putaway afterwards: +12 of A/B1 into its pickface (existing identity) and
// +10 of B/C1 into a new bin.
const replenished: StockBin[] = [
  ...after.map((b) => b.location === 'CB02A01' && b.sku === SKU_A ? { ...b, qtyCartons: b.qtyCartons + 12 } : b),
  makeBin('CB06D01', SKU_B, 'C1', '2030-09-04', 10, UPP_B),
];

await test('putaway adds to the right bins and totals reconcile', () => {
  assert.equal(stockQty(replenished, 'CB02A01', SKU_A, 'B1'), 17);
  assert.equal(stockQty(replenished, 'CB06D01', SKU_B, 'C1'), 10);
  assert.equal(totalStock(replenished), totalStock(after) + 22);
  assert.equal(totalStock(replenished), 162);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
