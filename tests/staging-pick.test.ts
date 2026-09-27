/**
 * Staging fallback (allocator.ts rule 6): rack bins first; what they cannot
 * cover comes from stock in an outbound staging location (STAGING,
 * STAGING_OUT, STG_01..), as a plain hand pick — no pallet opened, no Bin To
 * Bin, no pickface. Only the rest is a shortage.
 */
import { strict as assert } from 'node:assert';
import { expiryText, NO_EXPIRY, withConfig } from '../lib/allocator/config';
import { runPipeline } from '../lib/allocator/pipeline';
import { loadWorkbook } from '../lib/allocator/adapters/excel-input';
import { inventoryToStock, type InventoryRow } from '../lib/allocator/adapters/inventory-stock';
import { stagingBin } from '../lib/allocator/staging';
import type { DemandLine, StockBin } from '../lib/allocator/types';

let passed = 0, failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const UPP = 48;
const rack = (location: string, batch: string, expiry: string, qty: number): StockBin => ({
  binId: `${location}|S|${batch}`, location, aisle: location.slice(0, 2), bay: parseInt(location.slice(2, 4)),
  level: location.slice(4, 5), position: parseInt(location.slice(5, 7)), sku: 'S', description: 'S', batch,
  expiryDate: new Date(`${expiry}T00:00:00Z`), grDate: null, qtyCartons: qty, upp: UPP, uom: 'CAR', isFullPallet: qty === UPP,
});
const staged = (location: string, qty: number, expiry: Date = NO_EXPIRY) =>
  stagingBin(location, 'S', null, expiry, qty, UPP, { description: 'S', grDate: null, uom: 'CAR' });
const order = (qty: number): DemandLine => ({ shipmentNumber: 'SH1', waveNo: '1', orderNos: ['O1'], sku: 'S', description: 'S', qtyCartons: qty,
  upp: UPP, destination: '', shipToLocation: '', transport: null, truckType: null, slotTime: '01:00', deliveryDate: null });
const config = withConfig({ asOf: new Date('2026-09-25T00:00:00Z'), minRemainingShelfLifeDays: 1 });
const run = (stock: StockBin[], qty: number) => runPipeline(stock, [order(qty)], new Map(), config).allocation;
const rows = (res: ReturnType<typeof run>) =>
  res.picklists.flatMap((p) => p.lines).map((l) => `${l.location} ${l.qtyPick} ${l.pickType}${l.breaksPallet ? ' buka' : ''}${l.moveTo ? ` ->${l.moveTo}` : ''}`);

console.log('\nStaging after the racks');

await test('racks cover the order -> staging untouched', () => {
  const res = run([rack('CE14D02', 'B', '2030-08-20', 48), staged('STAGING', 60)], 30);
  assert.deepEqual(res.lines.map((l) => `${l.location} ${l.qtyPick}`), ['CE14D02 30']);
});

await test('racks short -> racks first, staging covers the rest, no shortage', () => {
  const res = run([rack('CE14D02', 'B', '2030-08-20', 20), staged('STAGING', 60)], 30);
  assert.equal(res.lines.find((l) => l.location === 'CE14D02')?.qtyPick, 20);
  assert.equal(res.lines.find((l) => l.location === 'STAGING')?.qtyPick, 10);
  assert.equal(res.shortages.length, 0);
});

await test('no rack stock at all -> the whole order from staging', () => {
  const res = run([staged('STAGING', 60)], 30);
  assert.deepEqual(rows(res), ['STAGING 30 CASE']);
});

await test('racks + staging still short -> shortage is only the rest', () => {
  const res = run([rack('CE14D02', 'B', '2030-08-20', 10), staged('STAGING', 5)], 30);
  assert.equal(res.shortages[0]?.qtyShort, 15);
});

await test('STG_xx floor lanes count as staging, earliest expiry first', () => {
  const res = run([staged('STG_02', 20, new Date('2030-09-01T00:00:00Z')), staged('STG_01', 20, new Date('2030-12-01T00:00:00Z'))], 30);
  assert.deepEqual(rows(res).sort(), ['STG_01 10 CASE', 'STG_02 20 CASE']);
});

await test('a full pallet quantity in staging is still a hand pick: no pallet opened, no Bin To Bin', () => {
  const res = run([staged('STAGING', 48)], 20);
  assert.deepEqual(rows(res), ['STAGING 20 CASE']);
});

await test('staging row without expiry prints "-"', () => {
  const res = run([staged('STAGING', 10)], 5);
  assert.equal(expiryText(res.lines[0].expiryDate), '-');
  assert.equal(res.warnings.filter((w) => w.code === 'SHELF_LIFE_BLOCKED' || w.code === 'EXPIRED').length, 0);
});

await test('15 Sep workbook: STAGING stock (no batch/expiry in the sheet) is only used for what the racks cannot cover', async () => {
  const c = withConfig({ asOf: new Date('2026-09-15'), minRemainingShelfLifeDays: 1 });
  const wb = await loadWorkbook('data/Warehouse_Management_System_15_September_2026_.xlsx', c);
  const inStaging = wb.stock.filter((b) => b.location === 'STAGING' && b.sku === '550044709').reduce((n, b) => n + b.qtyCartons, 0);
  assert.equal(inStaging, 420);
  const res = runPipeline(wb.stock, wb.demand, wb.stagedBySku, c, wb.warnings).allocation;
  const rackOnly = runPipeline(wb.stock.filter((b) => b.location !== 'STAGING'), wb.demand, wb.stagedBySku, c).allocation;
  // Rack picks are exactly what a rack-only run makes; staging only fills that run's shortages.
  const rackLines = (a: typeof res) => a.lines.filter((l) => l.location !== 'STAGING').map((l) => `${l.shipmentNumber} ${l.sku} ${l.location} ${l.qtyPick}`).sort();
  assert.deepEqual(rackLines(res), rackLines(rackOnly));
  const shortBefore = rackOnly.shortages.filter((s) => s.sku === '550044709').reduce((n, s) => n + s.qtyShort, 0);
  const fromStaging = res.lines.filter((l) => l.location === 'STAGING' && l.sku === '550044709').reduce((n, l) => n + l.qtyPick, 0);
  assert.equal(fromStaging, Math.min(inStaging, shortBefore));
});

await test('database: staging row with expiry is pickable, without expiry is left out with a warning', () => {
  const row = (bin_code: string, expiry_date: string | null, quantity: number): InventoryRow => ({
    bin_code, bin_status: 'active', sku: 'S', description: 'S', uom: 'CAR', upp: UPP,
    batch_lot: 'B', quantity, expiry_date, received_date: null,
  });
  const out = inventoryToStock([row('STG_03', '2030-09-07', 36), row('STAGING', null, 12)], config);
  assert.deepEqual(out.stock.map((b) => `${b.location} ${b.qtyCartons}`), ['STG_03 36']);
  assert.equal(out.stagedBySku.get('S'), 12);
  assert.ok(out.warnings.some((w) => w.code === 'MISSING_EXPIRY'));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
