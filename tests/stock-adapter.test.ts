/**
 * Database stock adapter parity + plan payload shape.
 *
 * The web app feeds the allocator from the Supabase `inventory_detail` view
 * instead of the WMS sheet. Round-tripping the workbook's stock through the
 * inventory row shape must give a bit-identical allocation, and the plan
 * sent to `save_plan` must account for every allocated carton.
 */
import { strict as assert } from 'node:assert';
import { allocate, relocateByWaveOrder } from '../lib/allocator/allocator';
import { withConfig } from '../lib/allocator/config';
import { derivePickfaces } from '../lib/allocator/pickface';
import { loadWorkbook } from '../lib/allocator/adapters/excel-input';
import { inventoryToStock, type InventoryRow } from '../lib/allocator/adapters/inventory-stock';
import { buildPlan } from '../lib/allocator/plan';
import type { StockBin } from '../lib/allocator/types';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toRow = (b: StockBin): InventoryRow => ({
  bin_code: b.location,
  bin_status: 'active',
  sku: b.sku,
  description: b.description,
  uom: b.uom,
  upp: b.upp,
  batch_lot: b.batch ?? '',
  quantity: b.qtyCartons,
  expiry_date: iso(b.expiryDate),
  received_date: iso(b.grDate),
});
const lineKey = (l: { shipmentNumber: string; sku: string; location: string; batch: string | null; qtyPick: number; pickType: string }) =>
  `${l.shipmentNumber}|${l.sku}|${l.location}|${l.batch}|${l.qtyPick}|${l.pickType}`;

console.log('\nDatabase stock adapter');

for (const [file, asOf] of [
  ['data/Warehouse_Management_System_15_September_2026_.xlsx', '2026-09-15'],
  ['data/Warehouse_Management_System_18_September_2026_.xlsx', '2026-09-18'],
] as const) {
  const config = withConfig({ asOf: new Date(`${asOf}T00:00:00Z`) });
  const wb = await loadWorkbook(file, config);
  const db = inventoryToStock(wb.stock.map(toRow), config);

  await test(`${asOf}: every workbook bin survives the round trip`, () => {
    // Phantom racks (blockedBins) hold no stock in these fixtures, so all bins must survive.
    assert.equal(db.stock.length, wb.stock.length);
    assert.deepEqual(db.stock.map((b) => b.binId).sort(), wb.stock.map((b) => b.binId).sort());
  });

  const run = (stock: StockBin[]) => {
    const pickfaces = derivePickfaces(stock, config);
    const result = allocate(stock, wb.demand, config, wb.stagedBySku);
    relocateByWaveOrder(result.lines, pickfaces, config, stock);
    return { result, pickfaces };
  };
  const a = run(wb.stock);
  const b = run(db.stock);

  await test(`${asOf}: identical allocation from workbook and database stock`, () => {
    assert.deepEqual(b.result.stats, a.result.stats);
    assert.deepEqual(b.result.lines.map(lineKey), a.result.lines.map(lineKey));
    assert.deepEqual(b.result.shortages, a.result.shortages);
  });

  await test(`${asOf}: plan accounts for every allocated carton`, () => {
    const plan = buildPlan(b.result, wb.demand, b.pickfaces);
    const picked = plan.tasks.filter((t) => t.task_type === 'PICK').reduce((s, t) => s + t.quantity, 0);
    assert.equal(picked, b.result.stats.cartonsAllocated);
    const allocated = plan.outbound.reduce((s, o) => s + o.quantity_allocated, 0);
    assert.equal(allocated, b.result.stats.cartonsAllocated);
    const waveNos = new Set(plan.waves.map((w) => w.wave_no));
    assert.ok(plan.tasks.every((t) => waveNos.has(t.wave_no)), 'every task belongs to a planned wave');
    for (const w of waveNos) {
      const seqs = plan.tasks.filter((t) => t.wave_no === w).map((t) => t.seq);
      assert.deepEqual(seqs, seqs.map((_, i) => i + 1), `wave ${w} seq is 1..n`);
    }
  });
}

await test('blocked bins and missing expiry are excluded like the workbook adapter; staging stock is pickable', () => {
  const config = withConfig({ asOf: new Date('2026-09-24T00:00:00Z') });
  const base: InventoryRow = {
    bin_code: 'CA01A01', bin_status: 'active', sku: '550070612', description: 'x', uom: 'CAR', upp: 48,
    batch_lot: 'B1', quantity: 48, expiry_date: '2030-01-01', received_date: null,
  };
  const out = inventoryToStock([
    base,
    { ...base, bin_code: 'CA01A02', bin_status: 'blocked' },
    { ...base, bin_code: 'STAGING', quantity: 7 },
    { ...base, bin_code: 'CA01B01', expiry_date: null },
    { ...base, bin_code: 'QUARANTINE' },
  ], config);
  assert.deepEqual(out.stock.map((s) => s.location), ['CA01A01', 'STAGING']);
  assert.equal(out.stock[0].isFullPallet, true);
  assert.equal(out.stock[1].qtyCartons, 7);
  assert.equal(out.stagedBySku.get('550070612'), undefined);
  assert.deepEqual(out.warnings.map((w) => w.code).sort(), ['BIN_NOT_ACTIVE', 'MISSING_EXPIRY']);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
