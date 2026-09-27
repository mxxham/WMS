import { daysBetween, hasExpiry, isStagingLocation, minShelfLifeDays, type AllocatorConfig } from './config';
import { selectNextBin, toLedger, type Ledger } from './binselect';
import { derivePickfaces } from './pickface';
import { stockIdentityKey } from './ledger';
import { parseLocation, pickSequenceKey } from './pickpath';
import type {
  AllocationLine,
  AllocationResult,
  DemandLine,
  PickfaceAssignment,
  PickfaceLedger,
  PickType,
  Shortage,
  StockBin,
  Warning,
} from './types';

/**
 * FEFO allocation with pickface preference.
 *
 * Rule order, applied per demand line:
 *   1. Eligibility  — rack bin, active, not blocked, qty > 0, enough shelf life left.
 *   2. Pickface first — the SKU's pickface bin is tried before any reserve bin.
 *                       Pickers always go to the pickface, never to reserve racks.
 *   3. FEFO         — the earliest expiry date available is always served first.
 *                     No later-expiry bin is touched while earlier stock remains.
 *   4. Within one expiry date (the tie-break layer, where handling cost lives):
 *        · need >= 1 pallet  → take sealed full pallets (forklift move)
 *        · need <  1 pallet  → take from an already-open pallet, best-fit,
 *                              so a sealed pallet is only broken as a last resort
 *        · equal otherwise   → the bin closest along the pick path
 *   5. Repeat until the line is filled.
 *   6. Staging last — what the racks cannot cover is taken from stock in an
 *                     outbound staging location (STAGING, STG_01, ...),
 *                     earliest expiry first, as a hand pick. Only the rest
 *                     is flagged as a shortage.
 *
 * The bin-choice rule itself lives in binselect.ts and is shared with
 * the pickface relocation logic, so a pickface top-up picks stock the
 * exact same way an outbound order does.
 *
 * Deterministic: same inputs always produce the same picklist.
 */
