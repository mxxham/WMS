import * as XLSX from "xlsx";
import { excelBatchText, excelDateIso } from "@/lib/allocator/excel-date";
import { addOrder, splitOverOrders } from "@/lib/allocator/orders";
import type { AllocationResult, OrderQty, Shortage } from "@/lib/allocator/types";
import { mergeDos } from "@/lib/audit-do";
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
  /**
   * the DO (delivery order = SAP order) numbers this line belongs to: the
   * file's per-line "Order No", else its "DO Number", else the allocator's
   * orderNos. Trimmed, deduped, first-seen order (0121).
   */
  do_nos: string[];
  /** what stays of the SKU in the bin after the day's picks, per the file (null: not known) */
  bin_remaining: number | null;
  /** the ship-to company and its city (0123): shipment-level, read from the file or Schedule of the day */
  destination?: string | null;
  ship_to_location?: string | null;
};

/** What the audit shows of one shipment besides its number: who it goes to and where (0123). */
export type ShipmentMeta = { destination: string; shipToLocation: string };

export const K_ONE_SHEET = "K_ONE";
export const WMS_SHEET = "WMS";
/** Today's outbound demand, one row per order line: names each shipment's ship-to party and city. */
export const SCHEDULE_SHEET = "Schedule of the day";
/** Bin code of an order line whose cartons are already at outbound staging. */
export const STAGING_BIN = "STAGING";

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown) => (typeof v === "number" ? v : Number(text(v).replace(/,/g, "")) || 0);
const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = text(v).replace(/,/g, "");
  return s !== "" && Number.isFinite(Number(s)) ? Number(s) : null;
};
const isoDay = (v: unknown): string | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : excelDateIso(v);
  const s = text(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
/**
 * DO numbers in one cell: the sheet writes several as "a, b" (and a numeric
 * cell is still a string for us). Trimmed, no empties, first-seen order.
 */
const dosCell = (v: unknown): string[] => mergeDos(text(v).split(","));

/**
 * Ship-to company and city per shipment, from Schedule of the day (0123): the
 * K_ONE sheet has no such columns and a pick line's own copy would repeat on
 * every line, so the audit looks them up by shipment number instead. A missing
 * sheet or header is not an error — the audit then simply has no destination.
 */
export function scheduleMeta(wb: XLSX.WorkBook): Map<string, ShipmentMeta> {
  const out = new Map<string, ShipmentMeta>();
  const ws = wb.Sheets[SCHEDULE_SHEET];
  if (!ws) return out;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  // The header is not on a fixed row: find the one naming the columns we need.
  const hi = aoa.findIndex((r) => r?.some((c) => text(c) === "Shipment Number") && r.some((c) => text(c) === "Destination"));
  if (hi < 0) return out;
  const col = new Map((aoa[hi] ?? []).map((h, i) => [text(h), i] as const));
  const at = (r: unknown[], name: string) => (col.has(name) ? r[col.get(name)!] : null);
  for (const r of aoa.slice(hi + 1)) {
    if (!r) continue;
    const shipment = text(at(r, "Shipment Number"));
    if (!shipment || shipment.startsWith("#")) continue;
    const prev = out.get(shipment);
    // First non-empty value wins: a shipment's rows repeat the same party on every order line.
    out.set(shipment, {
      destination: prev?.destination || text(at(r, "Destination")),
      shipToLocation: prev?.shipToLocation || text(at(r, "Location of the ship-to party")),
    });
  }
  return out;
}

/**
 * Each DO's cartons per shipment + SKU, from Schedule of the day ("Order No",
 * "Delivery quantity"), in row order: what a K_ONE line listing several DOs is
 * split by. Keyed `shipment|sku`; empty without the sheet.
 */
export function scheduleOrders(wb: XLSX.WorkBook): Map<string, OrderQty[]> {
  const out = new Map<string, OrderQty[]>();
  const ws = wb.Sheets[SCHEDULE_SHEET];
  if (!ws) return out;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  const hi = aoa.findIndex((r) => r?.some((c) => text(c) === "Shipment Number") && r.some((c) => text(c) === "Order No"));
  if (hi < 0) return out;
  const col = new Map((aoa[hi] ?? []).map((h, i) => [text(h), i] as const));
  const at = (r: unknown[], name: string) => (col.has(name) ? r[col.get(name)!] : null);
  for (const r of aoa.slice(hi + 1)) {
    if (!r) continue;
    const shipment = text(at(r, "Shipment Number")), sku = text(at(r, "Material")), order = text(at(r, "Order No"));
    const qty = num(at(r, "Delivery quantity"));
    if (!shipment || !sku || !order || shipment.startsWith("#") || !(qty > 0)) continue;
    const k = `${shipment}|${sku}`;
    const list = out.get(k) ?? [];
    addOrder(list, order, qty);
    out.set(k, list);
  }
  return out;
}

/**
 * The DO of each K_ONE row. A row naming one DO keeps it: that is the source's
 * own answer. A row naming several (or none, then its "DO Number" list) is
 * split over what its shipment + SKU's DOs still miss in the Schedule, rows in
 * printed order filling DOs in Schedule order — the allocator's rule
 * (lib/allocator/orders.ts). Without Schedule cartons the row keeps its list.
 */
function kOneDos(rows: { group: string; qty: number; listed: string[] }[], orders: Map<string, OrderQty[]>): string[][] {
  // A K_ONE row can name several shipments in one cell ("109679524, 109683111"): its DOs are all of theirs.
  const ofGroup = (g: string): OrderQty[] | undefined => {
    const at = g.lastIndexOf("|");
    const sku = g.slice(at + 1);
    const lists = g.slice(0, at).split(",").map((sh) => orders.get(`${sh.trim()}|${sku}`)).filter((x): x is OrderQty[] => !!x);
    return lists.length ? lists.flat().map((o) => ({ ...o })) : undefined;
  };
  const pool = new Map<string, OrderQty[]>();
  for (const r of rows) {
    const list = pool.has(r.group) ? undefined : ofGroup(r.group);
    if (list) pool.set(r.group, list);
  }
  for (const r of rows) {
    if (r.listed.length !== 1) continue;
    const o = pool.get(r.group)?.find((x) => x.orderNo === r.listed[0]);
    if (o) o.qty = Math.max(0, o.qty - r.qty);
  }
  const rest = rows.filter((r) => r.listed.length !== 1);
  const { split } = splitOverOrders(rest, (r) => r.group, (r) => r.qty, (g) => {
    const open = pool.get(g);
    if (!open) return null;
    // Only the DOs the row itself names, when it names any of the shipment's.
    const listed = rest.find((r) => r.group === g)?.listed ?? [];
    const named = open.filter((o) => listed.includes(o.orderNo));
    return named.length ? named : open;
  });
  const byRow = new Map(rest.map((r, i) => [r, split[i]]));
  return rows.map((r) => {
    const s = byRow.get(r);
    return s ? s.map((o) => o.orderNo) : r.listed;
  });
}

/** Rows of the K_ONE picklist with a shipment, bin, material and a quantity above 0. */
export function kOneLines(wb: XLSX.WorkBook, meta: Map<string, ShipmentMeta> = scheduleMeta(wb),
  orders: Map<string, OrderQty[]> = scheduleOrders(wb)): SheetPickLine[] {
  const ws = wb.Sheets[K_ONE_SHEET];
  if (!ws) return [];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  // The header is not on a fixed row: find the one naming the columns we need.
  const hi = aoa.findIndex((r) => r?.some((c) => text(c) === "Shipments") && r.some((c) => text(c) === "Qty Pick"));
  if (hi < 0) return [];
  const col = new Map((aoa[hi] ?? []).map((h, i) => [text(h), i] as const));
  const get = (r: unknown[], name: string) => (col.has(name) ? r[col.get(name)!] : null);
  const out: SheetPickLine[] = [];
  const listed: string[][] = [];
  for (const r of aoa.slice(hi + 1)) {
    if (!r) continue;
    const shipment = text(get(r, "Shipments"));
    const bin = text(get(r, "Lokasi")).toUpperCase();
    const sku = text(get(r, "Material"));
    const qty = num(get(r, "Qty Pick"));
    if (!shipment || !bin || !sku || shipment.startsWith("#") || sku.startsWith("#") || !(qty > 0)) continue;
    // The DOs the row names: its own "Order No", else the shipment's "DO Number" list (split below).
    const order = dosCell(get(r, "Order No"));
    listed.push(order.length ? order : dosCell(get(r, "DO Number")));
    out.push({
      picklist: text(get(r, "Picklist")) || null, wave_no: text(get(r, "NO (Wave)")) || null,
      shipment_number: shipment, seq: num(get(r, "Seq")), bin_code: bin, sku,
      description: text(get(r, "Description")), uom: text(get(r, "UOM")) || null,
      batch: excelBatchText(get(r, "Batch")), expiry: isoDay(get(r, "Exp Date")), qty, picker_name: null,
      do_nos: [],
      bin_remaining: numOrNull(get(r, "Sisa di Bin")),
      // The K_ONE sheet has no such columns in the real workbook: the Schedule map is the normal source.
      destination: text(get(r, "Destination")) || meta.get(shipment)?.destination || "",
      ship_to_location: text(get(r, "Location of the ship-to party")) || meta.get(shipment)?.shipToLocation || "",
    });
  }
  const dos = kOneDos(out.map((l, i) => ({ group: `${l.shipment_number}|${l.sku}`, qty: l.qty, listed: listed[i]! })), orders);
  out.forEach((l, i) => { l.do_nos = dos[i]!; });
  return mergeLines(out);
}

/** The allocator's picklists as audit lines. */
export function allocatorLines(allocation: AllocationResult, meta: Map<string, ShipmentMeta> = new Map()): SheetPickLine[] {
  return mergeLines(allocation.picklists.flatMap((p) => p.lines.map((l): SheetPickLine => ({
    picklist: p.picklistId, wave_no: p.waveNo, shipment_number: l.shipmentNumber, seq: l.seq,
    bin_code: l.location.toUpperCase(), sku: l.sku, description: l.description, uom: l.uom,
    batch: l.batch ?? "", expiry: l.expiryDate.toISOString().slice(0, 10), qty: l.qtyPick, picker_name: null,
    do_nos: mergeDos(l.orderNos),
    bin_remaining: l.qtyRemainingInBin,
    // The file's own Schedule is the source; the picklist's header is the fallback when it is not in the map.
    destination: meta.get(l.shipmentNumber)?.destination || p.destination || "",
    ship_to_location: meta.get(l.shipmentNumber)?.shipToLocation || p.shipToLocation || "",
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
    if (prev) {
      prev.qty += l.qty; prev.seq = Math.min(prev.seq, l.seq);
      prev.bin_remaining = minKnown(prev.bin_remaining, l.bin_remaining);
      // One line can be two order lines of the same shipment: keep every DO, not just the first line's.
      prev.do_nos = mergeDos(prev.do_nos, l.do_nos);
      // Same shipment, so the same party: keep whichever line named it.
      prev.destination = prev.destination || l.destination;
      prev.ship_to_location = prev.ship_to_location || l.ship_to_location;
    }
    else by.set(k, { ...l });
  }
  return [...by.values()];
}

const minKnown = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

/**
 * One remaining qty per bin + SKU, for the count at the rack: in a rack
 * bin the lowest (after the day's last pick); at STAGING all the lines'
 * cartons, which is what the checker finds there.
 */
export function withBinRemaining(lines: SheetPickLine[]): SheetPickLine[] {
  const by = new Map<string, number | null>();
  const key = (l: SheetPickLine) => `${l.bin_code}|${l.sku}`;
  for (const l of lines) {
    const k = key(l);
    if (l.bin_code === STAGING_BIN) by.set(k, (by.get(k) ?? 0) + l.qty);
    else by.set(k, by.has(k) ? minKnown(by.get(k)!, l.bin_remaining) : l.bin_remaining);
  }
  return lines.map((l) => ({ ...l, bin_remaining: by.get(key(l)) ?? null }));
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
export function stagedLines(shortages: Shortage[], batches: Map<string, KnownBatch[]>, waveOf: Map<string, string>,
  meta: Map<string, ShipmentMeta> = new Map()): SheetPickLine[] {
  return mergeLines(shortages.map((s): SheetPickLine => {
    const b = batches.get(s.sku)?.[0];
    return {
      picklist: `PL-${s.shipmentNumber}`, wave_no: waveOf.get(s.shipmentNumber) ?? null, shipment_number: s.shipmentNumber,
      seq: 999, bin_code: STAGING_BIN, sku: s.sku, description: s.description, uom: null,
      batch: b?.batch ?? "", expiry: b?.expiry ?? null, qty: s.qtyShort, picker_name: null,
      do_nos: mergeDos(s.orderNos), bin_remaining: null,
      destination: meta.get(s.shipmentNumber)?.destination || "",
      ship_to_location: meta.get(s.shipmentNumber)?.shipToLocation || "",
    };
  }));
}
