/** Pallet cards from a checked receipt (lib/inbound/cards.ts): manufacture date for drum / pail / IBC / fluidbag. */
import { strict as assert } from 'node:assert';
import { receiptCards } from '../lib/inbound/cards';
import { showsMfgDate } from '../lib/form-checker/mfg';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPallet cards from a receipt');

const head = { doc_no: '990000203', shipment_no: '990000103', plan_date: '2026-10-29', doc_date: null, checked_by_name: 'ilham' };
const pallet = (o: Record<string, unknown> = {}) => ({ line_no: 1, quantity: 4, batch_lot: '54654654', expiry_date: '2030-10-29', mfg_date: '2026-09-01',
  items: { sku: '550044360', uom: 'EA', description: 'RimR4X15W40CI4E7DH1_1*209L_A227' }, bins: { bin_code: 'CA01B02' }, ...o });

test('a drum pallet prints its manufacture date (DD/MM/YYYY), bin, batch, expiry', () => {
  const { cards } = receiptCards(head, [pallet()]);
  assert.deepEqual([cards[0].mfgDate, cards[0].binLocation, cards[0].batchNo, cards[0].expDate], ['01/09/2026', 'CA01B02', '54654654', '29/10/2030']);
});

test('a 209 L drum recorded as EA is still a drum on the card, so the MFG DATE box shows', () => {
  const { master } = receiptCards(head, [pallet()]);
  assert.equal(master.get('550044360')?.uom, 'Drum');
  assert.equal(showsMfgDate('550044360', master.get('550044360')?.uom), true);
});

test('no manufacture date entered: taken from a Shell date-coded batch', () =>
  assert.equal(receiptCards(head, [pallet({ mfg_date: null, batch_lot: '14H26JJ' })]).cards[0].mfgDate, '14/08/2026'));

test('no date and no date code: left empty (write-in line on the card)', () =>
  assert.equal(receiptCards(head, [pallet({ mfg_date: null })]).cards[0].mfgDate, null));

test('cartons keep their unit and no manufacture date', () => {
  const r = receiptCards(head, [pallet({ mfg_date: null, items: { sku: '550070614', uom: 'CAR', description: 'HlxHX610W40SP_4*4L_A04W' } })]);
  assert.equal(r.cards[0].mfgDate, null);
  assert.equal(showsMfgDate('550070614', r.master.get('550070614')?.uom), false);
});

test('shipment number and month come from the plan', () => {
  const c = receiptCards(head, [pallet()]).cards[0];
  assert.deepEqual([c.shipmentNo, c.month, c.vendorAsnNo, c.putawayNo], [990000103, 'OCTOBER', '990000203', '990000203-1']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
