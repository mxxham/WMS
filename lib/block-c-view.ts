/**
 * Block C in the 3D view (0147 / 0148): pure helpers the scene uses. Coordinates themselves come from the database
 * (`recompute_bin_positions`, `layout.block_c`); this only turns a slot's stock into a drawn stack.
 */
import { BLOCK_C_SLOT_REGEX, POSITIONS_PER_SLOT } from "@/config/warehouse";
import type { BinSummary, Layout } from "@/lib/warehouse-types";

/** Defaults mirror 0148 / 0150 (FA and FB are two separate rows with a lane between) so a layout saved before it (no `block_c` key) still draws. */
/** 0151: a slot is 14 positions, 2 along the row x 7 deep: ~2.4 m x 7 m, 2.6 m pitch; rows 10 m apart (7 m depth + a 3 m lane). */
export const BLOCK_C_DEFAULTS = { slot_pitch_m: 2.6, lane_gap_m: 10, pallet_height_m: 1.2, slot_depth_m: 7 } as const;

/** A Block C floor slot: no rack and a code like FA-01. */
export const isBlockCBin = (b: Pick<BinSummary, "bin_code" | "rack">): boolean => b.rack === null && BLOCK_C_SLOT_REGEX.test(b.bin_code);

/**
 * Pallets standing in a slot: the pallets of stock (`fill_ratio` x `capacity`, i.e. cartons / UPP), rounded up, and at
 * least one when the slot holds anything. 0 for an empty slot. An unknown UPP (`fill_ratio` null) counts as one pallet.
 */
export function stackPallets(b: Pick<BinSummary, "total_qty" | "fill_ratio" | "capacity">): number {
  if (!(Number(b.total_qty) > 0)) return 0;
  if (b.fill_ratio === null || b.capacity === null) return 1;
  return Math.max(1, Math.ceil(Number(b.fill_ratio) * Number(b.capacity) - 1e-9));
}

const cfg = (l: Layout) => ({ ...BLOCK_C_DEFAULTS, ...(l.block_c ?? {}) });

/**
 * Levels of the slot that are in use: a slot is POSITIONS_PER_SLOT floor positions stacked up to `capacity / positions`
 * high, so its pallets fill the first level before the second (ceil(pallets / positions)), never above the stack
 * height. A capacity not set yet (or left from before the 14-position plan) counts as one level.
 */
export function stackLevels(b: Pick<BinSummary, "total_qty" | "fill_ratio" | "capacity">): number {
  const pallets = stackPallets(b);
  if (pallets === 0) return 0;
  const stack = b.capacity === null ? 1 : Math.max(1, Math.round(Number(b.capacity) / POSITIONS_PER_SLOT));
  return Math.min(stack, Math.max(1, Math.ceil(pallets / POSITIONS_PER_SLOT)));
}

/** Footprint and height of the box drawn for a slot: a flat plate when empty, one box height per level in use. */
export function slotBox(b: Pick<BinSummary, "total_qty" | "fill_ratio" | "capacity">, l: Layout): { w: number; h: number; d: number } {
  const c = cfg(l);
  const levels = stackLevels(b);
  return { w: c.slot_pitch_m * 0.92, d: c.slot_depth_m, h: levels === 0 ? 0.06 : levels * c.pallet_height_m * 0.95 };
}

/** Centre of a slot's box, standing on the floor. */
export function slotCentre(b: BinSummary, l: Layout): [number, number, number] {
  return [Number(b.pos_x), slotBox(b, l).h / 2, Number(b.pos_z)];
}
