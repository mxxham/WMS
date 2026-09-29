/** Parked orders coming back under a new shipment number (lib/allocator/carry-over.ts). */
import { strict as assert } from 'node:assert';
import { matchParked, type ParkedOrder } from '../lib/allocator/carry-over';
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
