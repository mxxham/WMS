/** Buku stok: SAP's book of a day from the daily MB52/MB51 workbook (lib/ledger/sap-book.ts), on the real file of 28 Oct 2026 (= the day 27 Oct). */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type { Mb51Row, Mb52Row } from '../lib/sap-stock';
import { readSapWorkbook, sapBook, type SapBookLine } from '../lib/ledger/sap-book';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const row = (o: Partial<Mb51Row>): Mb51Row => ({
  line_no: 2, sku: '550000001', description: 'x', sloc: 'WHS1', mvt_type: '601', mvt_text: '', mat_doc: '1',
  posting_date: '2026-10-28', quantity: 0, uom: 'CAR', reference: '', customer: '', customer_name: '', user_name: '', ...o,
});
const mb52 = (sku: string, unrestricted: number, blocked: number, sloc = 'WHS1'): Mb52Row => ({
  sku, description: 'x', uom: 'CAR', plant: 'I003', sloc, batch: 'UT', unrestricted, blocked, sheet: 'mb52', line: 2,
});
const sum = (ls: SapBookLine[], k: keyof SapBookLine) => ls.reduce((s, l) => s + Number(l[k]), 0);

console.log('\nBuku stok: SAP book');

const wb = XLSX.read(readFileSync('data/MB52_2810_28_Oktober_2026.xlsx'));
const book = readSapWorkbook(wb, 'MB52 2810_28 Oktober 2026.xlsx');
const line = (sku: string) => {
  const l = book.lines.find((x) => x.sku === sku);
  if (!l) throw new Error(`no line for ${sku}`);
  return l;
};

test('the day is the MB51 posting date (27 Oct; the file is named after the 28th morning stock)', () => assert.equal(book.date, '2026-10-27'));

test('akhir = MB52 WHS1 as printed (the next morning stock)', () => {
  assert.equal(sum(book.lines, 'akhir_unrest'), 59477);
  assert.equal(sum(book.lines, 'akhir_block'), 18);
});

test('awal = akhir minus the day movements', () =>
  assert.equal(sum(book.lines, 'awal_unrest'), 59477 - 4546 + 114 - sum(book.lines, 'other_unrest')));

test('inbound 101 + Z31 = 4546, outbound 601 - 602 = 114', () => {
  assert.equal(sum(book.lines, 'inbound'), 4546);
  assert.equal(sum(book.lines, 'outbound'), 114);
});

test('550062464: MB52 7369 after two Z31 of 960 in and 5 out, so awal 5454', () => {
  const l = line('550062464');
  assert.deepEqual([l.awal_unrest, l.inbound, l.outbound, l.akhir_unrest], [5454, 1920, 5, 7369]);
});

test('550049045: 101 of 219 and Z31 of 960 both count', () => assert.equal(line('550049045').inbound, 1179));

test('550066782 only in MB51: akhir 0, 8 out and 5 to RETN, so awal 13', () => {
  const l = line('550066782');
  assert.deepEqual([l.akhir_unrest, l.outbound, l.other_by_type['311'], l.awal_unrest], [0, 8, -5, 13]);
});

test('INBD total is information only', () => {
  assert.equal(book.inbdTotal, 23540);
  assert.equal(sum(book.lines, 'akhir_unrest'), 59477, 'INBD never reaches the WHS1 stock');
});

test('two posting dates are refused', () =>
  assert.throws(() => sapBook([], [row({ posting_date: '2026-10-28' }), row({ posting_date: '2026-10-29' })], 'x.xlsx'), /lebih dari satu tanggal/));

test('no date in MB51 or the file name is refused', () =>
  assert.throws(() => sapBook([mb52('1', 1, 0)], [], 'stok.xlsx'), /Tanggal file tidak terbaca/));

test('no MB51 rows: the day before the file-name date', () =>
  assert.equal(sapBook([mb52('1', 1, 0)], [], 'MB52 2810_28 Oktober 2026.xlsx').date, '2026-10-27'));

test('343 / 344 / Z55 move between unrestricted and blocked', () => {
  const b = sapBook([mb52('1', 10, 2)], [
    row({ sku: '1', mvt_type: '344', quantity: 3 }), row({ sku: '1', mvt_type: '344', quantity: -3 }),
    row({ sku: '1', mvt_type: '343', quantity: 1 }), row({ sku: '1', mvt_type: '343', quantity: -1 }),
    row({ sku: '1', mvt_type: 'Z55', quantity: -2 }),
  ], 'x.xlsx');
  const l = b.lines[0];
  // akhir 10 / 2 from MB52; awal unrest = 10 - 1 + 3, awal block = 2 - 3 + 1 + 2
  assert.deepEqual([l.mv344, l.mv343, l.z55, l.awal_unrest, l.awal_block], [3, 1, 2, 12, 2]);
});

test('storage locations other than WHS1 are ignored in MB51', () => {
  const b = sapBook([mb52('1', 10, 0)], [row({ sku: '1', sloc: 'RETN', mvt_type: '311', quantity: 5 })], 'x.xlsx');
  assert.deepEqual([b.lines[0].inbound, b.lines[0].other_unrest, b.lines[0].awal_unrest], [0, 0, 10]);
});

test('a day without SAP movements (MB51 header only) uploads, dated file-name date - 1', () => {
  const quiet = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(quiet, wb.Sheets['mb52'], 'mb52');
  XLSX.utils.book_append_sheet(quiet, XLSX.utils.aoa_to_sheet([['Storage Location', 'Material', 'Material Description', 'Plant',
    'Movement Type', 'Movement Type Text', 'Material Document', 'Posting Date', 'Quantity', 'Base Unit of Measure']]), 'mb51');
  const b = readSapWorkbook(quiet, 'MB52 0111_01 November 2026.xlsx');
  assert.deepEqual([b.date, b.mb51Count, b.lines.reduce((n, l) => n + l.akhir_unrest, 0)], ['2026-10-31', 0, 59477]);
});

test('a workbook without an MB51 sheet is refused', () => {
  const only = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(only, wb.Sheets['mb52'], 'mb52');
  assert.throws(() => readSapWorkbook(only, 'MB52 2810_28 Oktober 2026.xlsx'), /MB51/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
