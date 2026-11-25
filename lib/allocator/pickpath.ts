import type { AllocatorConfig } from './config';

export interface ParsedLocation {
  location: string;
  aisle: string;
  bay: number;
  level: string;
  position: number;
}

/** CA01A01 → { aisle: 'CA', bay: 1, level: 'A', position: 1 } */
export function parseLocation(raw: string): ParsedLocation | null {
  const location = String(raw ?? '').trim().toUpperCase();
  const m = /^([A-Z]{2})(\d{2})([A-Z])(\d{2})$/.exec(location);
  if (!m) return null;
  return {
    location,
    aisle: m[1],
    bay: Number(m[2]),
    level: m[3],
    position: Number(m[4]),
  };
}

/**
 * Where a rack location sits on the walking route.
 *
 * With `baysPerSide` > 0 every aisle code is one back-to-back rack block:
 * bays 1..N form its left face and N+1..2N its right face, with bay N+1
 * directly behind bay 1. A walking lane runs between one block's right face
 * and the next block's left face, so the lane index is aisle rank + face.
 * With `baysPerSide` = 0 each aisle is a single straight row (legacy layout).
 */
export function walkPosition(loc: ParsedLocation, config: AllocatorConfig): { lane: number; along: number; face: 0 | 1 } {
  const aisleIdx = config.aisleSequence.indexOf(loc.aisle);
  const aisleRank = aisleIdx === -1 ? config.aisleSequence.length : aisleIdx;
  const n = config.baysPerSide;
  if (n > 0) {
    const face: 0 | 1 = loc.bay > n ? 1 : 0;
    return { lane: aisleRank + face, along: ((loc.bay - 1) % n) + 1, face };
  }
  return { lane: aisleRank, along: loc.bay, face: 0 };
}

/**
 * Travel cost key. Walk the lanes in configured order; on a serpentine route
 * every second lane is walked back-to-front so the picker never returns empty.
 * At one spot in a lane, ground level comes first (heaviest picks lowest),
 * then the two facing sides, then the pallet position.
 */
export function pickSequenceKey(loc: ParsedLocation, config: AllocatorConfig): number {
  const { lane, along, face } = walkPosition(loc, config);
  const reverse = config.serpentine && lane % 2 === 1;
  const alongRank = reverse ? 99 - along : along;

  const levelIdx = config.levelSequence.indexOf(loc.level);
  const levelRank = levelIdx === -1 ? config.levelSequence.length : levelIdx;

  // lane > along > level > face > position, packed into one sortable integer
  return lane * 10_000_000 + alongRank * 100_000 + levelRank * 1_000 + face * 100 + loc.position;
}

/**
 * FA-01 -> { aisle: 'FA', bay: 1, level: 'A', position: 1 }: only for building a StockBin of a Block C slot. NOT
 * parseLocation, which stays rack-only on purpose (pickface and replenishment treat a parsed location as a rack bin).
 */
export function parseBlockCSlot(raw: string): ParsedLocation | null {
  const location = String(raw ?? '').trim().toUpperCase();
  const m = /^([A-Z]{2})-(\d{2})$/.exec(location);
  return m ? { location, aisle: m[1], bay: Number(m[2]), level: 'A', position: 1 } : null;
}

/**
 * Where a Block C slot sits on its own short route: down the first lane (FA-01 -> FA-20), back up the second
 * (FB-20 -> FB-01), so the picker never returns empty. Later lanes continue the same way. Every key sorts after any
 * rack key, but Block C lines print on their own picklist anyway.
 */
export function blockCSequenceKey(location: string, config: AllocatorConfig): number {
  const m = /^([A-Z]{2})-(\d{2})$/.exec(String(location ?? '').trim().toUpperCase());
  if (!m) return Number.MAX_SAFE_INTEGER;
  const idx = config.blockCLanes.indexOf(m[1]);
  const lane = idx === -1 ? config.blockCLanes.length : idx;
  const slot = Number(m[2]);
  return 5_000_000_000 + lane * 1_000 + (config.serpentine && lane % 2 === 1 ? 99 - slot : slot);
}

/** Walking-route key of any pickable location: a rack bin, a Block C slot, or MAX for anything else (staging). */
export function locationSequenceKey(location: string, config: AllocatorConfig): number {
  const parsed = parseLocation(location);
  if (parsed) return pickSequenceKey(parsed, config);
  return blockCSequenceKey(location, config);
}

/** 2-digit scan-verification digit derived from the location code. */
export function checkDigit(location: string): string {
  let sum = 0;
  for (let i = 0; i < location.length; i++) {
    sum = (sum * 31 + location.charCodeAt(i)) % 97;
  }
  return String(sum).padStart(2, '0');
}
