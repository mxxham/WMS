/**
 * Lacak batch: everything the page shows is derived here from four reads
 * (stock, movements, open wave tasks, holds), so the screen and the Excel
 * download can never disagree. Pure functions, no I/O.
 *
 * Stock identity stays bin + SKU + batch + expiry: one batch with two expiry
 * dates in one bin is two positions, never merged.
 */
import { expiryCheck, batchMfgDate, MISMATCH_LABEL, type ExpiryMismatch } from "@/lib/batch-code";
import { LOC_LABEL, locType, stockKey, type LocType } from "@/lib/inventory-view";

// ---- What the page reads --------------------------------------------------

export type TraceStock = {
  bin_code: string; zone: string; rack: string | null; level: string | null; bin_status: string;
  sku: string; description: string; uom: string | null; upp: number | null;
  batch_lot: string; quantity: number; expiry_date: string | null; received_date: string | null;
  days_remaining: number | null; held: number; hold_reasons: string | null;
};
export type TraceMove = {
  id: string; type: string; quantity: number; batch_lot: string; expiry_date: string | null; created_at: string;
  note: string | null; reason_code: string | null; by_name: string | null; approved_by_name: string | null;
  sku: string; description: string; uom: string | null;
  from_bin: string | null; to_bin: string | null; user: string | null;
  shipment: string | null; wave_no: string | null; wave_date: string | null; truck: string | null;
};
export type TraceTask = {
  task_type: "PICK" | "REPLENISH"; sku: string; description: string; from_bin: string; to_bin: string | null;
  batch_lot: string; expiry_date: string | null; quantity: number; wave_no: string; planned_date: string;
  shipment_number: string | null;
};
export type TraceOutbound = { shipment_number: string; sku: string; destination: string; truck: string | null; order_nos: string[] | null };
export type TraceHold = {
  id: string; scope: "LINE" | "BATCH"; bin_code: string | null; sku: string; batch_lot: string; expiry_date: string | null;
  quantity: number | null; reason_code: string; note: string; status: "ACTIVE" | "RELEASED";
  created_by_name: string; created_at: string; released_by_name: string | null; released_at: string | null;
  release_note: string | null; covered_qty: number | null;
};

// ---- What the page shows --------------------------------------------------

export type Position = TraceStock & {
  loc: LocType;
  /** cartons an open wave task will take from this position */
  reserved: number;
  /** cartons an open Bin To Bin will bring into this position */
  incoming: number;
  held: number;
  available: number;
  /** quantity / UPP, null when the item has no UPP */
  pallets: number | null;
  /** days since the stock was received, null without a receive date */
  ageDays: number | null;
  waves: string[];
};

export type ExpiryGroup = {
  sku: string; expiry: string | null; days: number | null; qty: number; bins: { code: string; qty: number }[];
  /** what the batch code says the expiry should be, when it disagrees with the recorded one */
  expected: string | null; mismatch: ExpiryMismatch | null;
};

export type SkuSummary = {
  sku: string; description: string; uom: string | null; upp: number | null;
  opening: number; received: number; shipped: number; adjusted: number;
  onHand: number; reserved: number; held: number; available: number; pallets: number | null; bins: number;
  /** on hand according to the movements alone: opening + received - shipped + adjusted */
  ledger: number;
  /** onHand - ledger: not zero when part of the history is missing (stock that came in under another batch code, …) */
  gap: number;
  expiries: ExpiryGroup[];
  firstSeen: string | null; lastMove: string | null;
};

export type ShipRow = {
  shipment: string; sku: string; description: string; date: string; wave: string; destination: string; truck: string | null;
  orders: string; qty: number; bins: string[]; expiries: string[]; last: string;
};
export type DestinationRow = { destination: string; shipments: number; qty: number; first: string; last: string };

export type HistoryRow = TraceMove & {
  /** signed effect on the batch's stock in the warehouse: 0 for a move between two bins */
  delta: number;
  /** the SKU's batch stock after this movement, by the movements alone */
  balance: number;
};

export type Alert = { tone: "bad" | "warn" | "info"; text: string };

export const MOVE_LABEL: Record<string, string> = { inbound: "Terima", putaway: "Putaway", picking: "Pick", transfer: "Transfer", adjustment: "Adjust" };
export const MANUAL_SHIPMENT = "(pick manual)";

const num = (v: unknown) => Number(v ?? 0) || 0;
const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY);

