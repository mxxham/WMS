/**
 * Which bins an investigation (Investigasi selisih) shows first, by the sign and the size of the gap
 * against one pallet of the SKU (its own UPP):
 *
 *   WMS more than SAP   >= 1 pallet: every bin that holds the SKU in the database
 *                       <  1 pallet: the pickface / level A bins that hold it
 *   WMS less than SAP   >= 1 pallet: the picklist of the chosen wave day
 *                       <  1 pallet: that picklist, then the pickface / level A bins
 *
 * Exactly one pallet counts as a pallet. When the small cases give nothing (every bin checked, none differs)
 * the page widens to every pickface bin. A SKU without a UPP, or a gap of zero, keeps the score list
 * of recon_suspect_bins. This file only decides which bins come first; the database still scores them
 * (migration 0129) and the check / fix flow is unchanged.
 */
import { fmtNum } from "@/lib/utils";
import { topSuspects, type SuspectBin } from "@/lib/recon-investigate";

/** One PICK line of a wave day (pick_task_detail): the "kemarin" picklist of an investigation. */
export type PickLine = {
  id: string; wave_no: string; planned_date: string; shipment_number: string | null; seq: number; status: string;
  from_bin: string; actual_from_bin: string | null; batch_lot: string; expiry_date: string | null;
  quantity: number; actual_quantity: number | null; picked_by_name: string | null; completed_by_name: string | null;
};

/** The bin a picker really took from: the actual bin when it differs from the plan. */
export const pickBin = (p: PickLine) => p.actual_from_bin ?? p.from_bin;

export type SuspectMode =
  | "WIDE"                    // no UPP, or no gap: the score list
  | "PLUS_ALL"                // WMS more by a pallet or more: every bin holding the SKU
  | "PLUS_PICKFACE"           // WMS more by less than a pallet: pickface / level A bins holding the SKU
  | "MINUS_PICKLIST"          // WMS less by a pallet or more: the picklist of the wave day
  | "MINUS_PICKLIST_PICKFACE"; // WMS less by less than a pallet: the picklist plus pickface / level A bins

