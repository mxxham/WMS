/** Shared classification for the dashboard and the Inventory page. */

export type LocType = "rack" | "staging" | "quarantine" | "mia" | "other";
export const LOC_LABEL: Record<LocType, string> = { rack: "Rak", staging: "Staging", quarantine: "Karantina", mia: "MIA (belum ketemu)", other: "Lantai lain" };

export function locType(r: { zone: string; rack: string | null }): LocType {
  if (r.zone === "STAGING") return "staging";
  if (r.zone === "QUARANTINE") return "quarantine";
  if (r.zone === "MIA") return "mia";
  return r.rack ? "rack" : "other";
}

/** Shelf-life buckets by days left, oldest first. */
export const SHELF_BUCKETS = [
  { key: "expired", label: "Expired", max: -1 },
  { key: "d90", label: "≤ 90 hari", max: 90 },
  { key: "d180", label: "91–180 hari", max: 180 },
  { key: "d365", label: "181–365 hari", max: 365 },
  { key: "y2", label: "1–2 tahun", max: 730 },
  { key: "y3", label: "2–3 tahun", max: 1095 },
  { key: "more", label: "> 3 tahun", max: Infinity },
  { key: "none", label: "Tanpa tanggal", max: NaN },
] as const;
export type ShelfBucket = (typeof SHELF_BUCKETS)[number]["key"];

export function shelfBucket(daysRemaining: number | null): ShelfBucket {
  if (daysRemaining === null) return "none";
  return SHELF_BUCKETS.find((b) => !Number.isNaN(b.max) && daysRemaining <= b.max)!.key;
}

/** Stock identity used to match inventory rows with open tasks. */
export const stockKey = (bin: string, sku: string, batch: string, expiry: string | null) =>
  `${bin}|${sku}|${batch ?? ""}|${expiry ? expiry.slice(0, 10) : ""}`;

/** Today's date in Jakarta as YYYY-MM-DD. */
export const jakartaDate = (d: Date = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/** The sort keys of Inventory → Stok; "bin" walks the rack in position order (0142). */
export type InventorySort = "sku" | "qty" | "expiry" | "reserved" | "bin";
export const INVENTORY_SORTS: InventorySort[] = ["sku", "qty", "expiry", "reserved", "bin"];

type SortLine = { bin_code: string; sku: string; batch_lot: string; quantity: number; expiry_date: string | null; reserved: number };
type SortSku = { sku: string; firstBin: string; total: number; reserved: number; earliest: string | null };

/**
 * Per lokasi: "bin" is bin code order (zone, rack number, level, position —
 * the codes are zero-padded), so a filtered aisle reads like the rack is
 * walked; ties inside one bin go by SKU then batch. The others keep their
 * meaning: SKU, quantity, expiry, reservation.
 */
export function lineSortCompare(sort: InventorySort): (a: SortLine, b: SortLine) => number {
  return sort === "bin" ? (a, b) => a.bin_code.localeCompare(b.bin_code) || a.sku.localeCompare(b.sku) || a.batch_lot.localeCompare(b.batch_lot)
    : sort === "qty" ? (a, b) => Number(b.quantity) - Number(a.quantity)
    : sort === "expiry" ? (a, b) => (a.expiry_date ?? "9999").localeCompare(b.expiry_date ?? "9999")
    : sort === "reserved" ? (a, b) => b.reserved - a.reserved
    : (a, b) => a.sku.localeCompare(b.sku) || a.bin_code.localeCompare(b.bin_code);
}

/** Per SKU: "bin" orders the SKUs by where their stock sits (first bin code). */
export function skuSortCompare(sort: InventorySort): (a: SortSku, b: SortSku) => number {
  return sort === "bin" ? (a, b) => a.firstBin.localeCompare(b.firstBin) || a.sku.localeCompare(b.sku)
    : sort === "qty" ? (a, b) => b.total - a.total
    : sort === "expiry" ? (a, b) => (a.earliest ?? "9999").localeCompare(b.earliest ?? "9999")
    : sort === "reserved" ? (a, b) => b.reserved - a.reserved
    : (a, b) => a.sku.localeCompare(b.sku);
}
