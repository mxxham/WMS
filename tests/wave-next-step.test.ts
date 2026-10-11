/** The Wave page's next-step sentence and primary button, per wave and for the day (spec §1.1, §1.3). */
import { strict as assert } from 'node:assert';
import { dayNextStep, waveNextStep, waveOrder, type WaveFacts } from '../lib/wave-next-step';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nWave next step');

const w = (o: Partial<WaveFacts>): WaveFacts => ({
  id: o.id ?? `w${o.wave_no ?? '1'}`, wave_no: '1', planned_slot: '08:00', status: 'PENDING', open: 0, total: 0, blocked: 0, ...o,
});

test('running wave with open lines: start picking', () => {
  assert.deepEqual(waveNextStep(w({ open: 21, total: 27 })), { tone: 'normal', text: 'Mulai picking: 21 baris belum diambil.', primary: 'mulai' });
});
test('running wave with blocked lines: fix them first', () => {
  assert.deepEqual(waveNextStep(w({ open: 5, total: 9, blocked: 2 })), { tone: 'bad', text: '2 baris tertahan: perbaiki dulu.', primary: 'lihat' });
});
test('every line posted: close the wave', () => {
  assert.deepEqual(waveNextStep(w({ open: 0, total: 9 })), { tone: 'normal', text: 'Semua baris sudah diposting: tutup wave.', primary: 'tutup' });
});
test('Tunda: activate', () => {
  assert.deepEqual(waveNextStep(w({ status: 'RESCHEDULED', open: 4, total: 4 })), { tone: 'muted', text: 'Ditunda. Aktifkan untuk lanjut.', primary: 'aktifkan' });
});
test('finished: time in Jakarta, audit when known', () => {
  assert.deepEqual(waveNextStep(w({ status: 'COMPLETED', finishedAt: '2026-11-20T00:20:00Z', audit: { done: 3, total: 5 } })),
    { tone: 'muted', text: 'Selesai 07.20. Audit 3/5 shipment.', primary: null });
  assert.deepEqual(waveNextStep(w({ status: 'COMPLETED', finishedAt: '2026-11-20T00:20:00Z' })), { tone: 'muted', text: 'Selesai 07.20.', primary: null });
  assert.deepEqual(waveNextStep(w({ status: 'COMPLETED' })), { tone: 'muted', text: 'Selesai.', primary: null });
});
test('cancelled', () => {
  assert.deepEqual(waveNextStep(w({ status: 'CANCELLED', cancelledAt: '2026-11-20T02:05:00Z' })), { tone: 'muted', text: 'Dibatalkan 09.05.', primary: null });
});

const day = [
  w({ id: 'a', wave_no: '1', planned_slot: '07:00', status: 'COMPLETED', total: 16 }),
  w({ id: 'b', wave_no: '2', planned_slot: '08:00', open: 27, total: 27 }),
  w({ id: 'c', wave_no: '7', planned_slot: '06:30', open: 3, total: 9, blocked: 1 }),
];
test('day: stok kurang first, waves joined in Indonesian, each named once', () => {
  assert.deepEqual(dayNextStep(day, { short: [{ wave_no: '7' }, { wave_no: '8' }, { wave_no: '7' }], requests: 1, waiting: [] }),
    { text: '3 baris stok kurang di NO 7 dan NO 8 harus diperbaiki dulu.', target: { kind: 'problems' } });
  assert.match(dayNextStep(day, { short: [{ wave_no: '1' }, { wave_no: '2' }, { wave_no: '3' }], requests: 0, waiting: [] }).text, /di NO 1, NO 2 dan NO 3 /);
});
test('day: then supervisor requests, then waiting Bin To Bin', () => {
  assert.deepEqual(dayNextStep(day, { short: [], requests: 1, waiting: [] }), { text: '1 permintaan dari picker menunggu supervisor.', target: { kind: 'problems' } });
  assert.deepEqual(dayNextStep(day, { short: [], requests: 0, waiting: [{ wave_no: '2' }] }), { text: '1 baris menunggu Bin To Bin di NO 2.', target: { kind: 'problems' } });
});
test('day: then the next wave to start, by slot', () => {
  const open = [w({ id: 'b', wave_no: '2', planned_slot: '08:00', open: 27, total: 27 }), w({ id: 'd', wave_no: '3', planned_slot: '07:30', open: 2, total: 5 })];
  assert.deepEqual(dayNextStep(open, { short: [], requests: 0, waiting: [] }), { text: 'Mulai NO 3 (07:30): 2 baris.', target: { kind: 'wave', id: 'd' } });
});
test('day: all finished, or no plan', () => {
  assert.deepEqual(dayNextStep([w({ status: 'COMPLETED' }), w({ id: 'x', status: 'CANCELLED' })], { short: [], requests: 0, waiting: [] }),
    { text: 'Semua wave hari ini selesai.', target: null });
  assert.deepEqual(dayNextStep([], { short: [], requests: 0, waiting: [] }), { text: 'Belum ada rencana untuk hari ini.', target: null });
});
test('wave order: running by slot then NO, then finished, then cancelled', () => {
  const list = [
    w({ id: 'x', wave_no: '9', status: 'CANCELLED' }), w({ id: 'f', wave_no: '1', status: 'COMPLETED' }),
    w({ id: 'n', wave_no: '10', planned_slot: null }), w({ id: 'p', wave_no: '2', planned_slot: '08:00', status: 'RESCHEDULED' }),
    w({ id: 'q', wave_no: '11', planned_slot: '08:00' }), w({ id: 'r', wave_no: '5', planned_slot: '06:00' }),
  ];
  assert.deepEqual(waveOrder(list).map((x) => x.id), ['r', 'p', 'q', 'n', 'f', 'x']);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
