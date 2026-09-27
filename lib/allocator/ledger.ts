import type { AllocationLine, StockBin } from './types';

export interface PickfaceAssignment {
  location: string;
  sku: string;
  targetQtyCartons: number;
}

export function stockIdentityKey(location: string, sku: string, batch: string | null, expiry: Date): string {
  return `${location}|${sku}|${batch ?? ''}|${expiry.toISOString().slice(0, 10)}`;
}

function parseIdentityKey(key: string): { location: string; sku: string; batch: string; expiryStr: string } {
  const [location, sku, batch, expiryStr] = key.split('|');
  return { location, sku, batch, expiryStr };
}

export function computeStockAfterMovements(
  stock: StockBin[],
  lines: AllocationLine[],
  pickfaces: Map<string, PickfaceAssignment>,
): StockBin[] {
  const adjustments = new Map<string, number>();

  for (const line of lines) {
    const key = stockIdentityKey(line.location, line.sku, line.batch, line.expiryDate);
    adjustments.set(key, (adjustments.get(key) ?? 0) - line.qtyPick);
  }

  // Pallet-break moves exactly as recorded on the lines (relocateByWaveOrder).
  for (const line of lines) {
    if (!line.moveTo || line.moveQty <= 0) continue;
    const sourceKey = stockIdentityKey(line.location, line.sku, line.batch, line.expiryDate);
    adjustments.set(sourceKey, (adjustments.get(sourceKey) ?? 0) - line.moveQty);
    const destKey = stockIdentityKey(line.moveTo, line.sku, line.batch, line.expiryDate);
    adjustments.set(destKey, (adjustments.get(destKey) ?? 0) + line.moveQty);
  }

  const uppBySku = new Map<string, number>();
  for (const bin of stock) {
    if (!uppBySku.has(bin.sku)) uppBySku.set(bin.sku, bin.upp);
  }

  const stockByKey = new Map<string, StockBin>();
  for (const bin of stock) {
    const key = stockIdentityKey(bin.location, bin.sku, bin.batch, bin.expiryDate);
    stockByKey.set(key, bin);
  }

  const result: StockBin[] = [];
  for (const [key, adj] of adjustments) {
    const existing = stockByKey.get(key);
    if (existing) {
      const newQty = existing.qtyCartons + adj;
      result.push({ ...existing, qtyCartons: newQty, isFullPallet: newQty >= existing.upp });
    } else if (adj > 0) {
      const { location, sku, batch, expiryStr } = parseIdentityKey(key);
      const upp = uppBySku.get(sku) ?? 1;
      result.push({
        binId: `${location}|${sku}|${batch}`,
        location,
        aisle: location.slice(0, 2),
        bay: parseInt(location.slice(2, 4)),
        level: location.slice(4, 5),
        position: parseInt(location.slice(5, 7)),
        sku,
        description: `SKU ${sku}`,
        batch,
        expiryDate: new Date(expiryStr),
        grDate: null,
        qtyCartons: adj,
        upp,
        uom: 'CAR',
        isFullPallet: adj >= upp,
      });
    }
  }

  for (const bin of stock) {
    const key = stockIdentityKey(bin.location, bin.sku, bin.batch, bin.expiryDate);
    if (!adjustments.has(key)) result.push(bin);
  }

  return result;
}

/**
 * Walks balances per physical identity through ordered steps. A step takes
 * `qty` from `key`, then optionally carries `moveQty` (or, with 'rest', the
 * whole leftover) to `moveToKey`. `after[i]` is what stays at `key` once
 * step i and its move are done: the picklist's Sisa.
 */
export interface ReplayStep { key: string; qty: number; moveToKey?: string | null; moveQty?: number | 'rest' }
export function replaySteps(initial: Map<string, number>, steps: ReplayStep[]) {
  const balance = new Map(initial);
  const after: number[] = [];
  const moved: number[] = [];
  const shortAt: number[] = [];
  steps.forEach((s, i) => {
    let left = (balance.get(s.key) ?? 0) - s.qty;
    if (left < 0) shortAt.push(i);
    let m = 0;
    if (s.moveToKey) {
      m = s.moveQty === 'rest' ? Math.max(left, 0) : Math.min(s.moveQty ?? 0, Math.max(left, 0));
      left -= m;
      balance.set(s.moveToKey, (balance.get(s.moveToKey) ?? 0) + m);
    }
    balance.set(s.key, left);
    after.push(left);
    moved.push(m);
  });
  return { after, moved, shortAt, balance };
}

/** Opening balance per physical identity. */
export function stockBalances(stock: StockBin[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of stock) {
    const k = stockIdentityKey(b.location, b.sku, b.batch, b.expiryDate);
    m.set(k, (m.get(k) ?? 0) + b.qtyCartons);
  }
  return m;
}

/**
 * Final Sisa in the PRINTED order (picklists as sorted, lines by seq) — the
 * order the plan's tasks are numbered in too. Locations and which line moves
 * a leftover were decided by relocateByWaveOrder; this pass only settles the
 * numbers. Returns the lines whose bin would go below zero (none expected).
 */
export function settleSisa(orderedLines: AllocationLine[], stock: StockBin[]): AllocationLine[] {
  const steps: ReplayStep[] = orderedLines.map((l) => ({
    key: stockIdentityKey(l.location, l.sku, l.batch, l.expiryDate),
    qty: l.qtyPick,
    moveToKey: l.moveTo ? stockIdentityKey(l.moveTo, l.sku, l.batch, l.expiryDate) : null,
    moveQty: 'rest' as const,
  }));
  const r = replaySteps(stockBalances(stock), steps);
  orderedLines.forEach((l, i) => {
    l.qtyRemainingInBin = r.after[i];
    l.moveQty = r.moved[i];
    if (!l.moveQty) l.moveTo = null;
  });
  return r.shortAt.map((i) => orderedLines[i]);
}
