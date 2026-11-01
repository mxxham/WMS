/**
 * The raw "Rekap inbound <yyyymm>" workbook on the Putaway page: one sheet per day ("01".."31"),
 * the "data putaway" columns plus Pallet ID. Several pallets into one bin are one putaway;
 * pallets with no bin yet are still in staging; the day sheet sets the arrival date.
 */
import { strict as assert } from 'node:assert';
import * as XLSX from 'xlsx';
import { readSheet } from '../lib/read-sheet';
import { parsePutawayDetail, parsePutawaySheet, pickPutawaySheet, sheetDay } from '../lib/putaway-sheet';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const HEAD = ['Shipment No.', 'Item Code', 'QTY ORDER', 'UoM', 'Inbound Order no', 'ASN No', 'ACTUAL QTY', 'Pallet ID', 'BIN Location',
  'GR No.', 'Batch No', 'Manufacture Date', 'Expired Date', 'Putaway No.', 'PALLET LOSCAM', 'PALLET NON LOSCAM'];
const row = (sku: unknown, qty: unknown, pallet: unknown, bin: unknown, batch: unknown, exp: unknown) =>
  [null, sku, null, null, null, null, qty, pallet, bin, null, batch, null, exp, null, null, null];
const sheetOf = (aoa: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...aoa]), '24');
  return readSheet(wb, '24');
};

console.log('\nPutaway: Rekap inbound');

test('two pallets into one bin (distinct Pallet IDs) are one putaway of the summed qty', () => {
  const { rows } = parsePutawayDetail(sheetOf([
    row('550076426', 1, 540000849574, 'CA11A02', '12616808', '2030-02-08'),
    row('550076426', 1, 540000849575, 'CB18A02', '12616808', '2030-02-08'),
    row('550076426', 1, 540000849576, 'CB18A02', '12616808', '2030-02-08'),
  ]));
  assert.deepEqual(rows.map((r) => [r.line, r.bin_code, r.quantity, r.error, r.pallet_lines ?? null]), [
    [2, 'CA11A02', 1, null, null],
    [3, 'CB18A02', 2, null, [3, 4]],
  ]);
});

test('the same Pallet ID twice is still a duplicate', () => {
  const rows = parsePutawaySheet(sheetOf([
    row('550076426', 1, 540000849575, 'CB18A02', '12616808', '2030-02-08'),
    row('550076426', 1, 540000849575, 'CB18A02', '12616808', '2030-02-08'),
  ]));
  assert.equal(rows[0].quantity, 1);
  assert.match(rows[1].error ?? '', /Duplikat dengan baris 2 \(Pallet ID 540000849575 sama\)/);
});

test('pallets without a BIN Location are counted as waiting, not rows or errors', () => {
  const { rows, pending } = parsePutawayDetail(sheetOf([
    row('550049045', 48, 540000849867, 'CF23E02', '13J26JJ', '2030-10-13'),
    [],
    ['109720903', '550044709', 960, 'CAR', 'IB/2026/101846', null, 48, 540000849868, null, null, null, null, null, null, null, null],
    row(null, 48, 540000849869, null, null, null),
    row(null, 48, 540000849870, null, null, null),
  ]));
  assert.deepEqual(rows.map((r) => [r.bin_code, r.error]), [['CF23E02', null]]);
  assert.deepEqual(pending, { pallets: 3, quantity: 144 });
});

test('the WMS "data putaway" sheet (no Pallet ID) keeps its duplicate rule', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['BIN Location', 'Item Code', 'ACTUAL QTY', 'Batch No', 'Expired Date'],
    ['CD01A01', 550044709, 24, 'P1', '2031-05-05'],
    ['CD01A01', 550044709, 24, 'P1', '2031-05-05'],
    [null, 550044709, 24, 'P1', '2031-05-05'],
  ]), 'data putaway');
  const { rows, pending } = parsePutawayDetail(readSheet(wb, 'data putaway'));
  assert.deepEqual(rows.map((r) => r.error), [null, 'Duplikat dengan baris 2', 'Kode bin kosong']);
  assert.equal(pending.pallets, 0);
});

test('day sheets: the file name gives the month', () => {
  assert.equal(sheetDay('27', 'Rekap inbound 202610 (30).xlsx'), '2026-10-27');
  assert.equal(sheetDay('01', 'Rekap inbound 202610.xlsx'), '2026-10-01');
  assert.equal(sheetDay('31', 'Rekap inbound 202611.xlsx'), null);
  assert.equal(sheetDay('27', 'Rekap inbound.xlsx'), null);
  assert.equal(sheetDay('data putaway', 'Rekap inbound 202610.xlsx'), null);
});

test('the first sheet opened: "data putaway", else the arrival day, else the last day before it', () => {
  const days = ['01', '02', '24', '26', '27', '28'];
  const f = 'Rekap inbound 202610 (30).xlsx';
  assert.equal(pickPutawaySheet(['WMS', 'data putaway', 'MASTER DATA'], 'Warehouse_Management_System.xlsx', '2026-10-27'), 'data putaway');
  assert.equal(pickPutawaySheet(days, f, '2026-10-27'), '27');
  assert.equal(pickPutawaySheet(days, f, '2026-10-25'), '24');
  assert.equal(pickPutawaySheet(days, f, '2026-10-31'), '28');
  assert.equal(pickPutawaySheet(days, f, '2026-09-30'), '01');
  assert.equal(pickPutawaySheet(days, 'no-month.xlsx', '2026-10-27'), '01');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
