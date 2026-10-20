/**
 * Shipments of a schedule that already had a wave on an earlier day
 * (lib/allocator/earlier-waves.ts): 13 Oct's file lists 12 Oct's NO 5, 6, 7
 * again, under their old NO, next to 13 Oct's own NO 5, 6, 7.
 */
import { strict as assert } from 'node:assert';
import { compareWaveNo, fileDate, sortEarlier, type EarlierFacts } from '../lib/allocator/earlier-waves';
import type { DemandLine } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nShipments with a wave on an earlier day');

const d = (shipmentNumber: string, waveNo: string, o: Partial<DemandLine> = {}): DemandLine => ({
  shipmentNumber, waveNo, orderNos: [], sku: '550044709', description: 'Adv4T', qtyCartons: 10, upp: 48,
  destination: 'CV MULTI SARANA BAN', shipToLocation: 'SURABAYA', transport: null, truckType: null, slotTime: null, deliveryDate: null, ...o,
} as DemandLine);

// 12 Oct: NO 5 and NO 7 Batal with nothing posted, NO 6 Selesai (792 picked, not loaded).
const facts = (o: Partial<EarlierFacts> = {}): EarlierFacts => ({
  waves: [
    { id: 'w5', wave_no: '5', planned_date: '2026-10-12', status: 'CANCELLED', shipment_numbers: ['109713885'] },
    { id: 'w6', wave_no: '6', planned_date: '2026-10-12', status: 'COMPLETED', shipment_numbers: ['109714050'] },
    { id: 'w7', wave_no: '7', planned_date: '2026-10-12', status: 'CANCELLED', shipment_numbers: ['109713888'] },
  ],
  posted: [{ wave_id: 'w6', shipment_number: '109714050', quantity: 792 }],
  loaded: [],
  ...o,
});

// The 13 Oct file: its own NO 5, 6, 7, and 12 Oct's three at the bottom with their old NO.
const day13 = () => [
  d('109717658', '5'), d('109717659', '6'), d('109717263', '7'),
  d('109713885', '5', { sku: '550038021' }), d('109713885', '5', { sku: '550050072' }),
  d('109714050', '6'), d('109713888', '7'),
];

test('13 Oct: Batal shipments get their own NO RESCHEDULE wave, the picked one is not planned again', () => {
  const r = sortEarlier(day13(), facts());
  assert.deepEqual(r.demand.map((x) => [x.shipmentNumber, x.waveNo]), [
    ['109717658', '5'], ['109717659', '6'], ['109717263', '7'],
    ['109713885', '5 RESCHEDULE'], ['109713885', '5 RESCHEDULE'], ['109713888', '7 RESCHEDULE'],
  ]);
  assert.deepEqual(r.decisions.map((x) => [x.kind, x.shipment, x.from.wave_no, x.kind === 'reschedule' ? x.waveNo : null]), [
    ['reschedule', '109713885', '5', '5 RESCHEDULE'],
    ['picked', '109714050', '6', null],
    ['reschedule', '109713888', '7', '7 RESCHEDULE'],
  ]);
  const picked = r.decisions.find((x) => x.kind === 'picked');
  assert.ok(picked && picked.kind === 'picked' && picked.quantity === 792);
  // 11 waves of the day + 2 RESCHEDULE = 13; here 3 + 2.
  assert.equal(new Set(r.demand.map((x) => x.waveNo)).size, 5);
});

test('the input is not changed; shipments without an earlier wave pass through untouched', () => {
  const demand = day13();
  const r = sortEarlier(demand, facts({ waves: [], posted: [] }));
  assert.equal(r.decisions.length, 0);
  assert.deepEqual(r.demand, demand);
  sortEarlier(demand, facts());
  assert.equal(demand[3].waveNo, '5', 'the original lines keep their NO');
});

