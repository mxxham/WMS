/**
 * Investigasi selisih (migration 0129): find the stock behind a SAP vs WMS
 * difference and correct today's on hand. The database scores the bins and
 * builds the fix (recon_suspect_bins, recon_fix_plan); this file words the
 * results for the page and checks what a person types before it is sent.
 */
import { fmtDate, fmtNum } from "@/lib/utils";

export type SuspectReason =
  | "CURRENT" | "WMS_MORE" | "EMPTIED" | "IMPORT_ZERO" | "QTY_MATCH" | "STOCK_MATCH"
  | "RECENT_3" | "RECENT_14" | "RECENT_60" | "PICKFACE" | "STAGING" | "QUARANTINE" | "NEIGHBOUR" | "OTHER_SKU";

export type StockLine = { batch_lot: string; expiry_date: string | null; quantity: number };

/** One row of recon_suspect_bins. */
export type SuspectBin = {
  bin_id: string; bin_code: string; zone: string; rack: string | null; level: string | null; bin_position: string | null; bin_status: string;
  kind: "CURRENT" | "HISTORY" | "PICKFACE" | "STAGING" | "NEIGHBOUR" | "OTHER";
  system_qty: number; system_lines: StockLine[]; other_skus: string[] | null; is_pickface: boolean;
  moves: number; first_seen: string | null; last_move_at: string | null; last_move_type: string | null; last_move_qty: number | null; last_move_note: string | null;
  last_full: number | null; emptied_at: string | null; emptied_by_import: boolean; neighbour_of: string | null;
  score: number; reasons: SuspectReason[];
  check_id: string | null; checked_at: string | null; checked_name: string | null; checked_qty: number | null; check_lines: StockLine[] | null; check_stale: boolean;
};

export type PlanMove = { from_bin: string; to_bin: string; batch_lot: string; expiry_date: string | null; quantity: number; checked_name: string };
export type PlanAdjust = { bin_code: string; batch_lot: string; expiry_date: string | null; quantity: number; checked_name: string };
export type PlanCheck = {
  check_id: string; bin_code: string; checked_name: string; checked_at: string; counted: number; system: number;
  lines: StockLine[]; system_lines: StockLine[];
};

/** recon_fix_plan. */
export type FixPlan = {
  checks: PlanCheck[]; stale: { check_id: string; bin_code: string; checked_name: string; checked_at: string }[];
  check_ids: string[]; checkers: string[];
  transfers: PlanMove[]; adjustments: PlanAdjust[]; blockers: string[];
  transfer_qty: number; net_adjust: number; adjust_abs: number; limit: number; needs_other_person: boolean;
  gap_before: number; gap_after: number; last_fix_at: string | null;
};

