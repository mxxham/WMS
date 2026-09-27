/** Shell SAP stock / pending GI files (lib/sap-stock.ts), on the real 24 Sep workbook sheets. */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseDeliveryDoc, parsePendingList, parseSapStock } from '../lib/sap-stock';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nSAP stock files');
const wb = XLSX.read(readFileSync('data/Warehouse_Management_System_24_September_2026_.xlsx'));

test('SAP vs fisik sheet: header found below the summary, SAP (first) Unrestricted/Blocked taken', () => {
  const p = parseSapStock(wb, 'SAP_24 Septber vs fisik_unrest');
  assert.equal(p.headerLine, 7);  // Excel row 7: summary block, a blank row, then the titles
  const r = p.rows.find((x) => x.sku === '550058592')!;
  assert.deepEqual([r.unrestricted, r.blocked, r.uom], [2192, 7, 'CAR']);
  assert.ok(p.rows.length >= 100, `${p.rows.length} rows`);
});
test('blocked-only sheet (Block_pdated) reads Blocked, Unrestricted 0', () => {
  const p = parseSapStock(wb, 'Block_pdated');
  const r = p.rows.find((x) => x.sku === '550071396')!;
  assert.deepEqual([r.unrestricted, r.blocked], [0, 88]);
});
test('a plain MB52 export (first sheet that fits) and text quantities', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Catatan'], []]), 'Info');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Plant', 'Material', 'Material Description', 'Storage Location', 'Batch', 'Base Unit of Measure', 'Unrestricted', 'Blocked'],
    ['I003', 550044709, 'Adv', 'WHS1', 'UT', 'CAR', '1.234', 0],
    ['I003', 'Total', '', '', '', '', 1234, 0],
  ]), 'MB52');
  const p = parseSapStock(book);
  assert.equal(p.sheet, 'MB52');
  assert.deepEqual(p.rows.map((r) => [r.sku, r.unrestricted]), [['550044709', 1234]]);
  assert.deepEqual(p.skipped.map((s) => s.why), ['bukan kode SKU: "Total"']);
});
test('pending GI list is summed per SKU', () => {
  const g = parsePendingList(XLSX.utils.book_new() && (() => { const b = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(b, wb.Sheets['pending GI'], 'pending GI'); return b; })());
  const r = g.find((x) => x.sku === '550062461');
  assert.ok(r && r.qty >= 10, JSON.stringify(r));
});
test('delivery document: SKU + batch lines summed, SAP batch "UT" means no batch', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['DO', 'Material', 'Batch', 'Delivery quantity'],
    ['8001', 550044709, '14h26jj', 20], ['8001', 550044709, '14H26JJ', 24], ['8001', '550058593', 'UT', 30], ['8001', 'x', '', 5],
  ]), 'DO');
  assert.deepEqual(parseDeliveryDoc(book), [
    { sku: '550044709', batch_lot: '14H26JJ', quantity: 44 }, { sku: '550058593', batch_lot: '', quantity: 30 }]);
});
test('a file without the columns says so', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]), 'x');
  assert.throws(() => parseSapStock(book), /Tidak ada sheet dengan kolom Material/);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
