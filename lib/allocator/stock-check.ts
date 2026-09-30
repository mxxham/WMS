import { normBatch } from '@/lib/pick-audit';
import type { StockBin } from './types';

/**
 * A plan made from the WMS file's stock sheet may become the day's waves only
 * when the database holds the same stock where that plan works: every bin +
 * SKU it picks from or moves a pallet's rest into, batch by batch. 30 Sep:
 * the file had CB11A02 86 x 19I26JJ and CD36A02 17, the database 40 + 47 x
 * 12I26JJ and 48; the printed picklist and the saved waves then disagreed.
 * The rest of the warehouse may differ; it does not change this plan.
 */

/** planning_stock() row (0044): physical, what other open waves take / bring in, what is on hold. */
export interface DbStockRow {
  bin_code: string; sku: string; batch_lot: string;
  physical: number; reserved: number; incoming: number; held: number;
}

export type StockProblem = 'qty' | 'claimed' | 'held';
export interface StockCheckRow {
  bin: string; sku: string; batch: string;
  file: number; db: number; reserved: number; incoming: number; held: number;
  problem: StockProblem | null;
}

type TaskRef = { from_bin: string; to_bin: string | null; sku: string };

export function checkPlanStock(tasks: TaskRef[], fileStock: StockBin[], dbRows: DbStockRow[]): { ok: boolean; rows: StockCheckRow[] } {
  const binSku = (bin: string, sku: string) => `${bin.trim().toUpperCase()}|${sku}`;
  const touched = new Set(tasks.flatMap((t) => [binSku(t.from_bin, t.sku), ...(t.to_bin ? [binSku(t.to_bin, t.sku)] : [])]));

  const rows = new Map<string, StockCheckRow>();
  const row = (bin: string, sku: string, batch: string | null) => {
    const b = bin.trim().toUpperCase(), n = normBatch(batch), k = `${b}|${sku}|${n}`;
    return rows.get(k) ?? rows.set(k, { bin: b, sku, batch: n, file: 0, db: 0, reserved: 0, incoming: 0, held: 0, problem: null }).get(k)!;
  };
  for (const s of fileStock) if (touched.has(binSku(s.location, s.sku))) row(s.location, s.sku, s.batch).file += Number(s.qtyCartons);
  for (const d of dbRows) {
    if (!touched.has(binSku(d.bin_code, d.sku))) continue;
    const r = row(d.bin_code, d.sku, d.batch_lot);
    r.db += Number(d.physical); r.reserved += Number(d.reserved); r.incoming += Number(d.incoming); r.held += Number(d.held);
  }

  const out = [...rows.values()].map((r) => ({
    ...r,
    problem: r.file !== r.db ? 'qty' as const : r.reserved > 0 || r.incoming > 0 ? 'claimed' as const : r.held > 0 ? 'held' as const : null,
  })).sort((a, b) => a.bin.localeCompare(b.bin) || a.sku.localeCompare(b.sku) || a.batch.localeCompare(b.batch));
  return { ok: out.every((r) => !r.problem), rows: out };
}
