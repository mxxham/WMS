/**
 * Replay invariants for two waves sharing one shipment (remainder wave on Tunda re-run).
 *
 * Fixture (fixed dates, no TZ dependency):
 *   - Old wave "1" (slot 06:00): one COMPLETED pick at actuals (8 of 10) + one CANCELLED pick (5)
 *   - New wave "2" (slot 07:00): two PLANNED picks from the same bin/batch (3 + 2)
 *   - Physical stock now: 12 cartons in the bin (20 opening − 8 actually taken)
 *
 * Assertions:
 *   (a) execution order excludes CANCELLED tasks
 *   (b) the COMPLETED pick replays with its actual_quantity (8)
 *   (c) the new wave's planned picks produce Sisa rows whose arithmetic agrees with
 *       physical quantity math: opening 20 → after old pick 12 → after new pick #1 9 → after new pick #2 7
 *   (d) print/task order follows slot then NO (wave 1 tasks before wave 2 tasks)
 */
import { strict as assert } from 'node:assert';
import { sisaFromTasks, picklistsFromTasks, type TaskRow, type WaveRow, type OutboundRow, type StockNow } from '../lib/allocator/picklist-from-tasks';
import { withConfig } from '../lib/allocator/config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const cfg = withConfig({ asOf: new Date('2026-10-24T00:00:00Z') });

// Two waves sharing shipment "SHIP-001"
// Wave 1: slot 06:00, wave_no "1"
// Wave 2: slot 07:00, wave_no "2"
const waves: WaveRow[] = [
  { id: 'w1', wave_no: '1', planned_date: '2026-10-24', shipment_numbers: ['SHIP-001'], truck: null, destination: 'Customer A', planned_slot: '06:00', status: 'PENDING' },
  { id: 'w2', wave_no: '2', planned_date: '2026-10-24', shipment_numbers: ['SHIP-001'], truck: null, destination: 'Customer A', planned_slot: '07:00', status: 'PENDING' },
];

const bin = 'CA01A01';
const sku = '123456789';
const batch = 'BATCH-001';
const expiry = '2026-12-31';

const baseTask = {
  wave_id: '',
  wave_no: '',
  planned_slot: null,
  sku,
  description: 'Test Lubricant',
  uom: 'CAR',
  upp: 48,
  from_bin: bin,
  to_bin: null as string | null,
  batch_lot: batch,
  expiry_date: expiry,
  pick_type: 'CASE' as const,
  breaks_pallet: false,
  completed_at: null,
  completed_by_name: null,
  actual_from_bin: null,
  actual_batch_lot: null,
  actual_expiry_date: null,
  deviation_reason: null,
  picked_by_name: null,
};

const tasks: TaskRow[] = [
  // Old wave 1: COMPLETED pick at actuals (8 of 10 planned)
  {
    ...baseTask,
    id: 't1',
    wave_id: 'w1',
    wave_no: '1',
    shipment_number: 'SHIP-001',
    task_type: 'PICK',
    seq: 1,
    status: 'COMPLETED',
    quantity: 10,
    actual_quantity: 8,
    completed_at: '2026-10-24T06:15:00Z',
    completed_by_name: 'Operator A',
  },
  // Old wave 1: CANCELLED pick (should be excluded from replay)
  {
    ...baseTask,
    id: 't2',
    wave_id: 'w1',
    wave_no: '1',
    shipment_number: 'SHIP-001',
    task_type: 'PICK',
    seq: 2,
    status: 'CANCELLED',
    quantity: 5,
    actual_quantity: null,
  },
  // New wave 2: first PLANNED pick (3 cartons)
  {
    ...baseTask,
    id: 't3',
    wave_id: 'w2',
    wave_no: '2',
    shipment_number: 'SHIP-001',
    task_type: 'PICK',
    seq: 1,
    status: 'PLANNED',
    quantity: 3,
    actual_quantity: null,
  },
  // New wave 2: second PLANNED pick (2 cartons)
  {
    ...baseTask,
    id: 't4',
    wave_id: 'w2',
    wave_no: '2',
    shipment_number: 'SHIP-001',
    task_type: 'PICK',
    seq: 2,
    status: 'PLANNED',
    quantity: 2,
    actual_quantity: null,
  },
];

// Physical stock NOW: 12 cartons remain in the bin (20 opening - 8 actually taken)
const stockNow: StockNow[] = [
  { bin_code: bin, sku, batch_lot: batch, expiry_date: expiry, quantity: 12 },
];

