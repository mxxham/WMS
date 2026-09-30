/**
 * How far a rack bin is from another, for "nearest empty bin": same aisle
 * first, then fewer racks away, then fewer levels up or down, then the same
 * position. Aisles are CA..CG, racks 01..40, levels A..E, positions 01/02.
 */
export type BinParts = { zone: string; rack: string | null; level: string | null; position: string | null };

const RACK_BIN = /^([A-Z]{2})(\d{2})([A-Z])(\d{2})$/;

export function parseBin(code: string): BinParts | null {
  const m = RACK_BIN.exec(code.trim().toUpperCase());
  return m ? { zone: m[1], rack: m[2], level: m[3], position: m[4] } : null;
}

/** Smaller is nearer. */
export function binDistance(from: BinParts, to: BinParts): number {
  const aisle = Math.abs(from.zone.charCodeAt(1) - to.zone.charCodeAt(1)) + (from.zone[0] === to.zone[0] ? 0 : 50);
  const rack = Math.abs(Number(from.rack ?? 0) - Number(to.rack ?? 0));
  const level = Math.abs((from.level ?? "A").charCodeAt(0) - (to.level ?? "A").charCodeAt(0));
  const pos = from.position === to.position ? 0 : 1;
  return aisle * 1000 + rack * 10 + level * 2 + pos * 0.5;
}

/** "sama lorong, 2 rak" style label for the list. */
export function distanceLabel(from: BinParts, to: BinParts): string {
  const rack = Math.abs(Number(from.rack ?? 0) - Number(to.rack ?? 0));
  const level = Math.abs((from.level ?? "A").charCodeAt(0) - (to.level ?? "A").charCodeAt(0));
  const where = from.zone === to.zone ? "lorong sama" : `lorong ${to.zone}`;
  return `${where} · ${rack === 0 ? "rak sama" : `${rack} rak`}${level ? ` · ${level} level` : ""}`;
}
