import { assignWaves } from '../wave-numbers';
import * as XLSX from 'xlsx';
import { isStagingLocation, NO_EXPIRY, type AllocatorConfig } from '../config';
import { stagingBin } from '../staging';
import { parseLocation } from '../pickpath';
import type { DemandLine, StockBin, Warning } from '../types';
import { addOrder } from '../orders';
import { lookupUom } from '../uom-master';
import { excelBatchText, excelDateUtc, excelSerialToUtc, fractionTimeHHMM, sheetTimeHHMM } from '../excel-date';
import { fileDate } from '../earlier-waves';

export const SHEETS = {
  stock: 'WMS',
  stockHeaderRow: 4, // 1-based row holding the column names
  demand: 'Schedule of the day',
  master: 'MASTER DATA',
} as const;

export interface LoadedData {
  stock: StockBin[];
  demand: DemandLine[];
  stagedBySku: Map<string, number>;
  master: Map<string, { description: string; upp: number; uom: string }>;
  warnings: Warning[];
  /** the sheet the demand was read from: "Schedule of the day", or one day's sheet of a planning file */
  scheduleSheet: string | null;
  /** false when the workbook has no WMS stock sheet (a planning-outbound file): stock must come from the database */
  hasStock: boolean;
}

/** A sheet the demand can be read from: its name, header row (1-based) and day, when known. */
export interface ScheduleSheet { name: string; headerRow: number; day: string | null }

const SCHEDULE_COLUMNS = ['Shipment Number', 'Material', 'Delivery quantity'];

/**
 * Every sheet holding outbound demand. The WMS file has one, "Schedule of the day".
 * The raw "Planning Outbound" file has one sheet per day ("1 Oktober 2026", ...): a title,
 * the day as a date cell in column A, then the same columns as "Schedule of the day" on row 4.
 */
export function scheduleSheets(wb: XLSX.WorkBook): ScheduleSheet[] {
  const found: ScheduleSheet[] = [];
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, range: 0 }).slice(0, 10);
    const idx = aoa.findIndex((r) => SCHEDULE_COLUMNS.every((c) => (r ?? []).some((v) => String(v ?? '').trim() === c)));
    if (idx < 0) continue;
    // The day: the sheet name ("20 Oktober 2026 "), else a date cell above the header.
    let day = fileDate(name);
    if (!day) {
      const cell = aoa.slice(0, idx).map((r) => r?.[0]).find((v) => v instanceof Date || (typeof v === 'number' && v > 20000));
      const d = cell === undefined ? null : asDate(cell);
      day = d ? d.toISOString().slice(0, 10) : null;
    }
    found.push({ name, headerRow: idx + 1, day });
  }
  return found;
}

/**
 * The demand sheet for a run on `asOf`: "Schedule of the day" when present, the only
 * schedule sheet, or the planning file's sheet for that day. Throws (Indonesian, shown on
 * the page) when none fits, naming the days the file does have.
 */
export function pickScheduleSheet(wb: XLSX.WorkBook, asOf: Date): ScheduleSheet {
  const all = scheduleSheets(wb);
  const named = all.find((s) => s.name === SHEETS.demand);
  if (named) return named;
  if (all.length === 1) return all[0];
  const day = asOf.toISOString().slice(0, 10);
  const match = all.filter((s) => s.day === day);
  if (match.length === 1) return match[0];
  if (all.length === 0) throw new Error('Tidak ada sheet jadwal di file ini (kolom "Shipment Number", "Material", "Delivery quantity" tidak ditemukan).');
  if (match.length > 1) throw new Error(`File ini punya ${match.length} sheet untuk ${day}: ${match.map((s) => `"${s.name.trim()}"`).join(', ')}.`);
  const days = all.map((s) => s.day ?? s.name.trim()).join(', ');
  throw new Error(`File perencanaan ini tidak punya sheet untuk tanggal ${day}. Tanggal yang ada: ${days}.`);
}

