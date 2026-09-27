/**
 * Excel dates must come out as the same calendar day in every timezone.
 * SheetJS builds dates with the zone's historical offset (Jakarta LMT
 * +7:07:12 → the 15th arrives as 23:59:48 on the 14th). Run under several
 * TZ values by `npm test`.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { withConfig } from '../lib/allocator/config';
import { loadWorkbookFromBuffer } from '../lib/allocator/browser/browser-input';
import { loadWorkbook } from '../lib/allocator/adapters/excel-input';
import { excelBatchText, excelDateIso } from '../lib/allocator/excel-date';
import { readSheet } from '../lib/read-sheet';
import { detectHeader, validateRows } from '../lib/import-validate';

let passed = 0, failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const FILE = 'data/Warehouse_Management_System_24_September_2026_.xlsx';
const buf = readFileSync(FILE);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const config = withConfig({ asOf: new Date('2026-09-24T00:00:00Z') });
console.log(`\nExcel dates (TZ=${process.env.TZ ?? 'system'})`);

await test('SheetJS (web) reads CD21D02 expiry as 2030-09-15', () => {
  const bin = loadWorkbookFromBuffer(ab, config).stock.find((b) => b.location === 'CD21D02')!;
  assert.equal(bin.expiryDate.toISOString().slice(0, 10), '2030-09-15');
});

await test('ExcelJS (CLI) and SheetJS (web) agree on every expiry', async () => {
  const web = loadWorkbookFromBuffer(ab, config).stock;
  const cli = (await loadWorkbook(FILE, config)).stock;
  const key = (b: { binId: string; expiryDate: Date }) => `${b.binId}|${b.expiryDate.toISOString().slice(0, 10)}`;
  assert.deepEqual(web.map(key).sort(), cli.map(key).sort());
});

await test('Import page validator reads the same expiry', () => {
  const wb = XLSX.read(ab, { cellDates: true });
  const d = readSheet(wb, 'WMS');
  const h = detectHeader(d.rows);
  const row = validateRows(d.rows, d.lines, h.headerRow, h.mapping).rows.find((r) => r.bin_code === 'CD21D02')!;
  assert.equal(row.expiry_date, '2030-09-15');
});

await test('nearest-midnight rounding: SheetJS-style and ExcelJS-style dates', () => {
  // local 23:59:48 the day before, local midnight, UTC midnight
  assert.equal(excelDateIso(new Date(2030, 8, 14, 23, 59, 48)), '2030-09-15');
  assert.equal(excelDateIso(new Date(2030, 8, 15, 0, 0, 0)), '2030-09-15');
  assert.equal(excelDateIso(new Date(Date.UTC(2030, 8, 15))), '2030-09-15');
});

await test('batch number with a date format reads back as the number (CD39C01 → 2150031)', () => {
  const bin = loadWorkbookFromBuffer(ab, config).stock.find((b) => b.location === 'CD39C01')!;
  assert.equal(bin.batch, '2150031');
  assert.equal(excelBatchText(new Date(2030, 8, 15)), '2030-09-15'); // a plausible date stays a date
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
