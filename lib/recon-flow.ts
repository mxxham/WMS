/**
 * What an investigation tells the person at each point (Investigasi selisih): the next thing to do, what each way
 * of closing the gap would leave, and one history of everything done for the SKU. Pure functions; the page words them.
 */
import { shortLines, type MiaEvent } from "@/lib/mia";
import type { ChecklistProgress } from "@/lib/recon-suspect-plan";
import type { FixPlan, FixRow } from "@/lib/recon-investigate";

const n = (v: unknown) => Number(v ?? 0) || 0;

export type NextAction = { step: 1 | 2 | 3 | null; tone: "todo" | "work" | "done" | "info"; text: string };

/** The one line under the summary bar: what to do now. */
export function nextAction(a: { gap: number; progress: ChecklistProgress; planWork: number; blockers: number; editable: boolean }): NextAction {
  if (!a.editable) return { step: null, tone: "info", text: "Rekonsiliasi ini sudah ditutup: hanya bisa dilihat." };
  const left = a.progress.todo + a.progress.stale;
  if (left > 0) return { step: 1, tone: "todo", text: `${left} bin belum dicek di daftar cek (langkah 1).` };
  if (a.planWork > 0) {
    return a.blockers > 0
      ? { step: 3, tone: "work", text: "Ada koreksi siap, tetapi ada yang menghalangi (wave atau hold): lihat langkah 3." }
      : { step: 3, tone: "work", text: "Hasil cek sudah ada koreksi yang siap diterapkan: lihat langkah 3." };
  }
  if (a.gap === 0) return { step: null, tone: "done", text: "Selisih sudah habis. Tidak ada yang perlu dikerjakan lagi untuk SKU ini." };
  if (a.gap < 0) return { step: 2, tone: "todo", text: "Semua bin di daftar sudah dicek dan belum ketemu: cek semua bin (langkah 2), atau catat ke MIA di langkah 3." };
  return { step: 2, tone: "todo", text: "Semua bin di daftar cocok tetapi WMS masih lebih dari SAP: cek semua bin (langkah 2), atau selesaikan dengan adjustment / MIA di langkah 3." };
}

export type ResolutionOption = {
  key: "ADJUST" | "MIA_MOVE" | "MIA_BOOK";
  title: string;
  /** the gap against SAP (WMS - SAP) after this option; null when the option does not apply yet */
  gapAfter: number | null;
  /** the change of WMS stock on the shelves */
  wmsChange: number;
  text: string;
};

/**
 * What each way of closing the gap would leave, from the checks made so far:
 *  - adjustment: the plan's own gap_after (transfers keep the total, the rest is adjusted);
 *  - MIA, stock the system has but the floor does not show: it moves out of the counted stock, so the gap shrinks by it;
 *  - MIA, SAP has more and nobody found it: booked outside our side, the gap stays and is explained by MIA.
 */
export function resolutionOptions(a: { gap: number; plan: FixPlan | null }): ResolutionOption[] {
  const out: ResolutionOption[] = [];
  const plan = a.plan;
  const work = plan ? plan.transfers.length + plan.adjustments.length : 0;
  out.push({
    key: "ADJUST", title: "Adjustment langsung", gapAfter: work > 0 && plan ? n(plan.gap_after) : null, wmsChange: plan ? n(plan.net_adjust) : 0,
    text: work > 0 ? "Stok WMS dikoreksi sesuai hasil cek (Bin To Bin untuk yang salah lokasi, adjustment untuk sisanya)." : "Belum ada hasil cek yang menghasilkan koreksi.",
  });
  const parked = plan ? plan.checks.reduce((t, c) => t + shortLines(c.system_lines, c.lines).reduce((s, l) => s + n(l.quantity), 0), 0) : 0;
  out.push({
    key: "MIA_MOVE", title: "Pindahkan ke MIA", gapAfter: parked > 0 ? a.gap - parked : null, wmsChange: -parked,
    text: parked > 0 ? `${parked} karton yang tercatat di bin tetapi tidak ada dipindah ke MIA: keluar dari stok WMS, bisa dicari lagi atau dihapus setelah SAP memposting.`
      : "Belum ada bin yang dicek dan stoknya kurang dari sistem.",
  });
  if (a.gap < 0) {
    out.push({
      key: "MIA_BOOK", title: "Catat ke MIA (belum ketemu)", gapAfter: a.gap, wmsChange: 0,
      text: `SAP punya ${-a.gap} karton lebih banyak. Dicatat ke MIA agar kelihatan: selisih tetap ${a.gap}, tetapi baris ini jadi "Dijelaskan: MIA".`,
    });
  }
  return out;
}

