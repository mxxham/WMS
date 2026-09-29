/** Excel rows of the WMS-file picking audit (lib/sheet-audit-export.ts). */
import { strict as assert } from 'node:assert';
import { auditWorkbookRows, jakartaTime, type ExportAttempt, type ExportLine } from '../lib/sheet-audit-export';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPicking audit export');

const line = (o: Partial<ExportLine>): ExportLine => ({
  id: 'l1', shipment_number: 'S1', wave_no: '1', picklist: 'PL-S1', seq: 1, bin_code: 'CA01A01', sku: '550024919', description: 'Rimula',
  uom: 'CAR', batch: 'C1', expiry: '2031-07-07', qty: 2, bin_remaining: 4, line_state: 'OK', ...o,
});
const att = (o: Partial<ExportAttempt>): ExportAttempt => ({
  line_id: 'l1', attempt_no: 1, checker_name: 'Sari', method: 'RACK', result: 'OK', errors: [], counted_qty: 2, found_sku: '550024919',
  found_batch: 'C1', rack_system: 4, rack_counted: 4, note: null, correction: false, created_at: '2026-09-29T03:00:00Z', ...o,
});

test('Jakarta time', () => assert.equal(jakartaTime('2026-09-29T03:05:00Z'), '2026-09-29 10:05'));

test('a corrected bin shows the latest count, the difference and Diubah', () => {
  const lines = [line({ line_state: 'MISMATCH' }), line({ id: 'l2', shipment_number: 'S2', bin_remaining: 1, qty: 3, line_state: 'OK' })];
  const attempts = [
    att({}), att({ line_id: 'l2' }),
    att({ attempt_no: 2, result: 'MISMATCH', errors: ['SHORT'], counted_qty: 1, rack_system: 1, rack_counted: 2, note: 'salah klik', correction: true, created_at: '2026-09-29T04:00:00Z' }),
  ];
  const { bins, lines: rows, history } = auditWorkbookRows(lines, attempts);
  assert.equal(bins.length, 1);
  assert.equal(bins[0]['Sisa di file'], 1);
  assert.equal(bins[0]['Sisa dihitung'], 2);
  assert.equal(bins[0].Selisih, 1);
  assert.equal(bins[0].Status, 'Selisih');
  assert.equal(bins[0].Diubah, 'Ya');
  assert.equal(bins[0]['Qty pick'], 5);
  assert.equal(rows[0].Error, 'Kurang');
  assert.equal(rows[0].Audit, 2);
  assert.equal(history.length, 3);
  assert.equal(history[2].Ubah, 'Ya');
});

test('wrong item shows what was found; unaudited bins stay blank', () => {
  const { bins } = auditWorkbookRows(
    [line({ line_state: 'MISMATCH' }), line({ id: 'l3', bin_code: 'STAGING', sku: '550056224', line_state: 'TODO', bin_remaining: 6 })],
    [att({ result: 'MISMATCH', errors: ['WRONG_SKU'], found_sku: '550044709', rack_counted: 0, note: 'isi lain' })]);
  const ca = bins.find((b) => b.Bin === 'CA01A01')!, stg = bins.find((b) => b.Bin === 'STAGING')!;
  assert.equal(ca['Barang ditemukan'], '550044709');
  assert.equal(stg.Rak, 'STAGING');
  assert.equal(stg.Status, 'Belum diaudit');
  assert.equal(stg['Sisa dihitung'], null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
