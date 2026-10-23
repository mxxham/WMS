/**
 * CKB Rebagging — pure logic tests (tsx, inline runner).
 * Follows the exact shape of tests/one-bin-per-line.test.ts:
 * - inline test() helper
 * - passed/failed counters on node:assert strict
 * - process.exit(failed > 0 ? 1 : 0)
 */
import { strict as assert } from 'node:assert';
import {
  REBAG_STATUSES,
  REBAG_ACTIONS_BY_STATUS,
  REBAG_VALID_TRANSITIONS,
  OPERATION_TYPES,
  computeVariance,
  unitsCompatible,
  evidenceGate,
  allocatePreview,
  type RebagStatus,
  type RebagActionKey,
  type OperationType,
  type EvidenceKind,
} from '../lib/ckb/rebagging';

let passed = 0, failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

function assertDeepEqual<T>(actual: T, expected: T, msg?: string) {
  assert.deepStrictEqual(actual, expected, msg);
}

console.log('\n=== CKB Rebagging Pure Logic Tests ===\n');

// ---------------------------------------------------------------------------
// Status machine metadata
// ---------------------------------------------------------------------------

console.log('\n--- Status metadata ---');

test('REBAG_STATUSES has all 10 statuses with Indonesian labels and valid tones', () => {
  const expectedStatuses: RebagStatus[] = [
    'DRAFT', 'OPEN', 'IN_PROGRESS', 'AWAITING_VERIFICATION', 'VERIFIED',
    'REJECTED', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'REVERSED',
  ];
  assert.equal(REBAG_STATUSES.length, 10);
  REBAG_STATUSES.forEach((s, i) => {
    assert.equal(s.key, expectedStatuses[i]);
    assert.ok(typeof s.label === 'string' && s.label.length > 0);
    assert.ok(typeof s.tone === 'string');
    assert.ok(typeof s.description === 'string' && s.description.length > 0);
  });
  // Check specific Indonesian labels
  assert.equal(REBAG_STATUSES.find(s => s.key === 'DRAFT')!.label, 'Draf');
  assert.equal(REBAG_STATUSES.find(s => s.key === 'OPEN')!.label, 'Terbuka');
  assert.equal(REBAG_STATUSES.find(s => s.key === 'IN_PROGRESS')!.label, 'Sedang Berjalan');
  assert.equal(REBAG_STATUSES.find(s => s.key === 'AWAITING_VERIFICATION')!.label, 'Menunggu Verifikasi');
  assert.equal(REBAG_STATUSES.find(s => s.key === 'VERIFIED')!.label, 'Terverifikasi');
  assert.equal(REBAG_STATUSES.find(s => s.key === 'REJECTED')!.label, 'Ditolak');
  assert.equal(REBAG_STATUSES.find(s => s.key === 'ON_HOLD')!.label, 'Ditahan');
  assert.equal(REBAG_STATUSES.find(s => s.key === 'COMPLETED')!.label, 'Selesai');
  assert.equal(REBAG_STATUSES.find(s => s.key === 'CANCELLED')!.label, 'Dibatalkan');
  assert.equal(REBAG_STATUSES.find(s => s.key === 'REVERSED')!.label, 'Dibatalkan Posting');
});

