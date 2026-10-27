/** Wave page for an operator: only the shipments assigned to them (Task 6). */
import { strict as assert } from 'node:assert';
import { filterToAssigned, keepWaveIds, emptyDayText, assignedDates, neighbourDates, scopeToAssigned, inventoryWork } from '../lib/assigned-waves';
import { picklistsFromTasks, restNotesFromTasks, type StockNow, type TaskRow, type WaveRow } from '../lib/allocator/picklist-from-tasks';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nAssigned waves');

const waves = [
  { id: 'w1', shipment_numbers: ['109717235'] },
  { id: 'w2', shipment_numbers: ['109717236'] },
];
const rows = [
  { wave_id: 'w1', n: 1 }, { wave_id: 'w2', n: 2 }, { wave_id: 'w2', n: 3 }, { wave_id: null, n: 4 },
];

test('only the assigned wave remains', () => {
  assert.deepEqual(filterToAssigned(waves, new Set(['109717236'])).map((w) => w.id), ['w2']);
});
test('a wave with any assigned shipment is kept', () => {
  const multi = [{ id: 'w3', shipment_numbers: ['1', '2'] }];
  assert.equal(filterToAssigned(multi, new Set(['2'])).length, 1);
});
test('empty assignment set gives no waves and no rows', () => {
  assert.deepEqual(filterToAssigned(waves, new Set()), []);
  assert.deepEqual(keepWaveIds(new Set(), rows), []);
});
test('rows of other waves and rows without a wave are dropped', () => {
  assert.deepEqual(keepWaveIds(new Set(['w1']), rows).map((r) => r.n), [1]);
  assert.deepEqual(keepWaveIds(new Set(['w2']), rows).map((r) => r.n), [2, 3]);
});
test('assignedDates is the sorted distinct set', () => {
  assert.deepEqual(assignedDates([{ planned_date: '2026-10-28' }, { planned_date: '2026-10-26' }, { planned_date: '2026-10-28' }]), ['2026-10-26', '2026-10-28']);
});
test('day arrows skip days without an assignment', () => {
  const d = ['2026-10-20', '2026-10-26', '2026-10-29'];
  assert.deepEqual(neighbourDates(d, '2026-10-27'), { prev: '2026-10-26', next: '2026-10-29' });
  assert.deepEqual(neighbourDates(d, '2026-10-20'), { prev: null, next: '2026-10-26' });
  assert.deepEqual(neighbourDates([], '2026-10-27'), { prev: null, next: null });
});
test('empty day text differs for an operator', () => {
  assert.equal(emptyDayText(true, '27 Okt 2026'), 'Belum ada shipment yang ditugaskan ke Anda.');
  assert.equal(emptyDayText(false, '27 Okt 2026'), 'Belum ada rencana untuk 27 Okt 2026.');
});

// Sisa is one replay of the whole day (AGENTS.md); assignment only narrows what an operator sees.
// Bin CB01C01 holds 40: NO 1 (another operator's shipment) picks 10, NO 2 (mine) picks 10 -> Sisa 20.
// NO 2 also opens a pallet at CB02C01 whose rest NO 3 (not mine) moves to the pickface.
const dayWave = (id: string, no: string, slot: string, sh: string): WaveRow => ({ id, wave_no: no, planned_date: '2026-10-27',
  shipment_numbers: [sh], truck: null, destination: 'X', planned_slot: slot, status: 'PENDING' });
const dayWaves = [dayWave('n1', '1', '08:00', 'SH1'), dayWave('n2', '2', '09:00', 'SH2'), dayWave('n3', '3', '10:00', 'SH3')];
const dayTask = (id: string, wave: WaveRow, seq: number, o: Partial<TaskRow> = {}): TaskRow => ({
  id, wave_id: wave.id, wave_no: wave.wave_no, planned_slot: wave.planned_slot, shipment_number: wave.shipment_numbers[0], task_type: 'PICK',
  seq, status: 'PLANNED', sku: 'S', description: 'D', uom: 'CAR', upp: 40, from_bin: 'CB01C01', to_bin: null, batch_lot: 'B1',
  expiry_date: '2031-01-01', quantity: 10, pick_type: 'CASE', breaks_pallet: false, completed_at: null, completed_by_name: null,
  actual_quantity: null, actual_from_bin: null, actual_batch_lot: null, actual_expiry_date: null, deviation_reason: null, ...o,
});
const dayTasks = [
  dayTask('t1', dayWaves[0], 1),
  dayTask('t2', dayWaves[1], 1),
  dayTask('t2b', dayWaves[1], 2, { sku: 'P', from_bin: 'CB02C01', quantity: 5, breaks_pallet: true }),
  dayTask('t3', dayWaves[2], 1, { sku: 'P', from_bin: 'CB02C01', quantity: 35, task_type: 'REPLENISH', shipment_number: null, to_bin: 'CB02A01' }),
];
const dayStock: StockNow[] = [
  { bin_code: 'CB01C01', sku: 'S', batch_lot: 'B1', expiry_date: '2031-01-01', quantity: 40 },
  { bin_code: 'CB02C01', sku: 'P', batch_lot: 'B1', expiry_date: '2031-01-01', quantity: 40 },
];
const sisaOf = (pls: ReturnType<typeof picklistsFromTasks>) =>
  Object.fromEntries(pls.flatMap((p) => p.lines).map((l) => [`${l.location}|${l.sku}`, l.qtyRemainingInBin]));

test('operator picklist Sisa equals the full-day Sisa (assignment never changes Sisa)', () => {
  const full = sisaOf(picklistsFromTasks(dayWaves, dayTasks, [], dayStock));
  assert.equal(full['CB01C01|S'], 20);
  const v = scopeToAssigned(dayWaves, dayTasks, new Set(['SH2']));
  assert.deepEqual(v.waves.map((w) => w.id), ['n2']);
  const mine = picklistsFromTasks(v.waves, v.dayTasks, [], dayStock, v.dayWaves);
  assert.deepEqual(mine.map((p) => p.shipmentNumbers[0]), ['SH2']);
  assert.equal(sisaOf(mine)['CB01C01|S'], 20);
});
test('operator rest note is the full-day one (NO 3 moves the opened pallet)', () => {
  assert.equal(restNotesFromTasks(dayWaves, dayTasks).get('t2b'), 'CB02A01 (dipindah NO 3)');
  const v = scopeToAssigned(dayWaves, dayTasks, new Set(['SH2']));
  assert.equal(restNotesFromTasks(v.dayWaves, v.dayTasks).get('t2b'), 'CB02A01 (dipindah NO 3)');
});
test('displayed tasks are the operator\'s only; non-operators see the whole day', () => {
  const v = scopeToAssigned(dayWaves, dayTasks, new Set(['SH2']));
  assert.deepEqual(v.tasks.map((t) => t.id), ['t2', 't2b']);
  assert.equal(v.dayTasks.length, 4);
  const all = scopeToAssigned(dayWaves, dayTasks, null);
  assert.equal(all.waves.length, 3);
  assert.equal(all.tasks, dayTasks);
});
test('count tasks and picklist corrections are not on an operator\'s Perlu ditangani', () => {
  const rows = [{ id: 'c1' }, { id: 'c2' }];
  assert.deepEqual(inventoryWork(true, rows), []);
  assert.deepEqual(inventoryWork(false, rows), rows);
  assert.deepEqual(inventoryWork(false, null), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
