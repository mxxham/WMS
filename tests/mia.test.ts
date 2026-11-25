import { strict as assert } from 'node:assert';
import { canMoveMia, miaAgeDays, miaSummary, shortLines, type MiaStockRow } from '../lib/mia';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const now = new Date('2026-11-24T10:00:00+07:00');
const row = (o: Partial<MiaStockRow>): MiaStockRow => ({
  item_id: 'i', sku: '550058593', description: 'x', upp: 48, batch_lot: 'B', expiry_date: '2030-01-01', quantity: 5, since: null, ...o,
});

test('only Inventory and Admin move stock in and out of MIA', () => {
  assert.equal(canMoveMia('inventory'), true);
  assert.equal(canMoveMia('admin'), true);
  for (const j of ['leader', 'operator', 'checker', 'admin_inbound', 'admin_outbound', null, undefined]) assert.equal(canMoveMia(j), false);
});

test('age in whole days; unknown when there is no date', () => {
  assert.equal(miaAgeDays('2026-11-21T10:00:00+07:00', now), 3);
  assert.equal(miaAgeDays('2026-11-24T09:00:00+07:00', now), 0);
  assert.equal(miaAgeDays(null, now), null);
  assert.equal(miaAgeDays('not a date', now), null);
});

test('summary: SKUs, cartons, oldest case and how many are past 7 days', () => {
  const s = miaSummary([
    row({ quantity: 4, since: '2026-11-23T10:00:00+07:00' }),
    row({ sku: '550044360', quantity: 10, since: '2026-11-10T10:00:00+07:00' }),
    row({ sku: '550044360', batch_lot: 'C', quantity: 2, since: '2026-11-16T10:00:00+07:00' }),
  ], now);
  assert.deepEqual(s, { skus: 2, qty: 16, oldestDays: 14, overdue: 2 });
  assert.deepEqual(miaSummary([], now), { skus: 0, qty: 0, oldestDays: null, overdue: 0 });
});

test('short lines: what the system holds beyond what the floor shows, per batch + expiry', () => {
  const sys = [{ batch_lot: 'B1', expiry_date: '2030-01-01', quantity: 48 }, { batch_lot: 'B2', expiry_date: '2030-02-01', quantity: 10 }];
  assert.deepEqual(shortLines(sys, []), sys);
  assert.deepEqual(shortLines(sys, [{ batch_lot: 'b1', expiry_date: '2030-01-01', quantity: 40 }]),
    [{ batch_lot: 'B1', expiry_date: '2030-01-01', quantity: 8 }, { batch_lot: 'B2', expiry_date: '2030-02-01', quantity: 10 }]);
  // more on the floor than in the system: not short; another expiry is another line
  assert.deepEqual(shortLines(sys, [{ batch_lot: 'B1', expiry_date: '2030-01-01', quantity: 60 }, { batch_lot: 'B2', expiry_date: '2031-02-01', quantity: 10 }]),
    [{ batch_lot: 'B2', expiry_date: '2030-02-01', quantity: 10 }]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
