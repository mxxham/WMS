/**
 * Block C picking (0147, spec docs/superpowers/specs/2026-11-20-block-c-floor-storage-design.md): a floor slot is a
 * STACK of pallets of one SKU. FEFO is global across Oso 5 and Block C; pallets and loose cartons follow the same
 * rules as a rack; there is no pickface, replenishment or Bin To Bin in Block C; and every shipment gets its own
 * Block C picklist (`PL-<shipment>-BC`), printed after its Oso 5 list.
 */
import { strict as assert } from 'node:assert';
import { withConfig } from '../lib/allocator/config';
import { runPipeline } from '../lib/allocator/pipeline';
import { buildPlan } from '../lib/allocator/plan';
import { blockCSequenceKey } from '../lib/allocator/pickpath';
import { inventoryToStock, type InventoryRow } from '../lib/allocator/adapters/inventory-stock';
import { picklistsFromTasks, type OutboundRow, type TaskRow, type WaveRow } from '../lib/allocator/picklist-from-tasks';
import type { DemandLine, StockBin } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const UPP = 50;
const config = withConfig({ asOf: new Date('2026-11-20T00:00:00Z'), minRemainingShelfLifeDays: 1 });
const date = (d: string) => new Date(`${d}T00:00:00Z`);

/** One stock row. A rack code is a rack bin; FA-01 is a Block C slot (a stack). */
function bin(location: string, sku: string, expiry: string, qty: number, batch = 'B1'): StockBin {
  const rack = /^C[A-Z]\d{2}[A-E]\d{2}$/.test(location);
  return {
    binId: `${location}|${sku}|${batch}`, location, aisle: location.slice(0, 2),
    bay: rack ? parseInt(location.slice(2, 4)) : parseInt(location.slice(3, 5)), level: rack ? location.slice(4, 5) : 'A',
    position: rack ? parseInt(location.slice(5, 7)) : 1, sku, description: sku, batch, expiryDate: date(expiry),
    grDate: null, qtyCartons: qty, upp: UPP, uom: 'CAR', isFullPallet: qty === UPP,
  };
}
const need = (sku: string, qty: number, shipment = 'SH1'): DemandLine => ({
  shipmentNumber: shipment, waveNo: '1', orderNos: ['O1'], sku, description: sku, qtyCartons: qty, upp: UPP,
  destination: 'D', shipToLocation: 'D', transport: null, truckType: null, slotTime: '01:00', deliveryDate: null,
});
const run = (stock: StockBin[], demand: DemandLine[]) => runPipeline(stock, demand, new Map(), config);
const rows = (r: ReturnType<typeof run>) => r.allocation.picklists.flatMap((p) => p.lines)
  .map((l) => `${l.location} ${l.qtyPick} ${l.pickType}${l.breaksPallet ? ' buka' : ''}${l.moveTo ? ` ->${l.moveTo}` : ''}`);

console.log('\nBlock C stacks');

test('a stack of 3 pallets: an order of 2 pallets takes two whole pallets, two forklift rows', () => {
  const r = run([bin('FA-01', 'S', '2027-06-30', 150)], [need('S', 100)]);
  assert.deepEqual(rows(r), ['FA-01 50 PALLET', 'FA-01 50 PALLET']);
  assert.deepEqual(r.allocation.picklists.flatMap((p) => p.lines).map((l) => l.qtyRemainingInBin), [100, 50]);
  assert.equal(r.allocation.picklists[0].totalPallets, 2);
});

test('2 pallets + 20 loose: the loose cartons break the third pallet, which stays in the slot (no Bin To Bin)', () => {
  const r = run([bin('FA-01', 'S', '2027-06-30', 150)], [need('S', 120)]);
  assert.deepEqual(rows(r), ['FA-01 20 CASE buka', 'FA-01 50 PALLET', 'FA-01 50 PALLET']);
  const loose = r.allocation.picklists.flatMap((p) => p.lines).find((l) => l.pickType === 'CASE')!;
  assert.equal(loose.moveTo, null);
  assert.equal(loose.moveQty, 0);
});

test('loose cartons come from the open pallet first: 2 full + 30 loose, a pick of 30 opens nothing', () => {
  const r = run([bin('FA-01', 'S', '2027-06-30', 130)], [need('S', 30)]);
  assert.deepEqual(rows(r), ['FA-01 30 CASE']);
  assert.equal(r.allocation.lines[0].qtyRemainingInBin, 100);
});

test('never break a pallet for a pick the open pallet cannot cover, but break only one: 130 stack, pick 40', () => {
  const r = run([bin('FA-01', 'S', '2027-06-30', 130)], [need('S', 40)]);
  assert.deepEqual(rows(r), ['FA-01 40 CASE buka']);
  assert.equal(r.allocation.lines[0].qtyRemainingInBin, 90);
});

