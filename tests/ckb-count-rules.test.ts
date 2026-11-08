// CKB blind count page rules (lib/ckb/count-rules.ts, 0133): photo reason, location groups, list order, progress.
import { strict as assert } from 'node:assert';
import { groupLocations, listOrder, locationPrefix, photoReason, progress } from '../lib/ckb/count-rules';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const on = { photoRules: true, customerAlways: false };

test('photoReason mirrors ckb_photo_reason, in its order', () => {
  assert.equal(photoReason({ origin: 'FOUND', round: 2 }, 0, on), 'hitungan 0');
  assert.equal(photoReason({ origin: 'FOUND', round: 2 }, 3, on), 'barang temuan');
  assert.equal(photoReason({ origin: 'BASELINE', round: 2 }, 3, on), 'hitungan ulang');
  assert.equal(photoReason({ origin: 'BASELINE', round: 1 }, 3, { photoRules: true, customerAlways: true }), 'wajib untuk pelanggan ini');
  assert.equal(photoReason({ origin: 'BASELINE', round: 1 }, 3, on), null);
  assert.equal(photoReason({ origin: 'BASELINE', round: 1 }, null, on), null);  // nothing typed yet
  assert.equal(photoReason({ origin: 'FOUND', round: 2 }, 0, { photoRules: false, customerAlways: true }), null);
});

test('locationPrefix: the part before the last run of digits', () => {
  assert.equal(locationPrefix('SIP-15'), 'SIP-');
  assert.equal(locationPrefix('0101NP0104'), '0101NP');
  assert.equal(locationPrefix('CG01A01'), 'CG01A');
  assert.equal(locationPrefix('YARD'), 'YARD');
  assert.equal(locationPrefix(''), '(tanpa lokasi)');
});

test('groupLocations groups by prefix, in code order, with totals', () => {
  const g = groupLocations([
    { storage_bin: 'SIP-11', lines: 2, assigned_to: 'a', counted: 1 },
    { storage_bin: '0101NP0104', lines: 1, assigned_to: null, counted: 0 },
    { storage_bin: 'SIP-10', lines: 3, assigned_to: 'a', counted: 3 },
  ]);
  assert.deepEqual(g.map((x) => x.prefix), ['0101NP', 'SIP-']);
  assert.deepEqual(g[1].bins.map((b) => b.storage_bin), ['SIP-10', 'SIP-11']);
  assert.deepEqual([g[1].lines, g[1].counted], [5, 4]);
});

test('listOrder: recounts first, then open, then counted; by location, then seq', () => {
  const t = (seq: number, status: string, storage_bin: string) => ({ seq, status, storage_bin });
  const out = listOrder([t(1, 'COUNTED', 'A-1'), t(2, 'OPEN', 'B-1'), t(3, 'RECOUNT_REQUESTED', 'C-1'), t(4, 'OPEN', 'A-2'), t(5, 'ACCEPTED', 'A-0')]);
  assert.deepEqual(out.map((x) => x.seq), [3, 4, 2, 5, 1]);
});

test('progress counts what no longer waits for a count', () => {
  assert.deepEqual(progress([{ status: 'OPEN' }, { status: 'RECOUNT_REQUESTED' }, { status: 'COUNTED' }, { status: 'ACCEPTED' }]), { done: 2, total: 4 });
});

console.log(`\nckb-count-rules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
