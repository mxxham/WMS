/**
 * CKB 3PL — stock take helpers (lib/ckb/stocktake.ts), inspection (lib/ckb/inspection.ts),
 * evidence (lib/ckb/evidence.ts), reports (lib/ckb/reports.ts) and the SAP export sheet
 * (lib/ckb/export-file.ts). The classification cases are the same ones supabase/tests/67 runs
 * against public.ckb_classify, so the screen and the database cannot drift apart unnoticed.
 */
import { strict as assert } from 'node:assert';
import { classify, variance, reviewActions, countOpen, parseCountInput } from '../lib/ckb/stocktake';
import { checklistError, keyFromLabel, submitProblems, inspectionResult, type ChecklistItem } from '../lib/ckb/inspection';
import { sniffMime, evidenceFileError, evidencePath } from '../lib/ckb/evidence';
import { reportSummary, stocktakeCompletion, cellText, reportsFor } from '../lib/ckb/reports';
import { exportRows, exportTotals, exportNotice, EXPORT_COLUMNS, type ExportLineData } from '../lib/ckb/export-file';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const base = { origin: 'BASELINE' as const, identityIssue: null, baseline: 10, batchOk: null, expiryOk: null };

console.log('\nCKB stock take');

test('zero and not counted are different', () => {
  assert.equal(classify({ ...base, baseline: 0, qty: 0 }), 'MATCH');
  assert.equal(classify({ ...base, baseline: 0, qty: null }), 'UNCOUNTED');
  assert.equal(classify({ ...base, qty: 0 }), 'SHORTAGE');
  assert.equal(variance(10, null), null);
  assert.equal(variance(10, 0), -10);
});

test('classification order: uncounted, ambiguous, found, batch/expiry, then quantity', () => {
  assert.equal(classify({ ...base, qty: 10 }), 'MATCH');
  assert.equal(classify({ ...base, qty: 4 }), 'SHORTAGE');
  assert.equal(classify({ ...base, qty: 12 }), 'OVERAGE');
  assert.equal(classify({ ...base, identityIssue: 'DUPLICATE_ROWS', qty: 10 }), 'AMBIGUOUS');
  assert.equal(classify({ ...base, origin: 'FOUND', baseline: 0, qty: 6 }), 'UNEXPECTED');
  assert.equal(classify({ ...base, qty: 10, batchOk: false }), 'BATCH_MISMATCH');
  assert.equal(classify({ ...base, qty: 10, expiryOk: false }), 'BATCH_MISMATCH');
  assert.equal(classify({ ...base, identityIssue: 'DUPLICATE_ROWS', qty: null }), 'UNCOUNTED');
});

test('variance is per task: a -6 in one bin and +6 in another stay -6 and +6', () => {
  const a = variance(10, 4), b = variance(0, 6);
  assert.equal(a, -6); assert.equal(b, 6);
});

test('review buttons follow the database guards', () => {
  assert.deepEqual(reviewActions({ status: 'COUNTED', classification: 'SHORTAGE', countTotal: 1 }), ['ACCEPT', 'RECOUNT', 'EXCLUDE']);
  assert.deepEqual(reviewActions({ status: 'COUNTED', classification: 'AMBIGUOUS', countTotal: 1 }), ['RECOUNT', 'EXCLUDE']);
  assert.deepEqual(reviewActions({ status: 'OPEN', classification: 'UNCOUNTED', countTotal: 0 }), ['RECOUNT', 'EXCLUDE']);
  assert.deepEqual(reviewActions({ status: 'RECOUNT_REQUESTED', classification: 'SHORTAGE', countTotal: 1 }), ['EXCLUDE']);
  assert.deepEqual(reviewActions({ status: 'ACCEPTED', classification: 'MATCH', countTotal: 1 }), []);
});

test('counting is open while counting, and in review only for recounts', () => {
  assert.ok(countOpen('COUNTING', 'OPEN') && countOpen('COUNTING', 'COUNTED') && countOpen('REVIEW', 'RECOUNT_REQUESTED'));
  assert.ok(!countOpen('REVIEW', 'COUNTED') && !countOpen('DRAFT', 'OPEN') && !countOpen('CLOSED', 'RECOUNT_REQUESTED'));
});