/** recon_fixes row, for the history under the plan. */
export type FixRow = {
  id: string; applied_at: string; applied_name: string; checker_names: string[]; transfer_qty: number; net_adjust: number;
  adjust_abs: number; cause: string | null; note: string | null; plan: FixPlan;
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const daysAgo = (d: string | null, asOf: string) => {
  if (!d) return null;
  const ms = new Date(`${asOf}T23:59:59+07:00`).getTime() - new Date(d).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
};

/** The clue, in words a supervisor reads on the floor. */
export function reasonLabel(r: SuspectReason, b: SuspectBin, gap: number, asOf: string): string {
  switch (r) {
    case "CURRENT": return `WMS: ${fmtNum(n(b.system_qty))} di sini`;
    case "WMS_MORE": return "WMS lebih dari SAP: pastikan barangnya benar ada";
    case "EMPTIED": return b.emptied_at ? `Kosong di sistem sejak ${fmtDate(b.emptied_at)}` : "Pernah berisi, sekarang kosong di sistem";
    case "IMPORT_ZERO": return "Dinolkan impor pagi (not in file)";
    case "QTY_MATCH": return `Terakhir berisi ${fmtNum(n(b.last_full) || Math.abs(n(b.last_move_qty)))} = selisih`;
    case "STOCK_MATCH": return `Stok WMS ${fmtNum(n(b.system_qty))} = selisih ${fmtNum(Math.abs(gap))}`;
    case "RECENT_3": case "RECENT_14": case "RECENT_60": {
      const d = daysAgo(b.last_move_at, asOf);
      return d === null ? "Ada mutasi baru-baru ini" : d === 0 ? "Ada mutasi di hari itu / sesudahnya" : `Mutasi ${d} hari sebelum tanggal SAP`;
    }
    case "PICKFACE": return "Pickface SKU ini";
    case "STAGING": return "Area staging";
    case "QUARANTINE": return "Karantina";
    case "NEIGHBOUR": return b.neighbour_of ? `Sebelah ${b.neighbour_of}` : "Bin sebelah";
    case "OTHER_SKU": return `Sistem: berisi ${(b.other_skus ?? []).slice(0, 2).join(", ")}`;
  }
}

/** Strong clues are worth a walk first. */
export const STRONG: SuspectReason[] = ["QTY_MATCH", "STOCK_MATCH", "IMPORT_ZERO"];

export const KIND_LABEL: Record<SuspectBin["kind"], string> = {
  CURRENT: "Ada di WMS", HISTORY: "Pernah berisi", PICKFACE: "Pickface", STAGING: "Staging", NEIGHBOUR: "Sebelah", OTHER: "Dicek manual",
};

/** The first bins to walk to: every strong clue, then the best scores, at most `max`. */
export function topSuspects(rows: SuspectBin[], max = 8): SuspectBin[] {
  const strong = rows.filter((r) => r.reasons.some((x) => STRONG.includes(x)));
  const rest = rows.filter((r) => !strong.includes(r) && r.score >= 25);
  return [...strong, ...rest].slice(0, Math.max(max, strong.length));
}

/** "48 karton" when the difference is whole pallets of this SKU. */
export function palletHint(gap: number, upp: number | null | undefined): string | null {
  const g = Math.abs(gap), u = n(upp);
  if (!g || u <= 1) return null;
  if (g % u === 0) return g === u ? `Selisih = tepat 1 palet penuh (${fmtNum(u)} karton/palet).` : `Selisih = tepat ${fmtNum(g / u)} palet penuh (${fmtNum(u)} karton/palet).`;
  return null;
}

/** "48 · B48 · exp 01-05-2030", or "kosong". */
export function linesText(lines: StockLine[] | null | undefined): string {
  const ls = (lines ?? []).filter((l) => n(l.quantity) !== 0);
  if (!ls.length) return "kosong";
  return ls.map((l) => `${fmtNum(n(l.quantity))}${l.batch_lot ? ` · ${l.batch_lot}` : ""}${l.expiry_date ? ` · exp ${fmtDate(l.expiry_date)}` : ""}`).join("; ");
}
export const linesQty = (lines: StockLine[] | null | undefined) => (lines ?? []).reduce((s, l) => s + n(l.quantity), 0);

/** A row of the check form, as typed. */
export type DraftLine = { batch_lot: string; expiry_date: string; quantity: string };

/**
 * Checks the typed lines before they go to recon_check_bin. Returns the lines
 * to send, or the message to show. Empty rows and rows of 0 are ignored (a pre-filled
 * batch that is not there); no row left = "kosong".
 * `known` = the batch + expiry identities this bin already has (no expiry needed for those).
 */
export function checkDraft(draft: DraftLine[], known: StockLine[]): { lines: StockLine[] } | { error: string } {
  const out: StockLine[] = [];
  for (const d of draft) {
    const qtyText = d.quantity.trim();
    if (!qtyText && !d.batch_lot.trim() && !d.expiry_date) continue;
    const q = Number(qtyText.replace(",", "."));
    if (qtyText && q === 0) continue;
    if (!qtyText || !Number.isFinite(q) || q < 0) return { error: "Isi jumlah karton (0 jika batch ini tidak ada), atau hapus barisnya." };
    if (!Number.isInteger(q)) return { error: "Jumlah karton harus bilangan bulat." };
    const batch = d.batch_lot.trim().toUpperCase();
    const exp = d.expiry_date || null;
    const isKnown = known.some((k) => k.batch_lot.toUpperCase() === batch && (k.expiry_date ?? null) === exp);
    if (!exp && !isKnown) return { error: `Isi tanggal expired untuk batch ${batch || "–"} (dari label karton).` };
    out.push({ batch_lot: batch, expiry_date: exp, quantity: q });
  }
  return { lines: out };
}

/** The confirmation sentence for applying a plan. */
export function planSentence(p: FixPlan, sku: string): string {
  const parts: string[] = [];
  for (const t of p.transfers) parts.push(`pindah ${fmtNum(n(t.quantity))} karton ${t.from_bin} → ${t.to_bin}`);
  for (const a of p.adjustments) parts.push(`${n(a.quantity) > 0 ? "tambah" : "kurangi"} ${fmtNum(Math.abs(n(a.quantity)))} karton di ${a.bin_code}`);
  const after = n(p.gap_after);
  return `SKU ${sku}: ${parts.join(", ")}. Stok WMS hari ini berubah ${n(p.net_adjust) > 0 ? "+" : ""}${fmtNum(n(p.net_adjust))}; `
    + (after === 0 ? "selisih dengan SAP menjadi 0." : `sisa selisih dengan SAP ${after > 0 ? "+" : ""}${fmtNum(after)}.`);
}

/** Reason codes allowed for the two sides of a fix (mirrors recon_apply_fix). */
export const PLUS_REASONS = ["FOUND", "COUNT_VARIANCE", "DATA_ENTRY", "RECEIVING_DIFF", "RETURN", "MISPICK", "OTHER"] as const;
export const MINUS_REASONS = ["LOST", "COUNT_VARIANCE", "DATA_ENTRY", "DAMAGED", "MISPICK", "RECEIVING_DIFF", "OTHER"] as const;
