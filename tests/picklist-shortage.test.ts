/**
 * A shipment that leaves short says so in the picklist header (6 Oct,
 * shipment 109704727: 550069887 x12 and 550077926 x2 short, invisible on the
 * paper). Both builders: the Wave page reprint (picklistsFromTasks, from the
 * order lines) and the Alokasi run (buildPicklists, from the run's shortages).
 */
import { strict as assert } from 'node:assert';
import { withConfig } from '../lib/allocator/config';
import { allocate } from '../lib/allocator/allocator';
import { buildPicklists } from '../lib/allocator/picklist';
import { picklistsFromTasks, type TaskRow, type WaveRow } from '../lib/allocator/picklist-from-tasks';
import type { DemandLine, StockBin } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const wave: WaveRow = { id: 'w13', wave_no: '13', planned_date: '2026-10-06', shipment_numbers: ['109704727'], truck: 'C20', destination: 'MANADO', planned_slot: '07:52', status: 'PENDING' };
const task = (o: Partial<TaskRow>): TaskRow => ({
  id: 't1', wave_id: 'w13', wave_no: '13', planned_slot: '07:52', shipment_number: '109704727', task_type: 'PICK', seq: 1, status: 'PLANNED',
  sku: '550069887', description: 'Rimula', uom: 'CAR', upp: 44, from_bin: 'CF29A01', to_bin: null, batch_lot: '08I26JJ', expiry_date: '2030-09-08',
  quantity: 27, pick_type: 'CASE', breaks_pallet: false, completed_at: null, completed_by_name: null, actual_quantity: null, actual_from_bin: null,
  actual_batch_lot: null, actual_expiry_date: null, deviation_reason: null, ...o,
});

console.log('\nPicklist shortage header');

test('reprint: order lines allocated below their order are listed, biggest first; a full line is not', () => {
  const [pl] = picklistsFromTasks([wave], [task({})], [
    { wave_id: 'w13', shipment_number: '109704727', sku: '550069887', order_nos: ['538386894'], quantity_requested: 39, quantity_allocated: 27 },
    { wave_id: 'w13', shipment_number: '109704727', sku: '550077926', order_nos: ['538386894'], quantity_requested: 2, quantity_allocated: 0 },
    { wave_id: 'w13', shipment_number: '109704727', sku: '550070612', order_nos: ['538386894'], quantity_requested: 211, quantity_allocated: 211 },
  ]);
  assert.deepEqual(pl.shortages, [{ sku: '550069887', qtyShort: 12 }, { sku: '550077926', qtyShort: 2 }]);
});

test('reprint without order quantities (older callers): no shortage line', () => {
  const [pl] = picklistsFromTasks([wave], [task({})], [{ wave_id: 'w13', shipment_number: '109704727', sku: '550069887', order_nos: [] }]);
  assert.deepEqual(pl.shortages, []);
});

test('Alokasi run: the run\'s shortages for that shipment go into its header', () => {
  const config = withConfig({ asOf: new Date('2026-10-06T00:00:00Z') });
  const bin = (location: string, qty: number): StockBin => ({ binId: `${location}|550069887|08I26JJ`, location, aisle: 'CF', bay: 29, level: 'A', position: 1,
    sku: '550069887', description: 'Rimula', batch: '08I26JJ', expiryDate: new Date('2030-09-08T00:00:00Z'), grDate: null, qtyCartons: qty, upp: 44, uom: 'CAR', isFullPallet: false });
  const demand: DemandLine[] = [{ shipmentNumber: '109704727', waveNo: '13', orderNos: ['538386894'], sku: '550069887', description: 'Rimula', qtyCartons: 39,
    upp: 44, destination: 'MANADO', shipToLocation: 'MANADO', transport: null, truckType: 'C20', slotTime: '07:52', deliveryDate: null }];
  const result = allocate([bin('CF29A01', 27)], demand, config);
  const [pl] = buildPicklists(result, demand, config);
  assert.deepEqual(pl.shortages, [{ sku: '550069887', qtyShort: 12 }]);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
