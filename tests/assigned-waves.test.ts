/** Wave page for an operator: only the shipments assigned to them (Task 6). */
import { strict as assert } from 'node:assert';
import { filterToAssigned, keepWaveIds, emptyDayText, assignedDates, neighbourDates } from '../lib/assigned-waves';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
