/** "Sheet benar" on the Putaway page: decisions per bin line (the database side is supabase/tests/38_putaway_fix.sql). */
import { strict as assert } from 'node:assert';
import { fixDelta, fixLinesFor, fixPayload, fixProblem, fixSummary, type FixLine } from '../lib/putaway-sheet';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPutaway: sheet benar');

// 8 Oct: CA06C01 held 4 IAGO drums on the floor; the system had 36 Helix there (really in CA02D02).
const helix = { sku: '550038021', batch_lot: '01J26JJ', expiry_date: '2030-10-01', quantity: 36 };
const row = { bin_code: 'CA06C01', sku: '550056224', quantity: 4 };

test('every line starts undecided and must get a decision', () => {
  const lines = fixLinesFor([helix]);
  assert.equal(lines[0].choice, '');
  assert.equal(fixProblem('CA06C01', lines), '550038021 batch 01J26JJ: pilih keputusan');
});

test('a move needs a real other bin', () => {
  const l: FixLine = { ...helix, choice: 'move', move_to: '' };
  assert.match(fixProblem('CA06C01', [l])!, /isi bin tujuan/);
  assert.match(fixProblem('CA06C01', [{ ...l, move_to: 'ca06c01' }])!, /sama dengan bin ini/);
  assert.equal(fixProblem('CA06C01', [{ ...l, move_to: 'ca02d02' }]), null);
});

test('a count needs a number, 0 allowed', () => {
  const l: FixLine = { ...helix, choice: 'count', counted: 'x' };
  assert.match(fixProblem('CA06C01', [l])!, /isi jumlah sebenarnya/);
  assert.equal(fixProblem('CA06C01', [{ ...l, counted: '0' }]), null);
});

test('adjustment per decision: remove takes all, count the difference, keep and move none', () => {
  assert.equal(fixDelta({ ...helix, choice: 'remove' }), -36);
  assert.equal(fixDelta({ ...helix, choice: 'count', counted: '30' }), -6);
  assert.equal(fixDelta({ ...helix, choice: 'count', counted: '40' }), 4);
  assert.equal(fixDelta({ ...helix, choice: 'keep' }), 0);
  assert.equal(fixDelta({ ...helix, choice: 'move', move_to: 'CA02D02' }), 0);
});

test('summary: the incident in one sentence', () => {
  assert.equal(fixSummary(row, [{ ...helix, choice: 'move', move_to: 'ca02d02' }], 20),
    'CA06C01: putaway 4 × 550056224; 36 × 550038021 (01J26JJ) pindah ke CA02D02.');
});

test('summary: an adjustment above the limit is marked for approval, one within it is not', () => {
  assert.match(fixSummary(row, [{ ...helix, choice: 'remove' }], 20), /36 × 550038021 \(01J26JJ\) dihapus \(perlu persetujuan\)/);
  assert.match(fixSummary(row, [{ ...helix, choice: 'count', counted: '30' }], 20), /550038021 \(01J26JJ\) 36 → 30\.$/);
});

test('payload carries only what each decision needs, bins upper-cased', () => {
  assert.deepEqual(fixPayload([{ ...helix, choice: 'move', move_to: ' ca02d02 ', counted: '5' }]), [
    { ...helix, choice: 'move', counted: undefined, move_to: 'CA02D02' }]);
  assert.deepEqual(fixPayload([{ ...helix, choice: 'count', counted: ' 30 ', move_to: 'X' }]), [
    { ...helix, choice: 'count', counted: '30', move_to: undefined }]);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