test('a stack of one pallet: exactly one pallet is a forklift row and the slot is left empty', () => {
  const r = run([bin('FA-01', 'S', '2027-06-30', 50)], [need('S', 50)]);
  assert.deepEqual(rows(r), ['FA-01 50 PALLET']);
  assert.equal(r.allocation.lines[0].qtyRemainingInBin, 0);
});

test('the whole stack in one order (3 pallets) is three forklift rows and the shipment is fully served', () => {
  const r = run([bin('FA-01', 'S', '2027-06-30', 150)], [need('S', 150)]);
  assert.deepEqual(rows(r), ['FA-01 50 PALLET', 'FA-01 50 PALLET', 'FA-01 50 PALLET']);
  assert.equal(r.allocation.shortages.length, 0);
});

console.log('\nFEFO is global across both buildings');

test('an earlier expiry in Oso 5 is picked before a later one in Block C', () => {
  const r = run([bin('CB05C01', 'S', '2027-01-31', 50), bin('FA-01', 'S', '2027-06-30', 100)], [need('S', 50)]);
  assert.deepEqual(rows(r), ['CB05C01 50 PALLET']);
});

test('an earlier expiry in Block C is picked before a later one in Oso 5', () => {
  const r = run([bin('CB05C01', 'S', '2027-06-30', 50), bin('FA-01', 'S', '2027-01-31', 100)], [need('S', 50)]);
  assert.deepEqual(rows(r), ['FA-01 50 PALLET']);
});

test('same expiry in both: no later date is touched, and the order fills from both buildings', () => {
  const r = run([bin('CB05C01', 'S', '2027-03-31', 50), bin('FA-01', 'S', '2027-03-31', 100), bin('FB-02', 'S', '2027-09-30', 100)], [need('S', 150)]);
  assert.equal(r.allocation.lines.reduce((n, l) => n + l.qtyPick, 0), 150);
  assert.ok(!rows(r).some((x) => x.startsWith('FB-02')));
});

console.log('\nNo pickface, no replenishment, no move into Oso 5');

test('a Block C SKU never gets a pickface or a REPLENISH task', () => {
  const r = run([bin('FA-01', 'S', '2027-06-30', 150)], [need('S', 120)]);
  assert.equal(r.pickfaces.size, 0);
  const plan = buildPlan(r.allocation, [need('S', 120)], r.pickfaces);
  assert.equal(plan.tasks.filter((t) => t.task_type === 'REPLENISH').length, 0);
});

test('a SKU with a rack pickface AND a Block C stack: the Block C pick is never carried to the pickface', () => {
  const r = run([bin('CB05A01', 'S', '2027-06-30', 10), bin('FA-01', 'S', '2027-01-31', 150)], [need('S', 20)]);
  const bc = r.allocation.lines.find((l) => l.location === 'FA-01')!;
  assert.ok(bc);
  assert.equal(bc.moveTo, null);
  assert.equal(bc.moveQty, 0);
  assert.ok(r.allocation.lines.every((l) => !l.moveTo || !l.moveTo.startsWith('F')));
});

console.log('\nOne Block C picklist per shipment');

test('a shipment with Oso 5 and Block C lines gets two lists, the Block C one second and flagged', () => {
  const r = run([bin('CB05C01', 'R', '2027-06-30', 50), bin('FA-01', 'S', '2027-06-30', 100)],
    [need('R', 50), need('S', 100)]);
  const lists = r.allocation.picklists;
  assert.deepEqual(lists.map((p) => p.picklistId), ['PL-SH1', 'PL-SH1-BC']);
  assert.equal(lists[0].site, undefined);
  assert.equal(lists[1].site, 'BLOCKC');
  assert.deepEqual(lists[1].lines.map((l) => l.location), ['FA-01', 'FA-01']);
  assert.deepEqual(lists[1].lines.map((l) => l.seq), [1, 2]);
  assert.equal(lists[1].totalPallets, 2);
});

test('forklift and handpick rows of Block C stay together on the one list', () => {
  const r = run([bin('FA-01', 'S', '2027-06-30', 150)], [need('S', 120)]);
  assert.equal(r.allocation.picklists.length, 1);
  assert.equal(r.allocation.picklists[0].picklistId, 'PL-SH1-BC');
  assert.equal(r.allocation.picklists[0].taskType, 'MIXED');
});

test('a shipment with only Oso 5 lines is unchanged: one list, no -BC', () => {
  const r = run([bin('CB05C01', 'R', '2027-06-30', 50)], [need('R', 50)]);
  assert.deepEqual(r.allocation.picklists.map((p) => p.picklistId), ['PL-SH1']);
});

