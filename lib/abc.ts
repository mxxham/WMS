/**
 * Kelas ABC (0126): everything the page computes from a stored run, pure so it is tested without a database.
 * A run ranks every SKU by picking lines; A = the SKUs making the first `a` % of lines, B = up to `b` %,
 * C = the rest and every SKU not picked. The SKU that crosses a limit belongs to the class below the limit
 * (the database's abc_compute uses the same rule: share of lines BEFORE the SKU < limit).
 */
export type AbcClass = "A" | "B" | "C";
export const CLASSES: AbcClass[] = ["A", "B", "C"];

export type AbcRun = {
  id: string; period_from: string; period_to: string; a_pct: number; b_pct: number; source: "AUTO" | "MANUAL";
  total_lines: number; total_cartons: number; sku_count: number; created_at: string; created_by_name: string;
  applied_at: string | null; applied_by_name: string | null;
};

export type AbcItem = {
  item_id: string; sku: string; description: string | null; class: AbcClass; prev_class: string | null;
  rank: number; pick_lines: number; cartons: number; pick_days: number; share: number; cum_share: number;
};

/** A run's SKU with what the warehouse holds now. */
export type AbcRow = AbcItem & {
  stock: number;          // cartons on hand now, all bins
  bins: number;           // bins holding it now
  racks: number;          // racks (aisle + bay) holding it now
  pickface: string | null;
  pack: string | null;
  /** classes in earlier runs, newest first (null = not in that run) */
  history: (AbcClass | null)[];
};

export type Change = "up" | "down" | "same" | "new";
const ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };

/** Compared with the class before the run: up = moved towards A. */
export function changeOf(prev: string | null, now: AbcClass): Change {
  if (!prev || !(prev in ORDER)) return "new";
  return ORDER[now] < ORDER[prev] ? "up" : ORDER[now] > ORDER[prev] ? "down" : "same";
}

/** Inclusive days of a period ("2026-10-01".."2026-10-31" = 31). */
export function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Days the stock on hand lasts at the period's pick rate; null when it was not picked. */
export function coverDays(stock: number, cartons: number, days: number): number | null {
  if (cartons <= 0 || days <= 0) return null;
  return stock / (cartons / days);
}

/**
 * Classes for other limits, from the same ranking: the "what if" of the page. `rows` in rank order.
 * Mirrors abc_compute: a SKU with no picks is always C.
 */
export function classify<T extends { pick_lines: number }>(rows: T[], aPct: number, bPct: number): AbcClass[] {
  const total = rows.reduce((n, r) => n + r.pick_lines, 0);
  let before = 0;
  return rows.map((r) => {
    const pct = total ? (before / total) * 100 : 100;
    before += r.pick_lines;
    if (r.pick_lines === 0) return "C";
    return pct < aPct ? "A" : pct < bPct ? "B" : "C";
  });
}

export type ClassSummary = { cls: AbcClass; skus: number; lines: number; cartons: number; linesPct: number; cartonsPct: number; skuPct: number };

export function summarize(rows: { class: AbcClass; pick_lines: number; cartons: number }[]): ClassSummary[] {
  const lines = rows.reduce((n, r) => n + r.pick_lines, 0), cartons = rows.reduce((n, r) => n + Number(r.cartons), 0);
  return CLASSES.map((cls) => {
    const of = rows.filter((r) => r.class === cls);
    const l = of.reduce((n, r) => n + r.pick_lines, 0), c = of.reduce((n, r) => n + Number(r.cartons), 0);
    return { cls, skus: of.length, lines: l, cartons: c, linesPct: lines ? (l / lines) * 100 : 0, cartonsPct: cartons ? (c / cartons) * 100 : 0,
      skuPct: rows.length ? (of.length / rows.length) * 100 : 0 };
  });
}

/** prev class -> new class -> SKUs. "–" = had no class. */
export function changeMatrix(rows: { prev_class: string | null; class: AbcClass }[]): Record<string, Record<AbcClass, number>> {
  const m: Record<string, Record<AbcClass, number>> = {};
  for (const from of [...CLASSES, "–"]) m[from] = { A: 0, B: 0, C: 0 };
  for (const r of rows) m[r.prev_class && r.prev_class in ORDER ? r.prev_class : "–"][r.class]++;
  return m;
}

