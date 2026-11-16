/** Parsing the "data putaway" sheet (the database side is supabase/tests/04_putaway_import.sql). */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { readSheet } from '../lib/read-sheet';
import { parsePutawaySheet, parsePutawayDetail, stagingCode, isStagingKind, STAGING_LABELS, stagingProblem } from '../lib/putaway-sheet';

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

test('staging codes map to STAGING; floor and rack codes do not', () => {
  assert.equal(stagingCode('STAGE-IN'), 'STAGING');
  assert.equal(stagingCode(' stage in '), 'STAGING');
  assert.equal(stagingCode('STAGING-IN'), 'STAGING');
  assert.equal(stagingCode('STAGING'), 'STAGING');
  assert.equal(stagingCode('STG_01'), null);
  assert.equal(stagingCode('CB12A01'), null);
  assert.equal(stagingCode('QUA-SHELL'), null);
  assert.equal(stagingCode(''), null);
});

const REKAP = ['Pallet ID', 'BIN Location', 'Item Code', 'ACTUAL QTY', 'Batch No', 'Expired Date'];

test('Rekap STAGE-IN pallets become one STAGING row, summed per SKU + batch + expiry', () => {
  const d = parsePutawayDetail(sheetOf([
    REKAP,
    ['540000774460', 'STAGE-IN', 550046498, 4, '12718466', '2029-03-01'],
    ['540000774461', 'STAGE-IN', 550046498, 4, '12718466', '2029-03-01'],
    ['540000774462', 'stage-in', 550046498, 4, '12718466', '2029-03-01'],
  ]));
  assert.equal(d.rows.length, 1);
  const r = d.rows[0];
  assert.deepEqual([r.bin_code, r.sheet_bin, r.sku, r.quantity, r.error], ['STAGING', 'STAGE-IN', '550046498', 12, null]);
  assert.deepEqual(r.pallet_lines, [2, 3, 4]);
});

test('a Rekap pallet with blank BIN Location is not staged, only counted as pending', () => {
  const d = parsePutawayDetail(sheetOf([
    REKAP,
    ['540000774460', null, 550046498, 4, '12718466', '2029-03-01'],
    ['540000774461', 'CE35C01', 550070613, 44, 'B9', '2030-01-01'],
  ]));
  assert.deepEqual(d.rows.map((r) => r.bin_code), ['CE35C01']);
  assert.equal(d.rows[0].sheet_bin, undefined);
  assert.deepEqual(d.pending, { pallets: 1, quantity: 4 });
});

test('staging verdict kinds are told apart from conflict kinds', () => {
  assert.equal(isStagingKind('staging'), true);
  assert.equal(isStagingKind('staging_done'), true);
  assert.equal(isStagingKind('bin_occupied'), false);
  assert.equal(isStagingKind(null), false);
  assert.equal(STAGING_LABELS.staging_done, 'sudah dicatat di staging (dilewati)');
  assert.equal(isStagingKind('staging_less'), true);
  assert.equal(stagingProblem({ kind: 'staging_less', recorded: 80 }), 'Sheet kurang dari yang sudah dicatat di staging hari itu (80): tidak diposting, cek fisik / Adjust stok');
  assert.equal(stagingProblem({ kind: 'staging', recorded: 40 }), 'ke staging (tambahan; 40 sudah dicatat hari itu)');
  assert.equal(stagingProblem({ kind: 'staging', recorded: 0 }), 'ke staging');
  assert.equal(stagingProblem({ kind: 'staging_done', recorded: 80 }), 'sudah dicatat di staging (dilewati)');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
