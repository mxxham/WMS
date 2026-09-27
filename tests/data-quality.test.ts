/** Live data-quality checks (lib/data-quality.ts). */
import { strict as assert } from 'node:assert';
import { findIssues, isoToExcelSerial, type StockRow } from '../lib/data-quality';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const row = (p: Partial<StockRow>): StockRow => ({
  bin_code: 'CA01C01', rack: '01', zone: 'CA', sku: '550044709', description: null, upp: 48,
  batch_lot: 'B1', quantity: 10, expiry_date: '2031-01-01', ...p,
});
const kinds = (rows: StockRow[]) => findIssues(rows, '2026-09-24').map((i) => `${i.kind}:${i.row.bin_code}`);
console.log('\nData quality');

test('batch number shown as a date suggests the Excel serial (CD39C01: 7786-07-31 -> 2150031)', () => {
  assert.equal(isoToExcelSerial('7786-07-31'), 2150031);
  const [i] = findIssues([row({ bin_code: 'CD39C01', batch_lot: '7786-07-31' })], '2026-09-24');
  assert.deepEqual([i.kind, i.suggestedBatch], ['batch_is_date', '2150031']);
});

test('a plausible date as batch is flagged without a guess', () => {
  assert.equal(findIssues([row({ batch_lot: '2030-09-15' })], '2026-09-24')[0].suggestedBatch, undefined);
});

test('rack without batch, missing / past expiry are flagged; quarantine only for nothing', () => {
  assert.deepEqual(kinds([
    row({ bin_code: 'CA02B01', batch_lot: '' }),
    row({ bin_code: 'CA03A01', expiry_date: null }),
    row({ bin_code: 'CA04A01', expiry_date: '2026-09-01' }),
    row({ bin_code: 'QUARANTINE', rack: null, zone: 'QUARANTINE', batch_lot: '', expiry_date: null }),
    row({ bin_code: 'STAGING', rack: null, zone: 'STAGING', expiry_date: null }),
  ]), ['batch_missing:CA02B01', 'expiry_missing:CA03A01', 'expired:CA04A01', 'expiry_missing:STAGING']);
});

test('more than one pallet in a rack bin is flagged once per bin, across SKUs', () => {
  assert.deepEqual(kinds([
    row({ bin_code: 'CA05A01', quantity: 48 }),
    row({ bin_code: 'CA06A01', quantity: 30 }), row({ bin_code: 'CA06A01', sku: '550058593', quantity: 30 }),
  ]), ['over_pallet:CA06A01']);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