test('count input: empty is not zero, comma decimals, dots refused', () => {
  assert.equal(parseCountInput(''), null);
  assert.deepEqual(parseCountInput('0'), { qty: 0 });
  assert.deepEqual(parseCountInput('12,5'), { qty: 12.5 });
  assert.deepEqual(parseCountInput(' 1234 '), { qty: 1234 });
  assert.ok('error' in (parseCountInput('1.234') as object));
  assert.ok('error' in (parseCountInput('12.5') as object));
  assert.ok('error' in (parseCountInput('-1') as object));
  assert.ok('error' in (parseCountInput('abc') as object));
});

console.log('\nCKB inspection');
const CL: ChecklistItem[] = [
  { key: 'pallet', label: 'Palet utuh', required: true, kind: 'CHECK' },
  { key: 'qty', label: 'Jumlah', required: true, kind: 'NUMBER' },
  { key: 'remarks', label: 'Keterangan', required: false, kind: 'TEXT' },
];

test('checklist validation mirrors the database', () => {
  assert.equal(checklistError(CL), null);
  assert.match(checklistError([])!, /minimal/);
  assert.match(checklistError([{ ...CL[0] }, { ...CL[0] }])!, /dua kali/);
  assert.match(checklistError([{ ...CL[0], key: 'Bad Key' }])!, /kunci/);
  assert.match(checklistError([{ ...CL[0], kind: 'PHOTO' }])!, /jenis/);
  assert.equal(keyFromLabel('Label sesuai dokumen!', new Set()), 'label_sesuai_dokumen');
  assert.equal(keyFromLabel('Palet', new Set(['palet'])), 'palet_2');
});

test('submit problems: required answers, NG note, NG photo, NG finding', () => {
  const ready = { checklist: CL, photoCount: 0, requirePhotoOnNg: true, damageClass: 'NONE' as const, findings: null };
  assert.match(submitProblems({ ...ready, responses: [] })[0], /Palet utuh, Jumlah/);
  assert.deepEqual(submitProblems({ ...ready, responses: [{ key: 'pallet', result: 'OK' }, { key: 'qty', value_num: 0 }] }), [], 'zero is an answer');
  const ng = submitProblems({ ...ready, responses: [{ key: 'pallet', result: 'NG' }, { key: 'qty', value_num: 3 }] });
  assert.equal(ng.length, 3);
  assert.deepEqual(submitProblems({ ...ready, photoCount: 1, damageClass: 'MINOR', responses: [{ key: 'pallet', result: 'NG', note: 'retak' }, { key: 'qty', value_num: 3 }] }), []);
  assert.equal(inspectionResult([{ key: 'pallet', result: 'NG' }]), 'FAIL');
  assert.equal(inspectionResult([{ key: 'pallet', result: 'NA' }]), 'PASS');
});

console.log('\nCKB evidence');
const POLICY = { max_mb: 10, allowed_mime: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], retention_days: 730 };
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = new TextEncoder().encode('%PDF-1.7 xxxxx');
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

test('file type comes from the bytes, not the name', () => {
  assert.equal(sniffMime(JPG), 'image/jpeg');
  assert.equal(sniffMime(PDF), 'application/pdf');
  assert.equal(sniffMime(EXE), null);
  assert.match(evidenceFileError({ declaredMime: 'image/jpeg', size: 100, head: EXE }, POLICY)!, /tidak dikenali/);
  assert.match(evidenceFileError({ declaredMime: 'image/png', size: 100, head: JPG }, POLICY)!, /tidak sama/);
  assert.match(evidenceFileError({ declaredMime: 'image/jpeg', size: 11 * 1024 * 1024, head: JPG }, POLICY)!, /10 MB/);
  assert.equal(evidenceFileError({ declaredMime: 'image/jpeg', size: 100, head: JPG }, POLICY), null);
  assert.match(evidenceFileError({ declaredMime: 'application/pdf', size: 100, head: PDF }, { ...POLICY, allowed_mime: ['image/jpeg'] })!, /tidak diizinkan/);
});

