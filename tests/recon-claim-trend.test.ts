import { strict as assert } from 'node:assert';
import { claimAge, claimAlive, heldByOther, samePerson, CLAIM_TTL_MIN, type ReconClaim } from '../lib/recon-claim';
import { gapSeries, repeatStreak, type TrendRow } from '../lib/recon-trend';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const now = new Date('2026-11-24T10:00:00Z');
const claim = (by: string, lastSeen = '2026-11-24T09:58:00Z'): ReconClaim => ({ line_id: 'l', by_name: by, claimed_at: '2026-11-24T09:30:00Z', last_seen_at: lastSeen });

test('same person: case and spacing do not matter, a blank name is nobody', () => {
  assert.equal(samePerson('Ani Putri', '  ani   putri '), true);
  assert.equal(samePerson('Ani', 'Budi'), false);
  assert.equal(samePerson('', ''), false);
  assert.equal(samePerson(null, undefined), false);
});

test('held by other: only a claim of somebody else counts', () => {
  assert.equal(heldByOther(undefined, 'Ani'), false);
  assert.equal(heldByOther(claim('ani'), ' Ani '), false);
  assert.equal(heldByOther(claim('Budi'), 'Ani'), true);
});

test('claim age in words, and alive within the 30 minute window', () => {
  assert.equal(claimAge('2026-11-24T09:59:40Z', now), 'baru saja');
  assert.equal(claimAge('2026-11-24T09:55:00Z', now), '5 menit lalu');
  assert.equal(claimAge('2026-11-24T07:30:00Z', now), '2 jam lalu');
  assert.equal(claimAlive(claim('x', '2026-11-24T09:40:00Z'), now), true);
  assert.equal(claimAlive(claim('x', new Date(now.getTime() - (CLAIM_TTL_MIN + 1) * 60_000).toISOString()), now), false);
});

const row = (id: string, asOf: string, du: number, wf = 0): TrendRow => ({ recon_id: id, as_of: asOf, diff_unrestricted: du, diff_blocked: 0, wms_fix: wf });

test('gap series: oldest first, our side (SAP - WMS is flipped), corrections included, newest 12 only', () => {
  const s = gapSeries([row('b', '2026-11-10', -5), row('a', '2026-11-03', 3), row('c', '2026-11-17', -8, 8)]);
  assert.deepEqual(s.map((p) => [p.asOf, p.dayGap, p.fix, p.gap]), [['2026-11-03', -3, 0, -3], ['2026-11-10', 5, 0, 5], ['2026-11-17', 8, 8, 16]]);
  const many = gapSeries(Array.from({ length: 20 }, (_, i) => row(`r${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`, 1)));
  assert.equal(many.length, 12); assert.equal(many[0].asOf, '2026-10-09');
});

test('repeat streak: latest runs in a row with a gap of the same direction', () => {
  const s = (...gaps: number[]) => gapSeries(gaps.map((g, i) => row(`r${i}`, `2026-11-0${i + 1}`, -g)));
  assert.deepEqual(repeatStreak(s(5, 3, 8)), { runs: 3, sign: 1 });
  assert.deepEqual(repeatStreak(s(-2, 4, 6)), { runs: 2, sign: 1 });
  assert.deepEqual(repeatStreak(s(4, -6)), { runs: 1, sign: -1 });
  assert.deepEqual(repeatStreak(s(4, 0)), { runs: 0, sign: 0 });
  assert.deepEqual(repeatStreak([]), { runs: 0, sign: 0 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
