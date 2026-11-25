import { strict as assert } from 'node:assert';
import { parseBinCode } from '../config/warehouse';
import { detectImportKind, declaredTotal, opnameLabel, countColumnFill } from '../lib/import-kind';
import { detectHeader, validateRows } from '../lib/import-validate';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

// Header as in the 22 Nov 2026 stock-take workbook (row 4, extra audit columns to the right).
const header: unknown[] = []; 
header[7] = 'Lokasi'; header[8] = 'Batch'; header[9] = 'GR date'; header[10] = 'Expired Date'; header[11] = 'item';
header[12] = 'Description'; header[13] = 'Qty'; header[16] = 'UPP'; header[21] = 'Remain Qty'; header[37] = 'uom'; header[52] = 'Batch';
function row(bin: string, sku: string | null, qty: number, batch: string | null = null, exp: Date | null = null) {
  const r: unknown[] = new Array(53).fill(null);
  r[7] = bin; r[11] = sku; r[13] = qty; r[21] = qty; r[8] = batch; r[10] = exp;
  return r;
}
const rows = [header,
  row('STG_INBV93', null, 0), row('STG_INBV93', null, 0), row('RETN', null, 0),
  row('Z_QUARANTINE', '550062463', 3, '04K26JJ', new Date(2030, 10, 4)),
  row('CD01D01', '550062463', 48, '11K26JJ', new Date(2030, 10, 11))];
const lines = rows.map((_, i) => i + 4);

test('header: first Batch column wins over the later audit Batch', () => {
  const h = detectHeader(rows);
  assert.equal(h.headerRow, 0); assert.equal(h.mapping.batch_lot, 8); assert.equal(h.mapping.quantity, 21);
});
test('new floor locations parse', () => {
  assert.equal(parseBinCode('STG_INBV99')?.zone, 'STAGING');
  assert.equal(parseBinCode('RETN')?.zone, 'RETURN');
});
test('no row of the file is rejected, quarantine stock lands in QUARANTINE (blocked)', () => {
  const h = detectHeader(rows);
  const v = validateRows(rows, lines, h.headerRow, h.mapping, new Date(2026, 10, 22)).rows;
  assert.equal(v.filter((r) => r.status === 'error').length, 0);
  const q = v.find((r) => r.sku === '550062463' && r.quantity === 3)!;
  assert.equal(q.bin_code, 'QUARANTINE'); assert.equal(q.bin_status, 'blocked'); assert.equal(q.expiry_date, '2030-11-04');
  assert.equal(v.find((r) => r.bin_code === 'CD01D01')!.quantity, 48);
});

test('stock-opname file is told apart from the regular WMS file', () => {
  const label: unknown[] = new Array(53).fill(null); label[10] = "STOCK TAKE 22 NOV' 2026"; label[21] = 65970;
  const opname = [label, [], [], header, row('CA01A01', '550076253', 7)];
  assert.equal(detectImportKind(opname, 3), 'opname');
  assert.equal(opnameLabel(opname, 3), "STOCK TAKE 22 NOV' 2026");
  assert.equal(declaredTotal(opname, 3, 21), 65970);
  assert.equal(detectImportKind([header, row('CA01A01', '550076253', 7)], 0), 'wms');
  const audit = [...header]; audit[46] = 'audit remain qty'; audit[47] = 'Qty fisik';
  assert.equal(detectImportKind([audit, row('CA01A01', null, 0)], 0), 'opname');
});

test('same goods twice in a floor location add up; twice in a rack bin stays an error', () => {
  const exp = new Date(2030, 10, 4);
  const f = [header, row('Z_QUARANTINE', '550071396', 2, null, exp), row('Z_QUARANTINE', '550071396', 1, null, exp),
    row('CD01D01', '550062463', 48, '11K26JJ', exp), row('CD01D01', '550062463', 48, '11K26JJ', exp)];
  const v = validateRows(f, f.map((_, i) => i + 4), 0, detectHeader(f).mapping, new Date(2026, 10, 22)).rows;
  const q = v.filter((r) => r.bin_code === 'QUARANTINE');
  assert.equal(q.length, 1); assert.equal(q[0].quantity, 3); assert.equal(q[0].status, 'warning');
  assert.equal(v.filter((r) => r.bin_code === 'CD01D01' && r.status === 'error').length, 1);
});

test('opname count: on hand is the count (typed over its formula), blank means 0; no column falls back', () => {
  const exp = new Date(2030, 10, 4);
  // CE01D01 as in the 22 Nov file: Qty 48 and Remain Qty 48, but the team typed 0 over on hand.
  const mk = (bin: string, qty: number, onHand: number | null) => { const r = row(bin, '550062463', qty, '04K26JJ', exp); r[30] = onHand; return r; };
  const hdr = [...header]; hdr[30] = 'on hand';
  const f = [hdr, mk('CE01D01', 48, 0), mk('CE01E01', 48, 40), mk('CE01E02', 48, null)];
  const m = detectHeader(f).mapping;
  assert.equal(m.count_qty, 30); assert.equal(m.quantity, 21);
  assert.equal(countColumnFill(f, 0, m.count_qty), 2);
  const v = validateRows(f, f.map((_, i) => i + 4), 0, m, new Date(2026, 10, 22), { useCount: true }).rows;
  assert.deepEqual(v.map((r) => r.quantity), [0, 40, 0]);
  assert.match(v[0].messages.join(), /di-nol-kan/);
  const plain = validateRows(f, f.map((_, i) => i + 4), 0, m, new Date(2026, 10, 22)).rows;
  assert.deepEqual(plain.map((r) => r.quantity), [48, 48, 48]);
  assert.equal(countColumnFill([header, row('CE01D01', '550062463', 48)], 0, detectHeader([header]).mapping.count_qty), 0);
});

test('import: a 19xx expiry (Excel two-digit year) is read as 100 years later, with a warning', () => {
  const r2 = [header, row('CD01D01', '550062463', 48, '02K26JJ', new Date(1930, 10, 2)), row('CD01D02', '550062463', 48, '02K26JJ', new Date(2030, 10, 2))];
  const h = detectHeader(r2);
  const v = validateRows(r2, r2.map((_, i) => i + 4), h.headerRow, h.mapping, new Date(2026, 10, 22)).rows;
  const fixed = v.find((x) => x.bin_code === 'CD01D01')!;
  assert.equal(fixed.expiry_date, '2030-11-02');
  assert.equal(fixed.status, 'warning');
  assert.match(fixed.messages.join(), /1930 di file dibaca 2030/);
  const plain = v.find((x) => x.bin_code === 'CD01D02')!;
  assert.equal(plain.expiry_date, '2030-11-02');
  assert.equal(plain.status, 'ok');
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
