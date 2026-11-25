import { strict as assert } from 'node:assert';
import {
  HK_STATE, HK_STATUS_LABEL, addDays, dayFull, addMonths, canSubmit, compliancePct, dayLabel, dayRatios, fitEdge, hkPhotoPath, isExpected, isoDow, jakartaToday, lateRank, lateWindowOpen,
  fitBox, monthEnd, monthLabel, monthStart, monthWeeks, packDays, parsePaste, pctTone, perPic, photoRuleError, pickPackPhotos, problemAreaIds, reminders, summarizeGrid, weekDays, weekStart,
  workdaysBetween, type GridRow,
} from '../lib/ckb/housekeeping';
import { REPORTS, reportSummary } from '../lib/ckb/reports';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const none = new Set<string>();

test('weekdays: 24 Nov 2026 is a Tuesday, the week runs Monday 23 to Friday 27', () => {
  assert.equal(isoDow('2026-11-24'), 2);
  assert.equal(isoDow('2026-11-29'), 7);
  assert.equal(weekStart('2026-11-24'), '2026-11-23');
  assert.equal(weekStart('2026-11-29'), '2026-11-23');   // a Sunday belongs to the week before it
  assert.deepEqual(weekDays('2026-11-23'), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(dayLabel('2026-11-24'), 'Sel 24');
});

test('Jakarta today follows the Jakarta calendar, not UTC', () => {
  assert.equal(jakartaToday(new Date('2026-11-24T18:00:00Z')), '2026-11-25');   // 01:00 on the 25th in Jakarta
  assert.equal(jakartaToday(new Date('2026-11-24T10:00:00Z')), '2026-11-24');
});

test('working days skip weekends and holidays', () => {
  assert.deepEqual(workdaysBetween('2026-11-26', '2026-12-01', none), ['2026-11-26', '2026-11-27', '2026-11-30', '2026-12-01']);
  assert.deepEqual(workdaysBetween('2026-11-26', '2026-12-01', new Set(['2026-11-27'])), ['2026-11-26', '2026-11-30', '2026-12-01']);
});

test('late rank counts working days up to yesterday; the window mirrors ckb_hk_start', () => {
  const today = '2026-11-30';                               // a Monday
  assert.equal(lateRank('2026-11-27', today, none), 1);     // Friday = the previous working day
  assert.equal(lateRank('2026-11-26', today, none), 2);
  assert.equal(lateRank('2026-11-25', today, none), 3);
  assert.equal(lateRank('2026-11-24', today, none), 4);
  assert.equal(lateRank(today, today, none), 0);
  assert.equal(lateWindowOpen('2026-11-25', today, none, 3), true);
  assert.equal(lateWindowOpen('2026-11-24', today, none, 3), false);   // 4 working days back
  assert.equal(lateWindowOpen('2026-11-28', today, none, 3), false);   // a Saturday
  assert.equal(lateWindowOpen('2026-11-27', today, new Set(['2026-11-27']), 3), false);   // a holiday
  assert.equal(lateWindowOpen(today, today, none, 3), false);          // today is not late
  // a holiday in between does not use up the window
  assert.equal(lateWindowOpen('2026-11-24', today, new Set(['2026-11-26']), 3), true);
});

test('compliance: whole percent, null when nothing was expected', () => {
  assert.equal(compliancePct(4, 3), 75);
  assert.equal(compliancePct(3, 3), 100);
  assert.equal(compliancePct(0, 0), null);
  assert.equal(pctTone(null), 'muted'); assert.equal(pctTone(96), 'ok'); assert.equal(pctTone(85), 'warn'); assert.equal(pctTone(50), 'bad');
});

test('photo rules: sent check-in, an after photo before any before photo, the cap', () => {
  const base = { status: 'STARTED', kind: 'BEFORE' as const, before: 0, after: 0, maxPerKind: 3 };
  assert.equal(photoRuleError(base), null);
  assert.match(photoRuleError({ ...base, status: 'SUBMITTED' })!, /sebelum check-in dikirim/);
  assert.match(photoRuleError({ ...base, kind: 'AFTER' })!, /foto sebelum dulu/);
  assert.equal(photoRuleError({ ...base, kind: 'AFTER', before: 1 }), null);
  assert.match(photoRuleError({ ...base, before: 3 })!, /Maksimal 3 foto sebelum/);
  assert.equal(canSubmit(1, 1), true); assert.equal(canSubmit(2, 0), false); assert.equal(canSubmit(0, 1), false);
});

test('fit edge: scale down to the long edge, never enlarge', () => {
  assert.deepEqual(fitEdge(4000, 3000, 1600), { w: 1600, h: 1200 });
  assert.deepEqual(fitEdge(3000, 4000, 1600), { w: 1200, h: 1600 });
  assert.deepEqual(fitEdge(800, 600, 1600), { w: 800, h: 600 });
});

test('photo path: ids only, an image type', () => {
  const c = '11111111-1111-1111-1111-111111111111', k = '22222222-2222-2222-2222-222222222222', o = '33333333-3333-3333-3333-333333333333';
  assert.equal(hkPhotoPath(c, k, o, 'image/jpeg'), `${c}/HOUSEKEEPING/${k}/${o}.jpg`);
  assert.throws(() => hkPhotoPath(c, '../x', o, 'image/jpeg'), /ID tidak valid/);
  assert.throws(() => hkPhotoPath(c, k, o, 'application/pdf'), /JPG, PNG atau WebP/);
});

test('paste: Excel tabs, semicolons or commas; a header line is skipped; blank lines ignored', () => {
  const tab = parsePaste('Kode\tCustomer\tPIC\nCG05\tFreeport\tandi\n\nCG06\tCGP\tbudi\n');
  assert.deepEqual(tab.rows, [{ code: 'CG05', customer: 'Freeport', pic: 'andi' }, { code: 'CG06', customer: 'CGP', pic: 'budi' }]);
  assert.deepEqual(parsePaste('CG05;Freeport;andi').rows, [{ code: 'CG05', customer: 'Freeport', pic: 'andi' }]);
  assert.deepEqual(parsePaste('DOCK 1,Freeport,andi,Dock depan').rows, [{ code: 'DOCK 1', customer: 'Freeport', pic: 'andi', name: 'Dock depan' }]);
  assert.deepEqual(parsePaste('CG05').rows, [{ code: 'CG05', customer: '', pic: '' }]);     // only a code: the rest stays as it is
  assert.match(parsePaste('  \n ').error!, /Tempel dulu/);
  assert.match(parsePaste('Kode\tCustomer\tPIC').error!, /Tidak ada baris/);
  assert.match(parsePaste(Array.from({ length: 501 }, (_, i) => `A${i}`).join('\n')).error!, /Maksimal 500/);
});


// ---------------------------------------------------------------------
// Phase 1 completion: grid summaries, reminders, months, the photo pack, the housekeeping report
// ---------------------------------------------------------------------
const row = (o: Partial<GridRow>): GridRow => ({
  area_id: 'a1', area_code: 'CG01', area_name: 'Rak', customer_code: 'FP', pic_user_id: 'u1', pic_name: 'Ani', day: '2026-11-24', state: 'DONE',
  late: false, on_behalf: false, checkin_id: null, attempt: 1, ...o,
});

test('grid summary counts done and missed as expected; excused, leave and holidays are not', () => {
  const s = summarizeGrid([row({}), row({ state: 'DONE', late: true }), row({ state: 'MISSED' }), row({ state: 'EXCUSED' }), row({ state: 'LEAVE' }), row({ state: 'STARTED' }), row({ state: 'HOLIDAY' })]);
  assert.deepEqual(s, { expected: 3, done: 2, missed: 1, late: 1, started: 1, excused: 1, pct: 67 });
  assert.equal(summarizeGrid([row({ state: 'EXCUSED' })]).pct, null);
  assert.equal(isExpected('DONE'), true); assert.equal(isExpected('EXCUSED'), false); assert.equal(isExpected('PENDING'), false);
});

test('per PIC: worst compliance first, areas counted once', () => {
  const rows = [
    row({ pic_user_id: 'u1', pic_name: 'Ani', area_id: 'a1' }), row({ pic_user_id: 'u1', pic_name: 'Ani', area_id: 'a1', day: '2026-11-25' }),
    row({ pic_user_id: 'u2', pic_name: 'Budi', area_id: 'a2', state: 'MISSED' }), row({ pic_user_id: 'u2', pic_name: 'Budi', area_id: 'a3' }),
    row({ pic_user_id: null, pic_name: null, area_id: 'a4', state: 'NA' }),
  ];
  const p = perPic(rows);
  assert.deepEqual(p.map((x) => [x.pic_name, x.pct, x.areas, x.missed]), [['Budi', 50, 2, 1], ['Ani', 100, 1, 0]]);
});

test('problem areas: missed or rejected days only', () => {
  const ids = problemAreaIds([row({ area_id: 'a1' }), row({ area_id: 'a2', state: 'MISSED' }), row({ area_id: 'a3', state: 'REJECTED' }), row({ area_id: 'a4', state: 'EXCUSED' })]);
  assert.deepEqual([...ids].sort(), ['a2', 'a3']);
});

test('reminders: PICs with racks still to send today, most racks first; nothing when the day is not worked', () => {
  const today = '2026-11-24';
  const rows = [
    row({ pic_user_id: 'u1', pic_name: 'Ani', area_code: 'CG02', state: 'PENDING', day: today }), row({ pic_user_id: 'u1', pic_name: 'Ani', area_code: 'CG01', state: 'STARTED', day: today }),
    row({ pic_user_id: 'u2', pic_name: 'Budi', area_code: 'CH01', state: 'REJECTED', day: today }), row({ pic_user_id: 'u3', pic_name: 'Cici', state: 'DONE', day: today }),
    row({ pic_user_id: 'u4', pic_name: 'Dedi', state: 'PENDING', day: '2026-11-23' }),
  ];
  assert.deepEqual(reminders(rows, today), [
    { pic_user_id: 'u1', pic_name: 'Ani', areas: ['CG01', 'CG02'], started: 1 },
    { pic_user_id: 'u2', pic_name: 'Budi', areas: ['CH01'], started: 0 },
  ]);
  assert.deepEqual(reminders(rows.map((r) => ({ ...r, state: 'HOLIDAY' as const })), today), []);
});

test('months: start, end, label and the Monday-Friday weeks that cover them', () => {
  assert.equal(monthStart('2026-11-24'), '2026-11-01');
  assert.equal(addMonths('2026-11-24', 1), '2026-12-01'); assert.equal(addMonths('2026-01-15', -1), '2025-12-01');
  assert.equal(monthEnd('2026-11-24'), '2026-11-30'); assert.equal(monthEnd('2026-02-10'), '2026-02-28');
  assert.equal(monthLabel('2026-11-24'), 'November 2026');
  const w = monthWeeks('2026-11-24');
  assert.deepEqual(w[0], [null, null, null, null, null]);   // 1 Nov 2026 is a Sunday: the first Monday-Friday week starts on the 2nd
  assert.deepEqual(w[1].slice(0, 2), ['2026-11-02', '2026-11-03']);
  assert.deepEqual(w[w.length - 1], ['2026-11-30', null, null, null, null]);
});

test('day ratios count only expected days', () => {
  const m = dayRatios([{ day: 'd1', state: 'DONE' }, { day: 'd1', state: 'MISSED' }, { day: 'd1', state: 'EXCUSED' }, { day: 'd2', state: 'DONE' }, { day: 'd3', state: 'NA' }]);
  assert.deepEqual([...m.entries()], [['d1', { expected: 2, done: 1 }], ['d2', { expected: 1, done: 1 }]]);
});

test('photo pack: the first before and the last after photo of a day, marks from any photo; at most 31 done days, the latest kept', () => {
  const p = pickPackPhotos([
    { kind: 'AFTER', photo_id: 'a2', uploaded_at: '2026-11-24T10:00:00Z', late: false, on_behalf: false }, { kind: 'BEFORE', photo_id: 'b2', uploaded_at: '2026-11-24T08:05:00Z', late: false, on_behalf: false },
    { kind: 'BEFORE', photo_id: 'b1', uploaded_at: '2026-11-24T08:00:00Z', late: true, on_behalf: false }, { kind: 'AFTER', photo_id: 'a1', uploaded_at: '2026-11-24T09:00:00Z', late: false, on_behalf: true },
  ]);
  assert.deepEqual(p, { before: 'b1', after: 'a2', late: true, onBehalf: true });
  assert.deepEqual(pickPackPhotos([]), { before: null, after: null, late: false, onBehalf: false });
  const cells = Array.from({ length: 40 }, (_, i) => ({ day: addDays('2026-10-01', i), state: 'DONE' as const }));
  const r = packDays(cells, '2026-10-01', '2026-11-30');
  assert.equal(r.days.length, 31); assert.equal(r.cut, true); assert.equal(r.days[r.days.length - 1], '2026-11-09');
  assert.deepEqual(packDays([{ day: '2026-11-24', state: 'MISSED' }], '2026-11-01', '2026-11-30'), { days: [], cut: false });
});

test('housekeeping report: summary from the rows, a customer can run it, no name column', () => {
  const def = REPORTS.housekeeping;
  assert.ok(def.roles.includes('customer') && def.roles.includes('supervisor') && def.roles.includes('admin') && !def.roles.includes('operator'));
  assert.ok(!def.columns.some((c) => /(pic|nama_petugas|reviewer|oleh|by_name)/i.test(c.key)), def.columns.map((c) => c.key).join());
  const rows = [{ state: 'DONE', late: false }, { state: 'DONE', late: true }, { state: 'MISSED', late: false }, { state: 'NA', late: false }];
  assert.deepEqual(reportSummary('housekeeping', rows), [
    { label: 'Hari diharapkan', value: 3 }, { label: 'Selesai', value: 2 }, { label: 'Terlewat', value: 1 }, { label: 'Terlambat', value: 1 }, { label: 'Kepatuhan (%)', value: 67 },
  ]);
  assert.equal(reportSummary('housekeeping', [])[4].value, 0);
});

test('fit box: keep the shape inside the box', () => {
  assert.deepEqual(fitBox(800, 600, 180, 105), { w: 140, h: 105 });
  assert.deepEqual(fitBox(600, 800, 180, 105), { w: 78.75, h: 105 });
  assert.deepEqual(fitBox(0, 0, 180, 105), { w: 180, h: 105 });
});

test('a day in a title reads once: weekday, then the date (dayLabel + dateLabel printed the day number twice)', () => {
  assert.equal(dayFull('2026-11-24'), 'Sel, 24 Nov 2026');
  assert.equal(dayFull('2026-11-27'), 'Jum, 27 Nov 2026');
  assert.ok(!/(\d+)[^\d]+ /.test(dayFull('2026-11-24')));
});

test('an excused day is a state of its own with a label', () => {
  assert.equal(HK_STATE.EXCUSED.label, 'Dibebaskan');
  assert.equal(HK_STATUS_LABEL.CANCELLED, 'Dibatalkan');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
