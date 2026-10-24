/** Parked orders coming back under a new shipment number (lib/allocator/carry-over.ts). */
import { strict as assert } from 'node:assert';
import { matchParked, type ParkedOrder, nextFreeWaveNo, planRemainders, type CarryMatch, type RemainderSave } from '../lib/allocator/carry-over';
import type { DemandLine } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nCarry over parked orders');

const d = (o: Partial<DemandLine>): DemandLine => ({
  shipmentNumber: '109693399', waveNo: '7', orderNos: ['538386834'], sku: '550056224', description: 'IAGO', qtyCartons: 3, upp: 4,
  destination: 'PT ASTRA', shipToLocation: 'SURABAYA', transport: null, truckType: null, slotTime: null, deliveryDate: null, ...o,
} as DemandLine);
const p = (o: Partial<ParkedOrder>): ParkedOrder => ({
  wave_id: 'w16', wave_no: '16', planned_date: '2026-09-29', shipment_number: '109689769', sku: '550056224', description: 'IAGO',
  order_nos: ['538386834'], quantity_requested: 3, quantity_picked: 0, posted_tasks: 0, ...o,
});

test('same SKU + Order No under a new shipment number is the parked order', () => {
  const demand = [d({}), d({ sku: '550044709', orderNos: ['999'] })];
  const { matches, matchedDemand } = matchParked(demand, [p({ posted_tasks: 1 })]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].mode, 'carry');
  assert.deepEqual(matches[0].shipments, { '109689769': '109693399' });
  assert.equal(matchedDemand.size, 1);
  assert.ok(matchedDemand.has(demand[0]));
});
test('same shipment number again: matched, nothing to rename', () => {
  const { matches } = matchParked([d({ shipmentNumber: '109689769' })], [p({})]);
  assert.deepEqual(matches[0].shipments, {});
});
test('same shipment number is enough, even without an Order No', () => {
  const { matches } = matchParked([d({ shipmentNumber: '109689769', orderNos: [''] })], [p({})]);
  assert.equal(matches.length, 1);
});
test('another Order No or SKU is not the same order', () => {
  assert.equal(matchParked([d({ orderNos: ['538386835'] })], [p({})]).matches.length, 0);
  assert.equal(matchParked([d({ shipmentNumber: '109689769', sku: '550056227' })], [p({})]).matches.length, 0);
  assert.equal(matchParked([d({ sku: '550056227' })], [p({})]).matches.length, 0);
});
test('a parked line not on today\'s schedule moves along and is listed', () => {
  const { matches } = matchParked([d({})], [p({}), p({ sku: '550056227', order_nos: ['538386834'], quantity_requested: 1 })]);
  assert.deepEqual(matches[0].unmatched, [{ sku: '550056227', shipment: '109689769', qty: 1 }]);
});
test('one old shipment split over two new ones is flagged', () => {
  const { matches } = matchParked([d({}), d({ sku: '550056227', shipmentNumber: '109693400' })],
    [p({}), p({ sku: '550056227' })]);
  assert.equal(matches[0].ambiguous, true);
});
test('quantities differ: both kept for the warning', () => {
  const { matches } = matchParked([d({ qtyCartons: 2 })], [p({})]);
  assert.deepEqual([matches[0].lines[0].oldQty, matches[0].lines[0].newQty], [3, 2]);
});

test('nothing picked yet: planned fresh, the whole shipment (with a new item) stays in the plan', () => {
  const demand = [d({ shipmentNumber: '109689769' }), d({ shipmentNumber: '109689769', sku: '550044709', orderNos: ['538999999'] })];
  const { matches, matchedDemand } = matchParked(demand, [p({})]);
  assert.equal(matches[0].mode, 'fresh');
  assert.equal(matchedDemand.size, 0);
});
test('something picked: only the old item leaves the plan, the new item is planned (then merged)', () => {
  const demand = [d({ shipmentNumber: '109689769' }), d({ shipmentNumber: '109689769', sku: '550044709', orderNos: ['538999999'] })];
  const { matchedDemand } = matchParked(demand, [p({ posted_tasks: 2 })]);
  assert.deepEqual([...matchedDemand].map((x) => x.sku), ['550056224']);
});

