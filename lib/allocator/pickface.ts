import type { AllocatorConfig } from './config';
import { parseLocation, pickSequenceKey, walkPosition } from './pickpath';
import type { PickfaceAssignment, StockBin } from './types';

/**
 * One dedicated pickface bin per SKU.
 *
 * An admin override (`config.pickfaceOverrides[sku]`) always wins — this is
 * the permanent CRUD-assigned bin. Without one, the SKU's own current stock
 * is used to pick a sensible default: whichever occupied bin with a pickface-
 * eligible level (default: Level A) sits earliest on the pick path becomes
 * the pickface, and everything else of that SKU is reserve stock that gets
 * moved in on replenishment. This mirrors what an admin would assign by hand,
 * and is only a starting point — override it once real pickface assignments
 * exist.
 *
 * Levels B-E are always bulk/reserve — never auto-derived as pickfaces.
 * This prevents bulk-to-bulk replenishment moves.
 */
export function derivePickfaces(stock: StockBin[], config: AllocatorConfig): Map<string, PickfaceAssignment> {
  const bySku = new Map<string, StockBin[]>();
  for (const bin of stock) {
    const list = bySku.get(bin.sku);
    if (list) list.push(bin);
    else bySku.set(bin.sku, [bin]);
  }

  const result = new Map<string, PickfaceAssignment>();

  // Every location that physically holds stock, of any SKU. A synthetic
  // pickface must never land on one of these (it would hold another product).
  const occupied = new Set(stock.filter((b) => b.qtyCartons > 0).map((b) => b.location));
  // Bins fixed as another SKU's pickface are never auto-chosen for this one.
  const fixedOwner = new Map(Object.entries(config.pickfaceOverrides).map(([sku, loc]) => [loc.toUpperCase(), sku]));
  const reservedFor = (loc: string, sku: string) => { const owner = fixedOwner.get(loc); return owner !== undefined && owner !== sku; };
  // Every rack bay the stock shows exists (any SKU): fallback pickface slots
  // are only proposed in bays that are known to be real.
  const knownBays = new Map<string, { aisle: string; bay: number }>();
  for (const b of stock) {
    const p = parseLocation(b.location);
    if (p && config.rackLocationPattern.test(b.location)) knownBays.set(`${p.aisle}${p.bay}`, { aisle: p.aisle, bay: p.bay });
  }

  for (const [sku, bins] of bySku) {
    const upp = bins.find((b) => b.upp)?.upp ?? 1;
    const description = bins[0]?.description ?? '';
    const target = config.pickfaceTargetQty === 'upp' ? upp : config.pickfaceTargetQty;

    const overrideLoc = config.pickfaceOverrides[sku];
    if (overrideLoc) {
      result.set(sku, {
        sku,
        description,
        location: overrideLoc.toUpperCase(),
        targetQtyCartons: target,
        isAuto: false,
      });
      continue;
    }

    // Enforce physical rule: only Level A bins are pickfaces (B-E = bulk)
    const pickfaceEligible = bins.filter((b) => {
      const parsed = parseLocation(b.location);
      return parsed !== null && config.pickfaceLevels.includes(parsed.level) && !reservedFor(b.location, sku);
    });

    const ranked = [...pickfaceEligible].sort((a, b) => {
      const pa = parseLocation(a.location);
      const pb = parseLocation(b.location);
      const ka = pa ? pickSequenceKey(pa, config) : Number.MAX_SAFE_INTEGER;
      const kb = pb ? pickSequenceKey(pb, config) : Number.MAX_SAFE_INTEGER;
      return ka - kb;
    });

    if (ranked.length > 0) {
      result.set(sku, {
        sku,
        description,
        location: ranked[0].location,
        targetQtyCartons: target,
        isAuto: true,
      });
      continue;
    }

    // No Level A stock for this SKU — create pickface at the bay where bulk stock lives
    const bulkBins = bins.filter((b) => {
      const parsed = parseLocation(b.location);
      return parsed !== null && !config.pickfaceLevels.includes(parsed.level);
    });

    if (bulkBins.length > 0) {
      // Group bulk stock by bay, pick the bay with the most cartons
      const bayQty = new Map<string, { aisle: string; bay: number; qty: number }>();
      for (const bin of bulkBins) {
        const parsed = parseLocation(bin.location);
        if (!parsed) continue;
        const key = `${parsed.aisle}${parsed.bay}`;
        const existing = bayQty.get(key);
        if (existing) existing.qty += bin.qtyCartons;
        else bayQty.set(key, { aisle: parsed.aisle, bay: parsed.bay, qty: bin.qtyCartons });
      }

      // Bays by bulk quantity, most first; ties broken by pick path so the
      // result is deterministic. Use the first bay with a free Level A slot.
      const level = config.pickfaceLevels[0] ?? 'A';
      const bays = [...bayQty.values()].sort((a, b) => b.qty - a.qty
        || pickSequenceKey({ location: '', aisle: a.aisle, bay: a.bay, level, position: 1 }, config)
         - pickSequenceKey({ location: '', aisle: b.aisle, bay: b.bay, level, position: 1 }, config));
      const usedLocations = new Set([...result.values()].map((p) => p.location));

      const free = (bay: { aisle: string; bay: number }) => {
        for (let pos = 1; pos <= 2; pos++) {
          const loc = `${bay.aisle}${String(bay.bay).padStart(2, '0')}${level}${String(pos).padStart(2, '0')}`;
          if (!(usedLocations.has(loc) || occupied.has(loc) || fixedOwner.has(loc) || config.blockedBins.includes(loc))) return loc;
        }
        return null;
      };
      let loc: string | null = null;
      for (const bay of bays) if ((loc = free(bay))) break;

      // The bulk bays' Level A slots are all taken: the nearest free Level A
      // slot along the walking route (same lane first, then the fewest bays
      // away), so an opened pallet's rest still gets a Bin To Bin.
      if (!loc && bays.length > 0) {
        const home = walkPosition({ location: '', aisle: bays[0].aisle, bay: bays[0].bay, level, position: 1 }, config);
        const dist = (b: { aisle: string; bay: number }) => {
          const w = walkPosition({ location: '', aisle: b.aisle, bay: b.bay, level, position: 1 }, config);
          return Math.abs(w.lane - home.lane) * 1_000 + Math.abs(w.along - home.along);
        };
        const nearest = [...knownBays.values()].sort((a, b) => dist(a) - dist(b)
          || pickSequenceKey({ location: '', aisle: a.aisle, bay: a.bay, level, position: 1 }, config)
           - pickSequenceKey({ location: '', aisle: b.aisle, bay: b.bay, level, position: 1 }, config));
        for (const bay of nearest) if ((loc = free(bay))) break;
      }

      if (loc) result.set(sku, { sku, description, location: loc, targetQtyCartons: target, isAuto: true });
      // No free Level A slot anywhere: no pickface. The SKU is then picked
      // straight from reserve and never re-anchored or relocated.
    }
  }

  return result;
}