/** One history of everything done for a SKU in this reconciliation, newest first. */
export type TimelineEntry = { at: string; kind: "CHECK" | "FIX" | "MIA"; title: string; detail: string; who: string };

export type CheckRecord = { id: string; checked_at: string; checked_name: string; counted_qty: number; note: string | null; bins: { bin_code: string } | null };

export function buildTimeline(a: { checks: CheckRecord[]; fixes: FixRow[]; mia: MiaEvent[] }, miaLabel: (k: MiaEvent["kind"]) => string): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const c of a.checks) {
    out.push({ at: c.checked_at, kind: "CHECK", who: c.checked_name, title: `Cek bin ${c.bins?.bin_code ?? "?"}`,
      detail: `${n(c.counted_qty) === 0 ? "kosong (0 karton)" : `${n(c.counted_qty)} karton`}${c.note ? ` · ${c.note}` : ""}` });
  }
  for (const f of a.fixes) {
    const parts = [n(f.transfer_qty) > 0 ? `Bin To Bin ${n(f.transfer_qty)}` : "", n(f.adjust_abs) > 0 ? `adjustment ${n(f.net_adjust) > 0 ? "+" : ""}${n(f.net_adjust)}` : ""].filter(Boolean);
    out.push({ at: f.applied_at, kind: "FIX", who: f.applied_name, title: "Koreksi diterapkan", detail: `${parts.join(" · ")}${f.note ? ` · ${f.note}` : ""}` });
  }
  for (const m of a.mia) {
    out.push({ at: m.created_at, kind: "MIA", who: m.by_name, title: `MIA: ${miaLabel(m.kind)}`,
      detail: `${n(m.quantity)} karton${m.bin_code ? ` · ${m.bin_code}` : ""}${m.batch_lot ? ` · batch ${m.batch_lot}` : ""} · ${m.note}` });
  }
  return out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}

/** Rows of the printable check sheet: the bins to walk, in route order, with blank columns to write the count. */
export type SheetRow = { bin: string; source: string; system: string };
export function sheetHtml(sku: string, description: string | null, asOf: string, gap: number, rows: SheetRow[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const body = rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td><b>${esc(r.bin)}</b></td><td>${esc(r.source)}</td><td>${esc(r.system)}</td><td class="w"></td><td class="w"></td><td class="w"></td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Lembar cek ${esc(sku)}</title><style>
@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:12px}h1{font-size:16px;margin:0 0 4px}p{margin:0 0 8px;color:#444}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #333;padding:6px;text-align:left;vertical-align:middle}th{background:#eee}
.c{width:28px;text-align:center}.w{width:110px;height:30px}thead{display:table-header-group}tr{page-break-inside:avoid}</style></head><body>
<h1>Lembar cek bin · SKU ${esc(sku)}</h1><p>${esc(description ?? "")} · Rekonsiliasi per ${esc(asOf)} · selisih WMS − SAP ${gap > 0 ? "+" : ""}${gap}</p>
<table><thead><tr><th class="c">#</th><th>Bin</th><th>Dari</th><th>Sistem</th><th class="w">Fisik (karton)</th><th class="w">Batch / expired</th><th class="w">Paraf</th></tr></thead><tbody>${body}</tbody></table>
</body></html>`;
}