export function allocate(
  stock: StockBin[],
  demand: DemandLine[],
  config: AllocatorConfig,
  stagedBySku: Map<string, number> = new Map(),
): AllocationResult {
  const warnings: Warning[] = [];
  const lines: AllocationLine[] = [];
  const shortages: Shortage[] = [];

  // Derive pickface assignments so outbound picks prefer the pickface bin.
  const pickfaces = derivePickfaces(stock, config);
  const pickfaceBySku = new Map<string, string>();
  for (const [sku, pf] of pickfaces) {
    pickfaceBySku.set(sku, pf.location);
  }

  const bySku = new Map<string, Ledger[]>();
  const stagingBySku = new Map<string, Ledger[]>();
  const rejectedShelfLife = new Map<string, number>();

  for (const bin of stock) {
    if (bin.qtyCartons <= 0) continue;
    if (config.blockedBins.includes(bin.location)) {
      warnings.push({
        level: 'INFO',
        code: 'BIN_BLOCKED',
        message: `${bin.location} skipped: bin is blocked`,
        context: { sku: bin.sku, qty: bin.qtyCartons },
      });
      continue;
    }

    const life = daysBetween(config.asOf, bin.expiryDate);
    if (hasExpiry(bin.expiryDate) && life < minShelfLifeDays(bin.sku, config)) {
      rejectedShelfLife.set(bin.sku, (rejectedShelfLife.get(bin.sku) ?? 0) + bin.qtyCartons);
      warnings.push({
        level: 'WARN',
        code: life < 0 ? 'EXPIRED' : 'SHELF_LIFE_BLOCKED',
        message: `${bin.location} ${bin.sku} batch ${bin.batch ?? '-'} has ${life} days left — not allocatable`,
        context: { location: bin.location, sku: bin.sku, expiry: bin.expiryDate, qty: bin.qtyCartons },
      });
      continue;
    }
    if (hasExpiry(bin.expiryDate) && life < config.nearExpiryWarningDays) {
      warnings.push({
        level: 'INFO',
        code: 'NEAR_EXPIRY',
        message: `${bin.location} ${bin.sku} expires in ${life} days — ship first`,
        context: { location: bin.location, sku: bin.sku, expiry: bin.expiryDate },
      });
    }

    const ledger = toLedger(bin, config);
    const target = isStagingLocation(bin.location, config) ? stagingBySku : bySku;
    const list = target.get(bin.sku);
    if (list) list.push(ledger);
    else target.set(bin.sku, [ledger]);
  }

  const ordered = [...demand].sort((a, b) => {
    if (config.sequenceShipmentsBySlot) {
      const s = (a.slotTime ?? '99:99').localeCompare(b.slotTime ?? '99:99');
      if (s !== 0) return s;
    }
    return a.shipmentNumber.localeCompare(b.shipmentNumber) || a.sku.localeCompare(b.sku);
  });

  for (const line of ordered) {
    const pool = bySku.get(line.sku) ?? [];
    let remaining = line.qtyCartons;
    const staged = stagingBySku.get(line.sku) ?? [];
    const upp = line.upp || pool[0]?.bin.upp || staged[0]?.bin.upp || 1;
    const expiriesUsed = new Set<string>();
    let allocated = 0;

    const pickfaceLoc = pickfaceBySku.get(line.sku);
    const isPickface = (l: Ledger) => !!pickfaceLoc && l.bin.location === pickfaceLoc;

    const take = (chosen: Ledger) => {
      const qty = Math.min(chosen.remaining, remaining);
      const wasSealed = !chosen.opened;
      const pickType: PickType = wasSealed && qty === upp && chosen.remaining === upp ? 'PALLET' : 'CASE';
      chosen.remaining -= qty;
      if (qty < upp || !wasSealed) chosen.opened = true;
      remaining -= qty;
      allocated += qty;
      expiriesUsed.add(chosen.bin.expiryDate.toISOString().slice(0, 10));
      lines.push({
        shipmentNumber: line.shipmentNumber,
        waveNo: line.waveNo,
        orderNos: line.orderNos,
        sku: line.sku,
        // The item master's name (what the carton label says); the schedule's text only as fallback.
        description: chosen.bin.description || line.description,
        location: chosen.bin.location,
        binId: chosen.bin.binId,
        batch: chosen.bin.batch,
        expiryDate: chosen.bin.expiryDate,
        qtyPick: qty,
        pickType,
        upp,
        uom: chosen.bin.uom,
        qtyRemainingInBin: chosen.remaining,
        moveQty: 0,
        moveTo: null,
        daysToExpiry: daysBetween(config.asOf, chosen.bin.expiryDate),
        seq: 0,
        breaksPallet: wasSealed && qty < upp,
        slotTime: line.slotTime,
      });
    };

    // Each step, FEFO first: only the earliest expiry still on hand, pickface
    // or reserve, may be touched. Inside that expiry:
    //   1. >= 1 pallet still needed -> a sealed full pallet, nearest; reserve
    //      pallets before the pickface's own, which is kept for loose cartons
    //      (opening it there needs no bin-to-bin move).
    //   2. The loose rest -> the pickface, when it covers the rest.
    //   3. One order line, one bin: a single reserve bin that covers the rest,
    //      when that costs no extra pallet (the bin is already open, or the
    //      pickface-first split would open a sealed pallet anyway).
    //   4. Otherwise the pickface first, then open pallets (best fit), a
    //      sealed pallet only as the last resort (selectNextBin).
    while (remaining > 0) {
      const available = pool.filter((l) => l.remaining > 0);
      if (available.length === 0) break;
      const earliest = Math.min(...available.map((l) => l.bin.expiryDate.getTime()));
      const group = available.filter((l) => l.bin.expiryDate.getTime() === earliest);
      const pf = group.filter(isPickface);
      const rv = group.filter((l) => !isPickface(l));
      const pfTotal = pf.reduce((n, l) => n + l.remaining, 0);

      let chosen: Ledger | undefined;
      if (remaining >= upp) {
        chosen = group.filter((l) => !l.opened && l.remaining === upp)
          .sort((x, y) => Number(isPickface(x)) - Number(isPickface(y)) || x.seqKey - y.seqKey)[0];
      }
      if (!chosen && pf.length > 0 && pfTotal >= remaining) {
        chosen = selectNextBin(pf, remaining, upp, config);
      }
      if (!chosen && pf.length > 0) {
        const single = selectNextBin(rv, remaining, upp, config);
        if (single && single.remaining >= remaining) {
          const rest = remaining - pfTotal;
          const splitSource = selectNextBin(rv, rest, upp, config);
          const splitOpensPallet = !!splitSource && !splitSource.opened && splitSource.remaining === upp && rest < upp;
          if (single.opened || splitOpensPallet) chosen = single;
        }
        chosen ??= selectNextBin(pf, remaining, upp, config);
      }
      chosen ??= selectNextBin(rv, remaining, upp, config);
      if (!chosen) break;
      take(chosen);
    }

    // Staging after the racks: what the racks could not cover, earliest
    // expiry, then oldest GR, then location.
    const stagingOrder = staged
      .filter((l) => l.remaining > 0)
      .sort((x, y) => x.bin.expiryDate.getTime() - y.bin.expiryDate.getTime()
        || (x.bin.grDate?.getTime() ?? 0) - (y.bin.grDate?.getTime() ?? 0)
        || x.bin.location.localeCompare(y.bin.location));
    for (const l of stagingOrder) {
      if (remaining <= 0) break;
      take(l);
    }

    if (remaining > 0) {
      const inStaging = stagedBySku.get(line.sku) ?? 0;
      shortages.push({
        shipmentNumber: line.shipmentNumber,
        orderNos: line.orderNos,
        sku: line.sku,
        description: line.description,
        qtyRequested: line.qtyCartons,
        qtyAllocated: allocated,
        qtyShort: remaining,
        reason: inStaging >= remaining
          ? 'ALREADY_STAGED'
          : (rejectedShelfLife.get(line.sku) ?? 0) >= remaining
            ? 'BLOCKED_SHELF_LIFE'
            : 'NO_STOCK',
        qtyRejectedByShelfLife: rejectedShelfLife.get(line.sku) ?? 0,
        qtyInStaging: inStaging,
      });
    }

    const masterName = [...pool, ...staged].find((l) => l.bin.description)?.bin.description;
    if (masterName && line.description && line.description.trim() !== masterName.trim()) {
      warnings.push({
        level: 'WARN',
        code: 'DESCRIPTION_MISMATCH',
        message: `SKU ${line.sku} (shipment ${line.shipmentNumber}): Schedule says "${line.description}", master data says "${masterName}". Picklist prints the master name.`,
        context: { sku: line.sku, schedule: line.description, master: masterName },
      });
    }

    if (config.warnOnMixedExpiryPerLine && expiriesUsed.size > 1) {
      warnings.push({
        level: 'INFO',
        code: 'MIXED_EXPIRY',
        message: `Shipment ${line.shipmentNumber} / ${line.sku} picks ${expiriesUsed.size} expiry dates (FEFO consumed the oldest batch first)`,
        context: { expiries: [...expiriesUsed].sort() },
      });
    }
  }

  const palletPicks = lines.filter((l) => l.pickType === 'PALLET').length;
  const cartonsRequested = demand.reduce((s, d) => s + d.qtyCartons, 0);
  const cartonsAllocated = lines.reduce((s, l) => s + l.qtyPick, 0);

  return {
    generatedAt: new Date(),
    picklists: [],
    lines,
    shortages,
    warnings,
    stats: {
      demandLines: demand.length,
      cartonsRequested,
      cartonsAllocated,
      fillRatePct: cartonsRequested ? (cartonsAllocated / cartonsRequested) * 100 : 100,
      palletPicks,
      casePicks: lines.length - palletPicks,
      palletsBroken: lines.filter((l) => l.breaksPallet).length,
      binsTouched: new Set(lines.map((l) => l.binId)).size,
      shipments: new Set(demand.map((d) => d.shipmentNumber)).size,
    },
  };
}

