import { fmtNum } from "@/lib/utils";

/** "Waiting long" in staging: 3 days or more, the same rule as the dashboard staging tally (d3p). */
export const STAGING_LONG_DAYS = 3;

/** One stock line in a staging location, as staging_stock() (0134) returns it. */
export type StagingLine = {
  bin_code: string; item_id: string; sku: string; description: string; uom: string; batch_lot: string;
  expiry_date: string | null; quantity: number; reserved: number; arrival_date: string | null; days_waiting: number | null;
};

export function waitLabel(days: number | null): string {
  if (days === null) return "tanggal datang tidak diketahui";
  return days === 0 ? "hari ini" : `${days} hari`;
}

export function isLong(days: number | null): boolean {
  return days !== null && days >= STAGING_LONG_DAYS;
}

/** What may move into a rack: what an open wave task has not reserved. */
export function movable(l: Pick<StagingLine, "quantity" | "reserved">): number {
  return Math.max(0, l.quantity - l.reserved);
}

export function moveSentence(l: StagingLine, qty: number, to: string): string {
  return `Pindah ${fmtNum(qty)} ${l.uom} ${l.sku} dari ${l.bin_code} ke ${to}?`;
}
