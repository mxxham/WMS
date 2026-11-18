import { parseLocation } from "@/lib/allocator/pickpath";

/**
 * Cek stok rak (0144): the stock of one aisle, bin by bin, for a check done on paper or on screen.
 * Pure: the page loads the rows (lib/stockcheck-data.ts), this file orders them, turns what was typed
 * into the changes `apply_rack_check` takes, and finds the mistakes before anything is sent.
 */

/** One stock line of a bin: the physical identity (bin + SKU + batch + expiry) with what is promised on it. */
export type StockLine = {
  bin_code: string; sku: string; description: string; uom: string | null;
  batch_lot: string; expiry_date: string | null; quantity: number;
  /** cartons on hold (0017) */
  held: number;
  /** cartons promised to open wave tasks, and those waves */
  reserved: number; waves: string[];
};

/** A line of the list: a stock line, or an empty bin (`line` null). */
export type CheckRow = { key: string; bin: string; line: StockLine | null };

export const lineKey = (l: Pick<StockLine, "bin_code" | "sku" | "batch_lot" | "expiry_date">) =>
  `${l.bin_code}|${l.sku}|${l.batch_lot}|${l.expiry_date ?? ""}`;

/**
 * The order of the sheet: aisle, then bay 01 → 40, then level A → E, then position. Bay 01 is on top
 * and bay 40 at the bottom, whatever the walking route is. A code that is not a rack location sorts last.
 */
export function compareBins(a: string, b: string): number {
  const pa = parseLocation(a), pb = parseLocation(b);
  if (pa && pb) {
    return pa.aisle.localeCompare(pb.aisle) || pa.bay - pb.bay || pa.level.localeCompare(pb.level) || pa.position - pb.position;
  }
  if (pa) return -1;
  if (pb) return 1;
  return a.localeCompare(b);
}

/** Lines of one bin: oldest expiry first (the one FEFO takes first), then batch. */
const inBin = (a: StockLine, b: StockLine) =>
  (a.expiry_date ?? "9999-12-31").localeCompare(b.expiry_date ?? "9999-12-31") || a.batch_lot.localeCompare(b.batch_lot) || a.sku.localeCompare(b.sku);

/**
 * Every bin in order. A bin with stock gives one row per stock line, an empty one gives one row
 * with no line (so stock found there can be added). Stock in a bin that is not in `bins` is still listed.
 */
export function buildCheckRows(bins: string[], lines: StockLine[]): CheckRow[] {
  const byBin = new Map<string, StockLine[]>();
  for (const l of lines) {
    if (!(Number(l.quantity) > 0)) continue;
    const list = byBin.get(l.bin_code);
    if (list) list.push(l); else byBin.set(l.bin_code, [l]);
  }
  const codes = [...new Set([...bins, ...byBin.keys()])].sort(compareBins);
  const rows: CheckRow[] = [];
  for (const bin of codes) {
    const mine = (byBin.get(bin) ?? []).sort(inBin);
    if (mine.length === 0) rows.push({ key: `${bin}|empty`, bin, line: null });
    else for (const line of mine) rows.push({ key: lineKey(line), bin, line });
  }
  return rows;
}

/** "CB07A02" → bay 7, for the bay separators; null for anything else. */
export const bayOf = (bin: string): number | null => parseLocation(bin)?.bay ?? null;

/** What was typed on an existing line. Base = the quantity the line had when the typing began. */
export type Edit = { sku?: string; qty?: string; batch?: string; expiry?: string; base: number };
/** A line added to a bin: stock found there that the system does not have. */
export type Added = { id: string; bin: string; sku: string; qty: string; batch: string; expiry: string };

/** One line of the `apply_rack_check` payload. */
export type PayloadLine = {
  bin_code: string; sku: string; add: boolean;
  batch_lot?: string; expiry_date?: string | null; expected_qty?: number;
  new_batch: string; new_expiry: string | null; new_qty: number;
};

export type Change = {
  row: string; bin: string; description: string; add: boolean;
  /** The SKU the line ends as (the physical one). */
  sku: string;
  /** Set when the SKU on the shelf differs from the system's: the system's SKU. */
  fromSku: string | null;
  from: { qty: number; batch: string; expiry: string | null } | null;
  to: { qty: number; batch: string; expiry: string | null };
  /** The line sent. For a SKU swap this empties the system's SKU; `extra` then adds the physical one. */
  payload: PayloadLine;
  extra?: PayloadLine;
};
/** A change as the report keeps it: what the system held and what the shelf showed, without the lines sent. */
export type ChangeView = Omit<Change, "payload" | "extra">;
/** Every line of the `apply_rack_check` payload for these changes (a SKU swap is two lines in the same save). */
export const payloadOf = (changes: Change[]): PayloadLine[] => changes.flatMap((c) => (c.extra ? [c.payload, c.extra] : [c.payload]));
export type Problem = { row: string; bin: string; text: string };

