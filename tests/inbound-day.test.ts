// "Karton masuk" counts a putaway on its arrival date (0117), not the day it was posted (0125).
import { strict as assert } from 'node:assert';
import { flowOnDay, inflowDay, inflowFetchSince, type InflowMove } from '../lib/inbound-day';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

// 1 Nov 2026, 08:00 Jakarta = 01:00 UTC: the morning the team posts 31 Oct's putaway.
const postedMorning = '2026-11-01T01:00:00Z';
const mv = (o: Partial<InflowMove>): InflowMove => ({ type: 'putaway', quantity: 10, from_bin_id: null, created_at: postedMorning, ...o });

test('a putaway posted today for yesterday counts on yesterday', () => {
  const m = mv({ putaway_arrival_moves: { arrival_date: '2026-10-31' } });
  assert.equal(inflowDay(m), '2026-10-31');
  assert.deepEqual(flowOnDay([m], '2026-11-01'), { masuk: 0, keluar: 0 });
  assert.deepEqual(flowOnDay([m], '2026-10-31'), { masuk: 10, keluar: 0 });
});

test('the embedded arrival row may come back as an array', () => {
  assert.equal(inflowDay(mv({ putaway_arrival_moves: [{ arrival_date: '2026-10-30' }] })), '2026-10-30');
});

test('without an arrival date it counts on the Jakarta posting day', () => {
  // 31 Oct 20:00 UTC = 1 Nov 03:00 Jakarta.
  assert.equal(inflowDay(mv({ created_at: '2026-10-31T20:00:00Z', putaway_arrival_moves: null })), '2026-11-01');
  assert.deepEqual(flowOnDay([mv({ type: 'inbound', from_bin_id: 'x' })], '2026-11-01'), { masuk: 10, keluar: 0 });
});

test('a putaway from another bin is a move, not inflow', () => {
  assert.deepEqual(flowOnDay([mv({ from_bin_id: 'bin-1' })], '2026-11-01'), { masuk: 0, keluar: 0 });
});

test('picking counts on its posting day only', () => {
  const moves = [mv({ type: 'picking', quantity: 4 }), mv({ type: 'picking', quantity: 6, created_at: '2026-10-30T05:00:00Z' })];
  assert.deepEqual(flowOnDay(moves, '2026-11-01'), { masuk: 0, keluar: 4 });
});

test('the fetch window starts 7 Jakarta days back', () => {
  assert.equal(inflowFetchSince('2026-11-01'), '2026-10-24T17:00:00.000Z');
});

console.log(`\ninbound-day: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
