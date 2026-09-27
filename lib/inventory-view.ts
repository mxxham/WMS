/** Shared classification for the dashboard and the Inventory page. */

export type LocType = "rack" | "staging" | "quarantine" | "other";
export const LOC_LABEL: Record<LocType, string> = { rack: "Rak", staging: "Staging", quarantine: "Karantina", other: "Lantai lain" };

export function locType(r: { zone: string; rack: string | null }): LocType {
  if (r.zone === "STAGING") return "staging";
  if (r.zone === "QUARANTINE") return "quarantine";
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
