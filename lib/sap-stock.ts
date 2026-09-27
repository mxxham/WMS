import * as XLSX from "xlsx";
import { readSheet } from "./read-sheet";

/**
 * Shell's SAP stock export (MB52-style): Plant, Material / SKU CODE, Material
 * Description, Storage Location, Batch ("UT"), Base Unit of Measure,
 * Unrestricted, Blocked. The header row is found by its titles, wherever it
 * sits; when a sheet repeats Unrestricted / Blocked (SAP vs FISIK vs RAMCO
 * side by side) the FIRST pair is SAP's.
 */
export type SapRow = { sku: string; description: string; uom: string; unrestricted: number; blocked: number; line: number };
export type SapParse = { sheet: string; rows: SapRow[]; skipped: { line: number; why: string }[]; headerLine: number };
export type PendingRow = { sku: string; qty: number };

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const SKU = (h: string) => h === "material" || h === "sku code" || h === "sku" || h === "material number" || h === "item code";
const UNREST = (h: string) => h.startsWith("unrestricted") || h === "unrest" || h === "unrestricted use";
const BLOCK = (h: string) => h.startsWith("blocked") || h === "blok" || h === "block";
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const skuText = (v: unknown) => (typeof v === "number" ? String(Math.round(v)) : String(v ?? "").trim());

function findHeader(rows: unknown[][]): { idx: number; cols: Record<"sku" | "desc" | "uom" | "unrest" | "blocked", number> } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const h = rows[i].map(norm);
    const sku = h.findIndex(SKU);
    const unrest = h.findIndex(UNREST);
    const blocked = h.findIndex(BLOCK);
    if (sku >= 0 && (unrest >= 0 || blocked >= 0)) {
      return { idx: i, cols: { sku, unrest, blocked, desc: h.findIndex((x) => x.includes("description")), uom: h.findIndex((x) => x.includes("unit of measure") || x === "uom" || x === "bun") } };
    }
  }
  return null;
}

/** First sheet (or `sheet`) that looks like an SAP stock list. */
export function parseSapStock(wb: XLSX.WorkBook, sheet?: string): SapParse {
  const names = sheet ? [sheet] : wb.SheetNames;
  for (const name of names) {
    const { rows, lines } = readSheet(wb, name);
    const head = findHeader(rows);
    if (!head) continue;
    const { cols } = head;
    const out: SapRow[] = [];
    const skipped: SapParse["skipped"] = [];
    for (let i = head.idx + 1; i < rows.length; i++) {
      const r = rows[i];
      const sku = skuText(r[cols.sku]);
      if (!/^\d{6,12}$/.test(sku)) { if (sku) skipped.push({ line: lines[i], why: `bukan kode SKU: "${sku}"` }); continue; }
      const unrestricted = cols.unrest >= 0 ? num(r[cols.unrest]) : 0;
      const blocked = cols.blocked >= 0 ? num(r[cols.blocked]) : 0;
      if (Number.isNaN(unrestricted) || Number.isNaN(blocked)) { skipped.push({ line: lines[i], why: "qty bukan angka" }); continue; }
      out.push({ sku, description: cols.desc >= 0 ? String(r[cols.desc] ?? "") : "", uom: cols.uom >= 0 ? String(r[cols.uom] ?? "").toUpperCase() : "",
        unrestricted, blocked, line: lines[i] });
    }
    if (out.length) return { sheet: name, rows: out, skipped, headerLine: lines[head.idx] };
  }
  throw new Error("Tidak ada sheet dengan kolom Material / SKU CODE dan Unrestricted / Blocked.");
}

/**
 * Pending GI / GR list: a Material (SKU) column and a quantity column
 * ("Delivery quantity", "Qty", "Quantity"). Several rows per SKU are summed.
 */
export function parsePendingList(wb: XLSX.WorkBook): PendingRow[] {
  for (const name of wb.SheetNames) {
    const { rows } = readSheet(wb, name);
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const h = rows[i].map(norm);
      const s = h.findIndex(SKU);
      const q = h.findIndex((x) => x === "delivery quantity" || x === "qty" || x === "quantity" || x === "jumlah");
      if (s < 0 || q < 0) continue;
      const m = new Map<string, number>();
      for (const r of rows.slice(i + 1)) {
        const sku = skuText(r[s]); const qty = num(r[q]);
        if (/^\d{6,12}$/.test(sku) && Number.isFinite(qty)) m.set(sku, (m.get(sku) ?? 0) + qty);
      }
      if (m.size) return [...m].map(([sku, qty]) => ({ sku, qty }));
    }
  }
  throw new Error("Tidak ada sheet dengan kolom Material dan Delivery quantity / Qty.");
}

export type DocLine = { sku: string; batch_lot: string; quantity: number };

/**
 * Delivery document lines (Shell DO / packing list): Material, quantity
 * ("Delivery quantity" / "Qty"), and Batch when the document prints one.
 * Rows with the same SKU + batch are summed.
 */
export function parseDeliveryDoc(wb: XLSX.WorkBook): DocLine[] {
  for (const name of wb.SheetNames) {
    const { rows } = readSheet(wb, name);
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const h = rows[i].map(norm);
      const s = h.findIndex(SKU);
      const q = h.findIndex((x) => x === "delivery quantity" || x === "qty" || x === "quantity" || x === "jumlah");
      if (s < 0 || q < 0) continue;
      const b = h.findIndex((x) => x === "batch" || x === "batch no" || x === "lot");
      const m = new Map<string, DocLine>();
      for (const r of rows.slice(i + 1)) {
        const sku = skuText(r[s]); const qty = num(r[q]);
        if (!/^\d{6,12}$/.test(sku) || !(qty > 0)) continue;
        const batch = b >= 0 ? String(r[b] ?? "").trim().toUpperCase().replace(/^UT$/, "") : "";
        const k = `${sku}|${batch}`;
        const e = m.get(k);
        if (e) e.quantity += qty; else m.set(k, { sku, batch_lot: batch, quantity: qty });
      }
      if (m.size) return [...m.values()];
    }
  }
  throw new Error("Tidak ada sheet dengan kolom Material dan Delivery quantity / Qty.");
}
