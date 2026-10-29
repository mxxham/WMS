/** Buku stok works in Asia/Jakarta calendar days, written as "YYYY-MM-DD". */

/** The Jakarta calendar day of an instant. */
export function jakartaDay(at: Date = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** Calendar arithmetic on "YYYY-MM-DD" (in UTC, so no time zone can shift it). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The team enters a day's inbound the next day (putaway), so a day's WMS side is not complete until the
 * next day is over. Until then the page says "Menunggu putaway".
 */
export function isWaiting(date: string, today: string): boolean {
  return today <= addDays(date, 1);
}

/** Every day of a "YYYY-MM" month. */
export function monthDays(month: string): string[] {
  const out: string[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}

/** The month to show: `raw` when it is "YYYY-MM", else the month of `today`. */
export function monthOf(raw: string | undefined, today: string): string {
  return /^\d{4}-\d{2}$/.test(raw ?? "") ? raw! : today.slice(0, 7);
}
