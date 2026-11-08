/**
 * Rak & Lokasi (0132): bin state and owner, the floor plan, selections and tiles.
 * Pure: rows of `bin_summary` in, plan and numbers out. The SQL rules this mirrors live in
 * supabase/migrations/0132_racks_and_locations.sql (bin_state, bin_usable, plan_racks_preview).
 */
import { DEFAULT_CONFIG } from "@/lib/allocator/config";

const DEFAULT_BLOCKED = DEFAULT_CONFIG.blockedBins;

export type BinState = "ACTIVE" | "BLOCKED" | "NOT_PRESENT" | "PLANNED";
export type Owner = "SHELL" | "CKB";

/** One row of `bin_summary`. */
export type RackBin = {
  id: string; bin_code: string; zone: string;
  rack: string | null; level: string | null; position: string | null;
  status: "active" | "blocked";
  block_kind: Exclude<BinState, "ACTIVE"> | null; block_reason: string | null;
  /** null on floor locations (STAGING, STG_xx, QUARANTINE): shared by both sides */
  owner: Owner | null;
  total_qty: number; fill_ratio: number | null; abc_class: string | null; min_expiry: string | null; skus: string[];
};

export const STATE_LABEL: Record<BinState, string> = { ACTIVE: "Aktif", BLOCKED: "Diblokir", NOT_PRESENT: "Tidak ada", PLANNED: "Rencana" };
export const OWNER_LABEL: Record<Owner, string> = { SHELL: "Shell", CKB: "CKB 3PL" };

/** Mirror of SQL `bin_state`. */
export function stateOf(b: Pick<RackBin, "status" | "block_kind">): BinState {
  return b.status === "active" ? "ACTIVE" : b.block_kind ?? "BLOCKED";
}

/** Mirror of SQL `bin_usable(bin, 'SHELL')`. */
export function usableForShell(b: Pick<RackBin, "status" | "owner">): boolean {
  return b.status === "active" && (b.owner === "SHELL" || b.owner === null);
}

/** One bay = one rack number; `slot` is its column in the plan (0-19). */
export type Bay = { zone: string; rack: string; face: 0 | 1; slot: number; bins: RackBin[] };
export type AisleBlock = { zone: string; faces: [Bay[], Bay[]]; planned: boolean };
export type FloorPlan = { aisles: AisleBlock[]; floor: RackBin[] };

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * The warehouse from above, built by the 3D view's rules (recompute_bin_positions, 0006): aisles in
 * `aisleOrder` (any other zone after, alphabetically), each one back-to-back block; face 0 = racks
 * 01..baysPerSide, face 1 = the racks behind them (21 behind 01). Floor locations are listed apart.
 */
export function buildFloorPlan(bins: RackBin[], aisleOrder: string[], baysPerSide = 20): FloorPlan {
  const byZone = new Map<string, Map<string, RackBin[]>>();
  const floor: RackBin[] = [];
  for (const b of bins) {
    if (!b.rack) { floor.push(b); continue; }
    const racks = byZone.get(b.zone) ?? new Map<string, RackBin[]>();
    byZone.set(b.zone, racks);
    const list = racks.get(b.rack) ?? [];
    racks.set(b.rack, list);
    list.push(b);
  }
  const extra = [...byZone.keys()].filter((z) => !aisleOrder.includes(z)).sort();
  const zones = [...aisleOrder.filter((z) => byZone.has(z)), ...extra];
  const aisles = zones.map((zone): AisleBlock => {
    const racks = byZone.get(zone)!;
    const face = (f: 0 | 1): Bay[] => Array.from({ length: baysPerSide }, (_, slot) => {
      const rack = pad2(slot + 1 + f * baysPerSide);
      const list = (racks.get(rack) ?? []).slice().sort((a, b) => a.bin_code.localeCompare(b.bin_code));
      return { zone, rack, face: f, slot, bins: list };
    });
    const all = [...racks.values()].flat();
    return { zone, faces: [face(0), face(1)], planned: all.length > 0 && all.every((b) => b.block_kind === "PLANNED") };
  });
  floor.sort((a, b) => a.bin_code.localeCompare(b.bin_code));
  return { aisles, floor };
}

export const bayKey = (zone: string, rack: string) => `${zone}${rack}`;

