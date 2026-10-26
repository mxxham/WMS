/**
 * CKB 3PL — SAP snapshot parser (lib/ckb/sap-import.ts). No CKB SAP sample file exists yet, so
 * these fixtures are built inline from the configured header aliases; they test the refusal rules,
 * not a claimed SAP format.
 */
import { strict as assert } from 'node:assert';
import * as XLSX from 'xlsx';
import { parseSapSnapshot, parseQuantity, parseExpiry, identityKey, totalQty, type SapMapping } from '../lib/ckb/sap-import';
import { readSheet } from '../lib/read-sheet';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const MAP: SapMapping = {
  material_code: ['material', 'material number'], description: ['material description'], plant: ['plant'],
  storage_location: ['storage location'], storage_bin: ['storage bin'], batch: ['batch'],
  expiry_date: ['sled/bbd'], uom: ['base unit of measure'], quantity: ['unrestricted'],
};
const HEAD = ['Plant', 'Material', 'Material Description', 'Storage Location', 'Storage Bin', 'Batch', 'SLED/BBD', 'Base Unit of Measure', 'Unrestricted'];
const lines = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const parse = (rows: unknown[][]) => parseSapSnapshot(rows, lines(rows.length), MAP);

console.log('\nCKB SAP import parser');

test('reads a valid sheet: header found under a title row, values normalised', () => {
  const p = parse([['Stock overview 24.10.2026'], HEAD,
    ['1100', 550044709, 'Copper bag', 'WH05', 'cg01a01', 'B1', '31.03.2027', 'bag', 40],
    ['1100', 'M-200', 'Drum', 'WH05', 'CG01A02', '', 46477, 'DR', 0]]);
  assert.deepEqual(p.fileErrors, []);
  assert.equal(p.headerLine, 2);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].material_code, '550044709');
  assert.equal(p.rows[0].storage_bin, 'CG01A01');
  assert.equal(p.rows[0].uom, 'BAG');
  assert.equal(p.rows[0].expiry_date, '2027-03-31');
  assert.equal(p.rows[1].expiry_date, '2027-03-31', 'Excel serial 46477');
  assert.equal(p.rows[1].quantity, 0, 'a zero row is kept');
  assert.equal(totalQty(p.rows), 40);
});

test('an empty quantity is a row error, never zero', () => {
  const p = parse([HEAD, ['1100', 'M1', 'x', 'WH05', 'CG01A01', '', '', 'KG', null]]);
  assert.equal(p.rows.length, 0);
  assert.match(p.errors[0].message, /qty kosong/);
  assert.equal(p.errors[0].line, 2);
});

test('missing material or unit, negative and text quantities are reported per line', () => {
  const p = parse([HEAD,
    ['1100', '', 'x', 'WH05', 'CG01A01', '', '', 'KG', 1],
    ['1100', 'M1', 'x', 'WH05', 'CG01A01', '', '', '', 1],
    ['1100', 'M2', 'x', 'WH05', 'CG01A01', '', '', 'KG', -3],
    ['1100', 'M3', 'x', 'WH05', 'CG01A01', '', '', 'KG', '1.234'],
    ['1100', 'M4', 'x', 'WH05', 'CG01A01', '', '', 'KG', '#VALUE!'],
    ['1100', 'M5', 'x', 'WH05', 'CG01A01', '', '', 'KG', '12']]);
  assert.deepEqual(p.errors.map((e) => e.line), [2, 3, 4, 5, 6]);
  assert.match(p.errors[0].message, /material kosong/);
  assert.match(p.errors[1].message, /satuan kosong/);
  assert.match(p.errors[2].message, /negatif/);
  assert.match(p.errors[3].message, /pemisah/);
  assert.match(p.errors[4].message, /error Excel/);
  assert.equal(p.rows.length, 1, 'a whole number typed as text is unambiguous');
  assert.equal(p.rows[0].quantity, 12);
});

test('dates: day-first with dots and ISO accepted; slashes refused as ambiguous; impossible dates refused', () => {
  assert.equal(parseExpiry('31.03.2027'), '2027-03-31');
  assert.equal(parseExpiry('2027-03-31'), '2027-03-31');
  assert.equal(parseExpiry(null), null);
  assert.ok(typeof parseExpiry('03/04/2027') === 'object');
  assert.ok(typeof parseExpiry('31.02.2027') === 'object');
  assert.ok(typeof parseExpiry(12.5) === 'object');
});

test('quantity parser', () => {
  assert.equal(parseQuantity(7.5), 7.5);
  assert.equal(parseQuantity('0'), 0);
  assert.equal(typeof parseQuantity(''), 'string');
  assert.equal(typeof parseQuantity('12,5'), 'string');
  assert.equal(typeof parseQuantity(Number.NaN), 'string');
});

test('a batch that Excel turned into a date is refused', () => {
  const p = parse([HEAD, ['1100', 'M1', 'x', 'WH05', 'CG01A01', new Date(2039, 2, 1), '', 'KG', 1]]);
  assert.equal(p.rows.length, 0);
  assert.match(p.errors[0].message, /batch terbaca sebagai tanggal/);
});

test('a missing required column rejects the file', () => {
  const p = parse([HEAD.filter((h) => h !== 'Unrestricted'), ['1100', 'M1']]);
  assert.equal(p.headerLine, null);
  assert.match(p.fileErrors[0], /Baris judul tidak ditemukan/);
  assert.equal(p.rows.length, 0);
});

test('a required column matching two columns rejects the file instead of picking one', () => {
  const p = parse([[...HEAD, 'Unrestricted'], ['1100', 'M1', 'x', 'WH05', 'CG01A01', '', '', 'KG', 1, 5]]);
  assert.match(p.fileErrors[0], /Kolom wajib ganda: Qty/);
  assert.equal(p.rows.length, 0);
});

test('identities: same material + bin + batch + expiry + unit counted as duplicate, not merged', () => {
  const p = parse([HEAD,
    ['1100', 'M1', 'x', 'WH05', 'CG01A01', 'B1', '', 'KG', 3],
    ['1100', 'M1', 'x', 'WH05', 'cg01a01', 'B1', '', 'kg', 4],
    ['1100', 'M1', 'x', 'WH05', 'CG01A02', 'B1', '', 'KG', 4]]);
  assert.equal(p.rows.length, 3);
  assert.equal(p.duplicateIdentities, 1);
  assert.equal(identityKey(p.rows[0]), identityKey(p.rows[1]));
  assert.notEqual(identityKey(p.rows[0]), identityKey(p.rows[2]));
});

test('identity key matches the database spelling (public.ckb_identity_key)', () => {
  assert.equal(identityKey({ material_code: ' m-1 ', plant: '1100', storage_location: 'wh05', storage_bin: 'cg01a01', batch: 'b1', expiry_date: '2027-03-31', uom: 'bag', stock_type: '' }),
    'M-1|1100|WH05|CG01A01|B1|2027-03-31|BAG|');
});

test('a real workbook round trip through SheetJS (cellDates false) and readSheet', () => {
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ['1100', 'M1', 'x', 'WH05', 'CG01A01', 'B1', 46477, 'KG', 2.5]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const book = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { cellDates: false });
  const { rows, lines: ls } = readSheet(book, 'Sheet1');
  const p = parseSapSnapshot(rows, ls, MAP);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].expiry_date, '2027-03-31');
  assert.equal(p.rows[0].quantity, 2.5);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
