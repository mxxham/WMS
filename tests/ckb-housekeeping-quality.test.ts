/**
 * CKB housekeeping phase 2 (0160): the score, the finding rules and the week helpers (lib/ckb/hk-quality.ts), plus static
 * guards over migration 0160 next to tests/ckb-housekeeping-isolation.test.ts.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  FINDING_STATE, RATING_LABEL, canVerify, countFindings, isOverdue, lastWeeks, latestScores, missingItems, scorePct, scoreTone, trend, trendLabel,
} from '../lib/ckb/hk-quality';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

console.log('\nCKB housekeeping quality');

test('score: 2 points good, 1 fair, 0 poor, over the best possible, whole percent; nothing rated is null', () => {
  assert.equal(scorePct(['GOOD', 'GOOD', 'GOOD', 'GOOD', 'FAIR', 'POOR']), 75);      // 9 of 12: the number SQL test 120 asserts
  assert.equal(scorePct(['GOOD', 'GOOD']), 100);
  assert.equal(scorePct(['POOR', 'POOR', 'POOR']), 0);
  assert.equal(scorePct(['GOOD', 'FAIR', 'FAIR']), 67);                              // 4 of 6
  assert.equal(scorePct(['GOOD', 'POOR', 'POOR', 'POOR', 'POOR', 'POOR', 'POOR']), 14);   // 2 of 14 = 14.28
  assert.equal(scorePct([]), null);
});

test('score tone and the three labels', () => {
  assert.equal(scoreTone(90), 'ok'); assert.equal(scoreTone(85), 'ok'); assert.equal(scoreTone(75), 'warn'); assert.equal(scoreTone(40), 'bad'); assert.equal(scoreTone(null), 'muted');
  assert.deepEqual(Object.values(RATING_LABEL), ['Baik', 'Perlu perbaikan', 'Buruk']);
});

test('every active item must be rated: the ones still missing', () => {
  assert.deepEqual(missingItems(['a', 'b', 'c'], { a: 'GOOD', c: 'POOR' }), ['b']);
  assert.deepEqual(missingItems(['a'], { a: 'FAIR' }), []);
  assert.deepEqual(missingItems([], {}), []);
});

test('verifying: only a fixed finding, never by who raised it or who fixed it', () => {
  const f = { status: 'FIXED' as const, raised_by: 'sup', fixed_by: 'op' };
  assert.equal(canVerify(f, 'sup2'), true);
  assert.equal(canVerify(f, 'sup'), false);
  assert.equal(canVerify(f, 'op'), false);
  assert.equal(canVerify({ ...f, status: 'OPEN' }, 'sup2'), false);
  assert.equal(canVerify({ ...f, status: 'VERIFIED' }, 'sup2'), false);
});

test('overdue: open past its due date only', () => {
  assert.equal(isOverdue({ status: 'OPEN', due_date: '2026-11-20' }, '2026-11-24'), true);
  assert.equal(isOverdue({ status: 'OPEN', due_date: '2026-11-24' }, '2026-11-24'), false);
  assert.equal(isOverdue({ status: 'OPEN', due_date: null }, '2026-11-24'), false);
  assert.equal(isOverdue({ status: 'FIXED', due_date: '2026-11-20' }, '2026-11-24'), false);
});

test('a re-score is a new version: the latest per rack and week wins', () => {
  const rows = [
    { area_id: 'a', week_start: '2026-11-16', version: 1, pct: 75 }, { area_id: 'a', week_start: '2026-11-16', version: 2, pct: 100 },
    { area_id: 'a', week_start: '2026-11-23', version: 1, pct: 50 }, { area_id: 'b', week_start: '2026-11-16', version: 1, pct: 80 },
  ];
  const l = latestScores(rows).sort((x, y) => (x.area_id + x.week_start).localeCompare(y.area_id + y.week_start));
  assert.deepEqual(l.map((r) => [r.area_id, r.week_start, r.pct]), [['a', '2026-11-16', 100], ['a', '2026-11-23', 50], ['b', '2026-11-16', 80]]);
});

test('last weeks: Mondays, oldest first, ending at the week of today', () => {
  assert.deepEqual(lastWeeks('2026-11-24', 3), ['2026-11-09', '2026-11-16', '2026-11-23']);
  assert.deepEqual(lastWeeks('2026-11-29', 1), ['2026-11-23']);   // a Sunday belongs to the week that began on Monday the 23rd
  assert.deepEqual(lastWeeks('2026-11-23', 2), ['2026-11-16', '2026-11-23']);
});

test('trend: latest scored week against the one before; null with fewer than two', () => {
  assert.equal(trend([60, null, 75, 90]), 15);
  assert.equal(trend([90, 80]), -10);
  assert.equal(trend([80]), null);
  assert.equal(trend([null, null]), null);
  assert.equal(trendLabel(15), '▲ 15'); assert.equal(trendLabel(-10), '▼ 10'); assert.equal(trendLabel(0), '= 0'); assert.equal(trendLabel(null), '–');
});

test('finding counts, with a customer DONE counted as done', () => {
  const rows = [
    { status: 'OPEN', due_date: '2026-11-20' }, { status: 'OPEN', due_date: null }, { status: 'FIXED', due_date: '2026-11-20' },
    { status: 'VERIFIED', due_date: null }, { status: 'DONE', due_date: null },
  ];
  assert.deepEqual(countFindings(rows, '2026-11-24'), { open: 2, fixed: 1, done: 2, overdue: 1 });
  assert.equal(FINDING_STATE.FIXED.label, 'Menunggu verifikasi'); assert.equal(FINDING_STATE.DONE.label, 'Selesai');
});

// ---- migration 0160 guards
const sql = readFileSync('supabase/migrations/0160_ckb_hk_quality.sql', 'utf8');

test('0160 writes no Shell table and alters only ckb_hk_ tables', () => {
  for (const m of sql.matchAll(/alter table public\.(\w+)/g)) assert.ok(m[1].startsWith('ckb_hk_'), m[1]);
  assert.ok(!/(insert into|update|delete from) public\.(movements|inventory|bins|items)\b/.test(sql));
  assert.ok(!/from public\.bins\b/.test(sql));
});

test('0160 gives a customer no policy on the quality tables and no name column in its two functions', () => {
  for (const p of sql.matchAll(/create policy "([^"]+)" on public\.(ckb_hk_\w+)[\s\S]*?;/g)) assert.ok(!/customer'\]/.test(p[0]) && !/ckb_can_see_customer/.test(p[0]), `${p[2]} readable by a customer`);
  for (const fn of ['ckb_hk_customer_quality', 'ckb_hk_customer_findings']) {
    const m = sql.match(new RegExp(`function public\\.${fn}\\([^)]*\\)\\s*returns table \\(([^)]*)\\)`));
    assert.ok(m, `${fn} not found`);
    assert.ok(!/(raised_by|raised_name|fixed_by|fixed_name|verified_by|verified_name|scored_|cancel|_note|_reason|_name\b)/.test(m![1].replace(/area_name/g, '')), `${fn} returns ${m![1]}`);
  }
  assert.ok(/f\.status <> 'CANCELLED'/.test(sql), 'a cancelled finding must not reach a customer');
});

test('0160 keeps scores append-only and refuses a lead verifying their own finding', () => {
  assert.ok(/ckb_hk_scores_append_only before update or delete/.test(sql) && /ckb_hk_score_lines_append_only before update or delete/.test(sql));
  assert.ok(/auth\.uid\(\) in \(f\.raised_by, f\.fixed_by\)/.test(sql));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