export const normBatch = (s: string) => s.trim().toUpperCase();
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** 2-Nov-30 typed in Excel is stored as 1930 (AGENTS.md): a year outside this is a typing mistake. */
export const expiryPlausible = (iso: string) => YMD.test(iso) && iso >= "2000-01-01" && iso <= "2099-12-31";
const wholeNumber = (s: string) => /^\d{1,7}$/.test(s.trim());

/** Which lines of the list changed, from what was typed: the changes to send and the problems to fix first. */
export function changesOf(
  rows: CheckRow[], edits: Record<string, Edit>, added: Added[], skus: Map<string, string>,
): { changes: Change[]; problems: Problem[]; stale: string[] } {
  const changes: Change[] = [];
  const problems: Problem[] = [];
  const stale: string[] = [];

  for (const r of rows) {
    const l = r.line, e = edits[r.key];
    if (!l || !e) continue;
    if (e.base !== Number(l.quantity)) { stale.push(r.key); continue; }
    const qty = e.qty === undefined ? Number(l.quantity) : e.qty.trim() === "" ? NaN : wholeNumber(e.qty) ? Number(e.qty) : NaN;
    const batch = e.batch === undefined ? l.batch_lot : normBatch(e.batch);
    const expiry = e.expiry === undefined ? l.expiry_date : e.expiry === "" ? null : e.expiry;
    const sku = e.sku === undefined ? l.sku : e.sku.trim();
    const swap = sku !== l.sku;
    if (Number.isNaN(qty)) { problems.push({ row: r.key, bin: r.bin, text: `${r.bin}: jumlah harus bilangan bulat 0 atau lebih` }); continue; }
    if (l.expiry_date && !expiry) { problems.push({ row: r.key, bin: r.bin, text: `${r.bin}: tanggal expired tidak boleh dikosongkan` }); continue; }
    if (expiry && !expiryPlausible(expiry)) { problems.push({ row: r.key, bin: r.bin, text: `${r.bin}: tanggal expired ${expiry} tidak masuk akal` }); continue; }
    const from = { qty: Number(l.quantity), batch: l.batch_lot, expiry: l.expiry_date };
    if (swap) {
      const desc = skus.get(sku);
      if (desc === undefined) { problems.push({ row: r.key, bin: r.bin, text: `${r.bin}: SKU ${sku || "kosong"} tidak ada di master item` }); continue; }
      if (qty <= 0) { problems.push({ row: r.key, bin: r.bin, text: `${r.bin}: jumlah SKU fisik harus di atas 0 (untuk mengosongkan bin, kembalikan SKU lalu isi jumlah 0)` }); continue; }
      if (!expiry) { problems.push({ row: r.key, bin: r.bin, text: `${r.bin}: tanggal expired SKU fisik wajib diisi` }); continue; }
      changes.push({
        row: r.key, bin: r.bin, sku, fromSku: l.sku, description: desc, add: false, from, to: { qty, batch, expiry },
        // The system's SKU is emptied and the physical one added, in the same all-or-none save.
        payload: { bin_code: l.bin_code, sku: l.sku, add: false, batch_lot: l.batch_lot, expiry_date: l.expiry_date, expected_qty: from.qty,
          new_batch: l.batch_lot, new_expiry: l.expiry_date, new_qty: 0 },
        extra: { bin_code: l.bin_code, sku, add: true, new_batch: batch, new_expiry: expiry, new_qty: qty },
      });
      continue;
    }
    if (qty === from.qty && batch === l.batch_lot && expiry === l.expiry_date) continue;
    changes.push({
      row: r.key, bin: r.bin, sku: l.sku, fromSku: null, description: l.description, add: false, from, to: { qty, batch, expiry },
      payload: { bin_code: l.bin_code, sku: l.sku, add: false, batch_lot: l.batch_lot, expiry_date: l.expiry_date, expected_qty: from.qty,
        new_batch: batch, new_expiry: expiry, new_qty: qty },
    });
  }

  for (const a of added) {
    const sku = a.sku.trim();
    const blank = !sku && !a.qty.trim() && !a.batch.trim() && !a.expiry;
    if (blank) continue;
    const tag = `${a.bin} (tambah)`;
    const desc = skus.get(sku);
    if (!sku || desc === undefined) { problems.push({ row: a.id, bin: a.bin, text: `${tag}: SKU ${sku || "kosong"} tidak ada di master item` }); continue; }
    if (!wholeNumber(a.qty) || Number(a.qty) <= 0) { problems.push({ row: a.id, bin: a.bin, text: `${tag}: jumlah harus bilangan bulat di atas 0` }); continue; }
    if (!a.expiry || !expiryPlausible(a.expiry)) { problems.push({ row: a.id, bin: a.bin, text: `${tag}: tanggal expired wajib diisi dan harus masuk akal` }); continue; }
    const batch = normBatch(a.batch);
    changes.push({
      row: a.id, bin: a.bin, sku, fromSku: null, description: desc, add: true, from: null, to: { qty: Number(a.qty), batch, expiry: a.expiry },
      payload: { bin_code: a.bin, sku, add: true, new_batch: batch, new_expiry: a.expiry, new_qty: Number(a.qty) },
    });
  }
  return { changes, problems, stale };
}