test('loaded on the earlier day: planned as a new order, with a warning', () => {
  const r = sortEarlier([d('109714050', '6')], facts({ loaded: [{ wave_id: 'w6', shipment_number: '109714050' }] }));
  assert.deepEqual(r.demand.map((x) => x.waveNo), ['6']);
  assert.deepEqual(r.decisions.map((x) => x.kind), ['loaded']);
});

test('still open on an earlier day with nothing posted: not planned twice', () => {
  const r = sortEarlier([d('109714050', '6')], facts({ posted: [],
    waves: [{ id: 'w6', wave_no: '6', planned_date: '2026-10-12', status: 'PENDING', shipment_numbers: ['109714050'] }] }));
  assert.equal(r.demand.length, 0);
  assert.deepEqual(r.decisions.map((x) => x.kind), ['open']);
});

test('a Tunda (RESCHEDULED) wave is left to the carry-over flow', () => {
  const r = sortEarlier([d('109714050', '6')], facts({ posted: [],
    waves: [{ id: 'w6', wave_no: '6', planned_date: '2026-10-12', status: 'RESCHEDULED', shipment_numbers: ['109714050'] }] }));
  assert.deepEqual(r.demand.map((x) => x.waveNo), ['6']);
  assert.equal(r.decisions.length, 0);
});

test('the latest earlier wave decides: Batal on 11 Oct, then picked on 12 Oct', () => {
  const r = sortEarlier([d('109714050', '6')], facts({
    waves: [
      { id: 'w11', wave_no: '3', planned_date: '2026-10-11', status: 'CANCELLED', shipment_numbers: ['109714050'] },
      { id: 'w6', wave_no: '6', planned_date: '2026-10-12', status: 'COMPLETED', shipment_numbers: ['109714050'] },
    ] }));
  assert.deepEqual(r.decisions.map((x) => [x.kind, x.from.planned_date]), [['picked', '2026-10-12']]);
});

test('two Batal shipments of one earlier wave stay together; from different waves under one NO they do not merge', () => {
  const together = sortEarlier([d('A', '5'), d('B', '5')], facts({ posted: [],
    waves: [{ id: 'w5', wave_no: '5', planned_date: '2026-10-12', status: 'CANCELLED', shipment_numbers: ['A', 'B'] }] }));
  assert.deepEqual(together.demand.map((x) => x.waveNo), ['5 RESCHEDULE', '5 RESCHEDULE']);
  const apart = sortEarlier([d('A', '5'), d('B', '5')], facts({ posted: [],
    waves: [
      { id: 'w5', wave_no: '5', planned_date: '2026-10-12', status: 'CANCELLED', shipment_numbers: ['A'] },
      { id: 'w9', wave_no: '9', planned_date: '2026-10-11', status: 'CANCELLED', shipment_numbers: ['B'] },
    ] }));
  assert.deepEqual(apart.demand.map((x) => x.waveNo), ['5 RESCHEDULE', '5 RESCHEDULE-2']);
});

test('wave order: NO 5, then 5 RESCHEDULE, then 6; T-waves after every number, as before', () => {
  const nos = ['10', '6', '5 RESCHEDULE-2', 'T4', '5 RESCHEDULE', '5', '7 RESCHEDULE'];
  assert.deepEqual([...nos].sort(compareWaveNo), ['5', '5 RESCHEDULE', '5 RESCHEDULE-2', '6', '7 RESCHEDULE', '10', 'T4']);
});

test('the date in the file name', () => {
  assert.equal(fileDate('Warehouse Management System_13 Oktober 2026_.xlsx'), '2026-10-13');
  assert.equal(fileDate('Warehouse Management System_08 Oktober 2026_ RAHMAN(1).xlsx'), '2026-10-08');
  assert.equal(fileDate('WMS 1 Mei 2026.xlsx'), '2026-05-01');
  assert.equal(fileDate('picklist_2026-10-09.xlsx'), '2026-10-09');
  assert.equal(fileDate('Book2.xlsx'), null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