const outbound: OutboundRow[] = [
  { wave_id: 'w1', shipment_number: 'SHIP-001', sku, order_nos: ['ORD-001'], quantity_requested: 15, quantity_allocated: 13 },
  { wave_id: 'w2', shipment_number: 'SHIP-001', sku, order_nos: ['ORD-001'], quantity_requested: 5, quantity_allocated: 5 },
];

console.log('\nRemainder wave replay invariants (two waves, one shipment)');

test('execution order excludes CANCELLED tasks', () => {
  // sisaFromTasks internally uses executionOrder which filters out CANCELLED
  const sisa = sisaFromTasks(waves, tasks, stockNow);
  // Only 3 PICK tasks should have Sisa entries (t1, t3, t4); t2 is CANCELLED
  const pickSisa = [...sisa.entries()].filter(([, v]) => v.sisa !== undefined);
  assert.equal(pickSisa.length, 3, 'CANCELLED task should not produce a Sisa entry');
  // The CANCELLED task t2 must not be in the sisa map
  assert.ok(!sisa.has('t2'), 'CANCELLED task t2 must not appear in sisa map');
});

test('COMPLETED pick replays at its actual_quantity (8)', () => {
  const sisa = sisaFromTasks(waves, tasks, stockNow);
  const t1 = sisa.get('t1');
  assert.ok(t1, 't1 must have Sisa');
  // t1 is the first PICK in execution order. It takes 8 (actual).
  // Opening stock reconstructed: 12 (now) + 8 (added back for COMPLETED) = 20.
  // After t1 takes 8: 12 remains. That is the Sisa for t1.
  assert.equal(t1.sisa, 12, 'Sisa after COMPLETED pick (actual 8) must be 12');
  // The replay uses actual_quantity for COMPLETED tasks (verified by Sisa=12).
  // Printed qtyPick shows the planned quantity (10), which is correct — the
  // picklist records what was planned; actuals are recorded separately.
});

test('new wave planned picks produce correct Sisa arithmetic (20 → 12 → 9 → 7)', () => {
  const sisa = sisaFromTasks(waves, tasks, stockNow);
  // Execution order: t1 (wave 1, seq 1), t3 (wave 2, seq 1), t4 (wave 2, seq 2)
  // Opening: 20
  // After t1 (takes 8): 12
  // After t3 (takes 3): 9
  // After t4 (takes 2): 7
  const t3 = sisa.get('t3');
  const t4 = sisa.get('t4');
  assert.ok(t3, 't3 must have Sisa');
  assert.ok(t4, 't4 must have Sisa');
  assert.equal(t3.sisa, 9, 'Sisa after t3 (takes 3) must be 9');
  assert.equal(t4.sisa, 7, 'Sisa after t4 (takes 2) must be 7');
});

test('print/task order follows slot then NO (wave 1 before wave 2)', () => {
  const picklists = picklistsFromTasks(waves, tasks, outbound, stockNow);
  const allLines = picklists.flatMap(p => p.lines);
  // Should have 3 lines (t1, t3, t4); t2 is CANCELLED and excluded
  assert.equal(allLines.length, 3, 'Only 3 non-CANCELLED PICK tasks should appear');
  // Order: wave 1 (slot 06:00) tasks first, then wave 2 (slot 07:00) tasks
  assert.equal(allLines[0].waveNo, '1', 'First line must be from wave 1');
  assert.equal(allLines[0].seq, 1, 'First line seq 1');
  assert.equal(allLines[1].waveNo, '2', 'Second line must be from wave 2');
  assert.equal(allLines[1].seq, 1, 'Second line seq 1 (first of wave 2)');
  assert.equal(allLines[2].waveNo, '2', 'Third line must be from wave 2');
  assert.equal(allLines[2].seq, 2, 'Third line seq 2 (second of wave 2)');
});

test('Sisa on picklist lines matches sisaFromTasks for each task', () => {
  const sisa = sisaFromTasks(waves, tasks, stockNow);
  const picklists = picklistsFromTasks(waves, tasks, outbound, stockNow);
  const allLines = picklists.flatMap(p => p.lines);
  for (const line of allLines) {
    const taskId = tasks.find(t => t.wave_no === line.waveNo && t.seq === line.seq && t.shipment_number === line.shipmentNumber)?.id;
    assert.ok(taskId, `No task found for line wave ${line.waveNo} seq ${line.seq}`);
    const s = sisa.get(taskId);
    assert.ok(s, `Sisa entry missing for task ${taskId}`);
    assert.equal(line.qtyRemainingInBin, s.sisa, `qtyRemainingInBin mismatch for ${taskId}: printed ${line.qtyRemainingInBin}, sisa ${s.sisa}`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);