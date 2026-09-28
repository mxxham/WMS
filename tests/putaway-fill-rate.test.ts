/**
 * Putaway / pick loop: stock lives in database-shaped rows and every round is
 * converted with inventoryToStock, then putaway adds, one order picks, and the
 * fill rate must be 100% in all 100 rounds. Totals must reconcile at the end.
 */
import { strict as assert } from 'node:assert';
import { allocate, relocateByWaveOrder } from '../lib/allocator/allocator';
import { computeStockAfterMovements } from '../lib/allocator/ledger';
import { derivePickfaces } from '../lib/allocator/pickface';
import { buildPicklists } from '../lib/allocator/picklist';
import { withConfig } from '../lib/allocator/config';
import { inventoryToStock, type InventoryRow } from '../lib/allocator/adapters/inventory-stock';
import type { DemandLine, StockBin } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const SKU = '550044709', UPP = 48;
const config = withConfig({ asOf: new Date('2026-09-25T00:00:00Z'), minRemainingShelfLifeDays: 1 });

function row(bin_code: string, quantity: number): InventoryRow {
  return {
    bin_code, bin_status: 'active', sku: SKU, description: 'Oli', uom: 'CAR', upp: UPP,
    batch_lot: 'B1', quantity, expiry_date: '2030-09-03', received_date: null,
  };
}
function order(no: string, qty: number): DemandLine {
  return {
    shipmentNumber: 'SHC', waveNo: '1', orderNos: [no], sku: SKU, description: 'Oli',
    qtyCartons: qty, upp: UPP, destination: '', shipToLocation: '',
    transport: null, truckType: null, slotTime: '01:00', deliveryDate: null,
  };
}
const rowsQty = (rows: InventoryRow[]) => rows.reduce((s, r) => s + r.quantity, 0);

// The "database": one row per bin identity. Putaway mutates rows; picks are
// written back from the ledger so rows stay the single source of truth.
let rows: InventoryRow[] = [row('CB02A01', 10), row('CB02D01', 48), row('CB03D01', 48)];
const initialTotal = rowsQty(rows);
let totalPutaway = 0, totalPicked = 0, minFill = 100, reserveTapped = false, deviatedRounds = 0;
// Deterministic 20% wrong-bin chance (seeded so the run reproduces).
const WRONG_BIN_P = 0.2;
let rngState = 42;
function rng(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 2 ** 32;
}

console.log('\nPutaway fill rate over 100 rounds');

for (let i = 1; i <= 100; i++) {
  // Putaway first: restock the pickface; round 50 also lands a sealed pallet.
  const q = 6 + (i % 4);
  rows.find((r) => r.bin_code === 'CB02A01')!.quantity += q;
  totalPutaway += q;
  if (i === 50) { rows.push(row('CB04D01', 48)); totalPutaway += 48; }

  // Last 10 rounds order extra, forcing picks out of the reserve pallets.
  const d = i >= 91 ? q + 12 : q;
  const inv = inventoryToStock(rows, config);
  if (inv.warnings.length > 0) throw new Error(`round ${i}: adapter warnings`);
  if (inv.stock.reduce((s, b) => s + b.qtyCartons, 0) !== rowsQty(rows)) {
    throw new Error(`round ${i}: adapter lost stock`);
  }

  const pickfaces = derivePickfaces(inv.stock, config);
  const result = allocate(inv.stock, [order(`ORD-R${i}`, d)], config, inv.stagedBySku);
  relocateByWaveOrder(result.lines, pickfaces, config, inv.stock);
  const picklists = buildPicklists(result, [order(`ORD-R${i}`, d)], config);

  const allocated = result.lines.reduce((s, l) => s + l.qtyPick, 0);
  const fill = (allocated / d) * 100;
  if (fill < minFill) minFill = fill;
  if (result.shortages.length > 0 || allocated !== d) {
    throw new Error(`round ${i}: fill ${fill}% (short ${result.shortages[0]?.qtyShort ?? 0})`);
  }
  if (picklists.length !== 1 || picklists[0].totalCartons !== d) {
    throw new Error(`round ${i}: picklist does not cover the order`);
  }

  // 20% chance the planned bin is wrong at execution: the first line is
  // re-routed to another bin with the same batch/expiry holding enough stock.
  // Only when nothing moves, so the planned bin must come out untouched.
  let actual = result.lines;
  let plannedBin: string | null = null;
  if (rng() < WRONG_BIN_P && result.lines.every((l) => !l.moveTo)) {
    const first = result.lines[0];
    const alt = inv.stock.find((b) => b.sku === first.sku && b.batch === first.batch
      && b.expiryDate.getTime() === first.expiryDate.getTime()
      && b.location !== first.location && b.qtyCartons >= first.qtyPick);
    if (alt) {
      plannedBin = first.location;
      actual = [{ ...first, location: alt.location, binId: `${alt.location}|${first.sku}|${first.batch}` },
        ...result.lines.slice(1)];
      deviatedRounds++;
    }
  }
  const plannedQty = plannedBin === null ? 0
    : rows.find((r) => r.bin_code === plannedBin)!.quantity;
  if (actual.some((l) => l.location !== 'CB02A01')) reserveTapped = true;

  // Post the picks: ledger moves applied back to the database rows.
  const after: StockBin[] = computeStockAfterMovements(inv.stock, actual, pickfaces);
  totalPicked += allocated;
  rows = after.filter((b) => b.qtyCartons > 0).map((b) => ({
    bin_code: b.location, bin_status: 'active' as const, sku: b.sku, description: b.description,
    uom: b.uom, upp: b.upp, batch_lot: b.batch ?? '', quantity: b.qtyCartons,
    expiry_date: b.expiryDate.toISOString().slice(0, 10), received_date: null,
  }));
  if (rows.some((r) => r.quantity < 0)) throw new Error(`round ${i}: negative stock`);
  if (plannedBin !== null) {
    const kept = rows.find((r) => r.bin_code === plannedBin)?.quantity ?? 0;
    if (kept !== plannedQty) throw new Error(`round ${i}: planned bin ${plannedBin} changed by the deviation`);
  }
}

test('fill rate 100% in every one of the 100 rounds', () => {
  assert.equal(minFill, 100);
});

test('reserve pallets were picked from (wrong-bin re-routes skip the pickface)', () => {
  assert.equal(reserveTapped, true);
});

test('wrong-bin deviations fired at ~20% and stayed accurate', () => {
  assert.ok(deviatedRounds >= 10 && deviatedRounds <= 30, `got ${deviatedRounds}`);
});

test('end totals reconcile: initial + putaway - picked', () => {
  assert.equal(totalPutaway, 798);
  assert.equal(totalPicked, 870);
  assert.equal(rowsQty(rows), initialTotal + totalPutaway - totalPicked);
  assert.equal(rowsQty(rows), 34);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
