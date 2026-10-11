import { uomLabel } from "./allocator/picklist";
import { lookupUom } from "./allocator/uom-master";
import type { TaskRow } from "./allocator/picklist-from-tasks";
import { sheetRow, type SheetLine, type SheetRow } from "./wave-sheet";

/**
 * Paperless picking (0067): one line of a wave as the picker posts it at the
 * bin through post_pick_line, and the wave's progress against the order.
 * Quantities are in the item's own unit and never summed across units.
 */

const up = (s: string) => s.trim().toUpperCase();
const BIN = /^[A-Z0-9_]{3,20}$/;
const isQty = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());

/** The unit the picklist prints: Carton, Drum, Pail, IBC, Fluidbag. */
export function unitOf(sku: string, uom: string | null): string {
  return uomLabel(lookupUom(sku) ?? uom);
}

/** What must be fixed before Posting, or null. Mirrors post_pick_line's input checks. */
export function lineProblem(l: SheetLine, bins: Set<string> | null): string | null {
  const unit = unitOf(l.sku, l.uom);
  let total = 0;
  for (const s of l.sources) {
    const bin = up(s.bin);
    if (!bin) return "Isi bin asal";
    if (!BIN.test(bin) || (bins && !bins.has(bin))) return `Bin ${bin} tidak ada`;
    if (l.pick) {
      if (!isQty(s.qty)) return `Qty di ${bin} harus angka`;
      total += Number(s.qty);
    }
  }
  if (l.pick && total > Number(l.pick.quantity)) return `Qty paling banyak ${Number(l.pick.quantity)} ${unit} (order baris ini)`;
  const to = up(l.moveTo);
  // A move with no pick: a blank destination or quantity would cancel the planned Bin To Bin, so both are required.
  if (!l.pick && l.move) {
    if (!to) return "Isi bin tujuan";
    if (!isQty(l.moveQty) || Number(l.moveQty) <= 0) return "Isi Qty sisa yang dipindah";
  }
  if (to) {
    if (!BIN.test(to) || (bins && !bins.has(to))) return `Bin ${to} tidak ada`;
    if (l.sources.some((s) => up(s.bin) === to)) return `Bin To Bin: tujuan ${to} sama dengan bin asal`;
    if (!isQty(l.moveQty) || Number(l.moveQty) <= 0) return "Isi Qty sisa yang dipindah";
  }
  return null;
}

/** The confirmation sentence, e.g. "Ambil 13 Carton 550070614 dari CB34D02, sisa 23 Carton ke CB18A02." */
export function lineSummary(l: SheetLine, unit: string): string {
  const to = up(l.moveTo);
  if (!l.pick) return `Pindah ${Number(l.moveQty)} ${unit} ${l.sku} dari ${up(l.sources[0].bin)} ke ${to}.`;
  const rest = to ? `${Number(l.moveQty)} ${unit} ke ${to}` : "";
  const parts = l.sources.map((s, i) => `${Number(s.qty)} ${unit}${i === 0 ? ` ${l.sku}` : ""} dari ${up(s.bin)}`);
  return `Ambil ${parts.join(" + ")}${rest ? `, sisa ${rest}` : ""}.`;
}

/** The p_row for post_pick_line. */
export function linePayload(l: SheetLine): SheetRow {
  return sheetRow(l);
}

export type OrderLine = { shipment_number: string; sku: string; description?: string | null; quantity_requested: number; shortage_reason?: string | null };
export type UnitQty = Record<string, { needed: number; picked: number }>;
export type ShipmentProgress = { shipment: string; units: UnitQty; open: number; lack: Record<string, number> };
export type OrderProgress = {
  shipment: string; sku: string; description: string; unit: string;
  needed: number; planned: number; picked: number;
  /** the part allocation never planned, with its reason (NO_STOCK, BLOCKED_SHELF_LIFE, ALREADY_STAGED) */
  lackUnplanned: number; shortageReason: string | null;
  /** the part posted lines came up short, and those lines */
  lackShort: number; shortSeqs: number[];
  openLines: number;
};
export type PickerProgress = { name: string; lines: number; units: Record<string, number> };
export type WaveProgress = { lines: { done: number; total: number }; units: UnitQty; shipments: ShipmentProgress[]; orders: OrderProgress[]; pickers: PickerProgress[] };

