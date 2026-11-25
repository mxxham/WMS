// Block C in the 3D view (0148): which bins are Block C slots, and how tall each slot is drawn.
import { strict as assert } from 'node:assert';
import { isBlockCBin, slotBox, slotCentre, stackLevels, stackPallets } from '../lib/block-c-view';
import type { BinSummary, Layout } from '../lib/warehouse-types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const layout: Layout = { aisle_order: ['CA'], bay_width_m: 2.7, rack_depth_m: 1.2, level_height_m: 1.6, aisle_width_m: 3.2, positions_per_bay: 2,
  floor_zone_origin: { x: 0, z: -8 }, block_c: { origin: { x: 0, z: 70 }, slot_pitch_m: 2.6, lane_gap_m: 10, pallet_height_m: 1.2, slot_depth_m: 7, lanes: ['FA', 'FB'] } };
const slot = (over: Partial<BinSummary> = {}): BinSummary => ({ id: 'x', bin_code: 'FA-01', zone: 'FA', rack: null, level: null, position: '01', status: 'active', capacity: 42,
  pos_x: 0, pos_y: 0, pos_z: 70, abc_class: null, total_qty: 0, fill_ratio: 0, min_expiry: null, skus: [], ...over });

test('only a rack-less FA-01 style code is a Block C slot', () => {
  assert.equal(isBlockCBin({ bin_code: 'FA-01', rack: null }), true);
  assert.equal(isBlockCBin({ bin_code: 'FB-20', rack: null }), true);
  assert.equal(isBlockCBin({ bin_code: 'STAGING', rack: null }), false);
  assert.equal(isBlockCBin({ bin_code: 'STG_01', rack: null }), false);
  assert.equal(isBlockCBin({ bin_code: 'CA01A01', rack: '01' }), false);
});

test('pallets in a slot (capacity 42 = 14 positions x 3): empty 0, 100 of 50 per pallet = 2, a loose carton on top counts a pallet', () => {
  assert.equal(stackPallets(slot()), 0);
  assert.equal(stackPallets(slot({ total_qty: 100, fill_ratio: 2 / 42 })), 2);
  assert.equal(stackPallets(slot({ total_qty: 101, fill_ratio: 101 / 2100 })), 3);
  assert.equal(stackPallets(slot({ total_qty: 700, fill_ratio: 14 / 42 })), 14);
});

test('levels in use: 14 pallets fill level one, the 15th starts level two, never above the stack height', () => {
  const at = (pallets: number, capacity = 42) => stackLevels(slot({ capacity, total_qty: pallets * 50, fill_ratio: pallets / capacity }));
  assert.equal(at(0), 0); assert.equal(at(1), 1); assert.equal(at(14), 1); assert.equal(at(15), 2); assert.equal(at(29), 3);
  assert.equal(at(28, 28), 2); assert.equal(at(14, 28), 1);
  assert.equal(stackLevels(slot({ capacity: null, total_qty: 50, fill_ratio: null })), 1);
});

test('an unknown UPP still draws one level, never an empty plate', () => {
  assert.equal(stackPallets(slot({ total_qty: 40, fill_ratio: null })), 1);
});

test('an empty slot is a flat plate; a slot is one pallet height per level in use', () => {
  assert.equal(slotBox(slot(), layout).h, 0.06);
  const one = slotBox(slot({ total_qty: 700, fill_ratio: 14 / 42 }), layout);
  const three = slotBox(slot({ total_qty: 2100, fill_ratio: 1 }), layout);
  assert.ok(Math.abs(three.h - 3 * one.h) < 1e-9);
  assert.ok(Math.abs(one.h - 1.2 * 0.95) < 1e-9);
});

test('the box stands on the floor: its centre is half its height up, at the slot coordinates', () => {
  const b = slot({ total_qty: 2100, fill_ratio: 1, pos_x: 4.2, pos_z: 74 });
  const [x, y, z] = slotCentre(b, layout);
  assert.equal(x, 4.2); assert.equal(z, 74);
  assert.ok(Math.abs(y - slotBox(b, layout).h / 2) < 1e-9);
});

test('a layout saved before 0148 (no block_c) still draws with the defaults', () => {
  const old: Layout = { ...layout, block_c: undefined };
  const b = slotBox(slot({ total_qty: 50, fill_ratio: 1 / 3 }), old);
  assert.ok(Math.abs(b.w - 2.6 * 0.92) < 1e-9); assert.equal(b.d, 7);
});

test('a 14-position slot is about 2.4 m x 7 m and the rows stay clear of each other with a walking lane', () => {
  const b = slotBox(slot({ total_qty: 700, fill_ratio: 14 / 42 }), layout);
  assert.ok(b.w > 2.3 && b.w < 2.6, String(b.w)); assert.equal(b.d, 7);
  assert.ok(layout.block_c!.lane_gap_m - b.d >= 3, 'FA and FB boxes keep a 3 m lane');
  assert.ok(layout.block_c!.slot_pitch_m > b.w, 'neighbouring slots do not touch');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
