import { strict as assert } from 'node:assert';
import { dayEndExclusiveISO, dayStartISO, fmtDay, movementEffect, parsePage, quickRange, shiftDay, splitPage, validDay } from '../lib/movement-view';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

test('effect: inbound adds, picking removes, moves leave the total alone', () => {
  assert.deepEqual(movementEffect('inbound', 10), { effect: 'in', signed: 10 });
  assert.deepEqual(movementEffect('picking', 48), { effect: 'out', signed: -48 });
  assert.deepEqual(movementEffect('putaway', 5), { effect: 'move', signed: 0 });
  assert.deepEqual(movementEffect('transfer', 5), { effect: 'move', signed: 0 });
});
test('effect: adjustment keeps its own sign', () => {
  assert.deepEqual(movementEffect('adjustment', -3), { effect: 'out', signed: -3 });
  assert.deepEqual(movementEffect('adjustment', 7), { effect: 'in', signed: 7 });
});
test('validDay rejects junk and impossible dates', () => {
  assert.equal(validDay('2026-11-25'), '2026-11-25');
  for (const bad of [undefined, '', 'abc', '25-11-2026', '2026-13-40']) assert.equal(validDay(bad), undefined);
});
test('a Jakarta day runs [00:00 WIB, next 00:00 WIB): the last second is inside', () => {
  assert.equal(dayStartISO('2026-11-25'), '2026-11-24T17:00:00.000Z');
  assert.equal(dayEndExclusiveISO('2026-11-25'), '2026-11-25T17:00:00.000Z');
  const lastSecond = new Date('2026-11-25T16:59:59.500Z').getTime();
  assert.ok(lastSecond < new Date(dayEndExclusiveISO('2026-11-25')).getTime());
});
test('quick ranges count back in Jakarta days (month and year edges)', () => {
  assert.equal(shiftDay('2026-12-01', 1), '2026-11-30');
  assert.equal(shiftDay('2027-01-01', 1), '2026-12-31');
  // 17:30Z on 24 Nov is already 00:30 on 25 Nov in Jakarta
  assert.deepEqual(quickRange(6, new Date('2026-11-24T17:30:00Z')), { from: '2026-11-19', to: '2026-11-25' });
  assert.deepEqual(quickRange(0, new Date('2026-11-24T17:30:00Z')), { from: '2026-11-25', to: '2026-11-25' });
});
test('parsePage survives junk', () => {
  assert.equal(parsePage(undefined), 0);
  for (const bad of ['abc', '-2', '1.5', 'NaN', '']) assert.equal(parsePage(bad), 0);
  assert.equal(parsePage('3'), 3);
});
test('splitPage: exactly one page of rows has no next page; one more row does', () => {
  const hundred = Array.from({ length: 100 }, (_, i) => i);
  assert.deepEqual(splitPage(hundred, 100), { shown: hundred, hasNext: false });
  const r = splitPage([...hundred, 100], 100);
  assert.equal(r.shown.length, 100); assert.equal(r.hasNext, true);
});
test('fmtDay prints the stored date whatever the machine zone', () => {
  assert.ok(fmtDay('2026-09-24').includes('24'));
  assert.equal(fmtDay(null), '–'); assert.equal(fmtDay('garbage'), '–');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
