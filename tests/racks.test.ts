// Rak & Lokasi (lib/racks.ts, 0132): bin state and owner rules, the floor plan, selections and tiles.
import { strict as assert } from 'node:assert';
import {
  bayFill, buildFloorPlan, codeRangeText, narrowLevels, overlayOf, plannedCodes, rackTiles, selectBayRange, stateOf,
  usableForShell, type RackBin,
} from '../lib/racks';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const bin = (code: string, o: Partial<RackBin> = {}): RackBin => {
  const m = /^([A-Z]{2})(\d{2})([A-E])(\d{2})$/.exec(code);
  return {
    id: code, bin_code: code, zone: m ? m[1] : code, rack: m ? m[2] : null, level: m ? m[3] : null, position: m ? m[4] : null,
    status: 'active', block_kind: null, block_reason: null, owner: m ? 'SHELL' : null,
    total_qty: 0, fill_ratio: null, abc_class: null, min_expiry: null, skus: [], ...o,
  };
};
/** Every bin of a rack: levels A..E (or given), positions 01 and 02. */
const rack = (zone: string, r: number, o: Partial<RackBin> = {}, levels = ['A', 'B', 'C', 'D', 'E']) =>
  levels.flatMap((l) => ['01', '02'].map((p) => bin(`${zone}${String(r).padStart(2, '0')}${l}${p}`, o)));

test('stateOf and usableForShell mirror bin_usable', () => {
  assert.equal(stateOf({ status: 'active', block_kind: null }), 'ACTIVE');
  assert.equal(stateOf({ status: 'blocked', block_kind: 'PLANNED' }), 'PLANNED');
  assert.equal(stateOf({ status: 'blocked', block_kind: null }), 'BLOCKED');
  assert.equal(usableForShell({ status: 'active', owner: 'SHELL' }), true);
  assert.equal(usableForShell({ status: 'active', owner: null }), true); // floor locations are shared
  assert.equal(usableForShell({ status: 'active', owner: 'CKB' }), false);
  assert.equal(usableForShell({ status: 'blocked', owner: 'SHELL' }), false);
});

test('floor plan follows 3D: racks 01-20 on face 0, 21-40 on face 1, rack 21 under rack 01', () => {
  const plan = buildFloorPlan([...rack('CA', 1), ...rack('CA', 21), ...rack('CA', 20)], ['CA']);
  const a = plan.aisles[0];
  assert.equal(a.zone, 'CA');
  assert.equal(a.faces[0].length, 20);
  assert.equal(a.faces[1].length, 20);
  assert.equal(a.faces[0][0].rack, '01');
  assert.equal(a.faces[1][0].rack, '21');
  assert.equal(a.faces[0][19].rack, '20');
  assert.equal(a.faces[0][0].bins.length, 10);
  assert.equal(a.faces[0][5].bins.length, 0); // rack 06 has no bins: an empty slot, still drawn
});

test('aisle order from the layout, extra zones after, alphabetically', () => {
  const plan = buildFloorPlan([...rack('CZ', 1), ...rack('CB', 1), ...rack('CA', 1), ...rack('CY', 2)], ['CA', 'CB']);
  assert.deepEqual(plan.aisles.map((a) => a.zone), ['CA', 'CB', 'CY', 'CZ']);
});

test('floor locations go to the floor row, in code order', () => {
  const plan = buildFloorPlan([bin('STG_02'), bin('STAGING'), ...rack('CA', 1)], ['CA']);
  assert.deepEqual(plan.floor.map((b) => b.bin_code), ['STAGING', 'STG_02']);
});

test('an aisle whose every bin is planned is flagged planned', () => {
  const plan = buildFloorPlan([...rack('CA', 1), ...rack('CI', 1, { status: 'blocked', block_kind: 'PLANNED' })], ['CA', 'CI']);
  assert.deepEqual(plan.aisles.map((a) => a.planned), [false, true]);
});

test('selectBayRange takes the rectangle across two aisles, in plan order', () => {
  const plan = buildFloorPlan([...rack('CE', 1), ...rack('CF', 1)], ['CE', 'CF']);
  const from = plan.aisles[0].faces[0][0]; // CE01
  const to = plan.aisles[1].faces[0][2];   // CF03
  const keys = selectBayRange(plan, from, to).map((b) => `${b.zone}${b.rack}`);
  assert.deepEqual(keys, ['CE01', 'CE02', 'CE03', 'CE21', 'CE22', 'CE23', 'CF01', 'CF02', 'CF03']);
});