const addUnit = (u: UnitQty, unit: string, needed: number, picked: number) => {
  const x = u[unit] ?? { needed: 0, picked: 0 };
  u[unit] = { needed: x.needed + needed, picked: x.picked + picked };
};

/** Needed (the order) vs picked (posted), per wave, shipment, order line and picker. */
export function waveProgress(tasks: TaskRow[], orders: OrderLine[]): WaveProgress {
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  const picks = live.filter((t) => t.task_type === "PICK");
  const posted = (t: TaskRow) => t.status === "COMPLETED";
  const took = (t: TaskRow) => (posted(t) ? Number(t.actual_quantity ?? t.quantity) : 0);
  const info = new Map(live.map((t) => [t.sku, t]));

  const keys = new Map<string, OrderLine>();
  // Two outbound rows for one shipment and SKU are one order line: quantities add, the first non-null text wins.
  for (const o of orders) {
    const k = `${o.shipment_number}|${o.sku}`;
    const prev = keys.get(k);
    keys.set(k, prev ? {
      ...prev,
      quantity_requested: Number(prev.quantity_requested) + Number(o.quantity_requested),
      description: prev.description ?? o.description,
      shortage_reason: prev.shortage_reason ?? o.shortage_reason,
    } : o);
  }
  for (const t of picks) {
    const k = `${t.shipment_number ?? "-"}|${t.sku}`;
    if (!keys.has(k)) keys.set(k, { shipment_number: t.shipment_number ?? "-", sku: t.sku, quantity_requested: 0 });
  }

  const orderRows: OrderProgress[] = [...keys.values()].map((o) => {
    const mine = picks.filter((t) => (t.shipment_number ?? "-") === o.shipment_number && t.sku === o.sku);
    const ref = info.get(o.sku);
    const planned = mine.reduce((n, t) => n + Number(t.quantity), 0);
    const picked = mine.reduce((n, t) => n + took(t), 0);
    const short = mine.filter((t) => posted(t) && took(t) < Number(t.quantity));
    const needed = Number(o.quantity_requested) || planned;
    return {
      shipment: o.shipment_number, sku: o.sku, description: o.description ?? ref?.description ?? "",
      unit: unitOf(o.sku, ref?.uom ?? null), needed, planned, picked,
      lackUnplanned: Math.max(needed - planned, 0), shortageReason: o.shortage_reason ?? null,
      lackShort: short.reduce((n, t) => n + Number(t.quantity) - took(t), 0), shortSeqs: short.map((t) => t.seq).sort((a, b) => a - b),
      openLines: mine.filter((t) => !posted(t)).length,
    };
  }).sort((a, b) => a.shipment.localeCompare(b.shipment) || a.sku.localeCompare(b.sku));

  const units: UnitQty = {};
  const byShipment = new Map<string, ShipmentProgress>();
  for (const o of orderRows) {
    addUnit(units, o.unit, o.needed, o.picked);
    const s = byShipment.get(o.shipment) ?? { shipment: o.shipment, units: {}, open: 0, lack: {} };
    addUnit(s.units, o.unit, o.needed, o.picked);
    s.open += o.openLines;
    byShipment.set(o.shipment, s);
  }
  for (const s of byShipment.values()) {
    if (s.open > 0) continue;
    for (const [unit, q] of Object.entries(s.units)) if (q.picked < q.needed) s.lack[unit] = q.needed - q.picked;
  }

  const pickers = new Map<string, PickerProgress>();
  for (const t of picks.filter(posted)) {
    const name = t.picked_by_name?.trim() || "–";
    const p = pickers.get(name) ?? { name, lines: 0, units: {} };
    const unit = unitOf(t.sku, t.uom);
    p.lines += 1;
    p.units[unit] = (p.units[unit] ?? 0) + took(t);
    pickers.set(name, p);
  }

  return {
    lines: { done: live.filter(posted).length, total: live.length },
    units, shipments: [...byShipment.values()], orders: orderRows,
    pickers: [...pickers.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
