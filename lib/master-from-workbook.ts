import * as XLSX from "xlsx";
import { readSheet } from "@/lib/read-sheet";

/** A SKU as the WMS file's MASTER DATA / Master SKU sheets describe it (for add_items, 0040). */
export type MasterItem = { sku: string; description: string; uom: string | null; upp: number | null; volume_l: number | null };

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown) => { const n = Number(text(v)); return text(v) !== "" && Number.isFinite(n) ? n : null; };

function sheetRows(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  if (!wb.Sheets[name]) return [];
  const { rows } = readSheet(wb, name);
  const hi = rows.findIndex((r) => r.some((c) => text(c) === "Material"));
  if (hi < 0) return [];
  const head = rows[hi].map(text);
  return rows.slice(hi + 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/**
 * The master data of `skus` from the workbook: description, UPP and volume
 * from MASTER DATA, base unit (and a fallback description / pallet size)
 * from Master SKU. SKUs found in neither sheet are left out.
 */
export function masterFromWorkbook(wb: XLSX.WorkBook, skus: string[]): MasterItem[] {
  const want = new Set(skus.map((s) => s.trim()));
  const master = new Map(sheetRows(wb, "MASTER DATA").map((r) => [text(r["Material"]), r]));
  const skuSheet = new Map(sheetRows(wb, "Master SKU").map((r) => [text(r["Material"]), r]));
  const out: MasterItem[] = [];
  for (const sku of want) {
    const m = master.get(sku), s = skuSheet.get(sku);
    const description = text(m?.["Material Description"]) || text(s?.["Material Description"]);
    if (!description) continue;
    out.push({
      sku, description,
      uom: text(s?.["Base Unit of Measure"]) || null,
      upp: num(m?.["UPP"]) ?? num(s?.["Pallet"]),
      volume_l: num(m?.["VOLUME"]) ?? num(s?.["Volume"]),
    });
  }
  return out.sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Every SKU the workbook's MASTER DATA and Master SKU sheets list (SAP numbers only). */
export function allMasterSkus(wb: XLSX.WorkBook): string[] {
  const skus = new Set<string>();
  for (const name of ["MASTER DATA", "Master SKU"]) {
    for (const r of sheetRows(wb, name)) { const s = text(r["Material"]); if (/^\d{6,12}$/.test(s)) skus.add(s); }
  }
  return [...skus].sort();
}
