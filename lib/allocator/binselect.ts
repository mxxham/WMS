import { isBlockCLocation, type AllocatorConfig } from './config';
import { locationSequenceKey } from './pickpath';
import type { StockBin } from './types';

/** Mutable working copy of a bin during a run — shared by allocation and replenishment. */
export interface Ledger {
  bin: StockBin;
  remaining: number;
  /** pallet seal already broken (either on arrival, or by an earlier pick in this run) */
  opened: boolean;
  seqKey: number;
}

export function toLedger(bin: StockBin, config: AllocatorConfig): Ledger {
  return {
    bin,
    remaining: bin.qtyCartons,
    opened: !bin.isFullPallet,
    seqKey: locationSequenceKey(bin.location, config),
  };
}

/**
 * The working ledgers of one stock row. A rack bin or staging row is one ledger. A Block C slot is a STACK: its
 * pallets are stacked up to 3 high, one batch and one expiry (user, 20 Nov 2026), so FEFO sees the stack as one
 * expiry date and the pallet rules below apply per pallet: each full pallet is a sealed ledger of `upp` cartons and
 * the loose part (qty % upp) is one already-open pallet. Every ledger points at the same bin, so the picks they
 * produce all name the slot; selectNextBin needs no special case.
 */
export function toLedgers(bin: StockBin, config: AllocatorConfig): Ledger[] {
  if (!isBlockCLocation(bin.location, config) || !(bin.upp > 0)) return [toLedger(bin, config)];
  const seqKey = locationSequenceKey(bin.location, config);
  const out: Ledger[] = [];
  for (let i = 0; i < Math.floor(bin.qtyCartons / bin.upp); i++) out.push({ bin, remaining: bin.upp, opened: false, seqKey });
  const loose = bin.qtyCartons % bin.upp;
  if (loose > 0) out.push({ bin, remaining: loose, opened: true, seqKey });
  return out;
}

/**
 * Picks the next bin to draw from for one SKU, given how much is still needed.
 * This is THE rule, used identically by outbound picking and pickface
 * replenishment — only the destination differs (a shipment vs a pickface bin).
 *
 *   1. FEFO: lock onto the earliest expiry date still available in the pool.
 *   2. Inside that expiry date:
 *        need >= 1 pallet → sealed full pallet, nearest on the pick path
 *        need <  1 pallet → an already-open pallet, best fit (smallest that
 *                            still covers the need), so fragments get cleared
 *        no open pallet left → break a sealed one, nearest on the pick path
 */
export function selectNextBin(
  pool: Ledger[],
  remaining: number,
  upp: number,
  config: AllocatorConfig,
): Ledger | undefined {
  const available = pool.filter((l) => l.remaining > 0);
  if (available.length === 0) return undefined;

  const earliest = available.reduce(
    (min, l) => (l.bin.expiryDate < min ? l.bin.expiryDate : min),
    available[0].bin.expiryDate,
  );
  const group = available
    .filter((l) => l.bin.expiryDate.getTime() === earliest.getTime())
    .sort((a, b) => (a.bin.grDate?.getTime() ?? 0) - (b.bin.grDate?.getTime() ?? 0) || a.seqKey - b.seqKey);

  return chooseWithinExpiryGroup(group, remaining, upp, config);
}

function chooseWithinExpiryGroup(
  group: Ledger[],
  remaining: number,
  upp: number,
  config: AllocatorConfig,
): Ledger | undefined {
  if (remaining >= upp) {
    const sealed = group.filter((l) => !l.opened && l.remaining === upp);
    if (sealed.length) return sealed.sort((a, b) => a.seqKey - b.seqKey)[0];
    return group.sort((a, b) => b.remaining - a.remaining || a.seqKey - b.seqKey)[0];
  }

  if (config.preferOpenPalletForRemainder) {
    const open = group.filter((l) => l.opened);
    if (open.length) {
      if (config.bestFitOpenPallets) {
        const fits = open.filter((l) => l.remaining >= remaining);
        if (fits.length) return fits.sort((a, b) => a.remaining - b.remaining || a.seqKey - b.seqKey)[0];
      }
      const largestOpen = open.sort((a, b) => b.remaining - a.remaining || a.seqKey - b.seqKey)[0];
      if (largestOpen.remaining >= remaining) return largestOpen;

      const sealed = group.filter((l) => !l.opened);
      if (sealed.length) return sealed.sort((a, b) => b.remaining - a.remaining || a.seqKey - b.seqKey)[0];
      return largestOpen;
    }
  }

  const sealed = group.filter((l) => !l.opened && l.remaining >= remaining);
  if (sealed.length) return sealed.sort((a, b) => a.seqKey - b.seqKey)[0];

  return group.sort((a, b) => a.seqKey - b.seqKey)[0];
}

/** Cartons remaining per bin after a set of picks/moves have been applied. */
export function applyMovements(stock: StockBin[], moved: Map<string, number>): StockBin[] {
  return stock.map((b) => {
    const taken = moved.get(b.binId);
    return taken ? { ...b, qtyCartons: b.qtyCartons - taken, isFullPallet: b.qtyCartons - taken >= b.upp } : b;
  });
}
