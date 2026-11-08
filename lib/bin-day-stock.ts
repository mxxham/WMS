/**
 * On hand per bin without downloading Laporan WMS harian: the rows of `wms_day_report` (0055) for one bin or a
 * rack, grouped per bin. Same calculation as the Excel file, so the numbers always match it:
 * On hand = this morning (after inbound / putaway, before picking), Remain = after the day's picks and moves.
 * Pure: rows in, groups out.
 */

export type DayRow = {
  bin_code: string; sku: string; description: string | null; uom: string | null;
  batch_lot: string; expiry_date: string | null;
  on_hand: number; pick: number; b_out: number; b_in: number; remain: number;
};
type Cols = { on_hand: number; pick: number; b_out: number; b_in: number; remain: number };
export type BinDayGroup = { bin: string; lines: DayRow[]; total: Cols };

const COLS = ["on_hand", "pick", "b_out", "b_in", "remain"] as const;

/** One group per bin, in code order; lines in FEFO order (expiry, then batch); a total per column. */
export function groupDayRows(rows: DayRow[]): BinDayGroup[] {
  const by = new Map<string, DayRow[]>();
  for (const r of rows) {
    const n = { ...r } as DayRow;
    for (const c of COLS) n[c] = Number(r[c]) || 0;
    by.set(r.bin_code, [...(by.get(r.bin_code) ?? []), n]);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bin, lines]) => {
    lines.sort((a, b) => (a.expiry_date ?? "9999").localeCompare(b.expiry_date ?? "9999") || a.batch_lot.localeCompare(b.batch_lot) || a.sku.localeCompare(b.sku));
    const total = { on_hand: 0, pick: 0, b_out: 0, b_in: 0, remain: 0 };
    for (const l of lines) for (const c of COLS) total[c] += l[c];
    return { bin, lines, total };
  });
}

/** What was typed: a full rack code (CB01A01) or a floor location is exact; 2+ code characters are a prefix (CB01). */
export function binQuery(raw: string): { kind: "exact" | "prefix"; code: string } | null {
  const code = raw.trim().toUpperCase();
  if (code.length < 2 || !/^[A-Z0-9_]+$/.test(code)) return null;
  const exact = /^C[A-Z]\d{2}[A-E]\d{2}$/.test(code) || /^(STAGING(_INB|_OUT)?|QUARANTINE|STG_\d{2})$/.test(code);
  return { kind: exact ? "exact" : "prefix", code };
}

/** The key that matches a current stock line (inventory) to its report row: the stock identity. */
export function dayKey(r: { sku: string; batch_lot: string; expiry_date: string | null }): string {
  return `${r.sku}|${r.batch_lot ?? ""}|${r.expiry_date ?? ""}`;
}

/** The day's picking and Bin To Bin of one line, in words: "pick −20, B out −28, B in +12"; "" when nothing happened. */
export function changeText(r: Pick<DayRow, "pick" | "b_out" | "b_in"> | undefined): string {
  if (!r) return "";
  const parts: string[] = [];
  if (Number(r.pick)) parts.push(`pick −${Number(r.pick)}`);
  if (Number(r.b_out)) parts.push(`B out −${Number(r.b_out)}`);
  if (Number(r.b_in)) parts.push(`B in +${Number(r.b_in)}`);
  return parts.join(", ");
}

/** Lines that had stock this morning but are no longer in the bin: shown so it is clear where the stock went. */
export function emptiedToday(rows: DayRow[], currentKeys: Set<string>): DayRow[] {
  return rows.filter((r) => Number(r.on_hand) > 0 && Number(r.remain) === 0 && !currentKeys.has(dayKey(r)));
}
