import { uomLabel } from "./allocator/picklist";
import { lookupUom } from "./allocator/uom-master";
import type { TaskRow } from "./allocator/picklist-from-tasks";
import { leftoverAfter, sheetNotes, sheetRow, type SheetLine, type SheetNote, type SheetRow, type SheetStock } from "./wave-sheet";

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

/** Own line: the typed names compared as same_person (0016) does; a line without a name is nobody's. */
export function samePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (x: string | null | undefined) => (x ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a) !== "" && norm(a) === norm(b);
}

const day = (d: string | null | undefined) => (d ?? "").slice(0, 10);

/** The stock row the line was planned from (marked "rencana" in the source suggestions). */
export function isPlannedSource(r: SheetStock, l: SheetLine): boolean {
  const plan = l.pick ?? l.move;
  return !!plan && r.bin === plan.from_bin && r.sku === l.sku && r.batch === plan.batch_lot && day(r.expiry) === day(plan.expiry_date);
}

/**
 * Qty sisa an open line's editor starts with: what the pallet really keeps after this pick
 * (leftoverAfter) once the stock has loaded, the plan only before that. A posted line keeps what was posted.
 */
export function restAtOpen(l: SheetLine, stock: SheetStock[], stockLoaded: boolean): string {
  if (l.posted || !l.move) return l.moveQty;
  return String(stockLoaded ? leftoverAfter(l, stock) : Number(l.move.quantity));
}

/**
 * The notes for the line being edited: what sheetNotes says (Isi dari picklist's own notes, replayed against the
 * system's stock once it has loaded), plus the rest against what the system says the pallet keeps. Warnings only:
 * the floor may know better; lineProblem decides what blocks Posting.
 */
export function draftNotes(draft: SheetLine, line: SheetLine, stock: SheetStock[], bins: Set<string> | null, unit: string,
  stockLoaded: boolean): SheetNote[] {
  // Before the stock has loaded, nothing is replayed (it would read every bin as empty).
  const l = stockLoaded ? { ...draft, done: true } : { ...draft, posted: false, done: false };
  const notes = [...(sheetNotes([l], new Map([[line.key, line]]), stockLoaded ? stock : [], bins).get(line.key) ?? [])];
  if (stockLoaded && line.move && !line.posted) {
    const left = leftoverAfter(draft, stock);
    const planned = Number(line.move.quantity);
    const bin = up(draft.sources[0].bin);
    if (left !== planned) notes.push({ tone: "warn", text: `Sistem: sisa di ${bin} setelah pick ini ${left} ${unit}, rencana ${planned} ${unit}.` });
    const mq = Number(draft.moveQty);
    if (up(draft.moveTo) && mq > left) {
      notes.push({ tone: "warn", text: `Qty sisa ${mq} ${unit} lebih dari sisa di sistem (${left} ${unit}): selisihnya dicatat sebagai koreksi picklist, ${bin} dihitung ulang.` });
    }
  }
  return notes;
}

/** A bin label as post_pick_line compares it (0068): upper case, no whitespace anywhere. */
export function normBin(code: string | null | undefined): string {
  return (code ?? "").replace(/\s/g, "").toUpperCase();
}

/**
 * The bin the rack scan must confirm (0068): the row's first source exactly as post_pick_line reads it
 * (pick_line_first_source): with several sources a 0-carton one is skipped; for a move-only line, its pallet.
 */
export function scanTarget(l: SheetLine): string {
  const src = sheetRow(l).sources;
  const first = src.length > 1 ? (src.find((s) => s.qty > 0) ?? src[0]) : src[0];
  return normBin(first?.bin);
}

export function scanMatches(l: SheetLine, code: string | null | undefined): boolean {
  const c = normBin(code);
  return c !== "" && c === scanTarget(l);
}

export type ScanCheck = { ok: true; bin: string; text: string } | { ok: false; bin: string; scanned: string; text: string };

/** The card's line under the scan: green with the bin, or red naming both bins. Nothing scanned: null. */
export function scanCheck(l: SheetLine, code: string | null | undefined): ScanCheck | null {
  const c = normBin(code);
  if (!c) return null;
  const bin = scanTarget(l);
  return c === bin ? { ok: true, bin, text: `✓ ${bin}` } : { ok: false, bin, scanned: c, text: `Bin salah: kamu scan ${c}, baris ini ${bin}` };
}

/**
 * Ambil dari <scanned>: the line with the scanned bin as its first source (the Berbeda editor's start).
 * Batch and expiry are filled when that bin holds one batch of the SKU, as the editor does on a typed bin.
 */
export function takeFrom(l: SheetLine, code: string, stock: SheetStock[]): SheetLine {
  const d = structuredClone(l);
  const bin = normBin(code);
  const here = stock.filter((r) => r.bin === bin && r.sku === l.sku && r.qty > 0);
  const s = { ...d.sources[0], bin };
  if (here.length === 1) { s.batch = here[0].batch; s.expiry = day(here[0].expiry); }
  d.sources[0] = s;
  return d;
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
