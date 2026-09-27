/** Parsing the "data putaway" sheet (the database side is supabase/tests/04_putaway_import.sql). */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { readSheet } from '../lib/read-sheet';
import { parsePutawaySheet } from '../lib/putaway-sheet';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const sheetOf = (aoa: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'data putaway');
  return readSheet(wb, 'data putaway');
};
const HEADER = ['BIN Location', 'Item Code', 'ACTUAL QTY', 'Batch No', 'Expired Date', 'cek dobel'];
console.log('\nPutaway sheet');

test('real 24 Sep sheet: 60 rows, no errors, dates in Jakarta calendar', () => {
  const wb = XLSX.read(readFileSync('data/Warehouse_Management_System_24_September_2026_.xlsx'), { cellDates: true, sheets: ['data putaway'] });
  const rows = parsePutawaySheet(readSheet(wb, 'data putaway'));
  assert.equal(rows.length, 60);
  assert.deepEqual(rows.filter((r) => r.error), []);
  const r = rows.find((x) => x.bin_code === 'CD21D02')!;
  assert.deepEqual([r.sku, r.batch_lot, r.quantity, r.expiry_date], ['550058593', '15I26JJ', 48, '2030-09-15']);
});

test('row problems are reported per line; blank rows skipped', () => {
  const rows = parsePutawaySheet(sheetOf([
    HEADER,
    ['cd01a01', 550044709, 24, 'P1', '2031-05-05', 1],
    ['CD01A01', 550044709, 24, 'P1', '2031-05-05', 1],
    [null, null, null, null, null, 'note'],
    ['CD01A02', 550044709, 'dua', 'P1', '2031-05-05'],
    ['CD01A03', 550044709, 24, 'P1', null],
    ['CD01A04', null, 24, 'P1', '2031-05-05'],
  ]));
  assert.deepEqual(rows.map((r) => [r.line, r.error]), [
    [2, null], [3, 'Duplikat dengan baris 2'], [5, 'Qty tidak valid (dua)'], [6, 'Tanggal expired kosong'], [7, 'Item code kosong'],
  ]);
  assert.equal(rows[0].bin_code, 'CD01A01');
});

test('missing columns are refused with the expected header names', () => {
  assert.throws(() => parsePutawaySheet(sheetOf([['BIN Location', 'Item Code'], ['CD01A01', 1]])), /ACTUAL QTY/);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
