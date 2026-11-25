// Pure helpers for the Mutasi page and its export: labels, stock effect, date bounds, paging.
// No I/O, so tests/movement-view.test.ts can pin every rule.

export const MOVEMENT_LABEL: Record<string, string> = {
  inbound: "Masuk",
  putaway: "Putaway",
  picking: "Picking",
  transfer: "Pindah bin",
  adjustment: "Koreksi",
};

export type Effect = "in" | "out" | "move";

/**
 * What a row does to the stock total. `quantity` is positive for every type except
 * `adjustment`, which is signed (constraint movement_qty_sign), so the direction comes from the type.
 * Putaway and transfer move stock between bins and leave the total unchanged.
 */
export function movementEffect(type: string, quantity: number): { effect: Effect; signed: number } {
  if (type === "inbound") return { effect: "in", signed: Math.abs(quantity) };
  if (type === "picking") return { effect: "out", signed: -Math.abs(quantity) };
  if (type === "adjustment") return { effect: quantity < 0 ? "out" : "in", signed: quantity };
  return { effect: "move", signed: 0 };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** A valid YYYY-MM-DD, or undefined. A hand-edited URL must never reach PostgREST as a bad timestamp. */
export function validDay(d: string | undefined): string | undefined {
  if (!d || !DAY.test(d)) return undefined;
  return Number.isNaN(new Date(`${d}T00:00:00+07:00`).getTime()) ? undefined : d;
}

/** Start of a Jakarta (WIB) day, as an ISO instant. */
export const dayStartISO = (d: string) => new Date(`${d}T00:00:00+07:00`).toISOString();
/** Start of the NEXT Jakarta day: use with `lt`, so the last second (and fraction) of the day is kept. */
export const dayEndExclusiveISO = (d: string) => new Date(new Date(`${d}T00:00:00+07:00`).getTime() + DAY_MS).toISOString();

/** Today's Jakarta calendar day. */
export const jakartaToday = (now: Date = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

/** The Jakarta day `days` before `day` (YYYY-MM-DD). */
export function shiftDay(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00+07:00`).getTime() - days * DAY_MS).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** Quick ranges for the filter bar. `days` = how many days back from today the range starts (0 = today only). */
export const QUICK_RANGES = [
  { label: "Hari ini", days: 0 },
  { label: "7 hari", days: 6 },
  { label: "30 hari", days: 29 },
] as const;

export function quickRange(days: number, now: Date = new Date()) {
  const to = jakartaToday(now);
  return { from: shiftDay(to, days), to };
}

/** `?page=` as a safe non-negative integer: NaN, negatives, fractions and junk all become 0. */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Fetch PAGE + 1 rows, show PAGE: the extra row says a next page really exists,
 * so "Berikutnya" never leads to an empty page when the count is an exact multiple.
 */
export function splitPage<T>(rows: T[], pageSize: number): { shown: T[]; hasNext: boolean } {
  return { shown: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
}

/** A date-only value (expiry) as `24 Sep 2026`. Parsed as UTC and printed as UTC, so no zone can shift the day. */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return "–";
  const date = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleDateString("id-ID", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}