/**
 * Bins that would hold more than one SKU once the changes are applied (the rule is one bin, one SKU),
 * with the SKUs. `onlyNew`: only bins that did not already.
 */
export function multiSkuBins(rows: CheckRow[], changes: Change[], onlyNew = false): { bin: string; skus: string[] }[] {
  const now = new Map<string, Map<string, number>>();
  const before = new Map<string, Set<string>>();
  const put = (m: Map<string, Map<string, number>>, bin: string, sku: string, qty: number) => {
    const s = m.get(bin) ?? new Map<string, number>();
    s.set(sku, (s.get(sku) ?? 0) + qty); m.set(bin, s);
  };
  const changed = new Map(changes.filter((c) => !c.add).map((c) => [c.row, c]));
  for (const r of rows) {
    if (!r.line) continue;
    const b = before.get(r.bin) ?? new Set<string>(); b.add(r.line.sku); before.set(r.bin, b);
    const c = changed.get(r.key);
    if (c && c.fromSku) { put(now, r.bin, r.line.sku, 0); put(now, r.bin, c.sku, c.to.qty); continue; }
    put(now, r.bin, r.line.sku, c?.to.qty ?? Number(r.line.quantity));
  }
  for (const c of changes) if (c.add) put(now, c.bin, c.sku, c.to.qty);
  const out: { bin: string; skus: string[] }[] = [];
  for (const [bin, m] of now) {
    const skus = [...m].filter(([, q]) => q > 0).map(([s]) => s).sort();
    if (skus.length > 1 && (!onlyNew || (before.get(bin)?.size ?? 0) <= 1)) out.push({ bin, skus });
  }
  return out.sort((a, b) => compareBins(a.bin, b.bin));
}

/** One change in the confirmation's words: "CB01A01 · 550044709 — qty 48 → 46, batch A → B". */
export function describeChange(c: Change): string {
  const head = `${c.bin} · ${c.fromSku ?? c.sku}`;
  if (c.add || !c.from) return `${head} — tambah ${c.to.qty}${c.to.batch ? `, batch ${c.to.batch}` : ""}, exp ${c.to.expiry}`;
  const parts: string[] = [];
  if (c.fromSku) { parts.push(`SKU ${c.fromSku} → ${c.sku}`); parts.push(`qty ${c.from.qty} → ${c.to.qty}`); }
  else if (c.from.qty !== c.to.qty) parts.push(`qty ${c.from.qty} → ${c.to.qty}`);
  if (c.from.batch !== c.to.batch) parts.push(`batch ${c.from.batch || "–"} → ${c.to.batch || "–"}`);
  if (c.from.expiry !== c.to.expiry) parts.push(`exp ${c.from.expiry ?? "–"} → ${c.to.expiry ?? "–"}`);
  return `${head} — ${parts.join(", ")}`;
}

/** The aisle code of a bin: CB07A02 → CB. */
export const aisleOfBin = (bin: string) => bin.slice(0, 2).toUpperCase();

/** One field of a line that differs between what the system holds and what the shelf shows. */
export type FieldDiff = { label: string; from: string; to: string };