test('two shipments: each has its own Block C list, in shipment order', () => {
  const r = run([bin('FA-01', 'S', '2027-06-30', 150)], [need('S', 50, 'SH1'), need('S', 50, 'SH2')]);
  assert.deepEqual(r.allocation.picklists.map((p) => p.picklistId), ['PL-SH1-BC', 'PL-SH2-BC']);
});

test('the shortage of a shipment prints once: on its Oso 5 list when it has one', () => {
  const r = run([bin('CB05C01', 'R', '2027-06-30', 50), bin('FA-01', 'S', '2027-06-30', 50)], [need('R', 50), need('S', 100)]);
  const [oso, bc] = r.allocation.picklists;
  assert.equal(oso.shortages?.length, 1);
  assert.equal(bc.shortages?.length, 0);
});

console.log('\nThe saved plan and its reprint');

test('plan tasks: the Block C task numbers after the Oso 5 task of the same shipment', () => {
  const demand = [need('R', 50), need('S', 100)];
  const r = run([bin('CB05C01', 'R', '2027-06-30', 50), bin('FA-01', 'S', '2027-06-30', 100)], demand);
  const plan = buildPlan(r.allocation, demand, r.pickfaces);
  assert.deepEqual(plan.tasks.map((t) => `${t.from_bin} ${t.seq}`), ['CB05C01 1', 'FA-01 2', 'FA-01 3']);
});

test('the reprint rebuilds the same two lists from the saved tasks', () => {
  const demand = [need('R', 50), need('S', 100)];
  const r = run([bin('CB05C01', 'R', '2027-06-30', 50), bin('FA-01', 'S', '2027-06-30', 100)], demand);
  const plan = buildPlan(r.allocation, demand, r.pickfaces);
  const wave: WaveRow = { id: 'w1', wave_no: '1', planned_slot: '01:00', planned_date: '2026-11-20', shipment_numbers: ['SH1'], destination: 'D', truck: null } as unknown as WaveRow;
  const tasks = plan.tasks.map((t, i) => ({
    id: `t${i}`, wave_id: 'w1', wave_no: '1', planned_slot: '01:00', shipment_number: t.shipment_number, task_type: t.task_type,
    seq: t.seq, status: 'PLANNED', sku: t.sku, description: t.sku, from_bin: t.from_bin, to_bin: t.to_bin, batch_lot: t.batch_lot,
    expiry_date: t.expiry_date, quantity: t.quantity, pick_type: t.pick_type, breaks_pallet: t.breaks_pallet, upp: UPP, uom: 'CAR',
  })) as unknown as TaskRow[];
  const stockNow = [{ bin_code: 'CB05C01', sku: 'R', batch_lot: 'B1', expiry_date: '2027-06-30', quantity: 50 },
    { bin_code: 'FA-01', sku: 'S', batch_lot: 'B1', expiry_date: '2027-06-30', quantity: 100 }];
  const lists = picklistsFromTasks([wave], tasks, [] as OutboundRow[], stockNow);
  assert.deepEqual(lists.map((p) => p.picklistId), ['PL-SH1', 'PL-SH1-BC']);
  assert.equal(lists[1].site, 'BLOCKC');
  assert.deepEqual(lists[1].lines.map((l) => l.qtyRemainingInBin), [50, 0]);
});

test('picking a stack more than once is not reported as a double pick', () => {
  const r = run([bin('FA-01', 'S', '2027-06-30', 150)], [need('S', 120)]);
  assert.equal(r.doubles.total, 0);
});

console.log('\nStock from the database and the walking route');

test('inventory_detail rows of FA-/FB- slots become pickable stock; a blocked or planned slot does not', () => {
  const row = (bin_code: string, bin_status: 'active' | 'blocked', quantity: number): InventoryRow => ({
    bin_code, bin_status, sku: 'S', description: 'S', uom: 'CAR', upp: UPP, batch_lot: 'B1', quantity, expiry_date: '2027-06-30', received_date: null });
  const r = inventoryToStock([row('FA-01', 'active', 150), row('FA-02', 'blocked', 50)], config);
  assert.deepEqual(r.stock.map((b) => `${b.location} ${b.qtyCartons}`), ['FA-01 150']);
});

test('the Block C route walks down FA and back up FB (serpentine)', () => {
  const key = (l: string) => blockCSequenceKey(l, config);
  assert.ok(key('FA-02') < key('FA-10'));
  assert.ok(key('FA-10') < key('FB-15'));
  assert.ok(key('FB-15') < key('FB-03'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
