/**
 * MIA (Missing In Action, migrations 0152 + 0153): stock nobody can find. It sits in the bin MIA, outside our side
 * of the SAP comparison, until it is found (MIA -> rack) or written off. Only the jobs Inventory and Admin move
 * stock in and out, and nobody approves it. This file words the MIA ledger for the pages.
 */

/** A row of mia_stock: what is in MIA now. `since` = the first time this batch + expiry went in. */
export type MiaStockRow = {
  item_id: string; sku: string; description: string | null; upp: number | null;
  batch_lot: string; expiry_date: string | null; quantity: number; since: string | null;
};

export type MiaKind = "MOVE_IN" | "BOOK" | "FIND" | "CLEAR";

/** A row of mia_events, with the SKU and bin joined in. */
export type MiaEvent = {
  id: string; kind: MiaKind; sku: string; description: string | null; batch_lot: string; expiry_date: string | null;
  quantity: number; bin_code: string | null; note: string; by_name: string; created_at: string; line_id: string | null;
};

export const MIA_KIND_LABEL: Record<MiaKind, string> = {
  MOVE_IN: "Dipindah ke MIA", BOOK: "Dicatat ke MIA", FIND: "Ditemukan", CLEAR: "Dihapus",
};

/** A case older than this many days is flagged on the page. */
export const MIA_ALERT_DAYS = 7;

/** Only Inventory and Admin move stock in and out of MIA (the database checks it too, `mia_require_actor`). */
export const canMoveMia = (job: string | null | undefined) => job === "inventory" || job === "admin";

const DAY = 86_400_000;
export function miaAgeDays(since: string | null, now: Date = new Date()): number | null {
  if (!since) return null;
  const t = new Date(since).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now.getTime() - t) / DAY));
}

export function miaSummary(rows: MiaStockRow[], now: Date = new Date()): { skus: number; qty: number; oldestDays: number | null; overdue: number } {
  let oldest: number | null = null, overdue = 0;
  for (const r of rows) {
    const d = miaAgeDays(r.since, now);
    if (d === null) continue;
    if (oldest === null || d > oldest) oldest = d;
    if (d > MIA_ALERT_DAYS) overdue++;
  }
  return { skus: new Set(rows.map((r) => r.sku)).size, qty: rows.reduce((s, r) => s + Number(r.quantity || 0), 0), oldestDays: oldest, overdue };
}

/**
 * Per batch + expiry, how many cartons a checked bin is short of the system (the system holds more than the floor
 * shows): the cartons that can go to MIA. A batch the floor shows more of is not short.
 */
export type ShortLine = { batch_lot: string; expiry_date: string | null; quantity: number };
export function shortLines(system: ShortLine[], counted: ShortLine[]): ShortLine[] {
  const key = (l: ShortLine) => `${l.batch_lot.toUpperCase()}|${l.expiry_date ?? ""}`;
  const seen = new Map(counted.map((c) => [key(c), Number(c.quantity) || 0]));
  const out: ShortLine[] = [];
  for (const s of system) {
    const q = Number(s.quantity) || 0;
    const diff = q - (seen.get(key(s)) ?? 0);
    if (diff > 0) out.push({ batch_lot: s.batch_lot, expiry_date: s.expiry_date, quantity: diff });
  }
  return out;
}