/** Before → after of one change, only the fields that differ (SKU, quantity, batch, expiry). */
export function diffOf(c: ChangeView): FieldDiff[] {
  if (c.add || !c.from) {
    return [{ label: "SKU", from: "–", to: c.sku }, { label: "Qty", from: "0", to: String(c.to.qty) },
      { label: "Batch", from: "–", to: c.to.batch || "–" }, { label: "Exp", from: "–", to: c.to.expiry ?? "–" }];
  }
  const out: FieldDiff[] = [];
  if (c.fromSku) out.push({ label: "SKU", from: c.fromSku, to: c.sku });
  if (c.from.qty !== c.to.qty) out.push({ label: "Qty", from: String(c.from.qty), to: String(c.to.qty) });
  if (c.from.batch !== c.to.batch) out.push({ label: "Batch", from: c.from.batch || "–", to: c.to.batch || "–" });
  if (c.from.expiry !== c.to.expiry) out.push({ label: "Exp", from: c.from.expiry ?? "–", to: c.to.expiry ?? "–" });
  return out;
}

/** Cartons gained (+) or lost (−) on the shelf by one change; for a SKU swap, the physical difference. */
export const cartonDelta = (c: ChangeView): number => c.to.qty - (c.from?.qty ?? 0);

export type SkuTotal = { sku: string; description: string; before: number; after: number; diff: number };
export type Summary = {
  bins: number;
  /** cartons the system holds in the aisle / the aisle once the changes are booked */
  before: number; after: number;
  /** cartons found over the system's figure / missing against it (a SKU swap counts its physical difference) */
  plus: number; minus: number;
  counts: { qty: number; identity: number; swap: number; found: number };
  /** the SKUs the changes touch, with the aisle's cartons of each before and after */
  skus: SkuTotal[];
};

/** Stock of the aisle before and after the changes, in total and for each SKU they touch. */
export function summarize(rows: CheckRow[], changes: Change[], skuNames: Map<string, string>): Summary {
  let before = 0;
  const per = new Map<string, { before: number; delta: number; description: string }>();
  const slot = (sku: string, description: string) => {
    const p = per.get(sku) ?? { before: 0, delta: 0, description };
    per.set(sku, p);
    return p;
  };
  const touched = new Set(changes.flatMap((c) => [c.sku, ...(c.fromSku ? [c.fromSku] : [])]));
  for (const r of rows) {
    if (!r.line) continue;
    before += Number(r.line.quantity);
    if (touched.has(r.line.sku)) slot(r.line.sku, r.line.description).before += Number(r.line.quantity);
  }
  let plus = 0, minus = 0;
  const counts = { qty: 0, identity: 0, swap: 0, found: 0 };
  for (const c of changes) {
    const d = cartonDelta(c);
    if (d > 0) plus += d; else minus -= d;
    if (c.add) counts.found++;
    else if (c.fromSku) counts.swap++;
    else {
      if (c.from!.qty !== c.to.qty) counts.qty++;
      if (c.from!.batch !== c.to.batch || c.from!.expiry !== c.to.expiry) counts.identity++;
    }
    if (c.fromSku) {
      slot(c.fromSku, skuNames.get(c.fromSku) ?? c.fromSku).delta -= c.from!.qty;
      slot(c.sku, c.description).delta += c.to.qty;
    } else slot(c.sku, c.description).delta += d;
  }
  const skus = [...per].map(([sku, p]) => ({ sku, description: p.description, before: p.before, after: p.before + p.delta, diff: p.delta }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
  return { bins: new Set(changes.map((c) => c.bin)).size, before, after: before + plus - minus, plus, minus, counts, skus };
}

/** What the page sends with a save (`p_report`): kept for good in `rack_check_reports` (0145). */
export type ReportPayload = { summary: Summary; changes: ChangeView[] };
export const reportPayload = (summary: Summary, changes: Change[]): ReportPayload => ({
  summary, changes: changes.map(({ payload: _p, extra: _e, ...view }) => view),
});

/** One row of `rack_check_reports`. `report` is `{}` for a save made without the page's summary. */
export type RackCheckReport = {
  id: number; aisle: string; created_at: string; by_name: string; reason_code: string;
  lines: number; added: number; movements: number;
  /** cartons of the aisle, measured by the database just before and just after the save */
  aisle_before: number; aisle_after: number;
  warnings: { bin_code: string; sku: string; qty: number; reserved: number; waves: string }[];
  report: Partial<ReportPayload>;
};
