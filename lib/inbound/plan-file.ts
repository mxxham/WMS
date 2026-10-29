import type * as XLSX from "xlsx";
import { readSheet } from "@/lib/read-sheet";

/**
 * Shell's inbound plan ("INBOUND SHELL, KAMIS 29 OKTOBER 2026"): one row per delivery order line, blank
 * (yellow) rows between. One document per Delivery Order number. It is a plan: the truck has not come yet.
 */
export type PlanLine = { sku: string; description: string; quantity: number; uom: string; litres: number | null; row: number };
export type PlanDoc = {
  doc_no: string; shipment_no: string; sales_order: string; container_no: string; seal_no: string;
  transporter: string; slot_time: string | null; lines: PlanLine[];
};
export type InboundPlan = { date: string | null; sheet: string; docs: PlanDoc[]; skipped: { row: number; why: string }[] };

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[.\s]+/g, " ").trim();
const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v)) : String(v).trim());
const MONTHS = ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"];

/** "INBOUND SHELL, KAMIS 29 OKTOBER 2026" -> "2026-10-29". */
function titleDate(rows: unknown[][]): string | null {
  for (const r of rows) for (const c of r) {
    const m = /(\d{1,2})\s+([a-z]+)\s+(\d{4})/i.exec(String(c ?? ""));
    if (!m) continue;
    const k = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3)));
    if (k >= 0) return `${m[3]}-${String(k + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/** Excel time (fraction of a day) or "10:30" -> "HH:MM". */
function slot(v: unknown): string | null {
  if (typeof v === "number" && v >= 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(v ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

const COLS = {
  shipment: ["shipment no", "shipment"], doc: ["delivery order no", "delivery order", "do no"], so: ["sales order no", "sales order"],
  sku: ["material no", "material"], desc: ["material description", "description"], qty: ["qty", "quantity"], uom: ["uom"],
  litres: ["total ltr", "total liter", "total litre"], container: ["container no", "container"], seal: ["seal no", "seal"],
  transporter: ["transporter"], slot: ["slot time", "slot"],
} as const;

export function parseInboundPlan(wb: XLSX.WorkBook): InboundPlan {
  for (const sheet of wb.SheetNames) {
    const { rows, lines } = readSheet(wb, sheet);
    const h = rows.findIndex((r) => r.map(norm).some((x) => x.startsWith("delivery order")) && r.map(norm).includes("material no"));
    if (h < 0) continue;
    const head = rows[h].map(norm);
    const col = (names: readonly string[]) => head.findIndex((x) => names.includes(x));
    const c = Object.fromEntries(Object.entries(COLS).map(([k, v]) => [k, col(v)])) as Record<keyof typeof COLS, number>;
    const at = (r: unknown[], k: keyof typeof COLS) => (c[k] >= 0 ? r[c[k]] : null);

    const docs = new Map<string, PlanDoc>();
    const skipped: InboundPlan["skipped"] = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      const doc = text(at(r, "doc")), sku = text(at(r, "sku")), q = Number(at(r, "qty"));
      if (!doc && !sku) continue;
      if (!doc) { skipped.push({ row: lines[i], why: "nomor Delivery Order kosong" }); continue; }
      if (!/^\d{6,12}$/.test(sku)) { skipped.push({ row: lines[i], why: `Material No. tidak valid: "${sku}"` }); continue; }
      if (!Number.isFinite(q) || q <= 0 || at(r, "qty") === "" || at(r, "qty") === null) {
        skipped.push({ row: lines[i], why: "Qty kosong atau 0" }); continue;
      }
      const d = docs.get(doc) ?? {
        doc_no: doc, shipment_no: text(at(r, "shipment")), sales_order: text(at(r, "so")), container_no: text(at(r, "container")),
        seal_no: text(at(r, "seal")), transporter: text(at(r, "transporter")), slot_time: slot(at(r, "slot")), lines: [],
      };
      const lit = Number(at(r, "litres"));
      d.lines.push({ sku, description: text(at(r, "desc")), quantity: q, uom: text(at(r, "uom")).toUpperCase(),
        litres: Number.isFinite(lit) && at(r, "litres") !== "" && at(r, "litres") !== null ? lit : null, row: lines[i] });
      docs.set(doc, d);
    }
    return { date: titleDate(rows.slice(0, h)), sheet, docs: [...docs.values()], skipped };
  }
  throw new Error("Bukan file rencana inbound: kolom Delivery Order No. dan Material No. tidak ditemukan.");
}