test('selectBayRange inside one face is a run of bays', () => {
  const plan = buildFloorPlan(rack('CF', 21), ['CF']);
  const face = plan.aisles[0].faces[1];
  assert.deepEqual(selectBayRange(plan, face[19], face[0]).map((b) => b.rack),
    Array.from({ length: 20 }, (_, i) => String(21 + i)));
});

test('narrowLevels keeps the chosen levels only', () => {
  const bins = rack('CF', 21);
  assert.deepEqual(narrowLevels(bins, ['A']).map((b) => b.bin_code), ['CF21A01', 'CF21A02']);
  assert.equal(narrowLevels(bins, []).length, 10); // no level chosen = all levels
});

test('codeRangeText names the first and last code and the count', () => {
  assert.equal(codeRangeText(['CF40A02', 'CF21A01', 'CF30A01']), 'CF21A01–CF40A02 (3 bin)');
  assert.equal(codeRangeText(['CE32A02']), 'CE32A02');
  assert.equal(codeRangeText([]), '');
});

test('plannedCodes mirrors plan_racks_preview', () => {
  const codes = plannedCodes('CI', 10, ['A', 'B', 'C', 'D']);
  assert.equal(codes.length, 160);
  assert.equal(codes[0], 'CI01A01');
  assert.equal(codes[1], 'CI01A02');
  assert.equal(codes[2], 'CI01B01');
  assert.equal(codes[codes.length - 1], 'CI30D02');
  assert.ok(!codes.includes('CI11A01') && !codes.includes('CI31A01') && codes.includes('CI21A01'));
});

test('overlay precedence: not present, planned, blocked, then CKB', () => {
  assert.equal(overlayOf(bin('CE33A01', { status: 'blocked', block_kind: 'NOT_PRESENT', owner: 'CKB' })), 'NOT_PRESENT');
  assert.equal(overlayOf(bin('CI01A01', { status: 'blocked', block_kind: 'PLANNED', owner: 'CKB' })), 'PLANNED');
  assert.equal(overlayOf(bin('CF21A01', { status: 'blocked', block_kind: 'BLOCKED', owner: 'CKB' })), 'BLOCKED');
  assert.equal(overlayOf(bin('CF21A01', { owner: 'CKB' })), 'CKB');
  assert.equal(overlayOf(bin('CA01A01')), null);
});

test('rackTiles counts usable, occupied, CKB, blocked, not present and planned rack bins', () => {
  const t = rackTiles([
    bin('CA01A01', { total_qty: 5 }), bin('CA01A02', { total_qty: 1 }), bin('CA01B01', { total_qty: 3 }), bin('CA01B02'),
    bin('CF21A01', { owner: 'CKB', total_qty: 9 }),
    bin('CA02A01', { status: 'blocked', block_kind: 'BLOCKED' }),
    bin('CE33A01', { status: 'blocked', block_kind: 'NOT_PRESENT' }),
    bin('CI01A01', { status: 'blocked', block_kind: 'PLANNED' }), bin('CI01A02', { status: 'blocked', block_kind: 'PLANNED' }),
    bin('STAGING', { total_qty: 40 }),
  ]);
  assert.deepEqual(t, { usable: 4, occupied: 3, pct: 0.75, ckb: 1, blocked: 1, notPresent: 1, planned: 2 });
  assert.deepEqual(rackTiles([]), { usable: 0, occupied: 0, pct: 0, ckb: 0, blocked: 0, notPresent: 0, planned: 0 });
});

test('bayFill shows the fullest bin of the bay', () => {
  const bins = rack('CA', 1).map((b) => (b.bin_code === 'CA01C02' ? { ...b, total_qty: 48 } : b));
  const plan = buildFloorPlan(bins, ['CA']);
  assert.equal(bayFill(plan.aisles[0].faces[0][0])?.bin_code, 'CA01C02');
  assert.equal(bayFill(plan.aisles[0].faces[0][3]), null);
});

console.log(`\nracks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
