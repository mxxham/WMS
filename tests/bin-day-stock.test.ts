// On hand per bin (lib/bin-day-stock.ts): the Laporan WMS harian rows of one bin or rack, grouped and totalled.
import { strict as assert } from 'node:assert';
import { binQuery, changeText, dayKey, emptiedToday, groupDayRows, type DayRow } from '../lib/bin-day-stock';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const row = (o: Partial<DayRow>): DayRow => ({
  bin_code: 'CB01A01', sku: '550058593', description: 'HELIX', uom: 'CAR', batch_lot: 'A', expiry_date: '2030-09-10',
  on_hand: 48, pick: 0, b_out: 0, b_in: 0, remain: 48, ...o,
});

test('one bin: its lines in FEFO order, totals per column', () => {
  const [g] = groupDayRows([
    row({ batch_lot: 'B', expiry_date: '2031-01-01', on_hand: 10, pick: 4, remain: 6 }),
    row({ on_hand: 48, pick: 20, b_out: 28, remain: 0 }),
  ]);
  assert.equal(g.bin, 'CB01A01');
  assert.deepEqual(g.lines.map((l) => l.batch_lot), ['A', 'B']);
  assert.deepEqual(g.total, { on_hand: 58, pick: 24, b_out: 28, b_in: 0, remain: 6 });
});

test('a rack: one group per bin in code order; numbers from the database are numbers', () => {
  const gs = groupDayRows([
    row({ bin_code: 'CB01B01', on_hand: '5' as unknown as number, remain: '5' as unknown as number }),
    row({ bin_code: 'CB01A02', on_hand: 3, remain: 3 }),
  ]);
  assert.deepEqual(gs.map((g) => g.bin), ['CB01A02', 'CB01B01']);
  assert.equal(gs[1].total.on_hand, 5);
});

test('binQuery: a full code is exact, a shorter one a prefix, junk is nothing', () => {
  assert.deepEqual(binQuery(' cb01a01 '), { kind: 'exact', code: 'CB01A01' });
  assert.deepEqual(binQuery('cb01'), { kind: 'prefix', code: 'CB01' });
  assert.deepEqual(binQuery('staging'), { kind: 'exact', code: 'STAGING' });
  assert.deepEqual(binQuery('stg_0'), { kind: 'prefix', code: 'STG_0' });
  assert.equal(binQuery('c'), null);
  assert.equal(binQuery('CB01%'), null);
});

test('changeText says the day in words, nothing when nothing happened', () => {
  assert.equal(changeText(row({ pick: 20, b_out: 28, b_in: 12 })), 'pick −20, B out −28, B in +12');
  assert.equal(changeText(row({ pick: 4 })), 'pick −4');
  assert.equal(changeText(row({})), '');
  assert.equal(changeText(undefined), '');
});

test('dayKey matches a current stock line to its report row', () => {
  assert.equal(dayKey({ sku: '550058593', batch_lot: 'A', expiry_date: '2030-09-10' }), '550058593|A|2030-09-10');
  assert.equal(dayKey({ sku: 'S', batch_lot: '', expiry_date: null }), 'S||');
});

test('emptiedToday: report rows with stock this morning and none of it left in the bin', () => {
  const rows = [row({ batch_lot: 'A', on_hand: 48, pick: 20, b_out: 28, remain: 0 }), row({ batch_lot: 'B', on_hand: 10, remain: 10 }),
                row({ batch_lot: 'C', on_hand: 0, b_in: 5, remain: 5 })];
  const current = new Set(['550058593|B|2030-09-10', '550058593|C|2030-09-10']);
  assert.deepEqual(emptiedToday(rows, current).map((r) => r.batch_lot), ['A']);
});

console.log(`\nbin-day-stock: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
