/**
 * Lacak batch → "Daftar batch per SKU": the answer to a principal's request
 * "send the batch number, production date and expiry date of these products".
 * The request (an e-mail table or a plain list of material numbers) is pasted
 * as it is; every batch on hand of each material is listed with its production
 * date, expiry date and quantity, next to the SAP stock the request quoted.
 * Pure functions, no I/O.
 */
import { addMonths, batchMfgDate, expiryCheck, MISMATCH_LABEL } from "@/lib/batch-code";
import type { SheetRow } from "@/lib/trace";

export type SkuRequest = {
  sku: string;
  /** the product name written next to the material number, when there is one */
  name: string | null;
  /** the stock figure quoted in the request (e.g. SAP "Stock I003"), when there is one */
  sap: number | null;
};

const SKU = /^\d{9}$/;
const NUMBER = /^-?\d[\d.,]*$/;

/** "3,474" / "3.474" -> 3474; "12.5" -> 12.5. A separator followed by exactly three digits is a thousands separator. */
export function parseQty(s: string): number | null {
  const t = s.trim();
  if (!NUMBER.test(t)) return null;
  const n = Number(t.replace(/[.,](?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads material numbers (9 digits) out of pasted text, in the order written,
 * each once. Works on an e-mail table pasted cell by cell (one cell per line),
 * on rows copied from Excel (tabs), and on a bare list. Between one material
 * and the next, the first text is its name and the first number its stock.
 */
export function parseSkuRequest(text: string): SkuRequest[] {
  const cells = text.split(/[\t\r\n;|]+| {2,}/).map((c) => c.trim()).filter(Boolean);
  const out: SkuRequest[] = [];
  const seen = new Map<string, SkuRequest>();
  let cur: SkuRequest | null = null;
  const start = (sku: string) => {
    const known = seen.get(sku);
    if (known) { cur = null; return; } // a repeated material: keep the first, ignore what follows it
    cur = { sku, name: null, sap: null };
    seen.set(sku, cur); out.push(cur);
  };
  for (const cell of cells) {
    if (SKU.test(cell)) { start(cell); continue; }
    // "550058593, 550058592" or a sentence holding material numbers
    const inside = cell.match(/(?<!\d)\d{9}(?!\d)/g);
    if (inside) { for (const s of inside) start(s); cur = inside.length === 1 ? cur : null; continue; }
    if (!cur) continue;
    const c: SkuRequest = cur;
    const n = parseQty(cell);
    if (n !== null) { if (c.sap === null) c.sap = n; } // later numbers (a signature, a phone number) are not stock
    else if (c.name === null) c.name = cell;
  }
  return out;
}

export type SkuStock = {
  bin_code: string; zone: string; sku: string; description: string; uom: string | null;
  batch_lot: string; quantity: number; expiry_date: string | null; days_remaining: number | null; held: number;
};
export type SkuItem = { sku: string; description: string; uom: string | null; shelf_life_months: number | null };

export type BatchLine = {
  sku: string; batch: string; expiry: string | null; days: number | null;
  /** production date, and where it comes from: the batch code, or expiry minus shelf life */
  mfg: string | null; mfgSource: "batch" | "shelf_life" | null;
  qty: number; held: number; bins: { code: string; qty: number }[];
  /** the recorded expiry disagrees with the batch code */
  note: string | null;
};
export type SkuReportRow = {
  sku: string; name: string | null; description: string | null; uom: string | null;
  /** false: the material number is not in the item master */
  known: boolean;
  sap: number | null; wms: number;
  /** wms - sap, null when the request quoted no stock */
  diff: number | null;
  batches: BatchLine[];
};

export const MFG_SOURCE_LABEL: Record<NonNullable<BatchLine["mfgSource"]>, string> = {
  batch: "kode batch",
  shelf_life: "expired − umur simpan",
};

/**
 * One row per requested material, in the order requested, each with its
 * batches on hand: earliest expiry first. One batch with two expiry dates is
 * two lines (stock identity is never merged across expiry dates).
 */
export function buildSkuReport(requests: SkuRequest[], stock: SkuStock[], items: SkuItem[], defaultShelfLife: number): SkuReportRow[] {
  const itemBy = new Map(items.map((i) => [i.sku, i]));
  const bySku = new Map<string, SkuStock[]>();
  for (const s of stock) {
    if (!(Number(s.quantity) > 0)) continue;
    (bySku.get(s.sku) ?? bySku.set(s.sku, []).get(s.sku)!).push(s);
  }
  return requests.map((r) => {
    const item = itemBy.get(r.sku);
    const rows = bySku.get(r.sku) ?? [];
    const shelf = Number(item?.shelf_life_months) > 0 ? Number(item!.shelf_life_months) : defaultShelfLife;
    const m = new Map<string, BatchLine>();
    for (const s of rows) {
      const k = `${s.batch_lot}|${s.expiry_date ?? ""}`;
      let b = m.get(k);
      if (!b) {
        const coded = batchMfgDate(s.batch_lot);
        const check = expiryCheck(s.batch_lot, s.expiry_date, shelf);
        b = {
          sku: r.sku, batch: s.batch_lot, expiry: s.expiry_date, days: s.days_remaining,
          mfg: coded ?? (s.expiry_date ? addMonths(s.expiry_date.slice(0, 10), -shelf) : null),
          mfgSource: coded ? "batch" : s.expiry_date ? "shelf_life" : null,
          qty: 0, held: 0, bins: [],
          note: check ? `Expired menurut kode batch: ${check.expected} (${MISMATCH_LABEL[check.kind]})` : null,
        };
        m.set(k, b);
      }
      const q = Number(s.quantity);
      b.qty += q;
      b.held += s.zone === "QUARANTINE" ? q : Math.min(Number(s.held ?? 0), q);
      const bin = b.bins.find((x) => x.code === s.bin_code);
      if (bin) bin.qty += q; else b.bins.push({ code: s.bin_code, qty: q });
    }
    const batches = [...m.values()].sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") || a.batch.localeCompare(b.batch));
    for (const b of batches) b.bins.sort((x, y) => x.code.localeCompare(y.code));
    const wms = batches.reduce((s, b) => s + b.qty, 0);
    return {
      sku: r.sku, name: r.name, description: item?.description ?? rows[0]?.description ?? null, uom: item?.uom ?? rows[0]?.uom ?? null,
      known: !!item || rows.length > 0, sap: r.sap, wms, diff: r.sap === null ? null : wms - r.sap, batches,
    };
  });
}

export type SkuReportTotals = { skus: number; withStock: number; unknown: number; batches: number; wms: number; sap: number | null; diff: number | null; differing: number };
export function skuReportTotals(rows: SkuReportRow[]): SkuReportTotals {
  const quoted = rows.filter((r) => r.sap !== null);
  const sap = quoted.length ? quoted.reduce((s, r) => s + (r.sap ?? 0), 0) : null;
  const wmsQuoted = quoted.reduce((s, r) => s + r.wms, 0);
  return {
    skus: rows.length, withStock: rows.filter((r) => r.wms > 0).length, unknown: rows.filter((r) => !r.known).length,
    batches: rows.reduce((s, r) => s + r.batches.length, 0), wms: rows.reduce((s, r) => s + r.wms, 0),
    sap, diff: sap === null ? null : wmsQuoted - sap, differing: quoted.filter((r) => r.diff !== 0).length,
  };
}

const productName = (r: SkuReportRow) => r.name ?? r.description ?? "";
export const binText = (b: BatchLine) => b.bins.map((x) => `${x.code} (${x.qty})`).join(", ");

/**
 * The reply itself: one line per material + batch + expiry, the material's
 * own figures repeated on each of its lines so the sheet can be filtered. A
 * material with nothing on hand still has a line, so nothing asked is missing.
 */
export function skuReplyRows(rows: SkuReportRow[]): SheetRow[] {
  return rows.flatMap((r): SheetRow[] => {
    const head = { Material: r.sku, Product: productName(r) };
    if (r.batches.length === 0) {
      return [{ ...head, "Batch number": "", "Production date": "", "Expired date": "", Qty: 0, UOM: r.uom ?? "",
        "Stock (permintaan)": r.sap ?? "", "Stock WMS": 0, Keterangan: r.known ? "Tidak ada stok di gudang" : "Material tidak ada di master item" }];
    }
    return r.batches.map((b) => ({
      ...head, "Batch number": b.batch, "Production date": b.mfg ?? "", "Expired date": b.expiry ?? "", Qty: b.qty, UOM: r.uom ?? "",
      "Stock (permintaan)": r.sap ?? "", "Stock WMS": r.wms,
      Keterangan: [
        b.mfgSource === "shelf_life" ? "Tgl produksi dihitung dari expired − umur simpan" : "",
        !b.batch ? "Batch tidak tercatat" : "", !b.expiry ? "Expired tidak tercatat" : "",
        b.held > 0 ? `${b.held} ditahan / karantina` : "", b.note ?? "",
      ].filter(Boolean).join("; "),
    }));
  });
}

export function skuReportSheets(rows: SkuReportRow[]): Record<string, SheetRow[]> {
  return {
    "Batch per material": skuReplyRows(rows),
    Ringkasan: rows.map((r) => ({
      Material: r.sku, Product: productName(r), UOM: r.uom ?? "", "Stock (permintaan)": r.sap ?? "", "Stock WMS": r.wms, Selisih: r.diff ?? "",
      "Jumlah batch": r.batches.length, "Expired terdekat": r.batches.find((b) => b.expiry)?.expiry ?? "",
      Keterangan: !r.known ? "Material tidak ada di master item" : r.wms === 0 ? "Tidak ada stok di gudang" : "",
    })),
    "Per bin": rows.flatMap((r) => r.batches.flatMap((b) => b.bins.map((x) => ({
      Material: r.sku, Product: productName(r), "Batch number": b.batch, "Production date": b.mfg ?? "", "Expired date": b.expiry ?? "",
      Bin: x.code, Qty: x.qty, UOM: r.uom ?? "",
    })))),
  };
}

/** The reply as tab-separated text, to paste straight into an e-mail or a sheet. */
export function skuReplyTsv(rows: SkuReportRow[]): string {
  const cols = ["Material", "Product", "Batch number", "Production date", "Expired date", "Qty"] as const;
  const lines = skuReplyRows(rows).map((r) => cols.map((c) => String(r[c] ?? "")).join("\t"));
  return [cols.join("\t"), ...lines].join("\n");
}
