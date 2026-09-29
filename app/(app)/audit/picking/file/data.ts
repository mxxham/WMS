import type { PickError } from "@/lib/pick-audit";

/** One row of sheet_pick_line_state (0029). */
export type SheetLineRow = {
  id: string; pick_date: string; source: "K_ONE" | "ALLOCATOR"; file_name: string | null; picklist: string | null; wave_no: string | null;
  shipment_number: string; seq: number; bin_code: string; sku: string; description: string; uom: string | null;
  batch: string; expiry: string | null; qty: number; picker_name: string | null;
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