/** A timestamp as Jakarta wall-clock time: the same text on the server (UTC) and in the browser. */
export function jakartaDateTime(ts: string | null | undefined): string {
  if (!ts) return "–";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
/** The Jakarta calendar day (YYYY-MM-DD) a timestamp falls on. */
export const jakartaDay = (ts: string) => new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/** Rack code parts shown as a hint under the bin: aisle and level. */
export function binHint(p: { zone: string; rack: string | null; level: string | null }): string {
  if (!p.rack) return LOC_LABEL[locType(p)];
  return `Aisle ${p.zone}${p.level ? ` · level ${p.level}` : ""}`;
}

// ---- Positions ------------------------------------------------------------

/**
 * Where the batch is now, one row per stock identity, with what open wave
 * tasks reserve and what is on hold. Rows with quantity 0 are left out.
 * `today` is the Jakarta date (YYYY-MM-DD).
 */
export function buildPositions(stock: TraceStock[], tasks: TraceTask[], today: string): Position[] {
  const out = new Map<string, { q: number; waves: Set<string> }>();
  const inc = new Map<string, number>();
  for (const t of tasks) {
    const k = stockKey(t.from_bin, t.sku, t.batch_lot, t.expiry_date);
    const e = out.get(k) ?? { q: 0, waves: new Set<string>() };
    e.q += num(t.quantity); e.waves.add(`NO ${t.wave_no}`);
    out.set(k, e);
    if (t.task_type === "REPLENISH" && t.to_bin) {
      const ki = stockKey(t.to_bin, t.sku, t.batch_lot, t.expiry_date);
      inc.set(ki, (inc.get(ki) ?? 0) + num(t.quantity));
    }
  }
  return stock.filter((s) => num(s.quantity) > 0).map((s) => {
    const qty = num(s.quantity);
    const k = stockKey(s.bin_code, s.sku, s.batch_lot, s.expiry_date);
    const r = out.get(k);
    const loc = locType(s);
    const reserved = Math.min(r?.q ?? 0, qty);
    // Quarantined stock is not available to ship, whatever its holds say (same rule as Inventory → Stok).
    const held = loc === "quarantine" ? qty : Math.min(num(s.held), qty);
    const upp = num(s.upp);
    return {
      ...s, quantity: qty, loc, reserved, incoming: inc.get(k) ?? 0, held,
      available: Math.max(qty - reserved - held, 0),
      pallets: upp > 0 ? qty / upp : null,
      ageDays: s.received_date ? Math.max(daysBetween(s.received_date, today), 0) : null,
      waves: r ? [...r.waves].sort() : [],
    };
  }).sort((a, b) => a.sku.localeCompare(b.sku) || (a.expiry_date ?? "9999").localeCompare(b.expiry_date ?? "9999") || a.bin_code.localeCompare(b.bin_code));
}

/** Per SKU and expiry date: the bins holding it. Earliest expiry first; stock without a date last. */
export function buildExpiryGroups(positions: Position[], shelfLife: Record<string, number>, defaultShelfLife: number): ExpiryGroup[] {
  const m = new Map<string, ExpiryGroup>();
  for (const p of positions) {
    const k = `${p.sku}|${p.expiry_date ?? ""}`;
    let g = m.get(k);
    if (!g) {
      const check = expiryCheck(p.batch_lot, p.expiry_date, shelfLife[p.sku] ?? defaultShelfLife);
      g = { sku: p.sku, expiry: p.expiry_date, days: p.days_remaining, qty: 0, bins: [], expected: check?.expected ?? null, mismatch: check?.kind ?? null };
      m.set(k, g);
    }
    g.qty += p.quantity;
    const b = g.bins.find((x) => x.code === p.bin_code);
    if (b) b.qty += p.quantity; else g.bins.push({ code: p.bin_code, qty: p.quantity });
  }
  return [...m.values()].sort((a, b) => a.sku.localeCompare(b.sku) || (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999"));
}

// ---- History --------------------------------------------------------------

/**
 * A movement's effect on how much of the batch is in the warehouse.
 * Receiving adds, picking removes, an adjustment is already signed, and a
 * move between two bins (transfer, putaway out of staging) changes nothing.
 */
export function moveDelta(m: Pick<TraceMove, "type" | "quantity" | "from_bin">): number {
  const q = num(m.quantity);
  if (m.type === "picking") return -q;
  if (m.type === "adjustment") return q;
  if (m.type === "inbound") return q;
  if (m.type === "putaway") return m.from_bin ? 0 : q;
  return 0;
}

/** Movements oldest first, each with its effect and the SKU's running balance. */
export function buildHistory(moves: TraceMove[]): HistoryRow[] {
  const bal = new Map<string, number>();
  return [...moves].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map((m) => {
    const delta = moveDelta(m);
    const balance = (bal.get(m.sku) ?? 0) + delta;
    bal.set(m.sku, balance);
    return { ...m, quantity: num(m.quantity), delta, balance };
  });
}

// ---- Summary --------------------------------------------------------------

export function buildSummary(history: HistoryRow[], positions: Position[], expiries: ExpiryGroup[]): SkuSummary[] {
  const m = new Map<string, SkuSummary>();
  const get = (sku: string, description: string, uom: string | null, upp: number | null) => {
    let e = m.get(sku);
    if (!e) {
      e = { sku, description, uom, upp, opening: 0, received: 0, shipped: 0, adjusted: 0, onHand: 0, reserved: 0, held: 0, available: 0,
        pallets: null, bins: 0, ledger: 0, gap: 0, expiries: [], firstSeen: null, lastMove: null };
      m.set(sku, e);
    }
    return e;
  };
  for (const h of history) {
    const e = get(h.sku, h.description, h.uom, null);
    if (h.type === "picking") e.shipped += h.quantity;
    else if (h.type === "adjustment" && h.note?.startsWith("OPENING BALANCE")) e.opening += h.quantity;
    else if (h.type === "adjustment") e.adjusted += h.quantity;
    else if (h.delta > 0) e.received += h.quantity;
    if (!e.firstSeen || h.created_at < e.firstSeen) e.firstSeen = h.created_at;
    if (!e.lastMove || h.created_at > e.lastMove) e.lastMove = h.created_at;
  }
  const bins = new Map<string, Set<string>>();
  for (const p of positions) {
    const e = get(p.sku, p.description, p.uom, p.upp);
    e.upp = e.upp ?? p.upp; e.uom = e.uom ?? p.uom;
    e.onHand += p.quantity; e.reserved += p.reserved; e.held += p.held; e.available += p.available;
    if (p.pallets !== null) e.pallets = (e.pallets ?? 0) + p.pallets;
    (bins.get(p.sku) ?? bins.set(p.sku, new Set()).get(p.sku)!).add(p.bin_code);
  }
  for (const e of m.values()) {
    e.bins = bins.get(e.sku)?.size ?? 0;
    e.ledger = e.opening + e.received - e.shipped + e.adjusted;
    e.gap = e.onHand - e.ledger;
    e.expiries = expiries.filter((x) => x.sku === e.sku);
  }
  return [...m.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

// ---- Where it went --------------------------------------------------------

/** Pick movements grouped per shipment + SKU, latest first. */
export function buildShipments(history: HistoryRow[], outbound: TraceOutbound[]): ShipRow[] {
  const outBy = new Map(outbound.map((o) => [`${o.shipment_number}|${o.sku}`, o]));
  const m = new Map<string, ShipRow & { binSet: Set<string>; expSet: Set<string> }>();
  for (const h of history) {
    if (h.type !== "picking") continue;
    const shipment = h.shipment ?? MANUAL_SHIPMENT;
    const k = `${shipment}|${h.sku}`;
    let e = m.get(k);
    if (!e) {
      const o = outBy.get(k);
      e = { shipment, sku: h.sku, description: h.description, date: h.wave_date ?? jakartaDay(h.created_at), wave: h.wave_no ?? "",
        destination: o?.destination ?? "", truck: o?.truck ?? h.truck ?? null, orders: (o?.order_nos ?? []).join(", "),
        qty: 0, bins: [], expiries: [], last: h.created_at, binSet: new Set(), expSet: new Set() };
      m.set(k, e);
    }
    e.qty += h.quantity;
    if (h.from_bin) e.binSet.add(h.from_bin);
    if (h.expiry_date) e.expSet.add(h.expiry_date);
    if (h.created_at > e.last) e.last = h.created_at;
  }
  return [...m.values()].map(({ binSet, expSet, ...r }) => ({ ...r, bins: [...binSet].sort(), expiries: [...expSet].sort() }))
    .sort((a, b) => b.last.localeCompare(a.last) || a.shipment.localeCompare(b.shipment) || a.sku.localeCompare(b.sku));
}

/** Who received the batch: one row per destination, most cartons first. For a recall this is the call list. */
export function buildDestinations(ships: ShipRow[]): DestinationRow[] {
  const m = new Map<string, DestinationRow & { set: Set<string> }>();
  for (const s of ships) {
    const key = s.destination || (s.shipment === MANUAL_SHIPMENT ? "Pick manual (tanpa shipment)" : "Tujuan tidak tercatat");
    const e = m.get(key) ?? { destination: key, shipments: 0, qty: 0, first: s.date, last: s.date, set: new Set<string>() };
    e.qty += s.qty; e.set.add(s.shipment);
    if (s.date < e.first) e.first = s.date;
    if (s.date > e.last) e.last = s.date;
    m.set(key, e);
  }
  return [...m.values()].map(({ set, ...r }) => ({ ...r, shipments: set.size })).sort((a, b) => b.qty - a.qty || a.destination.localeCompare(b.destination));
}

// ---- What needs attention -------------------------------------------------

export function buildAlerts(a: {
  positions: Position[]; summary: SkuSummary[]; holds: TraceHold[]; nearDays: number; fmtDate: (d: string | null) => string;
}): Alert[] {
  const out: Alert[] = [];
  const { positions, summary, holds, nearDays, fmtDate } = a;
  const n = (v: number) => v.toLocaleString("id-ID");
  const sumQty = (rows: Position[]) => rows.reduce((s, p) => s + p.quantity, 0);
  const binCount = (rows: Position[]) => new Set(rows.map((p) => p.bin_code)).size;

  const batchHold = holds.filter((h) => h.status === "ACTIVE" && h.scope === "BATCH");
  for (const h of batchHold) out.push({ tone: "bad", text: `Seluruh batch untuk SKU ${h.sku} sedang ditahan (${h.reason_code}): ${h.note}. Tidak bisa dipick sampai hold dilepas.` });

  const expired = positions.filter((p) => p.days_remaining !== null && p.days_remaining < 0);
  if (expired.length) out.push({ tone: "bad", text: `${n(sumQty(expired))} unit sudah expired, masih tercatat di ${n(binCount(expired))} bin.` });

  for (const s of summary) for (const g of s.expiries) {
    if (g.mismatch && g.expected) {
      out.push({ tone: "bad", text: `SKU ${s.sku}: expired tercatat ${fmtDate(g.expiry)}, menurut kode batch seharusnya ${fmtDate(g.expected)} (${MISMATCH_LABEL[g.mismatch]}). Perbaiki di Kualitas data.` });
    }
  }
  for (const s of summary) {
    if (s.expiries.length > 1) out.push({ tone: "warn", text: `SKU ${s.sku} punya ${s.expiries.length} tanggal expired berbeda dalam batch ini. Periksa mana yang benar.` });
  }
  const near = positions.filter((p) => p.days_remaining !== null && p.days_remaining >= 0 && p.days_remaining <= nearDays);
  if (near.length) out.push({ tone: "warn", text: `${n(sumQty(near))} unit akan expired dalam ${nearDays} hari (${n(binCount(near))} bin).` });

  const noDate = positions.filter((p) => !p.expiry_date);
  if (noDate.length) out.push({ tone: "warn", text: `${n(sumQty(noDate))} unit tanpa tanggal expired (${n(binCount(noDate))} bin): FEFO tidak bisa mengurutkannya.` });

  const lineHeld = positions.filter((p) => p.held > 0 && p.loc !== "quarantine");
  if (lineHeld.length && batchHold.length === 0) out.push({ tone: "warn", text: `${n(lineHeld.reduce((s, p) => s + p.held, 0))} unit ditahan di ${n(binCount(lineHeld))} bin.` });
  const quarantine = positions.filter((p) => p.loc === "quarantine");
  if (quarantine.length) out.push({ tone: "warn", text: `${n(sumQty(quarantine))} unit ada di karantina.` });
  const blocked = positions.filter((p) => p.bin_status === "blocked");
  if (blocked.length) out.push({ tone: "warn", text: `${n(sumQty(blocked))} unit ada di ${n(binCount(blocked))} bin yang diblokir: tidak akan dipick.` });

  const reserved = positions.reduce((s, p) => s + p.reserved, 0);
  if (reserved > 0) out.push({ tone: "info", text: `${n(reserved)} unit sudah dipesan wave yang belum dikerjakan.` });
  for (const s of summary) {
    if (s.gap !== 0) out.push({ tone: "info", text: `SKU ${s.sku}: stok sekarang ${n(s.onHand)}, menurut riwayat mutasi batch ini ${n(s.ledger)} (selisih ${s.gap > 0 ? "+" : ""}${n(s.gap)}). Sebagian riwayat tercatat dengan kode batch atau SKU lain, mis. sebelum koreksi identitas.` });
  }
  if (positions.length === 0 && summary.length > 0) out.push({ tone: "info", text: "Batch ini sudah tidak ada di gudang: semua sudah keluar." });
  return out;
}

// ---- Finding a batch without its exact code -------------------------------

export type Candidate = {
  batch: string; sku: string; description: string; uom: string | null;
  qty: number; bins: string[]; expiries: string[];
  /** production date read from the batch code, when it is date-coded */
  mfg: string | null;
};

/** Stock rows grouped per batch + SKU, the batch expiring first on top. Stock without a batch code is listed as "". */
export function buildCandidates(stock: TraceStock[]): Candidate[] {
  const m = new Map<string, Candidate & { binSet: Set<string>; expSet: Set<string> }>();
  for (const s of stock) {
    const qty = num(s.quantity);
    if (qty <= 0) continue;
    const k = `${s.batch_lot}|${s.sku}`;
    const e = m.get(k) ?? { batch: s.batch_lot, sku: s.sku, description: s.description, uom: s.uom, qty: 0, bins: [], expiries: [],
      mfg: batchMfgDate(s.batch_lot), binSet: new Set<string>(), expSet: new Set<string>() };
    e.qty += qty; e.binSet.add(s.bin_code);
    if (s.expiry_date) e.expSet.add(s.expiry_date);
    m.set(k, e);
  }
  return [...m.values()].map(({ binSet, expSet, ...r }) => ({ ...r, bins: [...binSet].sort(), expiries: [...expSet].sort() }))
    .sort((a, b) => (a.expiries[0] ?? "9999").localeCompare(b.expiries[0] ?? "9999") || a.sku.localeCompare(b.sku) || a.batch.localeCompare(b.batch));
}

// ---- Excel ----------------------------------------------------------------

export type SheetRow = Record<string, string | number | null>;
export type TraceData = {
  batch: string; skuFilter: string; printedAt: string;
  positions: Position[]; summary: SkuSummary[]; expiries: ExpiryGroup[];
  ships: ShipRow[]; destinations: DestinationRow[]; history: HistoryRow[];
  tasks: TraceTask[]; holds: TraceHold[]; alerts: Alert[];
};

const r1 = (v: number | null) => (v === null ? "" : Math.round(v * 10) / 10);

export function positionRows(positions: Position[]): SheetRow[] {
  return positions.map((p) => ({
    Bin: p.bin_code, Lokasi: LOC_LABEL[p.loc], Aisle: p.rack ? p.zone : "", Level: p.level ?? "", "Status bin": p.bin_status === "blocked" ? "diblokir" : "aktif",
    SKU: p.sku, Deskripsi: p.description, Batch: p.batch_lot, Expired: p.expiry_date ?? "", "Sisa hari": p.days_remaining ?? "",
    Qty: p.quantity, UOM: p.uom ?? "", "Palet (setara)": r1(p.pallets), Dipesan: p.reserved, Ditahan: p.held, "Alasan hold": p.hold_reasons ?? "",
    Tersedia: p.available, "Masuk (Bin To Bin)": p.incoming, Wave: p.waves.join(", "), "Tgl terima": p.received_date ?? "", "Lama di gudang (hari)": p.ageDays ?? "",
  }));
}
export function expiryRows(expiries: ExpiryGroup[]): SheetRow[] {
  return expiries.map((g) => ({
    SKU: g.sku, Expired: g.expiry ?? "", "Sisa hari": g.days ?? "", Qty: g.qty, "Jumlah bin": g.bins.length,
    Bin: g.bins.map((b) => `${b.code} (${b.qty})`).join(", "),
    "Expired menurut kode batch": g.expected ?? "", Catatan: g.mismatch ? MISMATCH_LABEL[g.mismatch] : "",
  }));
}
export function shipmentRows(ships: ShipRow[]): SheetRow[] {
  return ships.map((s) => ({
    Shipment: s.shipment, SKU: s.sku, Deskripsi: s.description, Tanggal: s.date, Wave: s.wave ? `NO ${s.wave}` : "", Tujuan: s.destination,
    Truk: s.truck ?? "", "No order": s.orders, Qty: s.qty, "Dari bin": s.bins.join(", "), Expired: s.expiries.join(", "),
  }));
}
export function historyRows(history: HistoryRow[]): SheetRow[] {
  return history.map((h) => ({
    Waktu: jakartaDateTime(h.created_at), Jenis: MOVE_LABEL[h.type] ?? h.type, SKU: h.sku, Batch: h.batch_lot, Expired: h.expiry_date ?? "",
    Qty: h.quantity, "Efek stok": h.delta, "Saldo batch": h.balance, Dari: h.from_bin ?? "", Ke: h.to_bin ?? "", Shipment: h.shipment ?? "",
    Wave: h.wave_no ? `NO ${h.wave_no}` : "", "Kode alasan": h.reason_code ?? "", Petugas: h.by_name ?? "", Penyetuju: h.approved_by_name ?? "",
    Akun: h.user ?? "sistem", Catatan: h.note ?? "",
  }));
}

/** The whole trace as one workbook: sheet name -> rows. Sheet names stay within Excel's 31 characters. */
export function traceSheets(d: TraceData): Record<string, SheetRow[]> {
  return {
    Ringkasan: d.summary.map((s) => ({
      Batch: d.batch, SKU: s.sku, Deskripsi: s.description, UOM: s.uom ?? "", "Tgl produksi (kode batch)": batchMfgDate(d.batch) ?? "",
      "Saldo awal": s.opening, Diterima: s.received, Dikirim: s.shipped, Penyesuaian: s.adjusted, "Stok sekarang": s.onHand,
      Dipesan: s.reserved, Ditahan: s.held, Tersedia: s.available, "Palet (setara)": r1(s.pallets), "Jumlah bin": s.bins,
      "Expired terdekat": s.expiries[0]?.expiry ?? "", "Saldo menurut riwayat": s.ledger, "Selisih riwayat": s.gap, "Dicetak": d.printedAt,
    })),
    "Posisi sekarang": positionRows(d.positions),
    "Per expired": expiryRows(d.expiries),
    "Dikirim ke": shipmentRows(d.ships),
    "Per tujuan": d.destinations.map((x) => ({ Tujuan: x.destination, Shipment: x.shipments, Qty: x.qty, "Kirim pertama": x.first, "Kirim terakhir": x.last })),
    "Dipesan wave": d.tasks.map((t) => ({
      Wave: `NO ${t.wave_no}`, Tanggal: t.planned_date, Jenis: t.task_type === "REPLENISH" ? "Bin To Bin" : "Pick", Shipment: t.shipment_number ?? "",
      SKU: t.sku, Batch: t.batch_lot, Expired: t.expiry_date ?? "", "Dari bin": t.from_bin, "Ke bin": t.to_bin ?? "", Qty: num(t.quantity),
    })),
    Hold: d.holds.map((h) => ({
      Status: h.status === "ACTIVE" ? "Aktif" : "Dilepas", Cakupan: h.scope === "BATCH" ? "Seluruh batch" : "Satu baris", Bin: h.bin_code ?? "", SKU: h.sku,
      Batch: h.batch_lot, Expired: h.expiry_date ?? "", "Qty ditahan": h.scope === "BATCH" ? num(h.covered_qty) : num(h.quantity), Alasan: h.reason_code,
      Keterangan: h.note, Oleh: h.created_by_name, Sejak: jakartaDateTime(h.created_at), "Dilepas oleh": h.released_by_name ?? "",
      "Dilepas pada": h.released_at ? jakartaDateTime(h.released_at) : "", "Catatan lepas": h.release_note ?? "",
    })),
    Riwayat: historyRows(d.history),
    Peringatan: d.alerts.map((x) => ({ Tingkat: x.tone === "bad" ? "Penting" : x.tone === "warn" ? "Perhatian" : "Info", Keterangan: x.text })),
  };
}

export const traceFileName = (batch: string, part = "") =>
  `lacak-batch_${batch.replace(/[^\w-]+/g, "_") || "tanpa-kode"}${part ? `_${part}` : ""}.xlsx`;
