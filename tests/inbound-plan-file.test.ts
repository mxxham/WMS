/** Inbound plan file "INBOUND SHELL, <hari> <tanggal>" (lib/inbound/plan-file.ts). */
import { strict as assert } from 'node:assert';
import * as XLSX from 'xlsx';
import { parseInboundPlan } from '../lib/inbound/plan-file';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nInbound plan file');

// Laid out like the 29 Oct screenshot: title, header, a data row, an empty (yellow) row, ...
const HEAD = ['No.', 'Shipment No.', 'Delivery Order No.', 'Sales Order No.', 'Material No.', 'Material Description', 'Qty.', 'UoM',
  'Total Ltr.', 'Container No.', 'Seal No.', 'Transporter', 'Slot Time'];
const book = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return wb;
};
const sample = book([
  ['', '', '', '', '', 'INBOUND SHELL, KAMIS 29 OKTOBER 2026'],
  HEAD,
  [1, 109718765, 538999563, 4550721436, 550070614, 'HlxHX610W40SP_4*4L_A04W', 720, 'CAR', 11520, 'HPCU2051790', 'JKT068035', 'SILKARGO', 9.5 / 24],
  [],
  [2, 109718766, 538999581, 4550721436, 550070614, 'HlxHX610W40SP_4*4L_A04W', 720, 'CAR', 11520, 'HPCU2051337', 'JKT068036', 'SILKARGO', '10:30'],
  [],
  [4, 109736726, 539301483, 4550779947, 550044360, 'RimR4X15W40CI4E7DH1_1*209L_A227', 80, 'EA', 16720, 'HPCU2051023', 'JKT068008', 'SILKARGO', 14 / 24],
  [5, 109736726, 539301483, 4550779947, 550038021, 'Helix HX320W50SLCF_4*4L_A04W', 40, 'CAR', 640, 'HPCU2051023', 'JKT068008', 'SILKARGO', 14 / 24],
]);
const p = parseInboundPlan(sample);

test('date from the title (Indonesian month)', () => assert.equal(p.date, '2026-10-29'));
test('one document per Delivery Order, empty rows skipped', () =>
  assert.deepEqual(p.docs.map((d) => d.doc_no), ['538999563', '538999581', '539301483']));
test('header fields of a document', () => {
  const d = p.docs[0];
  assert.deepEqual([d.shipment_no, d.sales_order, d.container_no, d.seal_no, d.transporter, d.slot_time],
    ['109718765', '4550721436', 'HPCU2051790', 'JKT068035', 'SILKARGO', '09:30']);
});
test('slot time typed as text is kept', () => assert.equal(p.docs[1].slot_time, '10:30'));
test('two SKUs on one DO are two lines of one document', () => {
  const d = p.docs[2];
  assert.deepEqual(d.lines.map((l) => [l.sku, l.quantity, l.uom]), [['550044360', 80, 'EA'], ['550038021', 40, 'CAR']]);
  assert.equal(d.lines[0].litres, 16720);
});
test('a row without a material or quantity is reported, not dropped silently', () => {
  const r = parseInboundPlan(book([HEAD, [1, 1, 539, 1, '', 'x', 10, 'CAR'], [2, 1, 540, 1, 550070614, 'x', '', 'CAR']]));
  assert.equal(r.docs.length, 0);
  assert.equal(r.skipped.length, 2);
});
test('a file without the header is refused with a sentence', () =>
  assert.throws(() => parseInboundPlan(book([['a', 'b'], [1, 2]])), /Delivery Order/));
test('no date in the title: date is null', () =>
  assert.equal(parseInboundPlan(book([HEAD, [1, 1, 539, 1, 550070614, 'x', 10, 'CAR']])).date, null));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
