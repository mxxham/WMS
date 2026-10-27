/**
 * Wave page for an operator: only the shipments assigned to them (shipment_assignments).
 * Pure helpers; the page reads the assignments and filters every dataset with these.
 */

/** Waves with at least one shipment number in `assigned` (one wave = one shipment). */
export function filterToAssigned<W extends { id: string; shipment_numbers: string[] }>(waves: W[], assigned: Set<string>): W[] {
  return waves.filter((w) => w.shipment_numbers.some((s) => assigned.has(s)));
}

/** Rows (tasks, outbound, problems, DO rows) that belong to one of the kept waves. */
export function keepWaveIds<R extends { wave_id: string | null }>(ids: Set<string>, rows: R[]): R[] {
  return rows.filter((r) => r.wave_id !== null && ids.has(r.wave_id));
}

/** Sorted distinct planned dates of the caller's assignments. */
export function assignedDates(rows: { planned_date: string }[]): string[] {
  return [...new Set(rows.map((r) => r.planned_date))].sort();
}

/** Nearest assigned day before and after `date`, for the day arrows. */
export function neighbourDates(dates: string[], date: string): { prev: string | null; next: string | null } {
  const before = dates.filter((d) => d < date);
  const after = dates.filter((d) => d > date);
  return { prev: before.length ? before[before.length - 1]! : null, next: after.length ? after[0]! : null };
}

/** The empty-day sentence; `formattedDate` is the already formatted day. */
export function emptyDayText(assignedOnly: boolean, formattedDate: string): string {
  return assignedOnly ? "Belum ada shipment yang ditugaskan ke Anda." : `Belum ada rencana untuk ${formattedDate}.`;
}