/** Every bay in the rectangle between two bays: rows (aisle × face, in plan order) × slots. */
export function selectBayRange(plan: FloorPlan, a: Bay, b: Bay): Bay[] {
  const rows = plan.aisles.flatMap((x) => x.faces);
  const rowOf = (bay: Bay) => rows.findIndex((r) => r.some((x) => x.zone === bay.zone && x.rack === bay.rack));
  const [r0, r1] = [rowOf(a), rowOf(b)].sort((x, y) => x - y);
  const [s0, s1] = [a.slot, b.slot].sort((x, y) => x - y);
  if (r0 < 0) return [];
  return rows.slice(r0, r1 + 1).flatMap((row) => row.filter((bay) => bay.slot >= s0 && bay.slot <= s1));
}

/** Keep the chosen levels; none chosen = every level. */
export function narrowLevels(bins: RackBin[], levels: string[]): RackBin[] {
  return levels.length ? bins.filter((b) => b.level !== null && levels.includes(b.level)) : bins;
}

/** "CF21A01–CF40A02 (40 bin)", one code alone, or "". */
export function codeRangeText(codes: string[]): string {
  if (codes.length === 0) return "";
  const sorted = [...codes].sort();
  return sorted.length === 1 ? sorted[0] : `${sorted[0]}–${sorted[sorted.length - 1]} (${sorted.length} bin)`;
}

/** Mirror of SQL `plan_racks_preview`: racks 01..n and 21..20+n, each level, positions 01/02. */
export function plannedCodes(aisle: string, bays: number, levels: string[]): string[] {
  const racks = [...Array.from({ length: bays }, (_, i) => i + 1), ...Array.from({ length: bays }, (_, i) => 21 + i)];
  return racks.flatMap((r) => levels.flatMap((l) => ["01", "02"].map((p) => `${aisle}${pad2(r)}${l}${p}`)));
}

/** What a cell must show over any colour mode, strongest first. */
export function overlayOf(b: RackBin): "NOT_PRESENT" | "PLANNED" | "BLOCKED" | "CKB" | null {
  if (b.block_kind === "NOT_PRESENT") return "NOT_PRESENT";
  if (b.block_kind === "PLANNED") return "PLANNED";
  if (b.status === "blocked") return "BLOCKED";
  if (b.owner === "CKB") return "CKB";
  return null;
}

export type RackTiles = { usable: number; occupied: number; pct: number; ckb: number; blocked: number; notPresent: number; planned: number };

/** The header numbers; rack bins only (floor locations are not positions). */
export function rackTiles(bins: RackBin[]): RackTiles {
  const t: RackTiles = { usable: 0, occupied: 0, pct: 0, ckb: 0, blocked: 0, notPresent: 0, planned: 0 };
  for (const b of bins) {
    if (!b.rack) continue;
    if (b.owner === "CKB") t.ckb++;
    const s = stateOf(b);
    if (s === "BLOCKED") t.blocked++;
    else if (s === "NOT_PRESENT") t.notPresent++;
    else if (s === "PLANNED") t.planned++;
    if (usableForShell(b)) { t.usable++; if (Number(b.total_qty) > 0) t.occupied++; }
  }
  t.pct = t.usable ? t.occupied / t.usable : 0;
  return t;
}

/** The bin whose colour a bay shows: the one holding the most. Null when the bay is empty. */
export function bayFill(bay: Bay): RackBin | null {
  let best: RackBin | null = null;
  for (const b of bay.bins) if (Number(b.total_qty) > 0 && (!best || Number(b.total_qty) > Number(best.total_qty))) best = b;
  return best;
}

/** The bin facts the engine needs, as `bins` rows give them. */
export type BinRuleRow = Pick<RackBin, "bin_code" | "rack" | "status" | "owner">;

/**
 * What the FEFO engine is told about bins for one run: every rack bin Shell may not use (lent to CKB,
 * blocked, missing, planned) joins the offline fallback list, and the walking order of aisles is the
 * layout's. The database is the source of truth since 0132; `DEFAULT_CONFIG.blockedBins` only covers a
 * CLI run that never sees the database.
 */
export function shellBinRules(rows: BinRuleRow[], aisleOrder: string[]): { blockedBins: string[]; aisleSequence: string[] } {
  const extra = rows.filter((r) => r.rack !== null && !usableForShell(r)).map((r) => r.bin_code);
  return { blockedBins: [...new Set([...DEFAULT_BLOCKED, ...extra])], aisleSequence: [...aisleOrder] };
}