/** Same field mapping and rules as adapters/excel-input.ts, for the in-browser workbook. */
export function loadWorkbookFromBuffer(buffer: ArrayBuffer, config: AllocatorConfig): LoadedData {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const warnings: Warning[] = [];

  const master = new Map<string, { description: string; upp: number; uom: string }>();
  for (const row of wb.Sheets[SHEETS.master] ? sheetRows(wb, SHEETS.master, 1) : []) {
    const sku = asSku(row['Material']);
    if (!sku) continue;
    master.set(sku, { description: asString(row['Material Description']), upp: asNumber(row['UPP']) || 1, uom: asString(row['UOM']) || 'CAR' });
  }

  const stock: StockBin[] = [];
  const stagedBySku = new Map<string, number>();
  const seenBins = new Map<string, number>();

  // A planning-outbound file has no stock sheet: the page then plans against the database only.
  const hasStock = Boolean(wb.Sheets[SHEETS.stock]);
  for (const row of hasStock ? sheetRows(wb, SHEETS.stock, SHEETS.stockHeaderRow) : []) {
    const location = asString(row['Lokasi']).toUpperCase();
    if (!location) continue;

    const qty = asNumber(row['Remain Qty']);
    if (qty <= 0) continue;

    if (isStagingLocation(location, config)) {
      const sku = asSku(row['item']);
      if (!sku) continue;
      const upp = asNumber(row['UPP']) || master.get(sku)?.upp || 1;
      stock.push(stagingBin(location, sku, excelBatchText(row['Batch']) || null, asDate(row['Expired Date']) ?? NO_EXPIRY, qty, upp, {
        description: asString(row['Description']) || master.get(sku)?.description || '',
        grDate: asDate(row['GR date']),
        uom: lookupUom(sku) || asString(row['uom']) || master.get(sku)?.uom || null,
      }));
      continue;
    }
    if (config.excludedLocations.some((x) => location === x.toUpperCase())) continue;

    const parsed = parseLocation(location);
    if (!parsed || !config.rackLocationPattern.test(location)) {
      warnings.push({ level: 'INFO', code: 'NON_RACK_LOCATION', message: `${location} is not a rack bin — excluded`, context: { location, qty } });
      continue;
    }

    const status = asString(row['status']);
    if (status && !config.pickableStatuses.includes(status)) {
      warnings.push({ level: 'WARN', code: 'BIN_NOT_ACTIVE', message: `${location} has status "${status}" — excluded`, context: { location } });
      continue;
    }

    const sku = asSku(row['item']);
    if (!sku) {
      warnings.push({ level: 'ERROR', code: 'MISSING_SKU', message: `${location} holds ${qty} cartons with no item code`, context: { location } });
      continue;
    }

    const expiryDate = asDate(row['Expired Date']);
    if (!expiryDate) {
      warnings.push({ level: 'ERROR', code: 'MISSING_EXPIRY', message: `${location} ${sku} has no expiry date — cannot be allocated under FEFO`, context: { location, sku } });
      continue;
    }

    const upp = asNumber(row['UPP']) || master.get(sku)?.upp || 1;
    const batch = excelBatchText(row['Batch']) || null;
    const binId = `${location}|${sku}|${batch ?? 'NOBATCH'}`;
    seenBins.set(location, (seenBins.get(location) ?? 0) + 1);

    stock.push({
      binId,
      location,
      aisle: parsed.aisle,
      bay: parsed.bay,
      level: parsed.level,
      position: parsed.position,
      sku,
      description: asString(row['Description']) || master.get(sku)?.description || '',
      batch,
      expiryDate,
      grDate: asDate(row['GR date']),
      qtyCartons: qty,
      upp,
      uom: lookupUom(sku) || asString(row['uom']) || master.get(sku)?.uom || null,
      isFullPallet: qty >= upp,
    });
  }

  for (const [location, count] of seenBins) {
    if (count > 1) {
      warnings.push({ level: 'WARN', code: 'DUPLICATE_BIN', message: `${location} appears ${count} times in the stock sheet`, context: { location, count } });
    }
  }

  const merged = new Map<string, DemandLine>();
  // NO per shipment: filled down within a shipment, never across shipments (wave-numbers.ts).
  const schedule = pickScheduleSheet(wb, config.asOf);
  const demandRows = [...sheetRows(wb, schedule.name, schedule.headerRow)];
  const waves = assignWaves(demandRows.map((row) => ({ shipment: asString(row['Shipment Number']), no: asString(row['NO']) })));
  const waveByShipment = waves.waveByShipment;
  warnings.push(...waves.warnings);

  for (const row of demandRows) {
    const sku = asSku(row['Material']);
    const shipmentNumber = asString(row['Shipment Number']);
    const qty = asNumber(row['Delivery quantity']);

    if (!sku || !shipmentNumber || qty <= 0) continue;

    const waveNo = waveByShipment.get(shipmentNumber) ?? shipmentNumber;

    const key = `${shipmentNumber}|${sku}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qtyCartons += qty;
      existing.orderNos.push(asString(row['Order No']));
      addOrder(existing.orders!, asString(row['Order No']), qty);
      continue;
    }
    merged.set(key, {
      shipmentNumber,
      waveNo,
      orderNos: [asString(row['Order No'])],
      // Each DO's own cartons, so every pick line can name its real DO (orders.ts).
      orders: [{ orderNo: asString(row['Order No']), qty }],
      sku,
      description: asString(row['Description']) || master.get(sku)?.description || '',
      qtyCartons: qty,
      // 0 when neither the row nor a master knows it (planning file): the allocator then takes the bin's UPP.
      upp: asNumber(row['upp']) || master.get(sku)?.upp || (master.size ? 1 : 0),
      destination: asString(row['Destination']),
      shipToLocation: asString(row['Location of the ship-to party']),
      transport: asString(row['TRANSPORT']) || null,
      truckType: asString(row['Type Truck']) || null,
      slotTime: asTime(row['Arrival Slot Time']),
      deliveryDate: asDate(row['First Delivery Date']),
    });
  }

  const byShipment = new Map<string, DemandLine[]>();
  for (const d of merged.values()) {
    const list = byShipment.get(d.shipmentNumber);
    if (list) list.push(d);
    else byShipment.set(d.shipmentNumber, [d]);
  }
  for (const list of byShipment.values()) {
    const slot = list.find((d) => d.slotTime)?.slotTime ?? null;
    const truck = list.find((d) => d.truckType)?.truckType ?? null;
    const transport = list.find((d) => d.transport)?.transport ?? null;
    for (const d of list) {
      d.slotTime ??= slot;
      d.truckType ??= truck;
      d.transport ??= transport;
    }
  }

  return { stock, demand: [...merged.values()], stagedBySku, master, warnings, scheduleSheet: schedule.name, hasStock };
}

type Row = Record<string, unknown>;

function sheetRows(wb: XLSX.WorkBook, sheetName: string, headerRow: number): Row[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found in workbook`);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  const headers = (aoa[headerRow - 1] ?? []).map((h) => String(h ?? '').trim());
  const rows: Row[] = [];
  for (let i = headerRow; i < aoa.length; i++) {
    const line = aoa[i];
    if (!line || line.every((v) => v === null || v === '')) continue;
    const obj: Row = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = line[idx] ?? null;
    });
    rows.push(obj);
  }
  return rows;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function asNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function asSku(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return String(Math.round(v));
  const s = String(v).trim();
  return /^\d+(\.0+)?$/.test(s) ? String(Math.round(Number(s))) : s;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return excelDateUtc(v);
  }
  if (typeof v === 'number' && v > 20000) return excelSerialToUtc(v);
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function asTime(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : sheetTimeHHMM(v);
  // A time cell without a time format arrives as the bare day fraction.
  if (typeof v === 'number') return v > 0 && v < 1 ? fractionTimeHHMM(v) : null;
  const s = asString(v);
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(s);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const min = m[2];
  const suffix = m[3]?.toUpperCase();
  if (suffix === 'PM' && hour < 12) hour += 12;
  if (suffix === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${min}`;
}