// --- nextFreeWaveNo tests ---
test('nextFreeWaveNo: empty taken set returns "1"', () => {
  const result = nextFreeWaveNo(new Set<string>());
  assert.equal(result, '1');
});
test('nextFreeWaveNo: taken {1,2,9} returns "3"', () => {
  const result = nextFreeWaveNo(new Set(['1', '2', '9']));
  assert.equal(result, '3');
});
test('nextFreeWaveNo: taken {1,2,3} returns "4"', () => {
  const result = nextFreeWaveNo(new Set(['1', '2', '3']));
  assert.equal(result, '4');
});
test('nextFreeWaveNo: taken with non-numeric strings ignored', () => {
  const result = nextFreeWaveNo(new Set(['T5', '5-2', '7']));
  assert.equal(result, '1');
});

// --- planRemainders tests ---
const demandFresh = (o: Partial<DemandLine>): DemandLine => ({
  shipmentNumber: 'SHIP001', waveNo: '1', orderNos: ['ORD001'], sku: 'SKU001', description: 'Item A', qtyCartons: 10, upp: 4,
  destination: 'DEST', shipToLocation: 'LOC', transport: null, truckType: null, slotTime: null, deliveryDate: null, ...o,
} as DemandLine);
const parkedBase = (o: Partial<ParkedOrder>): ParkedOrder => ({
  wave_id: 'w1', wave_no: '5', planned_date: '2026-09-24', shipment_number: 'SHIP001', sku: 'SKU001', description: 'Item A',
  order_nos: ['ORD001'], quantity_requested: 10, quantity_picked: 0, posted_tasks: 1, ...o,
} as ParkedOrder);

test('planRemainders: ambiguous carry match leaves demand untouched and adds wave_no to skippedFrom', () => {
  const demand = [demandFresh({ sku: 'SKU001' }), demandFresh({ sku: 'SKU002', shipmentNumber: 'SHIP002', qtyCartons: 5 })];
  const matches: CarryMatch[] = [{
    wave_id: 'w1', wave_no: '5', planned_date: '2026-09-24', posted_tasks: 1,
    shipments: { 'SHIP001': 'SHIP001' },
    lines: [
      { sku: 'SKU001', description: 'Item A', oldShipment: 'SHIP001', newShipment: 'SHIP001', oldQty: 10, newQty: 10 },
      { sku: 'SKU002', description: 'Item B', oldShipment: 'SHIP001', newShipment: 'SHIP002', oldQty: 5, newQty: 5 },
    ],
    unmatched: [], ambiguous: true, mode: 'carry',
  }];
  const parked: ParkedOrder[] = [
    parkedBase({ sku: 'SKU001', quantity_picked: 3 }),
    parkedBase({ sku: 'SKU002', shipment_number: 'SHIP001', quantity_picked: 1 }),
  ];
  const { demand: newDemand, remainders } = planRemainders(demand, matches, parked, new Set(['1', '2', '5']));
  // demand unchanged for ambiguous
  assert.equal(newDemand.length, 2);
  assert.equal(newDemand[0].qtyCartons, 10);
  assert.equal(newDemand[1].qtyCartons, 5);
  assert.deepEqual(remainders.skippedFrom, ['5']);
  assert.deepEqual(remainders.retracts, []);
});

test('planRemainders: ordinary carry match with quantity_picked < newQty creates remainder line with fresh waveNo', () => {
  const demand = [demandFresh({ sku: 'SKU001', qtyCartons: 10 })];
  const matches: CarryMatch[] = [{
    wave_id: 'w1', wave_no: '5', planned_date: '2026-09-24', posted_tasks: 1,
    shipments: { 'SHIP001': 'SHIP001' },
    lines: [{ sku: 'SKU001', description: 'Item A', oldShipment: 'SHIP001', newShipment: 'SHIP001', oldQty: 10, newQty: 10 }],
    unmatched: [], ambiguous: false, mode: 'carry',
  }];
  const parked: ParkedOrder[] = [parkedBase({ quantity_picked: 3 })];
  const taken = new Set<string>(['1', '2', '5']);
  const { demand: newDemand, remainders } = planRemainders(demand, matches, parked, taken);
  // original demand line should be replaced with remainder qty = 10 - 3 = 7
  assert.equal(newDemand.length, 1);
  assert.equal(newDemand[0].qtyCartons, 7);
  // waveNo should be fresh numeric not in taken
  assert.ok(!taken.has(newDemand[0].waveNo), `waveNo ${newDemand[0].waveNo} should not be in taken`);
  assert.ok(/^\d+$/.test(newDemand[0].waveNo), `waveNo ${newDemand[0].waveNo} should be numeric`);
  // retract entry present
  assert.deepEqual(remainders.retracts, [{ wave_id: 'w1', shipment_number: 'SHIP001', reason: 'sisanya direncanakan ulang' }]);
  assert.deepEqual(remainders.skippedFrom, []);
});

