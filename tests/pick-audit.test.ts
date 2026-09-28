/** Picking audit rules (lib/pick-audit.ts, same rule as 0024 pick_audit_errors). */
import { strict as assert } from 'node:assert';
import {
  allowedResolutions, auditCoverage, median, normBatch, pickAuditErrors, scanCompliance, shipmentFirstPass, summarizeAccuracy,
  type FirstAttempt,
} from '../lib/pick-audit';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPicking audit');

const exp = { sku: '550044709', batch: 'A7', expiry: '2031-05-05', qty: 10 };
const found = (o: Partial<{ sku: string; batch: string; expiry: string | null; qty: number; damaged: boolean }>) =>
  ({ sku: '550044709', batch: 'A7', expiry: null, qty: 10, damaged: false, ...o });

test('batch compare ignores case and every space', () => {
  assert.equal(normBatch(' a7 '), 'A7');
  assert.equal(normBatch('14h 26jj'), '14H26JJ');
  assert.equal(normBatch(null), '');
  assert.deepEqual(pickAuditErrors(exp, found({ batch: ' a7 ' })), []);
});
test('short, over, batch, expiry, damaged in fixed order', () => {
  assert.deepEqual(pickAuditErrors(exp, found({ qty: 8, batch: 'B8', expiry: '2031-06-06', damaged: true })),
    ['SHORT', 'WRONG_BATCH', 'WRONG_EXPIRY', 'DAMAGED']);
  assert.deepEqual(pickAuditErrors(exp, found({ qty: 11 })), ['OVER']);
});
test('expiry only compared when both are known', () => {
  assert.deepEqual(pickAuditErrors(exp, found({ expiry: null })), []);
  assert.deepEqual(pickAuditErrors({ ...exp, expiry: null }, found({ expiry: '2031-01-01' })), []);
  assert.deepEqual(pickAuditErrors(exp, found({ expiry: '2031-05-05T00:00:00' })), []);
});
test('wrong SKU: nothing else compared, damage still counts', () => {
  assert.deepEqual(pickAuditErrors(exp, found({ sku: '550024919', qty: 1, batch: 'ZZ' })), ['WRONG_SKU']);
  assert.deepEqual(pickAuditErrors(exp, found({ sku: '550024919', damaged: true })), ['WRONG_SKU', 'DAMAGED']);
});
test('resolutions: short alone, or batch/expiry with the full count', () => {
  assert.deepEqual(allowedResolutions(['SHORT'], 8, 10), ['ACCEPT_SHORT']);
  assert.deepEqual(allowedResolutions(['SHORT', 'WRONG_BATCH'], 8, 10), []);
  assert.deepEqual(allowedResolutions(['WRONG_BATCH'], 10, 10), ['ACCEPT_BATCH']);
  assert.deepEqual(allowedResolutions(['WRONG_BATCH', 'WRONG_EXPIRY'], 10, 10), ['ACCEPT_BATCH']);
  assert.deepEqual(allowedResolutions(['WRONG_EXPIRY', 'DAMAGED'], 10, 10), []);
  assert.deepEqual(allowedResolutions(['WRONG_SKU'], 10, 10), []);
  assert.deepEqual(allowedResolutions([], 10, 10), []);
});

const row = (o: Partial<FirstAttempt>): FirstAttempt => ({
  task_id: 't', result: 'OK', errors: [], expected_qty: 10, counted_qty: 10, picked_by_name: 'Budi', sku: '550044709',
  description: 'Oli', zone: 'CF', bulk_posted: false, minutes_to_audit: 10, wave_id: 'w1', shipment_number: 'S1', ...o,
});
test('accuracy: first attempts per line, units, per picker / SKU / zone / error', () => {
  const rows = [
    row({ task_id: 'a' }),
    row({ task_id: 'b', result: 'MISMATCH', errors: ['SHORT'], counted_qty: 8, minutes_to_audit: 30 }),
    row({ task_id: 'c', result: 'MISMATCH', errors: ['WRONG_BATCH'], picked_by_name: 'Rina', zone: 'CA', bulk_posted: true, minutes_to_audit: 20 }),
    row({ task_id: 'd', picked_by_name: null, sku: '550024919', description: 'Gemuk', minutes_to_audit: null }),
  ];
  const s = summarizeAccuracy(rows);
  assert.equal(s.lines, 4);
  assert.equal(s.ok, 2);
  assert.equal(s.lineAccuracy, 50);
  // 40 units expected; 2 short + 10 of the wrong batch are wrong.
  assert.equal(s.unitAccuracy, 70);
  assert.equal(s.mispicksPer1000, 500);
  assert.equal(s.medianMinutes, 20);
  assert.deepEqual(s.byError, [{ error: 'SHORT', n: 1 }, { error: 'WRONG_BATCH', n: 1 }]);
  assert.deepEqual(s.byPicker[0], { name: 'Rina', lines: 1, errors: 1, accuracy: 0, bulk: 1 });
  assert.deepEqual(s.byPicker.map((p) => p.name), ['Rina', 'Budi', '(tidak tercatat)']);
  assert.deepEqual(s.bySku[0], { sku: '550044709', description: 'Oli', lines: 3, errors: 2 });
  assert.deepEqual(s.byZone[0], { zone: 'CA', lines: 1, errors: 1 });
});
test('accuracy of nothing is unknown, not 100 %', () => {
  const s = summarizeAccuracy([]);
  assert.equal(s.lineAccuracy, null);
  assert.equal(s.unitAccuracy, null);
  assert.equal(s.mispicksPer1000, null);
  assert.equal(s.medianMinutes, null);
});
test('shipment first pass, coverage, scan compliance, median', () => {
  const rows = [row({ wave_id: 'w1', shipment_number: 'S1' }), row({ wave_id: 'w1', shipment_number: 'S2', result: 'MISMATCH', errors: ['OVER'] })];
  assert.equal(shipmentFirstPass([{ wave_id: 'w1', shipment_number: 'S1' }, { wave_id: 'w1', shipment_number: 'S2' }], rows), 50);
  assert.equal(shipmentFirstPass([], rows), null);
  assert.equal(auditCoverage([{ todo: 0, mismatch: 0 }, { todo: 1, mismatch: 0 }]), 50);
  assert.equal(auditCoverage([]), null);
  assert.equal(scanCompliance([true, false, false, true]), 50);
  assert.equal(scanCompliance([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
