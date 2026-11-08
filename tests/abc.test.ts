// Kelas ABC page logic (lib/abc.ts, 0126): classes, summaries, changes and the action lists.
import { strict as assert } from 'node:assert';
import { changeMatrix, changeOf, classify, coverDays, filterRows, lastMonth, paretoPoints, periodDays, periodLabel, rackOf,
  suggestions, summarize, type AbcRow } from '../lib/abc';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const row = (o: Partial<AbcRow>): AbcRow => ({
  item_id: o.sku ?? 'x', sku: 'x', description: null, class: 'C', prev_class: null, rank: 1, pick_lines: 0, cartons: 0, pick_days: 0,
  share: 0, cum_share: 0, stock: 0, bins: 0, racks: 0, pickface: null, pack: 'Carton', history: [], ...o,
});

test('classify: the SKU crossing a limit stays in the class below it, like abc_compute', () => {
  // 8, 1, 1 lines: X starts at 0% (A), Y at 80% (B), Z at 90% (B), W never picked (C).
  assert.deepEqual(classify([{ pick_lines: 8 }, { pick_lines: 1 }, { pick_lines: 1 }, { pick_lines: 0 }], 80, 95), ['A', 'B', 'B', 'C']);
  assert.deepEqual(classify([{ pick_lines: 8 }, { pick_lines: 1 }, { pick_lines: 1 }], 70, 90), ['A', 'B', 'C']);
});

test('classify: October 2026 head of the list (real counts) gives the live split at 80/95', () => {
  // The first SKUs of October by lines and the class the live query gave them.
  const lines = [256, 215, 148, 140, 107, 85, 84, 74, 74, 71, 71, 62, 54, 47, 46, 46, 45, 38, 36, 36, 33, 32, 32, 31, 29, 27, 27, 22, 20, 20, 20, 18];
  const rest = 2511 - lines.reduce((a, b) => a + b, 0);
  const cls = classify([...lines.map((pick_lines) => ({ pick_lines })), { pick_lines: rest }], 80, 95);
  assert.equal(cls.slice(0, 31).every((c) => c === 'A'), true, '31 A');
  assert.equal(cls[31], 'B', 'the 32nd (18 lines, 80.8% before it) is B');
});

test('classify: nothing picked at all -> all C', () => {
  assert.deepEqual(classify([{ pick_lines: 0 }, { pick_lines: 0 }], 80, 95), ['C', 'C']);
});

test('changeOf: up towards A, down towards C, new without a class', () => {
  assert.equal(changeOf('B', 'A'), 'up'); assert.equal(changeOf('A', 'C'), 'down');
  assert.equal(changeOf('B', 'B'), 'same'); assert.equal(changeOf(null, 'A'), 'new'); assert.equal(changeOf('X', 'B'), 'new');
});

test('summarize: SKUs, lines and cartons per class with shares', () => {
  const s = summarize([row({ class: 'A', pick_lines: 8, cartons: 80 }), row({ class: 'B', pick_lines: 2, cartons: 20 }), row({ class: 'C' })]);
  assert.deepEqual(s.map((x) => [x.cls, x.skus, x.lines, Math.round(x.linesPct), Math.round(x.cartonsPct)]),
    [['A', 1, 8, 80, 80], ['B', 1, 2, 20, 20], ['C', 1, 0, 0, 0]]);
});

test('changeMatrix: previous class by new class, "–" for none', () => {
  const m = changeMatrix([{ prev_class: 'B', class: 'A' }, { prev_class: 'B', class: 'A' }, { prev_class: null, class: 'C' }, { prev_class: 'A', class: 'A' }]);
  assert.equal(m.B.A, 2); assert.equal(m['–'].C, 1); assert.equal(m.A.A, 1); assert.equal(m.C.B, 0);
});

test('paretoPoints: starts at 0, ends at 100% of lines and of SKUs', () => {
  const p = paretoPoints([{ pick_lines: 3 }, { pick_lines: 1 }]);
  assert.deepEqual(p, [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }]);
});

