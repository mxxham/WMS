/**
 * Shell date-coded batches: dd + month letter (A = Jan … L = Dec) + yy +
 * plant, e.g. 14H26JJ = made 14 Aug 2026 at plant JJ. The expiry of such a
 * batch is its production date plus the item's shelf life (48 months unless
 * the item says otherwise), so a typed expiry can be checked against the
 * batch. Same rule as public.batch_mfg_date / batch_expected_expiry (0016).
 * SAP lot numbers (12658123) carry no date: nothing to check.
 */

const ISO = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Production date 'YYYY-MM-DD' of a date-coded batch, or null. */
export function batchMfgDate(batch: string | null | undefined): string | null {
  const m = /^(\d{2})([A-L])(\d{2})[A-Z]{2}$/.exec((batch ?? "").trim().toUpperCase());
  if (!m) return null;
  const y = 2000 + Number(m[3]), mo = m[2].charCodeAt(0) - 64, d = Number(m[1]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return ISO(y, mo, d);
}

/** Production date + months, clamped like Postgres (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return ISO(ny, nm, Math.min(d, last));
}

/** Expected expiry of a batch, or null when the batch is not date-coded. */
export function expectedExpiry(batch: string | null | undefined, shelfLifeMonths = 48): string | null {
  const mfg = batchMfgDate(batch);
  return mfg ? addMonths(mfg, shelfLifeMonths) : null;
}

export type ExpiryMismatch = "day_month_swapped" | "wrong_century" | "wrong_year" | "typo" | "other";

export const MISMATCH_LABEL: Record<ExpiryMismatch, string> = {
  day_month_swapped: "hari dan bulan tertukar",
  wrong_century: "abad salah",
  wrong_year: "tahun salah",
  typo: "salah ketik hari",
  other: "berbeda",
};

/** What kind of mistake turns `expected` into `recorded` (both 'YYYY-MM-DD'). */
export function classifyMismatch(recorded: string, expected: string): ExpiryMismatch {
  const [ry, rm, rd] = recorded.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = expected.slice(0, 10).split("-").map(Number);
  if (ry === ey && rm === ed && rd === em) return "day_month_swapped";
  if (rm === em && rd === ed && ry !== ey && ry % 100 === ey % 100) return "wrong_century";
  if (rm === em && rd === ed && ry !== ey) return "wrong_year";
  if (ry === ey && rm === em) return "typo";
  return "other";
}

/** The check the forms run while typing: null when fine or not checkable. */
export function expiryCheck(batch: string, expiry: string | null | undefined, shelfLifeMonths = 48):
  { expected: string; kind: ExpiryMismatch } | null {
  const expected = expectedExpiry(batch, shelfLifeMonths);
  if (!expected || !expiry) return null;
  const e = expiry.slice(0, 10);
  return e === expected ? null : { expected, kind: classifyMismatch(e, expected) };
}