function waveSortKey(waveNo: string): number {
  const n = Number(waveNo);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * Physical accounting event type.
 *
 * Every stock movement at a physical identity is one of:
 *   - PICK: a customer order consumed cartons from this identity
 *   - RELOC_IN: stock physically arrived here from a bulk source
 *   - RELOC_OUT: the leftover stock physically left this identity for a pickface
 */
export type PhysicalEvent =
  | { type: 'PICK'; waveNum: number; qty: number; line: AllocationLine }
  | { type: 'RELOC_OUT'; waveNum: number; qty: number; sourceKey: string; destinationKey: string; sourceLine: AllocationLine }
  | { type: 'RELOC_IN'; waveNum: number; qty: number; sourceKey: string; destinationKey: string; sourceLine: AllocationLine };

/**
 * Earliest slot per NO wave. A wave can hold shipments with different slots
 * (15 Sep: NO 1 = 00:52 and 03:22), and waves are worked one at a time, so a
 * wave is placed at its earliest slot.
 */
export function waveSlots(items: { waveNo: string; slotTime: string | null }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const i of items) {
    const s = i.slotTime ?? '99:99';
    if (!m.has(i.waveNo) || s < m.get(i.waveNo)!) m.set(i.waveNo, s);
  }
  return m;
}

/**
 * Row order inside one shipment's picklist: hand picks before forklift
 * pallets, then SKU, then along the pick path. picklist.ts prints in this
 * order and executionOrder() decides Bin To Bin in it, so the picker meets
 * the rows in the order the moves were planned.
 */