test('planRemainders: ordinary carry match with quantity_picked >= newQty drops the line', () => {
  const demand = [demandFresh({ sku: 'SKU001', qtyCartons: 10 })];
  const matches: CarryMatch[] = [{
    wave_id: 'w1', wave_no: '5', planned_date: '2026-09-24', posted_tasks: 1,
    shipments: { 'SHIP001': 'SHIP001' },
    lines: [{ sku: 'SKU001', description: 'Item A', oldShipment: 'SHIP001', newShipment: 'SHIP001', oldQty: 10, newQty: 10 }],
    unmatched: [], ambiguous: false, mode: 'carry',
  }];
  const parked: ParkedOrder[] = [parkedBase({ quantity_picked: 10 })];
  const { demand: newDemand, remainders } = planRemainders(demand, matches, parked, new Set(['1', '2', '5']));
  assert.equal(newDemand.length, 0);
  assert.deepEqual(remainders.retracts, [{ wave_id: 'w1', shipment_number: 'SHIP001', reason: 'sisanya direncanakan ulang' }]);
});

test('planRemainders: multiple SKUs per shipment each get remainder lines', () => {
  const demand = [
    demandFresh({ sku: 'SKU001', qtyCartons: 10 }),
    demandFresh({ sku: 'SKU002', qtyCartons: 5 }),
  ];
  const matches: CarryMatch[] = [{
    wave_id: 'w1', wave_no: '5', planned_date: '2026-09-24', posted_tasks: 1,
    shipments: { 'SHIP001': 'SHIP001' },
    lines: [
      { sku: 'SKU001', description: 'Item A', oldShipment: 'SHIP001', newShipment: 'SHIP001', oldQty: 10, newQty: 10 },
      { sku: 'SKU002', description: 'Item B', oldShipment: 'SHIP001', newShipment: 'SHIP001', oldQty: 5, newQty: 5 },
    ],
    unmatched: [], ambiguous: false, mode: 'carry',
  }];
  const parked: ParkedOrder[] = [
    parkedBase({ sku: 'SKU001', quantity_picked: 3 }),
    parkedBase({ sku: 'SKU002', quantity_picked: 2 }),
  ];
  const { demand: newDemand, remainders } = planRemainders(demand, matches, parked, new Set(['1', '2', '5']));
  assert.equal(newDemand.length, 2);
  assert.equal(newDemand.find(d => d.sku === 'SKU001')!.qtyCartons, 7);
  assert.equal(newDemand.find(d => d.sku === 'SKU002')!.qtyCartons, 3);
  // one retract per shipment
  assert.deepEqual(remainders.retracts, [{ wave_id: 'w1', shipment_number: 'SHIP001', reason: 'sisanya direncanakan ulang' }]);
});

test('planRemainders: multiple carried waves each get retract entry', () => {
  const demand = [
    demandFresh({ sku: 'SKU001', qtyCartons: 10, shipmentNumber: 'SHIP001' }),
    demandFresh({ sku: 'SKU002', qtyCartons: 5, shipmentNumber: 'SHIP002' }),
  ];
  const matches: CarryMatch[] = [
    {
      wave_id: 'w1', wave_no: '5', planned_date: '2026-09-24', posted_tasks: 1,
      shipments: { 'SHIP001': 'SHIP001' },
      lines: [{ sku: 'SKU001', description: 'Item A', oldShipment: 'SHIP001', newShipment: 'SHIP001', oldQty: 10, newQty: 10 }],
      unmatched: [], ambiguous: false, mode: 'carry',
    },
    {
      wave_id: 'w2', wave_no: '6', planned_date: '2026-09-24', posted_tasks: 1,
      shipments: { 'SHIP002': 'SHIP002' },
      lines: [{ sku: 'SKU002', description: 'Item B', oldShipment: 'SHIP002', newShipment: 'SHIP002', oldQty: 5, newQty: 5 }],
      unmatched: [], ambiguous: false, mode: 'carry',
    },
  ];
  const parked: ParkedOrder[] = [
    parkedBase({ wave_id: 'w1', wave_no: '5', sku: 'SKU001', quantity_picked: 3 }),
    parkedBase({ wave_id: 'w2', wave_no: '6', shipment_number: 'SHIP002', sku: 'SKU002', quantity_picked: 2 }),
  ];
  const { demand: newDemand, remainders } = planRemainders(demand, matches, parked, new Set(['1', '2', '5', '6']));
  assert.equal(newDemand.length, 2);
  assert.equal(remainders.retracts.length, 2);
  assert.ok(remainders.retracts.some(r => r.wave_id === 'w1' && r.shipment_number === 'SHIP001'));
  assert.ok(remainders.retracts.some(r => r.wave_id === 'w2' && r.shipment_number === 'SHIP002'));
});

