import type { PickError } from "@/lib/pick-audit";
import { walkKey, type BinState, type RackBin } from "../rack-data";

/** One row of sheet_pick_line_state (0029, 0030). */
export type SheetLineRow = {
  id: string; pick_date: string; source: "K_ONE" | "ALLOCATOR"; file_name: string | null; picklist: string | null; wave_no: string | null;
  shipment_number: string; seq: number; bin_code: string; sku: string; description: string; uom: string | null;
  batch: string; expiry: string | null; qty: number; picker_name: string | null; bin_remaining: number | null;
  last_checker: string | null; last_audited_at: string | null; last_method: "STAGING" | "RACK" | null;
  last_rack_system: number | null; last_rack_counted: number | null;
  last_errors: PickError[] | null; attempts: number; line_state: "TODO" | "OK" | "MISMATCH";
};

export type SheetShipment = { shipment_number: string; wave_no: string | null; lines: number; todo: number; ok: number; mismatch: number };

export const sheetShipmentHref = (date: string, shipment: string) =>
  `/audit/picking/file/${encodeURIComponent(shipment)}?date=${date}`;

/** Per shipment: lines and how far the audit is, in wave then shipment order. */
export function sheetShipments(rows: Pick<SheetLineRow, "shipment_number" | "wave_no" | "line_state">[]): SheetShipment[] {
  const by = new Map<string, SheetShipment>();
  for (const r of rows) {
    const s = by.get(r.shipment_number) ?? { shipment_number: r.shipment_number, wave_no: r.wave_no, lines: 0, todo: 0, ok: 0, mismatch: 0 };
    s.lines += 1;
    if (r.line_state === "OK") s.ok += 1; else if (r.line_state === "MISMATCH") s.mismatch += 1; else s.todo += 1;
    by.set(r.shipment_number, s);
  }
  return [...by.values()].sort((a, b) =>
    (a.wave_no ?? "").localeCompare(b.wave_no ?? "", undefined, { numeric: true }) || a.shipment_number.localeCompare(b.shipment_number));
}

/** Aisle of a rack bin (CA01A01 -> CA); anything else (STAGING) is its own group. */
export function sheetZone(bin: string): string {
  return /^[A-Z]{2}\d{2}[A-Z]\d{2}$/.test(bin) ? bin.slice(0, 2) : bin;
}

export const sheetRackHref = (date: string, zone: string) => `/audit/picking/file/rak/${encodeURIComponent(zone)}?date=${date}`;

/**
 * The file's lines per bin + SKU, in walking order, with what the file says
 * is left in the bin (`bin_qty`) and the last count at the rack.
 */
export function sheetRackBins(rows: SheetLineRow[]): RackBin[] {
  const by = new Map<string, { bin: RackBin; states: SheetLineRow["line_state"][] }>();
  for (const l of rows) {
    const k = `${l.bin_code}|${l.sku}`;
    const g = by.get(k) ?? {
      bin: { bin_code: l.bin_code, zone: sheetZone(l.bin_code), sku: l.sku, description: l.description, uom: l.uom, lines: 0,
             shipments: [], pickers: [], state: "OK" as BinState, bin_qty: null, countable: false, correctable: false, last: null },
      states: [],
    };
    g.bin.lines += 1;
    if (!g.bin.shipments.includes(l.shipment_number)) g.bin.shipments.push(l.shipment_number);
    if (l.picker_name && !g.bin.pickers.includes(l.picker_name)) g.bin.pickers.push(l.picker_name);
    if (l.bin_remaining !== null) g.bin.bin_qty = g.bin.bin_qty === null ? Number(l.bin_remaining) : Math.min(g.bin.bin_qty, Number(l.bin_remaining));
    if (l.last_method === "RACK" && l.last_audited_at && (!g.bin.last || l.last_audited_at > g.bin.last.at)) {
      g.bin.last = { checker: l.last_checker ?? "", system: l.last_rack_system, counted: l.last_rack_counted, at: l.last_audited_at };
    }
    g.states.push(l.line_state);
    by.set(k, g);
  }
  return [...by.values()].map(({ bin, states }): RackBin => ({
    ...bin,
    countable: bin.bin_qty !== null && states.some((s) => s !== "OK"),
    correctable: bin.bin_qty !== null && states.some((s) => s !== "TODO"),
    state: states.includes("MISMATCH") ? "MISMATCH" : states.includes("TODO") ? "TODO" : "OK",
  })).sort((a, b) => walkKey(a.bin_code).localeCompare(walkKey(b.bin_code)) || a.sku.localeCompare(b.sku));
}