test('REBAG_ACTIONS_BY_STATUS covers every status with action arrays', () => {
  const allStatuses: RebagStatus[] = [
    'DRAFT', 'OPEN', 'IN_PROGRESS', 'AWAITING_VERIFICATION', 'VERIFIED',
    'REJECTED', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'REVERSED',
  ];
  allStatuses.forEach(status => {
    assert.ok(Array.isArray(REBAG_ACTIONS_BY_STATUS[status]));
    REBAG_ACTIONS_BY_STATUS[status].forEach(action => {
      const validActions: RebagActionKey[] = [
        'edit-sources', 'edit-outputs', 'start', 'record', 'submit', 'verify',
        'resolve-variance', 'hold', 'unhold', 'cancel', 'approve-post', 'reverse', 'add-evidence'
      ];
      assert.ok(validActions.includes(action), `Unknown action ${action} in ${status}`);
    });
  });
  // Specific checks
  assertDeepEqual(REBAG_ACTIONS_BY_STATUS.DRAFT.sort(), ['edit-sources', 'edit-outputs', 'start', 'cancel', 'add-evidence'].sort());
  assertDeepEqual(REBAG_ACTIONS_BY_STATUS.OPEN.sort(), ['edit-sources', 'edit-outputs', 'start', 'cancel', 'add-evidence'].sort());
  assert.ok(REBAG_ACTIONS_BY_STATUS.IN_PROGRESS.includes('record'));
  assert.ok(REBAG_ACTIONS_BY_STATUS.IN_PROGRESS.includes('hold'));
  assert.ok(!REBAG_ACTIONS_BY_STATUS.AWAITING_VERIFICATION.includes('submit'));
  assert.ok(REBAG_ACTIONS_BY_STATUS.AWAITING_VERIFICATION.includes('cancel'));
  assert.ok(REBAG_ACTIONS_BY_STATUS.AWAITING_VERIFICATION.includes('resolve-variance'));
  assert.ok(REBAG_ACTIONS_BY_STATUS.VERIFIED.includes('approve-post'));
  assert.ok(!REBAG_ACTIONS_BY_STATUS.VERIFIED.includes('reverse'));
  assert.ok(REBAG_ACTIONS_BY_STATUS.VERIFIED.includes('cancel'));
  assert.ok(REBAG_ACTIONS_BY_STATUS.ON_HOLD.includes('unhold'));
  assert.ok(!REBAG_ACTIONS_BY_STATUS.COMPLETED.includes('approve-post'));
});