export function pickRowCompare(a: AllocationLine, b: AllocationLine, config: AllocatorConfig): number {
  const seq = (l: AllocationLine) => {
    const parsed = parseLocation(l.location);
    return parsed ? pickSequenceKey(parsed, config) : Number.MAX_SAFE_INTEGER;
  };
  return Number(a.pickType !== 'CASE') - Number(b.pickType !== 'CASE') ||
    a.sku.localeCompare(b.sku) ||
    seq(a) - seq(b);
}

/**
 * The order the warehouse executes the lines in, and the order the picklists
 * are printed and the plan's tasks numbered: NO waves by earliest slot (then
 * NO), inside a wave its shipments by slot (then number), then the rows of a
 * shipment as its picklist prints them (pickRowCompare). Every Sisa is
 * computed in this order, so all picklists of a run — printed together or one
 * wave at a time — agree with each other.
 */
export function executionOrder(lines: AllocationLine[], config: AllocatorConfig): AllocationLine[] {
  const index = new Map(lines.map((l, i) => [l, i]));
  const ws = waveSlots(lines);
  return [...lines].sort((a, b) =>
    ws.get(a.waveNo)!.localeCompare(ws.get(b.waveNo)!) ||
    waveSortKey(a.waveNo) - waveSortKey(b.waveNo) ||
    (a.slotTime ?? '99:99').localeCompare(b.slotTime ?? '99:99') ||
    a.shipmentNumber.localeCompare(b.shipmentNumber) ||
    pickRowCompare(a, b, config) ||
    index.get(a)! - index.get(b)!);
}

/**
 * Replays every line in execution order against real bin balances (one
 * balance per physical identity: location + SKU + batch + expiry) and fixes
 * up what allocation could not know:
 *
 *   · Where the stock is. When an earlier pallet break carried the leftover
 *     of this batch to the pickface, the pick goes to the pickface.
 *   · Whether this line opens a sealed pallet (the first line to touch a
 *     full pallet in EXECUTION order does, not in allocation order).
 *   · The bin-to-bin move: when a line breaks a pallet away from the SKU's
 *     pickface and the pickface is below its target, the leftover goes to
 *     the pickface right after the pick (moveQty / moveTo).
 *   · Sisa (qtyRemainingInBin): what physically stays in the bin once the
 *     line, including its move, is done.
 *
 * Quantities, SKU, batch and expiry of each line never change. The plan's
 * REPLENISH tasks (plan.ts) and every printout read the move and sisa from
 * the lines, so they always agree. Returns the pickface balances at the end.
 */