test('coverDays: stock over the daily pick rate; none when not picked', () => {
  assert.equal(coverDays(310, 310, 31), 31);
  assert.equal(coverDays(50, 0, 31), null);
});

test('periods: days, last month, labels', () => {
  assert.equal(periodDays('2026-10-01', '2026-10-31'), 31);
  assert.deepEqual(lastMonth('2026-11-01'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(lastMonth('2026-01-15'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(lastMonth('2028-03-01'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(periodLabel('2026-10-01', '2026-10-31'), 'Oktober 2026');
  assert.equal(periodLabel('2026-10-01', '2026-10-15'), '01-10-2026 s/d 15-10-2026');
});

test('rackOf: aisle + bay of a rack bin, null elsewhere', () => {
  assert.equal(rackOf('CB04B02'), 'CB04'); assert.equal(rackOf('STAGING'), null); assert.equal(rackOf('cc19a01'), 'CC19');
});

test('suggestions: each list holds exactly the SKUs its rule names', () => {
  const rows = [
    row({ sku: 'A1', class: 'A', prev_class: 'B', pick_lines: 50, stock: 100, pickface: null, racks: 1 }),
    row({ sku: 'A2', class: 'A', prev_class: 'A', pick_lines: 40, stock: 0, pickface: null }),
    row({ sku: 'B1', class: 'B', prev_class: 'B', pick_lines: 5, stock: 30, pickface: 'CC01A01', racks: 4 }),
    row({ sku: 'C1', class: 'C', prev_class: 'C', pick_lines: 0, stock: 60, pickface: 'CC02A01', racks: 1 }),
  ];
  const by = Object.fromEntries(suggestions(rows).map((s) => [s.key, s.skus]));
  assert.deepEqual(by['a-no-pickface'], ['A1'], 'A2 has no stock, so no pickface needed now');
  assert.deepEqual(by['new-a'], ['A1']);
  assert.deepEqual(by.spread, ['B1']);
  assert.deepEqual(by['no-move'], ['C1']);
  assert.deepEqual(by['c-pickface'], ['C1']);
});

test('suggestions: an empty list is left out', () => {
  assert.deepEqual(suggestions([row({ sku: 'B9', class: 'B', pick_lines: 3, stock: 5, racks: 1 })]), []);
});

test('filterRows: class, change, packaging, stock and text together', () => {
  const rows = [
    row({ sku: '550001', description: 'Helix HX6', class: 'A', prev_class: 'B', stock: 5 }),
    row({ sku: '550002', description: 'Rimula drum', class: 'A', prev_class: 'A', pack: 'Drum', stock: 0 }),
    row({ sku: '550003', description: 'Helix HX3', class: 'C', prev_class: 'C', stock: 9 }),
  ];
  const f = { cls: '' as const, change: '' as const, pack: '', q: '', stockOnly: false };
  assert.deepEqual(filterRows(rows, { ...f, cls: 'A' }).map((r) => r.sku), ['550001', '550002']);
  assert.deepEqual(filterRows(rows, { ...f, change: 'up' }).map((r) => r.sku), ['550001']);
  assert.deepEqual(filterRows(rows, { ...f, pack: 'Drum' }).map((r) => r.sku), ['550002']);
  assert.deepEqual(filterRows(rows, { ...f, stockOnly: true, q: 'helix' }).map((r) => r.sku), ['550001', '550003']);
  // A matrix cell: exactly B -> A, not every SKU that moved up into A.
  const cell = [...rows, row({ sku: '550004', class: 'A', prev_class: 'C' })];
  assert.deepEqual(filterRows(cell, { ...f, cls: 'A', prev: 'B' }).map((r) => r.sku), ['550001']);
  assert.deepEqual(filterRows([row({ sku: '550005', class: 'C', prev_class: null })], { ...f, prev: '–' }).map((r) => r.sku), ['550005']);
});

console.log(`\nabc: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
