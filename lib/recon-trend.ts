/**
 * One SKU's gap against SAP over several reconciliations, to see whether it keeps coming back ("berulang").
 * The gap of each run is what was left of it: the day's gap plus what Investigasi selisih corrected (wms_fix),
 * the same number the list shows (lib/sap-compare.ts, recon_line_gap in SQL).
 */

/** One stock_recon_lines row of the SKU with the reconciliation's date. */
export type TrendRow = {
  recon_id: string; as_of: string;
  diff_unrestricted: number | null; diff_blocked: number | null; wms_fix: number | null;
};

export type TrendPoint = { reconId: string; asOf: string; gap: number; dayGap: number; fix: number };

const n = (v: unknown) => Number(v ?? 0) || 0;

/** Oldest first, at most `max` of the newest runs; one point per reconciliation. */
export function gapSeries(rows: TrendRow[], max = 12): TrendPoint[] {
  const byRecon = new Map<string, TrendPoint>();
  for (const r of rows) {
    const dayGap = -(n(r.diff_unrestricted) + n(r.diff_blocked));
    byRecon.set(r.recon_id, { reconId: r.recon_id, asOf: r.as_of, dayGap, fix: n(r.wms_fix), gap: dayGap + n(r.wms_fix) });
  }
  return [...byRecon.values()].sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0)).slice(-max);
}

/**
 * How many of the latest runs in a row had a gap of the same direction (the run being looked at counts):
 * 3 = "berulang 3 kali berturut-turut". 0 when the latest run has no gap.
 */
export function repeatStreak(series: TrendPoint[]): { runs: number; sign: 1 | -1 | 0 } {
  const last = series[series.length - 1];
  if (!last || last.gap === 0) return { runs: 0, sign: 0 };
  const sign = last.gap > 0 ? 1 : -1;
  let runs = 0;
  for (let i = series.length - 1; i >= 0 && Math.sign(series[i].gap) === sign; i--) runs++;
  return { runs, sign };
}