export function relocateByWaveOrder(
  lines: AllocationLine[],
  pickfaces: Map<string, PickfaceAssignment>,
  config: AllocatorConfig,
  stock: StockBin[],
): PickfaceLedger {
  for (const l of lines) { l.moveQty = 0; l.moveTo = null; }
  if (config.relocationOrderBasis !== 'picklistNumber') return new Map();

  const balance = new Map<string, number>();
  const opened = new Set<string>();
  for (const bin of stock) {
    const key = stockIdentityKey(bin.location, bin.sku, bin.batch, bin.expiryDate);
    balance.set(key, (balance.get(key) ?? 0) + bin.qtyCartons);
    if (!bin.isFullPallet) opened.add(key);
  }
  const get = (k: string) => balance.get(k) ?? 0;
  const atLocation = (location: string, sku: string) => {
    let n = 0;
    for (const [k, q] of balance) if (k.startsWith(`${location}|${sku}|`)) n += q;
    return n;
  };

  const order = executionOrder(lines, config);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j < order.length && order[j].shipmentNumber === order[i].shipmentNumber && order[j].waveNo === order[i].waveNo) j++;
    const rows = order.slice(i, j);
    i = j;

    // The leftover of a batch was carried to the pickface by an earlier break:
    // those picks go to the pickface. Settled for the whole shipment first, so
    // its rows can be walked in the order the picklist prints them.
    const claimed = new Map<string, number>();
    for (const r of rows) {
      const k = stockIdentityKey(r.location, r.sku, r.batch, r.expiryDate);
      claimed.set(k, (claimed.get(k) ?? 0) + r.qtyPick);
    }
    for (const line of rows) {
      const pf = pickfaces.get(line.sku);
      let key = stockIdentityKey(line.location, line.sku, line.batch, line.expiryDate);
      if (get(key) < line.qtyPick && pf && pf.location !== line.location) {
        const pfKey = stockIdentityKey(pf.location, line.sku, line.batch, line.expiryDate);
        if (get(pfKey) - (claimed.get(pfKey) ?? 0) >= line.qtyPick) {
          claimed.set(key, claimed.get(key)! - line.qtyPick);
          claimed.set(pfKey, (claimed.get(pfKey) ?? 0) + line.qtyPick);
          line.location = pf.location;
          line.binId = `${pf.location}|${line.sku}|${line.batch ?? 'NOBATCH'}`;
          key = pfKey;
        }
      }
      line.pickType = !opened.has(key) && get(key) === line.upp && line.qtyPick === line.upp ? 'PALLET' : 'CASE';
    }
    rows.sort((a, b) => pickRowCompare(a, b, config));

    for (const line of rows) {
      const pf = pickfaces.get(line.sku);
      const key = stockIdentityKey(line.location, line.sku, line.batch, line.expiryDate);
      const before = get(key);
      const sealed = !opened.has(key) && before === line.upp;
      line.breaksPallet = sealed && line.qtyPick < line.upp;
      line.pickType = sealed && line.qtyPick === line.upp ? 'PALLET' : 'CASE';
      balance.set(key, before - line.qtyPick);
      opened.add(key);

      if (line.breaksPallet && pf && pf.location !== line.location && get(key) > 0
          && atLocation(pf.location, line.sku) < pf.targetQtyCartons) {
        const pfKey = stockIdentityKey(pf.location, line.sku, line.batch, line.expiryDate);
        line.moveQty = get(key);
        line.moveTo = pf.location;
        balance.set(pfKey, get(pfKey) + line.moveQty);
        opened.add(pfKey);
        balance.set(key, 0);
      }
      line.qtyRemainingInBin = get(key);
    }
  }

  mergeSameBinRows(lines);

  const ledger: PickfaceLedger = new Map();
  for (const [sku, pf] of pickfaces) {
    if (lines.some((l) => l.sku === sku)) ledger.set(sku, { location: pf.location, finalQty: atLocation(pf.location, sku) });
  }
  return ledger;
}

/**
 * One row per bin per order line. A pick re-routed to the pickface (its batch
 * was carried there by an earlier Bin To Bin) can land on a bin the same order
 * line already picks from; the admin would then see "CE26A02 12" and
 * "CE26A02 22" for one order. Rows with the same shipment, SKU, bin, batch and
 * expiry are merged in place (quantities added). Rows carrying a move are
 * never merged. Sisa is recomputed afterwards (settleSisa).
 */
export function mergeSameBinRows(lines: AllocationLine[]): void {
  const keep = new Map<string, AllocationLine>();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.moveTo) continue;
    const k = `${l.shipmentNumber}|${l.sku}|${stockIdentityKey(l.location, l.sku, l.batch, l.expiryDate)}`;
    const first = keep.get(k);
    if (!first) { keep.set(k, l); continue; }
    first.qtyPick += l.qtyPick;
    first.breaksPallet ||= l.breaksPallet;
    if (l.pickType === 'CASE') first.pickType = 'CASE';
    first.qtyRemainingInBin = Math.min(first.qtyRemainingInBin, l.qtyRemainingInBin);
    lines.splice(i, 1);
    i--;
  }
}
