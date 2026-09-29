/** Picking audit from the WMS file (lib/sheet-picklist.ts). */
import { strict as assert } from 'node:assert';
import * as XLSX from 'xlsx';
import { kOneLines, mergeLines, skuBatches, stagedLines, type SheetPickLine } from '../lib/sheet-picklist';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPicklist from the WMS file');

const HEAD = ['Picklist', 'NO (Wave)', 'Shipments', 'DO Number', 'Seq', 'Lokasi', 'Chk', 'Material', 'Description', 'Ke Lokasi',
  'Batch', 'Exp Date', 'Qty Pick', 'UOM', 'Pick Type'];
function book(rows: unknown[][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'K_ONE');
  // Round-trip like an uploaded file, dates included.
  return XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true });
}

test('reads K_ONE rows below a header that is not on row 1', () => {
  const lines = kOneLines(book([
    [null, null, null, ' '],
    HEAD,
    ['PL-1', 1, 109693263, 'DO1', 1, 'cd40a02', null, 550024918, 'Spirax', 'STG', '12600813', new Date(Date.UTC(2030, 0, 10)), 2, 'EA', 'CASE'],
  ]));
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    picklist: 'PL-1', wave_no: '1', shipment_number: '109693263', seq: 1, bin_code: 'CD40A02', sku: '550024918',
    description: 'Spirax', uom: 'EA', batch: '12600813', expiry: '2030-01-10', qty: 2, picker_name: null,
  });
});

test('skips empty, #N/A and zero-quantity rows', () => {
  const lines = kOneLines(book([
    HEAD,
    [null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, '#N/A', null, 2, 'CA01A01', null, '#N/A', null, null, null, null, 3],
    ['PL', 1, 'S1', null, 3, 'CA01A01', null, 550044709, 'x', null, 'A7', null, 0],
  ]));
  assert.equal(lines.length, 0);
});

test('an empty K_ONE (header only) or a missing sheet gives no lines', () => {
  assert.equal(kOneLines(book([HEAD])).length, 0);
  assert.equal(kOneLines(XLSX.utils.book_new()).length, 0);
});

test('same shipment + bin + SKU + batch is one line, quantities added', () => {
  const l = (o: Partial<SheetPickLine>): SheetPickLine => ({
    picklist: null, wave_no: null, shipment_number: 'S1', seq: 1, bin_code: 'CA01A01', sku: '1', description: '', uom: null,
    batch: 'A7', expiry: null, qty: 1, picker_name: null, ...o,
  });
  const out = mergeLines([l({ seq: 4, qty: 2 }), l({ seq: 2, qty: 3, batch: ' a7' }), l({ batch: 'B8' })]);
  assert.equal(out.length, 2);
  assert.equal(out[0].qty, 5);
  assert.equal(out[0].seq, 2);
});

test('short lines already at staging: STAGING bin, batch from the WMS sheet (earliest expiry)', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [null], [null], [null],
    ['xxx', 'Lokasi', 'Batch', 'Expired Date', 'item', 'Remain Qty'],
    ['a', 'CD26A02', '12663924', new Date(Date.UTC(2030, 5, 22)), 550056224, 0],
    ['b', 'CE03A02', 12663924, new Date(Date.UTC(2030, 5, 22)), 550056224, 0],
    ['c', 'CA01A01', 'LATE', new Date(Date.UTC(2031, 0, 1)), 550056224, 4],
  ]), 'WMS');
  const batches = skuBatches(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true }));
  assert.deepEqual(batches.get('550056224'), [{ batch: '12663924', expiry: '2030-06-22' }, { batch: 'LATE', expiry: '2031-01-01' }]);
  const short = { shipmentNumber: '109689769', orderNos: [], sku: '550056224', description: 'IAGO', qtyRequested: 3, qtyAllocated: 0, qtyShort: 3,
    reason: 'NO_STOCK' as const, qtyRejectedByShelfLife: 0, qtyInStaging: 0 };
  const [l] = stagedLines([short], batches, new Map([['109689769', '7']]));
  assert.equal(l.bin_code, 'STAGING');
  assert.equal(l.batch, '12663924');
  assert.equal(l.expiry, '2030-06-22');
  assert.equal(l.qty, 3);
  assert.equal(l.wave_no, '7');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
