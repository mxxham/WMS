/**
 * Bandingkan dengan WMS (lib/wms-compare.ts), on the cases found on 6 Oct:
 * staging written in lower case, a new batch kept under the old name, a pallet
 * rest moved to another bin than posted, a pallet the system still holds.
 */
import { strict as assert } from 'node:assert';
import { compareWms, type StockRow } from '../lib/wms-compare';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const r = (bin: string, sku: string, batch: string, qty: number, expiry = '2030-08-08'): StockRow => ({ bin, sku, batch, expiry, qty });
const kindOf = (res: ReturnType<typeof compareWms>, bin: string, sku: string) => res.lines.find((l) => l.bin === bin && l.sku === sku)?.kind;

console.log('\nBandingkan dengan WMS');

test('same stock, staging in lower case in the file: all same', () => {
  const res = compareWms([r('staging', '1', 'B1', 360), r('CA01A01', '2', 'B2', 5)], [r('STAGING', '1', 'B1', 360), r('CA01A01', '2', 'B2', 5)]);
  assert.equal(res.counts.same, 2);
  assert.equal(res.lines.filter((l) => l.kind !== 'same').length, 0);
});

test('same quantity under another batch name (CC27A02): batch, not a quantity difference', () => {
  const res = compareWms([r('CC27A02', '550071396', '04H26JJ', 28, '2030-08-04')], [r('CC27A02', '550071396', '19H26JJ', 28, '2030-08-19')]);
  assert.equal(kindOf(res, 'CC27A02', '550071396'), 'batch');
  assert.equal(res.lines[0].fileBatches, '04H26JJ exp 2030-08-04: 28');
});

test('same batch, other expiry (CE30A02 05 vs 10 Aug): batch', () => {
  const res = compareWms([r('CE30A02', '550058592', '05H26JJ', 19, '2030-08-05')], [r('CE30A02', '550058592', '05H26JJ', 19, '2030-08-10')]);
  assert.equal(kindOf(res, 'CE30A02', '550058592'), 'batch');
});

test('a pallet rest in another bin (CC29C02 → CC25A01): both lines "moved", the SKU total agrees', () => {
  const res = compareWms(
    [r('CC29C02', '550058593', '08H26JJ', 0), r('CC25A01', '550058593', '08H26JJ', 23)],
    [r('CC29C02', '550058593', '08H26JJ', 20), r('CC25A01', '550058593', '08H26JJ', 3)]);
  assert.equal(kindOf(res, 'CC29C02', '550058593'), 'moved');
  assert.equal(kindOf(res, 'CC25A01', '550058593'), 'moved');
});

test('a pallet the system still holds (CE11E01 44, file 0): only_system; a real shortfall: qty', () => {
  const res = compareWms(
    [r('CE11A02', '550061081', 'B', 32), r('CD13A01', '550048593', 'B', 71)],
    [r('CE11E01', '550061081', 'B', 44), r('CE11A02', '550061081', 'B', 41), r('CD13A01', '550048593', 'B', 36)]);
  assert.equal(kindOf(res, 'CE11E01', '550061081'), 'only_system');
  assert.equal(kindOf(res, 'CE11A02', '550061081'), 'qty');
  assert.equal(kindOf(res, 'CD13A01', '550048593'), 'qty');
  assert.equal(res.lines[0].kind, 'qty', 'quantity differences come first');
  assert.equal(res.systemTotal - res.fileTotal, 44 + 9 - 35);
});

test('a bin with a rejected file row is flagged, and staging never counts as "moved"', () => {
  const res = compareWms([r('z_Quarantine', '9', 'B', 7)], [], ['z_quarantine']);
  assert.equal(res.lines[0].kind, 'only_file');
  assert.equal(res.lines[0].rejected, true);
  const st = compareWms([r('staging', '1', 'B', 10), r('CA01A01', '1', 'B', 0)], [r('CA01A01', '1', 'B', 10)]);
  assert.equal(kindOf(st, 'STAGING', '1'), 'only_file');
  assert.equal(kindOf(st, 'CA01A01', '1'), 'only_system');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