test('REBAG_VALID_TRANSITIONS defines correct forward edges (no cycles except ON_HOLD resume)', () => {
  assertDeepEqual(REBAG_VALID_TRANSITIONS.DRAFT.sort(), ['OPEN', 'CANCELLED'].sort());
  assertDeepEqual(REBAG_VALID_TRANSITIONS.OPEN.sort(), ['IN_PROGRESS', 'CANCELLED'].sort());
  assertDeepEqual(REBAG_VALID_TRANSITIONS.IN_PROGRESS.sort(), ['AWAITING_VERIFICATION', 'ON_HOLD', 'CANCELLED'].sort());
  assertDeepEqual(REBAG_VALID_TRANSITIONS.AWAITING_VERIFICATION.sort(), ['VERIFIED', 'REJECTED', 'ON_HOLD', 'CANCELLED'].sort());
  assertDeepEqual(REBAG_VALID_TRANSITIONS.VERIFIED.sort(), ['COMPLETED', 'ON_HOLD', 'CANCELLED'].sort());
  // Reversal is posting-undo: only a COMPLETED job can be reversed, never a merely VERIFIED one.
  assert.ok(!REBAG_VALID_TRANSITIONS.VERIFIED.includes('REVERSED'));
  assertDeepEqual(REBAG_VALID_TRANSITIONS.REJECTED.sort(), ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'].sort());
  assert.ok(REBAG_VALID_TRANSITIONS.ON_HOLD.includes('DRAFT'));
  assert.ok(REBAG_VALID_TRANSITIONS.ON_HOLD.includes('OPEN'));
  assert.ok(REBAG_VALID_TRANSITIONS.ON_HOLD.includes('IN_PROGRESS'));
  assert.ok(REBAG_VALID_TRANSITIONS.ON_HOLD.includes('AWAITING_VERIFICATION'));
  assert.ok(REBAG_VALID_TRANSITIONS.ON_HOLD.includes('VERIFIED'));
  assert.ok(REBAG_VALID_TRANSITIONS.ON_HOLD.includes('REJECTED'));
  assert.ok(REBAG_VALID_TRANSITIONS.ON_HOLD.includes('CANCELLED'));
  assertDeepEqual(REBAG_VALID_TRANSITIONS.COMPLETED, ['REVERSED']);
  assertDeepEqual(REBAG_VALID_TRANSITIONS.CANCELLED, []);
  assertDeepEqual(REBAG_VALID_TRANSITIONS.REVERSED, []);
});

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

console.log('\n--- Operation types ---');

test('OPERATION_TYPES has all 4 types with Indonesian labels and emphasize fields', () => {
  const expected: OperationType[] = ['DAMAGE_REBAG', 'SPLIT', 'RELABEL', 'COMBINE'];
  assert.equal(OPERATION_TYPES.length, 4);
  OPERATION_TYPES.forEach((ot, i) => {
    assert.equal(ot.key, expected[i]);
    assert.ok(typeof ot.label === 'string' && ot.label.length > 0);
    assert.ok(typeof ot.description === 'string' && ot.description.length > 0);
    assert.ok(Array.isArray(ot.emphasizes) && ot.emphasizes.length > 0);
  });
  assert.equal(OPERATION_TYPES.find(t => t.key === 'DAMAGE_REBAG')!.label, 'Rebag Kerusakan');
  assert.equal(OPERATION_TYPES.find(t => t.key === 'SPLIT')!.label, 'Pecah Paket');
  assert.equal(OPERATION_TYPES.find(t => t.key === 'RELABEL')!.label, 'Ganti Label');
  assert.equal(OPERATION_TYPES.find(t => t.key === 'COMBINE')!.label, 'Gabung Paket');
});

// ---------------------------------------------------------------------------
// Variance computation
// ---------------------------------------------------------------------------

console.log('\n--- Variance computation ---');

test('computeVariance: zero when equal', () => {
  assert.equal(computeVariance(100, 100), 0);
  assert.equal(computeVariance(0, 0), 0);
});

test('computeVariance: positive when input > output (loss)', () => {
  assert.equal(computeVariance(100, 95), 5);
  assert.equal(computeVariance(50, 0), 50);
  assert.equal(computeVariance(10.5, 10), 0.5);
});

test('computeVariance: negative when input < output (gain — still requires review)', () => {
  assert.equal(computeVariance(100, 105), -5);
  assert.equal(computeVariance(0, 10), -10);
});

// ---------------------------------------------------------------------------
// Unit compatibility
// ---------------------------------------------------------------------------

console.log('\n--- Unit compatibility ---');

test('unitsCompatible: true for empty array', () => {
  assert.equal(unitsCompatible([]), true);
});

test('unitsCompatible: true when all units identical (case/space sensitive)', () => {
  assert.equal(unitsCompatible([{ unit: 'KG' }, { unit: 'KG' }, { unit: 'KG' }]), true);
  assert.equal(unitsCompatible([{ unit: 'pcs' }, { unit: 'pcs' }]), true);
});

test('unitsCompatible: false when any unit differs', () => {
  assert.equal(unitsCompatible([{ unit: 'KG' }, { unit: 'kg' }]), false); // case sensitive
  assert.equal(unitsCompatible([{ unit: 'KG' }, { unit: 'PCS' }]), false);
  assert.equal(unitsCompatible([{ unit: 'KG' }, { unit: 'KG ' }]), false); // trailing space
});

// ---------------------------------------------------------------------------
// Evidence gate
// ---------------------------------------------------------------------------

console.log('\n--- Evidence gate ---');

test('evidenceGate: both false when no evidence', () => {
  assertDeepEqual(evidenceGate([]), { before: false, after: false });
  assertDeepEqual(evidenceGate(['OTHER']), { before: false, after: false });
  assertDeepEqual(evidenceGate(['OTHER', 'OTHER']), { before: false, after: false });
});

test('evidenceGate: before true only with BEFORE', () => {
  assertDeepEqual(evidenceGate(['BEFORE']), { before: true, after: false });
  assertDeepEqual(evidenceGate(['BEFORE', 'OTHER']), { before: true, after: false });
});

test('evidenceGate: after true only with AFTER', () => {
  assertDeepEqual(evidenceGate(['AFTER']), { before: false, after: true });
  assertDeepEqual(evidenceGate(['AFTER', 'OTHER']), { before: false, after: true });
});

test('evidenceGate: both true only when both BEFORE and AFTER present', () => {
  assertDeepEqual(evidenceGate(['BEFORE', 'AFTER']), { before: true, after: true });
  assertDeepEqual(evidenceGate(['AFTER', 'BEFORE']), { before: true, after: true });
  assertDeepEqual(evidenceGate(['BEFORE', 'AFTER', 'OTHER']), { before: true, after: true });
});

// ---------------------------------------------------------------------------
// Allocation preview (greedy, same algorithm as SQL posting)
// ---------------------------------------------------------------------------

console.log('\n--- Allocation preview ---');

test('allocatePreview: single source -> single output, same bin', () => {
  const sources = [{ lineNo: 1, quantity: 100, binCode: 'CA01A01' }];
  const outputs = [{ lineNo: 1, quantity: 80, binCode: 'CA01A01' }];
  const res = allocatePreview(sources, outputs);
  assertDeepEqual(res.pairs, [{ sourceLineNo: 1, outputLineNo: 1, quantity: 80, sameBin: true, crossBin: false }]);
  assertDeepEqual(res.unallocatedSources, [{ lineNo: 1, quantity: 20 }]);
  assertDeepEqual(res.unfilledOutputs, []);
});

test('allocatePreview: single source -> single output, cross bin', () => {
  const sources = [{ lineNo: 1, quantity: 100, binCode: 'CA01A01' }];
  const outputs = [{ lineNo: 1, quantity: 80, binCode: 'CB02B02' }];
  const res = allocatePreview(sources, outputs);
  assertDeepEqual(res.pairs, [{ sourceLineNo: 1, outputLineNo: 1, quantity: 80, sameBin: false, crossBin: true }]);
  assertDeepEqual(res.unallocatedSources, [{ lineNo: 1, quantity: 20 }]);
  assertDeepEqual(res.unfilledOutputs, []);
});

test('allocatePreview: multi-source -> multi-output, greedy by line_no', () => {
  // Source 1: 50 @ CA01A01, Source 2: 60 @ CA01A02
  // Output 1: 70 @ CB01A01, Output 2: 40 @ CB01A02
  // Expected: Out1 takes 50 from Src1 + 20 from Src2; Out2 takes 40 from Src2 (remaining)
  const sources = [
    { lineNo: 1, quantity: 50, binCode: 'CA01A01' },
    { lineNo: 2, quantity: 60, binCode: 'CA01A02' },
  ];
  const outputs = [
    { lineNo: 1, quantity: 70, binCode: 'CB01A01' },
    { lineNo: 2, quantity: 40, binCode: 'CB01A02' },
  ];
  const res = allocatePreview(sources, outputs);
  assertDeepEqual(res.pairs, [
    { sourceLineNo: 1, outputLineNo: 1, quantity: 50, sameBin: false, crossBin: true },
    { sourceLineNo: 2, outputLineNo: 1, quantity: 20, sameBin: false, crossBin: true },
    { sourceLineNo: 2, outputLineNo: 2, quantity: 40, sameBin: false, crossBin: true },
  ]);
  assertDeepEqual(res.unallocatedSources, []);
  assertDeepEqual(res.unfilledOutputs, []);
});

test('allocatePreview: multi-source -> multi-output with same-bin and cross-bin mix', () => {
  // Source 1: 50 @ CA01A01, Source 2: 60 @ CA01A02
  // Output 1: 40 @ CA01A01 (same bin as Src1), Output 2: 70 @ CB01A01
  // Expected: Out1 takes 40 from Src1 (sameBin), Out2 takes 10 from Src1 + 60 from Src2 (crossBin)
  const sources = [
    { lineNo: 1, quantity: 50, binCode: 'CA01A01' },
    { lineNo: 2, quantity: 60, binCode: 'CA01A02' },
  ];
  const outputs = [
    { lineNo: 1, quantity: 40, binCode: 'CA01A01' },
    { lineNo: 2, quantity: 70, binCode: 'CB01A01' },
  ];
  const res = allocatePreview(sources, outputs);
  assertDeepEqual(res.pairs, [
    { sourceLineNo: 1, outputLineNo: 1, quantity: 40, sameBin: true, crossBin: false },
    { sourceLineNo: 1, outputLineNo: 2, quantity: 10, sameBin: false, crossBin: true },
    { sourceLineNo: 2, outputLineNo: 2, quantity: 60, sameBin: false, crossBin: true },
  ]);
  assertDeepEqual(res.unallocatedSources, []);
  assertDeepEqual(res.unfilledOutputs, []);
});

test('allocatePreview: output exceeds total source -> unfilled output', () => {
  const sources = [{ lineNo: 1, quantity: 50, binCode: 'CA01A01' }];
  const outputs = [{ lineNo: 1, quantity: 80, binCode: 'CB01A01' }];
  const res = allocatePreview(sources, outputs);
  assertDeepEqual(res.pairs, [{ sourceLineNo: 1, outputLineNo: 1, quantity: 50, sameBin: false, crossBin: true }]);
  assertDeepEqual(res.unallocatedSources, []);
  assertDeepEqual(res.unfilledOutputs, [{ lineNo: 1, quantity: 30, binCode: 'CB01A01' }]);
});

test('allocatePreview: source exceeds total output -> unallocated source', () => {
  const sources = [{ lineNo: 1, quantity: 100, binCode: 'CA01A01' }];
  const outputs = [{ lineNo: 1, quantity: 60, binCode: 'CB01A01' }];
  const res = allocatePreview(sources, outputs);
  assertDeepEqual(res.pairs, [{ sourceLineNo: 1, outputLineNo: 1, quantity: 60, sameBin: false, crossBin: true }]);
  assertDeepEqual(res.unallocatedSources, [{ lineNo: 1, quantity: 40 }]);
  assertDeepEqual(res.unfilledOutputs, []);
});

test('allocatePreview: sources and outputs sorted by line_no regardless of input order', () => {
  // Intentionally shuffled input order
  const sources = [
    { lineNo: 3, quantity: 30, binCode: 'CA01A03' },
    { lineNo: 1, quantity: 40, binCode: 'CA01A01' },
    { lineNo: 2, quantity: 50, binCode: 'CA01A02' },
  ];
  const outputs = [
    { lineNo: 2, quantity: 60, binCode: 'CB01A02' },
    { lineNo: 1, quantity: 60, binCode: 'CB01A01' },
  ];
  const res = allocatePreview(sources, outputs);
  // Should process Src1(40) -> Out1(60) takes 40, then Src2(50) -> Out1 takes 20, Src2 rem 30 -> Out2(60) takes 30, Src3(30) -> Out2 takes 30
  assertDeepEqual(res.pairs, [
    { sourceLineNo: 1, outputLineNo: 1, quantity: 40, sameBin: false, crossBin: true },
    { sourceLineNo: 2, outputLineNo: 1, quantity: 20, sameBin: false, crossBin: true },
    { sourceLineNo: 2, outputLineNo: 2, quantity: 30, sameBin: false, crossBin: true },
    { sourceLineNo: 3, outputLineNo: 2, quantity: 30, sameBin: false, crossBin: true },
  ]);
  assertDeepEqual(res.unallocatedSources, []);
  assertDeepEqual(res.unfilledOutputs, []);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);