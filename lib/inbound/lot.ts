import { addMonths, batchMfgDate } from "@/lib/batch-code";

/** Batch, production date and expiry of the goods, as typed on Penerimaan ("" = not filled yet). */
export type Lot = { batch: string; mfg: string; expiry: string };

/**
 * A batch was typed. A Shell date-coded batch (14H26JJ) carries its production date: it fills the
 * production date and the expiry (production + shelf life). Any other batch leaves both as they were.
 */
export function lotFromBatch(prev: Lot, batch: string, shelfLifeMonths: number): Lot {
  const b = batch.toUpperCase();
  const mfg = batchMfgDate(b);
  return mfg ? { batch: b, mfg, expiry: addMonths(mfg, shelfLifeMonths) } : { ...prev, batch: b };
}

/** A production date was typed: the expiry follows from it (cleared with it). */
export function lotFromMfg(prev: Lot, mfg: string, shelfLifeMonths: number): Lot {
  return { ...prev, mfg, expiry: mfg ? addMonths(mfg, shelfLifeMonths) : prev.expiry };
}

/** The pallets of one SKU take its lot; every other pallet stays as it is. */
export function applyLot<R extends Lot & { sku: string }>(rows: R[], sku: string, lot: Lot): R[] {
  return rows.map((r) => (r.sku === sku ? { ...r, ...lot } : r));
}

/** Receipts on a list date: a planned one on its plan date, a manual one on the Jakarta day it was made. */
export function receiptDay(r: { plan_date?: string | null; created_at: string }): string {
  return r.plan_date ?? new Date(r.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