// --- Regression tests through real matchParked ---

test('REGRESSION: same-shipment core scenario via real matchParked — retract keyed on oldShipment', () => {
  // Parked order with posted_tasks=1, quantity_picked=3, quantity_requested=10
  // Demand line with SAME shipment number SHIP001, qty 10
  const parked: ParkedOrder[] = [parkedBase({ quantity_picked: 3, posted_tasks: 1 })];
  const demand = [demandFresh({ sku: 'SKU001', qtyCartons: 10 })];
  const { matches } = matchParked(demand, parked);
  // matchParked deletes same-number from shipments map
  assert.deepEqual(matches[0].shipments, {});
  // But lines retain oldShipment = 'SHIP001'
  assert.equal(matches[0].lines[0].oldShipment, 'SHIP001');
  assert.equal(matches[0].lines[0].newShipment, 'SHIP001');
  assert.equal(matches[0].mode, 'carry');
  assert.equal(matches[0].ambiguous, false);

  // Now planRemainders should create retract keyed on oldShipment
  const { demand: newDemand, remainders } = planRemainders(demand, matches, parked, new Set(['1', '2', '5']));
  assert.equal(newDemand.length, 1);
  assert.equal(newDemand[0].qtyCartons, 7); // 10 - 3
  assert.ok(/^\d+$/.test(newDemand[0].waveNo));
  assert.deepEqual(remainders.retracts, [{ wave_id: 'w1', shipment_number: 'SHIP001', reason: 'sisanya direncanakan ulang' }]);
});

test('REGRESSION: rename scenario via real matchParked — retract keyed on parked shipment (oldShipment)', () => {
  // Parked shipment SHIP999, today's demand is SHIP001 (same order_no)
  const parked: ParkedOrder[] = [parkedBase({ shipment_number: 'SHIP999', quantity_picked: 2, posted_tasks: 1 })];
  const demand = [demandFresh({ sku: 'SKU001', qtyCartons: 10, shipmentNumber: 'SHIP001', orderNos: ['ORD001'] })];
  const { matches } = matchParked(demand, parked);
  // matchParked creates rename map SHIP999 -> SHIP001
  assert.deepEqual(matches[0].shipments, { 'SHIP999': 'SHIP001' });
  assert.equal(matches[0].lines[0].oldShipment, 'SHIP999');
  assert.equal(matches[0].lines[0].newShipment, 'SHIP001');
  assert.equal(matches[0].mode, 'carry');

  // planRemainders: remainder line under new shipment SHIP001, retract keyed on old SHIP999
  const { demand: newDemand, remainders } = planRemainders(demand, matches, parked, new Set(['1', '2', '5']));
  assert.equal(newDemand.length, 1);
  assert.equal(newDemand[0].qtyCartons, 8); // 10 - 2
  assert.equal(newDemand[0].shipmentNumber, 'SHIP001');
  assert.deepEqual(remainders.retracts, [{ wave_id: 'w1', shipment_number: 'SHIP999', reason: 'sisanya direncanakan ulang' }]);
});

test('REGRESSION: multiple SKUs same parked shipment — single retract per wave|oldShipment', () => {
  const parked: ParkedOrder[] = [
    parkedBase({ sku: 'SKU001', quantity_picked: 3, posted_tasks: 1 }),
    parkedBase({ sku: 'SKU002', quantity_picked: 1, posted_tasks: 1 }),
  ];
  const demand = [
    demandFresh({ sku: 'SKU001', qtyCartons: 10 }),
    demandFresh({ sku: 'SKU002', qtyCartons: 5 }),
  ];
  const { matches } = matchParked(demand, parked);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].mode, 'carry');
  assert.equal(matches[0].lines.length, 2);

  const { demand: newDemand, remainders } = planRemainders(demand, matches, parked, new Set(['1', '2', '5']));
  assert.equal(newDemand.length, 2);
  assert.equal(newDemand.find(d => d.sku === 'SKU001')!.qtyCartons, 7);
  assert.equal(newDemand.find(d => d.sku === 'SKU002')!.qtyCartons, 4);
  // Only ONE retract for the single oldShipment SHIP001
  assert.deepEqual(remainders.retracts, [{ wave_id: 'w1', shipment_number: 'SHIP001', reason: 'sisanya direncanakan ulang' }]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
