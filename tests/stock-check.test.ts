/** A plan made from the WMS file may be saved only when the database holds the same stock where it picks (lib/allocator/stock-check.ts). */
import { strict as assert } from 'node:assert';
import { checkPlanStock, type DbStockRow } from '../lib/allocator/stock-check';
import type { StockBin } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nFile plan vs database stock');

const file = (location: string, sku: string, batch: string | null, qty: number) =>
  ({ location, sku, batch, qtyCartons: qty } as StockBin);
const db = (bin_code: string, sku: string, batch_lot: string, physical: number, extra: Partial<DbStockRow> = {}): DbStockRow =>
  ({ bin_code, sku, batch_lot, physical, reserved: 0, incoming: 0, held: 0, ...extra });
const pick = (from_bin: string, sku: string, batch_lot: string, to_bin: string | null = null) => ({ from_bin, to_bin, sku, batch_lot });

test('same stock where the plan picks: ok', () => {
  const r = checkPlanStock([pick('CB11A02', '550074326', '19I26JJ')],
    [file('CB11A02', '550074326', '19I26JJ', 86)], [db('CB11A02', '550074326', '19I26JJ', 86)]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => [x.bin, x.batch, x.file, x.db, x.problem]), [['CB11A02', '19I26JJ', 86, 86, null]]);
});

test('NO 8 on 30 Sep: file 86 x 19I26JJ, database 40 x 19I26JJ + 47 x 12I26JJ -> both batches listed, blocked', () => {
  const r = checkPlanStock([pick('CB11A02', '550074326', '19I26JJ')],
    [file('CB11A02', '550074326', '19I26JJ', 86)],
    [db('CB11A02', '550074326', '19I26JJ', 40), db('CB11A02', '550074326', '12I26JJ', 47)]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.rows.map((x) => [x.batch, x.file, x.db, x.problem]), [['12I26JJ', 0, 47, 'qty'], ['19I26JJ', 86, 40, 'qty']]);
});

test('the Bin To Bin target is checked too (CD36A02: file 17, database 48)', () => {
  const r = checkPlanStock([pick('CE13E02', '550049045', '04I26JJ', 'CD36A02')],
    [file('CE13E02', '550049045', '04I26JJ', 48), file('CD36A02', '550049045', '20H26JJ', 17)],
    [db('CE13E02', '550049045', '04I26JJ', 48), db('CD36A02', '550049045', '20H26JJ', 48)]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.rows.filter((x) => x.problem).map((x) => [x.bin, x.file, x.db]), [['CD36A02', 17, 48]]);
});

test('a bin the file has but the database does not (CF19A01) is a difference', () => {
  const r = checkPlanStock([pick('CF19A01', '550062463', '09I26JJ')], [file('CF19A01', '550062463', '09I26JJ', 36)], []);
  assert.deepEqual(r.rows.map((x) => [x.bin, x.file, x.db, x.problem]), [['CF19A01', 36, 0, 'qty']]);
});

test('stock another open wave takes or brings in is a conflict, even when the numbers agree', () => {
  const r = checkPlanStock([pick('CB14D01', '550074326', '19I26JJ')], [file('CB14D01', '550074326', '19I26JJ', 48)],
    [db('CB14D01', '550074326', '19I26JJ', 48, { reserved: 48 })]);
  assert.equal(r.rows[0].problem, 'claimed');
  const hold = checkPlanStock([pick('CB14D01', '550074326', '19I26JJ')], [file('CB14D01', '550074326', '19I26JJ', 48)],
    [db('CB14D01', '550074326', '19I26JJ', 48, { held: 48 })]);
  assert.equal(hold.rows[0].problem, 'held');
});

test('batch spelling and bin case do not count as differences; other SKUs in the bin are ignored', () => {
  const r = checkPlanStock([pick('cb11a02', '550074326', '19I26JJ')],
    [file('CB11A02', '550074326', ' 19i26jj', 20), file('CB11A02', '550000001', 'X', 5)],
    [db('CB11A02', '550074326', '19I26JJ', 20)]);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
});

test('the same bin used twice is listed once', () => {
  const r = checkPlanStock([pick('CB11A02', '550074326', '19I26JJ'), pick('CB11A02', '550074326', '19I26JJ')],
    [file('CB11A02', '550074326', '19I26JJ', 86)], [db('CB11A02', '550074326', '19I26JJ', 86)]);
  assert.equal(r.rows.length, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
