import { lookupUom } from "@/lib/allocator/uom-master";
import { RACK_BIN_REGEX } from "@/config/warehouse";

/**
 * Auto putaway for a checked receipt (spec docs/superpowers/specs/2026-10-28-inbound-plan-autoputaway-design.md).
 * Pure: the caller passes the empty bins and the pickfaces; the database re-checks every bin when it is saved.
 */
export type Pack = "Carton" | "Drum" | "Pail" | "Fluidbag" | "IBC";

/**
 * Levels a FULL pallet of each packaging may stand on (decided by the user, 28 Oct 2026). Level A is for
 * leftovers below a full pallet (the pickface level); pail (A only) and fluidbag / IBC (A or B, user 29 Oct)
 * may also stand on it full.
 */
export const LEVELS: Record<Pack, string[]> = {
  Carton: ["B", "C", "D", "E"], Drum: ["B", "C"], Pail: ["A"], Fluidbag: ["A", "B"], IBC: ["A", "B"],
};
/** Levels a LEFTOVER (below UPP) may use: level A, the pickface level, for every packaging. */
export const LEFTOVER_LEVELS: Record<Pack, string[]> = {
  Carton: ["A"], Drum: ["A"], Pail: ["A"], Fluidbag: ["A"], IBC: ["A"],
};
const LEVEL_ORDER = ["B", "C", "D", "E", "A"];

/** Packaging of a SKU: the picklist master first, then CAR, then the description (209L drum, 18kg pail, IBC, fluidbag). */
export function packOf(sku: string, uom: string | null, description: string): Pack | null {
  const m = (lookupUom(sku) ?? "").toLowerCase();
  if (m === "car" || m === "ctn") return "Carton";
  if (m === "drum") return "Drum";
  if (m === "pail") return "Pail";
  if (m === "fluidbag") return "Fluidbag";
  if (m === "ibc") return "IBC";
  if ((uom ?? "").toUpperCase() === "CAR") return "Carton";
  const d = description.toLowerCase();
  if (/\bibc\b|1000\s*l/.test(d)) return "IBC";
  if (/fluid\s*bag|flexi|770\s*kg/.test(d)) return "Fluidbag";
  if (/209\s*l|180\s*kg|200\s*l/.test(d)) return "Drum";
  if (/\*\s*(18|20|25)\s*(kg|l)(?![a-z])/.test(d)) return "Pail";
  return null;
}

export type PutawayLine = { line: number; sku: string; uom: string | null; description: string; quantity: number; upp: number | null };
export type PalletPlan = {
  line: number; sku: string; pallet_no: number; quantity: number; full: boolean; pack: Pack | null;
  bin: string | null; why: string | null;
};
type Bin = { code: string; aisle: string; rack: number; level: string; position: string };

const parse = (code: string): Bin | null => {
  const m = RACK_BIN_REGEX.exec(code);
  return m ? { code, aisle: m[1], rack: Number(m[2]), level: m[3], position: m[4] } : null;
};

/**
 * Split each line into pallets (`floor(qty / upp)` full + one partial) and choose a bin for each:
 * - partial pallet (below UPP): the SKU's pickface (level A); else an empty level-A bin;
 * - full pallet: an empty allowed bin, grouped per rack: the SKU fills one rack (nearest its pickface, or
 *   the rack with the most free room) before the nearest next one; levels B..E before A. A bin is used once.
 */
export function planPutaway(input: { lines: PutawayLine[]; emptyBins: string[]; pickfaces: Map<string, string> }):
  { pallets: PalletPlan[]; warnings: string[] } {
  const pickfaceBins = new Set(input.pickfaces.values());
  const free = input.emptyBins.map(parse).filter((b): b is Bin => !!b && !pickfaceBins.has(b.code));
  const used = new Set<string>();
  const warnings: string[] = [];
  const pallets: PalletPlan[] = [];

  // Grouping: each SKU keeps filling its current rack (aisle + bay, e.g. CB01) until no allowed bin is left
  // there, then moves to the nearest rack. The first rack is the one nearest the SKU's pickface; without a
  // pickface, the rack with the most free allowed bins, so no aisle or bay is favoured by its name.
  const current = new Map<string, string>();
  const rackKey = (b: Bin) => `${b.aisle}${String(b.rack).padStart(2, "0")}`;
  const distance = (from: { aisle: string; rack: number }, to: Bin) =>
    from.aisle === to.aisle ? Math.abs(to.rack - from.rack)
      : 1000 + Math.abs(to.aisle.charCodeAt(1) - from.aisle.charCodeAt(1)) * 100 + Math.abs(to.rack - from.rack);

  const choose = (sku: string, levels: string[], order: string[]): Bin | null => {
    const rank = (l: string) => order.indexOf(l);
    const cands = free.filter((b) => !used.has(b.code) && levels.includes(b.level));
    if (!cands.length) return null;
    const byRack = new Map<string, Bin[]>();
    for (const b of cands) byRack.set(rackKey(b), [...(byRack.get(rackKey(b)) ?? []), b]);

    let rack = current.get(sku);
    if (!rack || !byRack.has(rack)) {
      const pf = parse(input.pickfaces.get(sku) ?? "");
      const anchor = rack ? { aisle: rack.slice(0, 2), rack: Number(rack.slice(2)) } : pf;
      const racks = [...byRack.entries()];
      racks.sort(([ka, a], [kb, b]) => anchor
        ? distance(anchor, a[0]) - distance(anchor, b[0]) || b.length - a.length || ka.localeCompare(kb)
        : b.length - a.length || ka.localeCompare(kb));
      rack = racks[0][0];
      current.set(sku, rack);
    }
    const pick = byRack.get(rack)!.sort((a, b) => rank(a.level) - rank(b.level) || a.position.localeCompare(b.position))[0];
    used.add(pick.code);
    return pick;
  };

  for (const l of input.lines) {
    const pack = packOf(l.sku, l.uom, l.description);
    const upp = l.upp && l.upp > 0 ? l.upp : null;
    if (!upp) warnings.push(`${l.sku}: UPP (karton per palet) belum ada di Master item, dihitung 1 palet`);
    const sizes: number[] = [];
    if (upp) { for (let i = 0; i < Math.floor(l.quantity / upp); i++) sizes.push(upp); if (l.quantity % upp) sizes.push(l.quantity % upp); }
    else sizes.push(l.quantity);

    sizes.forEach((q, i) => {
      const full = !!upp && q === upp;
      const base = { line: l.line, sku: l.sku, pallet_no: i + 1, quantity: q, full, pack };
      if (!pack) { pallets.push({ ...base, bin: null, why: "Jenis kemasan tidak dikenal: pilih bin sendiri" }); return; }
      const allowed = LEVELS[pack];
      if (!full) {
        const rest = LEFTOVER_LEVELS[pack];
        const pf = parse(input.pickfaces.get(l.sku) ?? "");
        if (pf && rest.includes(pf.level)) { pallets.push({ ...base, bin: pf.code, why: null }); return; }
        const bin = choose(`${l.sku}|sisa`, rest, LEVEL_ORDER);
        pallets.push({ ...base, bin: bin?.code ?? null, why: bin ? null : `Tidak ada bin kosong level ${rest.join("/")}` });
        return;
      }
      const bin = choose(l.sku, allowed, LEVEL_ORDER);
      pallets.push({ ...base, bin: bin?.code ?? null, why: bin ? null : `Tidak ada bin kosong level ${allowed.join("/")}` });
    });
  }
  return { pallets, warnings };
}