test('object paths are built from validated ids only', () => {
  const c = '11111111-1111-4111-8111-111111111111', e = '22222222-2222-4222-8222-222222222222', o = '33333333-3333-4333-8333-333333333333';
  assert.equal(evidencePath(c, 'INSPECTION', e, o, 'image/jpeg'), `${c}/INSPECTION/${e}/${o}.jpg`);
  assert.throws(() => evidencePath('../x', 'INSPECTION', e, o, 'image/jpeg'));
  assert.throws(() => evidencePath(c, 'INSPECTION', `${e}/..`, o, 'image/jpeg'));
  assert.throws(() => evidencePath(c, 'REBAGGING' as 'INSPECTION', e, o, 'image/jpeg'));
  assert.throws(() => evidencePath(c, 'INSPECTION', e, o, 'image/gif'));
});

console.log('\nCKB reports and SAP export');

test('report totals come from the filtered rows only', () => {
  const rows = [
    { classification: 'SHORTAGE', delta: -6, status: 'APPROVED' },
    { classification: 'UNEXPECTED', delta: 6, status: 'REJECTED' },
    { classification: 'UNCOUNTED', delta: null, status: 'PROPOSED' },
  ];
  assert.deepEqual(reportSummary('discrepancies', rows).map((s) => s.value), [3, 1, 1, 1]);
  assert.deepEqual(reportSummary('adjustments', rows).map((s) => s.value), [3, 6, 6, 1]);
  assert.deepEqual(reportSummary('discrepancies', []).map((s) => s.value), [0, 0, 0, 0]);
});

test('stock take completion is derived from task rows', () => {
  const t = (seq: number, rounds: number, status: string, cls: string) => ({ stocktake_id: 's1', stocktake_ref: 'ST1', customer_name: 'Freeport',
    baseline_ref: 'SAP1', snapshot_date: '2026-10-24', stocktake_status: 'REVIEW', created_at: '2026-10-25', seq, count_rounds: rounds, task_status: status, classification: cls });
  const [s] = stocktakeCompletion([t(1, 1, 'ACCEPTED', 'MATCH'), t(2, 2, 'COUNTED', 'SHORTAGE'), t(3, 0, 'OPEN', 'UNCOUNTED'), t(4, 1, 'EXCLUDED', 'COUNTED')]);
  assert.equal(s.tasks, 4); assert.equal(s.counted, 3); assert.equal(s.decided, 2); assert.equal(s.discrepancies, 2); assert.equal(s.pct_counted, 75);
});

test('representatives get only customer-facing reports', () => {
  assert.deepEqual(reportsFor('customer').sort(), ['adjustments', 'discrepancies', 'inspections', 'rebagging', 'recounts', 'stocktakes']);
  assert.ok(reportsFor('supervisor').includes('activity') && reportsFor('supervisor').includes('sap_exports'));
  assert.deepEqual(reportsFor('operator'), []);
  assert.equal(cellText(true), 'Ya');
  assert.equal(cellText('2026-10-25T08:30:00+07:00', 'datetime'), '2026-10-25 08:30');
});

const line = (n: number, delta: number): { line_no: number; data: ExportLineData } => ({ line_no: n, data: {
  adjustment_ref: `ADJ${n}`, stocktake_ref: 'ST1', baseline_snapshot_ref: 'SAP1', customer_code: 'FREEPORT', material_code: 'M1',
  description: 'x', plant: '', storage_location: '', storage_bin: 'CG01A01', batch: 'B1', expiry_date: null, uom: 'BAG', stock_type: '',
  baseline_qty: 10, counted_qty: 10 + delta, delta, direction: delta > 0 ? 'GAIN' : 'LOSS', classification: 'SHORTAGE', approved_by: 'Sari', approved_at: null } });

test('export sheet: rows in line order, totals from the lines, unverified format said on the sheet', () => {
  const rows = exportRows([line(2, 2), line(1, -6)]);
  assert.equal(rows[0][0], 1);
  assert.equal(rows[0].length, EXPORT_COLUMNS.length);
  assert.deepEqual(exportTotals([line(1, -6), line(2, 2)]), { gain: 2, loss: 6, lines: 2 });
  const notice = exportNotice({ ref_no: 'EXP1', kind: 'REEXPORT', original_ref: 'EXP0', reason: 'hilang', customer_code: 'FREEPORT', customer_name: 'Freeport',
    created_by_name: 'Sari', created_at: '2026-10-26', format_version: 'CKB-INTERNAL-1', format_verified: false }).join('\n');
  assert.match(notice, /EKSPOR ULANG dari EXP0: hilang/);
  assert.match(notice, /BELUM format unggah SAP/);
  assert.match(notice, /bukan bukti posting SAP/);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
