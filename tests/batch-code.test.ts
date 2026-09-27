/** Shell batch codes -> production date -> expected expiry (lib/batch-code.ts, same rule as 0016). */
import { strict as assert } from 'node:assert';
import { addMonths, batchMfgDate, classifyMismatch, expectedExpiry, expiryCheck } from '../lib/batch-code';
import { findIssues, type StockRow } from '../lib/data-quality';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nBatch codes and expiry');

test('14H26JJ = 14 Aug 2026; month letters A..L, case and spaces ignored', () => {
  assert.equal(batchMfgDate('14H26JJ'), '2026-08-14');
  assert.equal(batchMfgDate(' 01a27jj '), '2027-01-01');
  assert.equal(batchMfgDate('31L25JJ'), '2025-12-31');
});
test('not a date code: SAP lots, blanks, impossible days, letters past L', () => {
  for (const b of ['12658123', '', null, 'UT', '25E26', '31B26JJ', '30B28JJ', '14M26JJ', '14H26J']) assert.equal(batchMfgDate(b), null, String(b));
  assert.equal(batchMfgDate('29B28JJ'), '2028-02-29');
});
test('expected expiry = production + 48 months; month-end clamps like Postgres', () => {
  assert.equal(expectedExpiry('09F26JJ'), '2030-06-09');
  assert.equal(expectedExpiry('09F26JJ', 51), '2030-09-09');
  assert.equal(addMonths('2028-02-29', 12), '2029-02-28');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
});
test('the real 24 Sep errors are recognised', () => {
  assert.equal(classifyMismatch('2030-09-06', '2030-06-09'), 'day_month_swapped');
  assert.equal(classifyMismatch('1930-05-29', '2030-05-29'), 'wrong_century');
  assert.equal(classifyMismatch('2029-11-14', '2030-11-14'), 'wrong_year');
  assert.equal(classifyMismatch('2030-08-21', '2030-08-22'), 'typo');
  assert.equal(classifyMismatch('2030-02-26', '2030-04-06'), 'other');
});
test('expiryCheck: null when right or not checkable', () => {
  assert.equal(expiryCheck('14H26JJ', '2030-08-14'), null);
  assert.equal(expiryCheck('12658123', '2031-01-01'), null);
  assert.equal(expiryCheck('14H26JJ', null), null);
  assert.deepEqual(expiryCheck('09F26JJ', '2030-09-06T00:00:00Z'), { expected: '2030-06-09', kind: 'day_month_swapped' });
});

const row = (o: Partial<StockRow>): StockRow => ({ bin_code: 'CA01C01', rack: '01', zone: 'CA', sku: '550062460', description: 'x', upp: 44,
  batch_lot: '09F26JJ', quantity: 44, expiry_date: '2030-06-09', ...o });
test('data quality: expiry against the batch code, with the corrected date suggested', () => {
  const issues = findIssues([row({ expiry_date: '2030-09-06' }), row({ bin_code: 'CA01C02' })], '2026-09-24');
  const i = issues.filter((x) => x.kind === 'expiry_vs_batch');
  assert.equal(i.length, 1);
  assert.equal(i[0].row.bin_code, 'CA01C01');
  assert.equal(i[0].suggestedExpiry, '2030-06-09');
  assert.match(i[0].detail, /hari dan bulan tertukar/);
});
test('data quality: per-SKU shelf life is honoured', () => {
  const issues = findIssues([row({ expiry_date: '2030-09-09' })], '2026-09-24', new Map([['550062460', 51]]));
  assert.equal(issues.filter((x) => x.kind === 'expiry_vs_batch').length, 0);
});
test('data quality: one batch with two expiries lists every row of it', () => {
  const issues = findIssues([row({ batch_lot: '12628865', expiry_date: '2030-03-25' }), row({ bin_code: 'CA02C01', batch_lot: '12628865', expiry_date: '2030-05-22' }),
    row({ bin_code: 'CA03C01', batch_lot: '12628866', expiry_date: '2030-05-22' })], '2026-09-24');
  assert.deepEqual(issues.filter((x) => x.kind === 'batch_multi_expiry').map((x) => x.row.bin_code), ['CA01C01', 'CA02C01']);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
