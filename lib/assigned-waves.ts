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

/**
 * The operator's Wave page: `waves` / `tasks` are what is displayed and printed (their shipments);
 * `dayWaves` / `dayTasks` are what every replay runs over (Sisa, rest notes, numbering, print order).
 * `assigned` null = not an operator: everything is shown.
 */
export function scopeToAssigned<W extends { id: string; shipment_numbers: string[] }, T extends { wave_id: string | null }>(
  wavesAll: W[], tasksAll: T[], assigned: Set<string> | null,
): { waves: W[]; tasks: T[]; dayWaves: W[]; dayTasks: T[] } {
  if (!assigned) return { waves: wavesAll, tasks: tasksAll, dayWaves: wavesAll, dayTasks: tasksAll };
  const waves = filterToAssigned(wavesAll, assigned);
  const tasks = keepWaveIds(new Set(waves.map((w) => w.id)), tasksAll);
  return { waves, tasks, dayWaves: wavesAll, dayTasks: tasksAll };
}

/**
 * Day-wide work handled by Inventory / Leader (count tasks opened by a short pick, picklist
 * corrections): not on an operator's Perlu ditangani, whose links go to pages they cannot open.
 */
export function inventoryWork<R>(assignedOnly: boolean, rows: R[] | null | undefined): R[] {
  return assignedOnly ? [] : rows ?? [];
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