/** The Pareto curve: after k SKUs (in rank order), the share of all lines. Starts at (0, 0). */
export function paretoPoints(rows: { pick_lines: number }[]): { x: number; y: number }[] {
  const total = rows.reduce((n, r) => n + r.pick_lines, 0);
  const pts = [{ x: 0, y: 0 }];
  let cum = 0;
  rows.forEach((r, i) => { cum += r.pick_lines; pts.push({ x: (i + 1) / rows.length, y: total ? cum / total : 0 }); });
  return pts;
}

/** Rack of a rack bin code (CB04B02 -> CB04); null for staging / floor locations. */
export function rackOf(bin: string): string | null {
  const m = /^(C[A-Z]\d{2})[A-E]\d{2}$/.exec(bin.trim().toUpperCase());
  return m ? m[1] : null;
}

export type Suggestion = { key: string; title: string; why: string; skus: string[] };

/**
 * What the run asks the team to look at. Each list is a few clicks of work, not a report:
 * - A without a pickface: the busiest SKUs walked to from reserve every time;
 * - new in A: moved up since the last class, check its pickface is near and big enough;
 * - spread: stock in 3+ racks, the auditor and pickers walk between them (putaway now groups new pallets);
 * - stock that did not move: on hand, not picked in the period;
 * - C with a pickface: a pickface slot a faster SKU could use.
 */
export function suggestions(rows: AbcRow[]): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (key: string, title: string, why: string, list: AbcRow[]) => { if (list.length) out.push({ key, title, why, skus: list.map((r) => r.sku) }); };
  add("a-no-pickface", "Kelas A tanpa pickface", "SKU paling sering dipick tapi tidak punya pickface: setiap pick diambil dari rak cadangan.",
    rows.filter((r) => r.class === "A" && !r.pickface && r.stock > 0));
  add("new-a", "Naik ke kelas A", "Sekarang termasuk yang paling sering dipick: cek pickface-nya dekat dan cukup besar.",
    rows.filter((r) => r.class === "A" && changeOf(r.prev_class, r.class) === "up"));
  add("spread", "Tersebar di 3 rak atau lebih", "Picker dan auditor berjalan antar rak untuk satu SKU. Pertimbangkan Bin To Bin agar satu tempat.",
    rows.filter((r) => r.racks >= 3).sort((a, b) => b.racks - a.racks));
  add("no-move", "Ada stok, tidak dipick", "Stok di gudang tapi tidak ada picking di periode ini: cek expired dan laporkan ke Shell bila perlu.",
    rows.filter((r) => r.pick_lines === 0 && r.stock > 0).sort((a, b) => b.stock - a.stock));
  add("c-pickface", "Kelas C dengan pickface", "Jarang dipick tapi memakai slot pickface yang bisa dipakai SKU yang lebih cepat.",
    rows.filter((r) => r.class === "C" && r.pickface));
  return out;
}

/** `prev`: the class before the run ("–" = none), set by a click on the change matrix. */
export type Filters = { cls: "" | AbcClass; change: "" | Change; prev?: string; pack: string; q: string; stockOnly: boolean };

export function filterRows(rows: AbcRow[], f: Filters): AbcRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => (!f.cls || r.class === f.cls)
    && (!f.change || changeOf(r.prev_class, r.class) === f.change)
    && (!f.prev || (r.prev_class && r.prev_class in ORDER ? r.prev_class : "–") === f.prev)
    && (!f.pack || (r.pack ?? "–") === f.pack)
    && (!f.stockOnly || r.stock > 0)
    && (!q || r.sku.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q)));
}

/** Last calendar month in Jakarta, for the manual-run form's default. */
export function lastMonth(today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(first.getTime() - 86_400_000);
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
/** "Oktober 2026" for a whole calendar month, else "01-10-2026 s/d 15-10-2026". */
export function periodLabel(from: string, to: string): string {
  const whole = from.endsWith("-01") && lastMonth(nextDay(to)).from === from && lastMonth(nextDay(to)).to === to;
  if (whole) return `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  return `${dmy(from)} s/d ${dmy(to)}`;
}
function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
