/**
 * Pick path on the WSM SUB 2 back-to-back racks: each aisle code is one rack
 * block, bays 01–20 on its left face and 21–40 on its right face with bay 21
 * directly behind bay 01. A walking lane serves one block's right face and
 * the next block's left face.
 */
import { strict as assert } from 'node:assert';
import { withConfig } from '../lib/allocator/config';
import { parseLocation, pickSequenceKey, walkPosition } from '../lib/allocator/pickpath';
import { derivePickfaces } from '../lib/allocator/pickface';
import { allocate } from '../lib/allocator/allocator';
import { loadWorkbook } from '../lib/allocator/adapters/excel-input';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.log(`  ✗ ${name}\n    ${(err as Error).message}`); }
}

const config = withConfig({ asOf: new Date('2026-09-15T00:00:00Z') });
const walk = (code: string) => walkPosition(parseLocation(code)!, config);
const key = (code: string) => pickSequenceKey(parseLocation(code)!, config);
const route = (codes: string[]) => [...codes].sort((a, b) => key(a) - key(b));

console.log('\nBack-to-back pick path');

await test('bay 21 is behind bay 01: same spot along the block, other face', () => {
  assert.deepEqual(walk('CB01A01'), { lane: 1, along: 1, face: 0 });
  assert.deepEqual(walk('CB21A01'), { lane: 2, along: 1, face: 1 });
  assert.deepEqual(walk('CB40E02'), { lane: 2, along: 20, face: 1 });
});

await test("a lane serves one block's right face and the next block's left face", () => {
  assert.equal(walk('CB25C01').lane, walk('CC05C01').lane);
  assert.equal(walk('CF30A01').lane, walk('CG10A01').lane);
  assert.notEqual(walk('CB05A01').lane, walk('CB25A01').lane);
});

await test('facing bins across a lane are next to each other on the route', () => {
  // CB22 faces CC02 across lane 2; nothing else sorts between them at level A.
  const order = route(['CC02A01', 'CB22A01', 'CB30A01', 'CC10A01', 'CB02A01']);
  const i = order.indexOf('CB22A01'), j = order.indexOf('CC02A01');
  assert.equal(Math.abs(i - j), 1, order.join(' '));
});

await test('serpentine: odd lanes walked back to front', () => {
  // lane 0 (CA left face) forward, lane 1 (CB left face) backward, lane 2 forward.
  // CC01 and CB21 face each other at the start of lane 2: same spot, left face first.
  assert.deepEqual(route(['CA01A01', 'CA19A01', 'CB01A01', 'CB20A01', 'CC01A01', 'CB21A01', 'CB40A01']),
    ['CA01A01', 'CA19A01', 'CB20A01', 'CB01A01', 'CC01A01', 'CB21A01', 'CB40A01']);
});

await test('baysPerSide 0 keeps the old single-row order', () => {
  const legacy = withConfig({ baysPerSide: 0 });
  const k = (c: string) => pickSequenceKey(parseLocation(c)!, legacy);
  const codes = ['CB21A01', 'CB01A01', 'CA05B02', 'CC40A01', 'CB20E01'];
  // old formula: aisle*1e6 + (serpentine bay) *1e4 + level*100 + position
  const old = (c: string) => {
    const p = parseLocation(c)!; const a = legacy.aisleSequence.indexOf(p.aisle);
    return a * 1_000_000 + (a % 2 ? 99 - p.bay : p.bay) * 10_000 + legacy.levelSequence.indexOf(p.level) * 100 + p.position;
  };
  assert.deepEqual([...codes].sort((a, b) => k(a) - k(b)), [...codes].sort((a, b) => old(a) - old(b)));
});

await test('15 Sep workbook: FEFO still absolute on the new route', async () => {
  const wb = await loadWorkbook('data/Warehouse_Management_System_15_September_2026_.xlsx', config);
  derivePickfaces(wb.stock, config);
  const r = allocate(wb.stock, wb.demand, config, wb.stagedBySku);
  // For each SKU, no line may take a later expiry while an earlier one had stock left unpicked
  // by the whole run — checked via the allocator's own warnings: none may be FEFO violations.
  assert.equal(r.warnings.filter((w) => /FEFO/.test(w.code)).length, 0);
  assert.ok(r.stats.fillRatePct > 98, `fill ${r.stats.fillRatePct}`);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
