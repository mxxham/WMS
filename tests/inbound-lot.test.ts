// Penerimaan: batch and production date are typed once per SKU and fill every pallet of it.
import { strict as assert } from 'node:assert';
import { applyLot, lotFromBatch, lotFromMfg, receiptDay, type Lot } from '../lib/inbound/lot';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const empty: Lot = { batch: '', mfg: '', expiry: '' };

test('a date-coded batch fills production date and expiry', () => {
  // 14H26 = 14 Aug 2026; 36 months shelf life.
  assert.deepEqual(lotFromBatch(empty, '14h26jj', 36), { batch: '14H26JJ', mfg: '2026-08-14', expiry: '2029-08-14' });
});

test('another batch keeps what was typed for production and expiry', () => {
  const prev = { batch: '', mfg: '2026-07-01', expiry: '2030-07-01' };
  assert.deepEqual(lotFromBatch(prev, 'ab1234', 48), { batch: 'AB1234', mfg: '2026-07-01', expiry: '2030-07-01' });
});

test('a production date sets the expiry from the shelf life', () => {
  assert.deepEqual(lotFromMfg({ batch: 'X1', mfg: '', expiry: '' }, '2026-01-31', 1), { batch: 'X1', mfg: '2026-01-31', expiry: '2026-02-28' });
});

test('clearing the production date keeps the expiry', () => {
  assert.equal(lotFromMfg({ batch: '', mfg: '2026-01-01', expiry: '2030-01-01' }, '', 48).expiry, '2030-01-01');
});

test('the lot goes to every pallet of that SKU and no other', () => {
  const rows = [
    { key: 'a', sku: 'S1', batch: '', mfg: '', expiry: '' },
    { key: 'b', sku: 'S2', batch: 'KEEP', mfg: '', expiry: '2031-01-01' },
    { key: 'c', sku: 'S1', batch: 'OLD', mfg: '', expiry: '' },
  ];
  const out = applyLot(rows, 'S1', { batch: 'NEW', mfg: '2026-10-01', expiry: '2030-10-01' });
  assert.deepEqual(out.map((r) => [r.key, r.batch, r.expiry]), [['a', 'NEW', '2030-10-01'], ['b', 'KEEP', '2031-01-01'], ['c', 'NEW', '2030-10-01']]);
});

test('a manual receipt lists on its Jakarta creation day, a planned one on its plan date', () => {
  // 31 Oct 18:00 UTC = 1 Nov 01:00 Jakarta.
  assert.equal(receiptDay({ plan_date: null, created_at: '2026-10-31T18:00:00Z' }), '2026-11-01');
  assert.equal(receiptDay({ plan_date: '2026-10-30', created_at: '2026-10-31T18:00:00Z' }), '2026-10-30');
});

console.log(`\ninbound-lot: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
