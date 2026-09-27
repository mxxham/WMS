/**
 * Calendar dates from date-only Excel cells, correct in any timezone.
 *
 * Excel stores a date as a day number with no timezone. Readers turn it into
 * a JS Date differently: SheetJS (`cellDates: true`) builds local midnight
 * using the zone's *historical* offset, so in Asia/Jakarta (LMT +7:07:12) the
 * 15th arrives as 23:59:48 on the 14th; ExcelJS returns UTC midnight, i.e.
 * 07:00 local in WIB. Rounding to the NEAREST local midnight recovers the
 * intended calendar day in every case (the errors are far below 12 hours).
 */
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/** Nearest-midnight calendar day of a date-only cell value. */
export function excelCalendarDay(d: Date): { y: number; m: number; d: number } {
  const r = new Date(d.getTime() + HALF_DAY_MS);
  return { y: r.getFullYear(), m: r.getMonth() + 1, d: r.getDate() };
}

/** 'YYYY-MM-DD' for a date-only cell value. */
export function excelDateIso(d: Date): string {
  const { y, m, d: day } = excelCalendarDay(d);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The cell's calendar day as UTC midnight (the allocator's date convention). */
export function excelDateUtc(d: Date): Date {
  const { y, m, d: day } = excelCalendarDay(d);
  return new Date(Date.UTC(y, m - 1, day));
}

/** Excel serial day number (1900 system) → UTC midnight. */
export function excelSerialToUtc(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86_400_000));
}

/** Date cell → its Excel serial day number (inverse of excelSerialToUtc). */
export function excelDateToSerial(d: Date): number {
  return Math.round(excelDateUtc(d).getTime() / 86_400_000) + 25569;
}

/**
 * Batch cell → text. A batch number with a date format (2150031 shown as
 * "31 Jul 7786") reads as a far-future Date; give back the typed number.
 */
export function excelBatchText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return excelCalendarDay(v).y > 2100 ? String(excelDateToSerial(v)) : excelDateIso(v);
  }
  return String(v).trim();
}