export type SuspectPlan = {
  mode: SuspectMode;
  upp: number | null;
  /** |gap| >= UPP. */
  big: boolean;
  /** Bins to walk to first (rows of recon_suspect_bins). */
  primary: SuspectBin[];
  /** Bin codes the picklist took the SKU from, in picklist order, without repeats. */
  pickBins: string[];
  /** The "every pickface bin" fallback exists for this mode. */
  hasFallback: boolean;
  /** Every first bin is checked and none differs from the system: time to widen the search. */
  fallbackOpen: boolean;
  headline: string;
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const isFresh = (b: SuspectBin) => !!b.check_id && !b.check_stale;
const checkedDiffers = (b: SuspectBin) => isFresh(b) && n(b.checked_qty) !== n(b.system_qty);

/** A pickface bin of this SKU, or any level A bin. */
export const isPickfaceOrLevelA = (b: SuspectBin) => b.is_pickface || b.level === "A";

export function suspectPlan(a: { gap: number; upp: number | null | undefined; suspects: SuspectBin[]; picks: PickLine[] }): SuspectPlan {
  const upp = n(a.upp) > 0 ? n(a.upp) : null;
  const abs = Math.abs(a.gap);
  const byScore = (x: SuspectBin, y: SuspectBin) => y.score - x.score || x.bin_code.localeCompare(y.bin_code);
  const pickBins = [...new Set(a.picks.map(pickBin))];
  if (!abs || upp === null) {
    return {
      mode: "WIDE", upp, big: false, primary: topSuspects(a.suspects), pickBins, hasFallback: false, fallbackOpen: false,
      headline: !abs ? "Tidak ada sisa selisih." : "UPP SKU ini belum ada di master: daftar dibuat dari skor petunjuk saja.",
    };
  }
  const big = abs >= upp;
  const holding = a.suspects.filter((b) => n(b.system_qty) > 0);
  const low = holding.filter(isPickfaceOrLevelA);
  const picked = a.suspects.filter((b) => pickBins.includes(b.bin_code));
  let mode: SuspectMode, primary: SuspectBin[], headline: string;
  if (a.gap > 0) {
    mode = big ? "PLUS_ALL" : "PLUS_PICKFACE";
    primary = (big ? holding : low).slice().sort(byScore);
    headline = big
      ? `WMS lebih ${fmtNum(abs)} dari SAP, sama dengan atau lebih dari 1 palet (${fmtNum(upp)} karton): cek semua bin yang menurut sistem berisi SKU ini.`
      : `WMS lebih ${fmtNum(abs)} dari SAP, kurang dari 1 palet (${fmtNum(upp)} karton): cek pickface / level A yang berisi SKU ini dulu.`;
  } else {
    mode = big ? "MINUS_PICKLIST" : "MINUS_PICKLIST_PICKFACE";
    const rest = big ? [] : low.filter((b) => !pickBins.includes(b.bin_code));
    primary = [...picked.slice().sort(byScore), ...rest.sort(byScore)];
    headline = big
      ? `WMS kurang ${fmtNum(abs)} dari SAP, sama dengan atau lebih dari 1 palet (${fmtNum(upp)} karton): periksa picklist hari wave yang dipilih dulu.`
      : `WMS kurang ${fmtNum(abs)} dari SAP, kurang dari 1 palet (${fmtNum(upp)} karton): periksa picklist hari wave yang dipilih, lalu pickface / level A.`;
  }
  const hasFallback = mode === "PLUS_PICKFACE" || mode === "MINUS_PICKLIST_PICKFACE";
  const unchecked = primary.some((b) => !isFresh(b));
  // A picklist bin the suspect list does not know cannot be "checked" from here: wait for it, too.
  const unseenPicks = pickBins.some((c) => !a.suspects.some((b) => b.bin_code === c && isFresh(b)));
  const fallbackOpen = hasFallback && !unchecked && !(mode === "MINUS_PICKLIST_PICKFACE" && unseenPicks) && !primary.some(checkedDiffers);
  return { mode, upp, big, primary, pickBins, hasFallback, fallbackOpen, headline };
}

// ---------------------------------------------------------------------
// The checklist of Step 1: one row per bin to walk to, with what was done
// ---------------------------------------------------------------------
export type CheckState = "TODO" | "STALE" | "OK" | "DIFF";
export type CheckSource = "PICKLIST" | "PICKFACE" | "LEVEL_A" | "WMS";

export type ChecklistRow = {
  code: string;
  /** the suspect row; null for a picklist bin the suspect list does not know */
  bin: SuspectBin | null;
  /** the picklist lines of the chosen wave day that took the SKU from this bin */
  picks: PickLine[];
  sources: CheckSource[];
  state: CheckState;
  /** counted - system, when checked */
  diff: number;
};

/** Where a bin stands: not checked, checked but the system moved since, matches, or differs. */
export function checkState(b: SuspectBin | null): { state: CheckState; diff: number } {
  if (!b || !b.check_id) return { state: "TODO", diff: 0 };
  if (b.check_stale) return { state: "STALE", diff: 0 };
  const diff = n(b.checked_qty) - n(b.system_qty);
  return { state: diff === 0 ? "OK" : "DIFF", diff };
}

/** Picklist bins first (in picklist order), then the other bins of the plan in their order. */
export function checklistRows(plan: SuspectPlan, picks: PickLine[], suspects: SuspectBin[]): ChecklistRow[] {
  const byCode = new Map(suspects.map((b) => [b.bin_code, b]));
  const codes: string[] = [];
  if (plan.mode === "MINUS_PICKLIST" || plan.mode === "MINUS_PICKLIST_PICKFACE") for (const c of plan.pickBins) if (!codes.includes(c)) codes.push(c);
  for (const b of plan.primary) if (!codes.includes(b.bin_code)) codes.push(b.bin_code);
  return codes.map((code) => {
    const bin = byCode.get(code) ?? null;
    const linePicks = picks.filter((p) => pickBin(p) === code);
    const sources: CheckSource[] = [];
    if (linePicks.length) sources.push("PICKLIST");
    if (bin?.is_pickface) sources.push("PICKFACE");
    else if (bin?.level === "A") sources.push("LEVEL_A");
    if (!sources.length) sources.push("WMS");
    return { code, bin, picks: linePicks, sources, ...checkState(bin) };
  });
}

export type ChecklistProgress = { total: number; done: number; ok: number; diff: number; stale: number; todo: number };
export function checklistProgress(rows: ChecklistRow[]): ChecklistProgress {
  const c = (s: CheckState) => rows.filter((r) => r.state === s).length;
  const ok = c("OK"), diff = c("DIFF");
  return { total: rows.length, done: ok + diff, ok, diff, stale: c("STALE"), todo: c("TODO") };
}

/** The next row still to do after `from` (wrapping round), skipping the done ones. */
export function nextUnchecked(rows: ChecklistRow[], from: string): ChecklistRow | null {
  const open = rows.filter((r) => r.state === "TODO" || r.state === "STALE");
  const i = rows.findIndex((r) => r.code === from);
  return open.find((r) => rows.indexOf(r) > i && r.code !== from) ?? open.find((r) => r.code !== from) ?? null;
}
