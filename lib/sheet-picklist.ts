import * as XLSX from "xlsx";
import { excelBatchText, excelDateIso } from "@/lib/allocator/excel-date";
import type { AllocationResult, Shortage } from "@/lib/allocator/types";
import { normBatch } from "@/lib/pick-audit";

/**
 * The day's picks as the WMS workbook has them, for the picking audit from
 * the file (0029): the K_ONE picklist when it is filled, otherwise the
 * allocator's picklist from WMS stock + Schedule of the day.
 */
export type SheetPickLine = {
  picklist: string | null; wave_no: string | null; shipment_number: string; seq: number;
  bin_code: string; sku: string; description: string; uom: string | null;
  batch: string; expiry: string | null; qty: number; picker_name: string | null;
};

export const K_ONE_SHEET = "K_ONE";
export const WMS_SHEET = "WMS";
/** Bin code of an order line whose cartons are already at outbound staging. */
export const STAGING_BIN = "STAGING";

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown) => (typeof v === "number" ? v : Number(text(v).replace(/,/g, "")) || 0);
const isoDay = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : excelDateIso(v);
  const s = text(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** Rows of the K_ONE picklist with a shipment, bin, material and a quantity above 0. */
export function kOneLines(wb: XLSX.WorkBook): SheetPickLine[] {
  const ws = wb.Sheets[K_ONE_SHEET];
  if (!ws) return [];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  // The header is not on a fixed row: find the one naming the columns we need.
  const hi = aoa.findIndex((r) => r?.some((c) => text(c) === "Shipments") && r.some((c) => text(c) === "Qty Pick"));
  if (hi < 0) return [];
  const col = new Map((aoa[hi] ?? []).map((h, i) => [text(h), i] as const));
  const get = (r: unknown[], name: string) => (col.has(name) ? r[col.get(name)!] : null);
  const out: SheetPickLine[] = [];
  for (const r of aoa.slice(hi + 1)) {
    if (!r) continue;
    const shipment = text(get(r, "Shipments"));
    const bin = text(get(r, "Lokasi")).toUpperCase();
    const sku = text(get(r, "Material"));
    const qty = num(get(r, "Qty Pick"));
    if (!shipment || !bin || !sku || shipment.startsWith("#") || sku.startsWith("#") || !(qty > 0)) continue;
    out.push({
      picklist: text(get(r, "Picklist")) || null, wave_no: text(get(r, "NO (Wave)")) || null,
      shipment_number: shipment, seq: num(get(r, "Seq")), bin_code: bin, sku,
      description: text(get(r, "Description")), uom: text(get(r, "UOM")) || null,
      batch: excelBatchText(get(r, "Batch")), expiry: isoDay(get(r, "Exp Date")), qty, picker_name: null,
    });
  }
  return mergeLines(out);
}

/** The allocator's picklists as audit lines. */
export function allocatorLines(allocation: AllocationResult): SheetPickLine[] {
  return mergeLines(allocation.picklists.flatMap((p) => p.lines.map((l): SheetPickLine => ({
    picklist: p.picklistId, wave_no: p.waveNo, shipment_number: l.shipmentNumber, seq: l.seq,
    bin_code: l.location.toUpperCase(), sku: l.sku, description: l.description, uom: l.uom,
    batch: l.batch ?? "", expiry: l.expiryDate.toISOString().slice(0, 10), qty: l.qtyPick, picker_name: null,
  }))));
}

/**
 * One line per shipment + bin + SKU + batch (the database key): a picklist
 * can take the same batch from a bin twice for one shipment.
 */
export function mergeLines(lines: SheetPickLine[]): SheetPickLine[] {
  const by = new Map<string, SheetPickLine>();
  for (const l of lines) {
    const k = [l.shipment_number, l.bin_code, l.sku, normBatch(l.batch)].join("|");
    const prev = by.get(k);
    if (prev) { prev.qty += l.qty; prev.seq = Math.min(prev.seq, l.seq); }
    else by.set(k, { ...l });
  }
  return [...by.values()];
}

export type KnownBatch = { batch: string; expiry: string | null };

/**
 * Every batch the WMS sheet names per SKU, empty bins included (a bin
 * picked to 0 still says which batch was in it), earliest expiry first.
 */
export function skuBatches(wb: XLSX.WorkBook): Map<string, KnownBatch[]> {
  const out = new Map<string, KnownBatch[]>();
  const ws = wb.Sheets[WMS_SHEET];
  if (!ws) return out;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  const hi = aoa.findIndex((r) => r?.some((c) => text(c) === "Lokasi") && r.some((c) => text(c) === "Remain Qty"));
  if (hi < 0) return out;
  const col = new Map((aoa[hi] ?? []).map((h, i) => [text(h), i] as const));
  const at = (r: unknown[], name: string) => (col.has(name) ? r[col.get(name)!] : null);
  for (const r of aoa.slice(hi + 1)) {
    if (!r) continue;
    const sku = text(at(r, "item"));
    const batch = excelBatchText(at(r, "Batch"));
    if (!/^\d+$/.test(sku) || !batch || batch.startsWith("#")) continue;
    const list = out.get(sku) ?? [];
    if (!list.some((b) => normBatch(b.batch) === normBatch(batch))) list.push({ batch, expiry: isoDay(at(r, "Expired Date")) });
    out.set(sku, list);
  }
  for (const list of out.values()) list.sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999"));
  return out;
}

/**
 * Short order lines the warehouse says are already at staging, as audit
 * lines from STAGING. Batch / expiry: the SKU's batch in the WMS sheet, the
 * earliest expiry when there are several (FEFO picks that one first).
 */
export function stagedLines(shortages: Shortage[], batches: Map<string, KnownBatch[]>, waveOf: Map<string, string>): SheetPickLine[] {
  return mergeLines(shortages.map((s): SheetPickLine => {
    const b = batches.get(s.sku)?.[0];
    return {
      picklist: `PL-${s.shipmentNumber}`, wave_no: waveOf.get(s.shipmentNumber) ?? null, shipment_number: s.shipmentNumber,
      seq: 999, bin_code: STAGING_BIN, sku: s.sku, description: s.description, uom: null,
      batch: b?.batch ?? "", expiry: b?.expiry ?? null, qty: s.qtyShort, picker_name: null,
    };
  }));
}
