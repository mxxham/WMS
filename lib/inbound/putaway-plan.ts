import { lookupUom } from "@/lib/allocator/uom-master";
import { RACK_BIN_REGEX } from "@/config/warehouse";
import { DEFAULT_CONFIG } from "@/lib/allocator/config";

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

/** A stable number per text, so ties between racks are broken without favouring a name (FNV-1a). */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Split each line into pallets (`floor(qty / upp)` full + one partial) and choose a bin for each:
 * - partial pallet (below UPP): the SKU's pickface (level A); else an empty level-A bin;
 * - full pallet: an empty allowed bin; levels B..E before A; a bin is used once.
 *
 * Grouping by SKU (a rack = aisle + bay, e.g. CB01). A SKU keeps filling the rack it started in; a new rack is,
 * in this order: 1. a rack that already holds the SKU (stock, or chosen by a receipt not posted yet), the one
 * holding most of it first; 2. a rack with no other SKU; 3. any rack. Inside each step: nearest the SKU's own
 * stock or pickface, then the most free room, then a tie-break by hash, so no aisle or bay wins by its name.
 */
export function planPutaway(input: {
  lines: PutawayLine[]; emptyBins: string[]; pickfaces: Map<string, string>;
  /** where each SKU already is: bins with stock and bins other receipts have chosen */
  occupied?: { bin: string; sku: string }[];
}): { pallets: PalletPlan[]; warnings: string[] } {
  const pickfaceBins = new Set(input.pickfaces.values());
  const free = input.emptyBins.map(parse).filter((b): b is Bin => !!b && !pickfaceBins.has(b.code));
  const used = new Set<string>();
  const warnings: string[] = [];
  const pallets: PalletPlan[] = [];

  const rackKey = (b: Bin) => `${b.aisle}${String(b.rack).padStart(2, "0")}`;
  // What each rack holds: SKU -> pallets of it. Updated as this plan places pallets, so two SKUs of one
  // receipt avoid each other's rack too.
  const holds = new Map<string, Map<string, number>>();
  const hold = (rack: string, sku: string) => {
    const m = holds.get(rack) ?? holds.set(rack, new Map()).get(rack)!;
    m.set(sku, (m.get(sku) ?? 0) + 1);
  };
  for (const o of input.occupied ?? []) { const b = parse(o.bin); if (b) hold(rackKey(b), o.sku); }

  // Bays 01..20 face one side and 21..40 the other, back to back (bay 21 behind bay 01): compare by position along the aisle.
  const side = DEFAULT_CONFIG.baysPerSide;
  const along = (rack: number) => (side > 0 && rack > side ? rack - side : rack);
  const distance = (from: { aisle: string; rack: number }, to: { aisle: string; rack: number }) => {
    const d = Math.abs(along(to.rack) - along(from.rack)) + (side > 0 && (to.rack > side) !== (from.rack > side) ? 1 : 0);
    return from.aisle === to.aisle ? d : 1000 + Math.abs(to.aisle.charCodeAt(1) - from.aisle.charCodeAt(1)) * 100 + d;
  };
  const rackPos = (rack: string) => ({ aisle: rack.slice(0, 2), rack: Number(rack.slice(2)) });

  const current = new Map<string, string>();
  /** `key` is the SKU, or `<sku>|sisa` for its leftovers, which group on their own (level A). */
  const choose = (key: string, sku: string, levels: string[], order: string[]): Bin | null => {
    const rank = (l: string) => order.indexOf(l);
    const cands = free.filter((b) => !used.has(b.code) && levels.includes(b.level));
    if (!cands.length) return null;
    const byRack = new Map<string, Bin[]>();
    for (const b of cands) byRack.set(rackKey(b), [...(byRack.get(rackKey(b)) ?? []), b]);

    let rack = current.get(key);
    if (!rack || !byRack.has(rack)) {
      const own = (r: string) => holds.get(r)?.get(sku) ?? 0;
      const others = (r: string) => [...(holds.get(r)?.keys() ?? [])].filter((k) => k !== sku).length;
      // Anchor: the rack just filled, else the rack holding most of the SKU, else its pickface.
      const home = [...holds.keys()].filter((r) => own(r) > 0).sort((a, b) => own(b) - own(a) || a.localeCompare(b))[0];
      const anchor = rack ? rackPos(rack) : home ? rackPos(home) : parse(input.pickfaces.get(sku) ?? "");
      const step = (r: string) => (own(r) > 0 ? 0 : others(r) === 0 ? 1 : 2);
      const racks = [...byRack.entries()];
      racks.sort(([ka, a], [kb, b]) =>
        step(ka) - step(kb)
        || (step(ka) === 0 ? own(kb) - own(ka) : 0)
        || (anchor ? distance(anchor, a[0]) - distance(anchor, b[0]) : 0)
        || b.length - a.length
        || hash(`${sku}|${ka}`) - hash(`${sku}|${kb}`));
      rack = racks[0][0];
      current.set(key, rack);
    }
    const pick = byRack.get(rack)!.sort((a, b) => rank(a.level) - rank(b.level) || a.position.localeCompare(b.position))[0];
    used.add(pick.code);
    hold(rack, sku);
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
        const bin = choose(`${l.sku}|sisa`, l.sku, rest, LEVEL_ORDER);
        pallets.push({ ...base, bin: bin?.code ?? null, why: bin ? null : `Tidak ada bin kosong level ${rest.join("/")}` });
        return;
      }
      const bin = choose(l.sku, l.sku, allowed, LEVEL_ORDER);
      pallets.push({ ...base, bin: bin?.code ?? null, why: bin ? null : `Tidak ada bin kosong level ${allowed.join("/")}` });
    });
  }
  return { pallets, warnings };
}
