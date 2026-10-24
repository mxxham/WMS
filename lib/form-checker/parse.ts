/**
 * Form Checker workbook parser — pure, zero I/O.
 * Column indexes are fixed (A..X = 0..23) per docs/FORM_CHECKER_FORMAT.md.
 * The caller reads the sheet, drops the header row, and passes the remaining rows here.
 */
import type { FormCheckerCard } from "./types";

/** Fixed column indexes (A=0 .. X=23) — exported so reader and tests agree. */
export const FC_COL = {
  MONTH: 0,
  USER_NAME: 1,
  SHIPMENT_NO: 2,
  ITEM_CODE: 3,
  QTY_ORDER: 4,
  UOM: 5,
  ASN_NO: 6,
  VENDOR_ASN_NO: 7,
  ACT_QTY: 8,
  ACT_UOM: 9,
  PALLET_ID: 10,
  BIN_LOCATION: 11,
  GR_NO: 12,
  BATCH_NO: 13,
  MFG_DATE: 14,
  EXP_DATE: 15,
  PUTAWAY_NO: 16,
  PRINT_PUTAWAY_SHEET: 17,
  CONTAINER: 18,
  VEHICLE_NO: 19,
  SEAL: 20,
  TRANSPORTER: 21,
  PALLET_LOSCAM: 22,
  PALLET_NON_LOSCAM: 23,
} as const;

/** Canonical header labels for detection (normalized: lowercase, alphanumeric only). */
const CANONICAL_LABELS: Record<keyof typeof FC_COL, string[]> = {
  MONTH: ["month"],
  USER_NAME: ["username", "user"],
  SHIPMENT_NO: ["shipmentno", "shipment"],
  ITEM_CODE: ["itemcode", "item"],
  QTY_ORDER: ["qtyorder", "qty"],
  UOM: ["uom", "orderuom"],
  ASN_NO: ["asnno", "asn"],
  VENDOR_ASN_NO: ["vendorasnno", "vendorasn", "deliveryno", "vendorasnno deliveryno"],
  ACT_QTY: ["actqty", "actualqty", "act"],
  ACT_UOM: ["actuom", "actualuom", "uom2"],
  PALLET_ID: ["palletid", "pallet"],
  BIN_LOCATION: ["binlocation", "bin", "location"],
  GR_NO: ["grno", "gr"],
  BATCH_NO: ["batchno", "batch"],
  MFG_DATE: ["mfgdate", "manufacturedate", "manufacturingdate"],
  EXP_DATE: ["expdate", "expirydate", "expirationdate"],
  PUTAWAY_NO: ["putawayno", "putaway"],
  PRINT_PUTAWAY_SHEET: ["printputawaysheet", "printputaway"],
  CONTAINER: ["container"],
  VEHICLE_NO: ["vehicleno", "vehicle"],
  SEAL: ["seal"],
  TRANSPORTER: ["transporter"],
  PALLET_LOSCAM: ["palletloscam", "loscam"],
  PALLET_NON_LOSCAM: ["palletnonloscam", "nonloscam"],
};

/** Normalize a header cell text for matching. */
function normalizeHeader(text: unknown): string {
  if (text === null || text === undefined) return "";
  const s = String(text).trim().toLowerCase();
  return s.replace(/[^a-z0-9]/g, "");
}

/**
 * Detect column positions from a header row by matching normalized labels.
 * Returns a column map matching FC_COL's keys, or null if detection fails
 * (e.g. too few recognized headers).
 */
export function detectColumns(header: readonly unknown[]): Record<keyof typeof FC_COL, number> | null {
  const found: Partial<Record<keyof typeof FC_COL, number>> = {};
  let uomSeen = 0; // count of UoM-like headers encountered

  for (let i = 0; i < header.length; i++) {
    const norm = normalizeHeader(header[i]);
    if (!norm) continue;

    for (const [key, aliases] of Object.entries(CANONICAL_LABELS)) {
      if (aliases.includes(norm)) {
        const k = key as keyof typeof FC_COL;
        // Special handling for duplicate "UoM": first occurrence -> UOM (order), second -> ACT_UOM
        if (k === "UOM" || k === "ACT_UOM") {
          if (norm === "uom" || norm === "orderuom") {
            // Generic "UoM" header - assign based on occurrence order
            if (uomSeen === 0) {
              found.UOM = i;
              uomSeen++;
            } else if (uomSeen === 1 && !( "ACT_UOM" in found )) {
              found.ACT_UOM = i;
              uomSeen++;
            }
          } else if (k === "ACT_UOM" && uomSeen > 0 && !("ACT_UOM" in found)) {
            // Explicit "Act UoM" header (actuom, actualuom, uom2) after a UoM
            found.ACT_UOM = i;
            uomSeen++;
          } else if (!(k in found)) {
            found[k] = i;
          }
        } else if (!(k in found)) {
          found[k] = i;
        }
        break;
      }
    }
  }

  // Require at least the critical columns to consider detection successful
  const critical: (keyof typeof FC_COL)[] = [
    "MONTH", "USER_NAME", "SHIPMENT_NO", "ITEM_CODE", "ACT_QTY", "PALLET_ID", "BIN_LOCATION",
  ];
  if (critical.some((k) => !(k in found))) return null;

  // Fill any missing with fixed-map defaults (best effort)
  const result: Record<keyof typeof FC_COL, number> = {} as Record<keyof typeof FC_COL, number>;
  for (const k of Object.keys(FC_COL) as (keyof typeof FC_COL)[]) {
    result[k] = found[k] ?? FC_COL[k];
  }
  return result;
}

/** Return type for parseFormChecker with per-shipment row spans. */
export type ParseResult = {
  cards: FormCheckerCard[];
  shipments: number;
  spans: Array<{ shipmentNo: number; dataSetRows: [number, number][] }>;
};

// 1899-12-30 (Excel serial base), anchored in UTC so conversion is identical on every machine.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function isBlankRow(row: readonly unknown[]): boolean {
  return row.every((v) => v === null || v === undefined || v === "");
}

function trimIfString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number") return String(Math.round(v));
  const s = typeof v === "object" ? String((v as { text?: string }).text ?? v) : String(v);
  return s.trim() || null;
}

function excelSerialToDDMMYYYY(serial: number): string {
  // Excel serial: days since 1899-12-30. Fractional part = time of day (ignored).
  const days = Math.floor(serial);
  const ms = EXCEL_EPOCH_MS + days * 86_400_000;
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function maybeDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return excelSerialToDDMMYYYY(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    // If it looks like an Excel serial number stored as text, try to parse.
    const n = Number(t);
    if (!Number.isNaN(n)) return excelSerialToDDMMYYYY(n);
    return t; // already formatted, pass through
  }
  return null;
}

function getNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Parse Form Checker data rows (header already removed).
 * Implements forward-fill grouping rules 1–5 from docs/FORM_CHECKER_FORMAT.md.
 * @param rows Data rows (header already removed)
 * @param columns Optional column map; defaults to FC_COL for backward compatibility
 */
export function parseFormChecker(
  rows: readonly unknown[][],
  columns: Record<keyof typeof FC_COL, number> = FC_COL,
): ParseResult {
  const cards: FormCheckerCard[] = [];
  // Track per-shipment row indices (0-based within the data rows array)
  const shipmentRowIndices: Map<number, number[]> = new Map();
  let currentMonth: string | null = null;
  let currentUserName: string | null = null;
  let currentShipmentNo: number | null = null;
  let currentItemCode: number | null = null;
  let currentQtyOrder: number | null = null;
  let currentUom: string | null = null;
  let currentAsnNo: string | null = null;
  let currentVendorAsnNo: string | null = null;
  let currentGrNo: string | null = null;
  let currentBatchNo: string | null = null;
  let currentMfgDate: string | null = null;
  let currentExpDate: string | null = null;
  let currentPutawayNo: string | null = null;

  const seenShipments = new Set<number>();

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    if (isBlankRow(row)) {
      // Rule 5: blank row skipped, context preserved
      continue;
    }

    // Read raw values using the column map
    const monthRaw = row[columns.MONTH];
    const userNameRaw = row[columns.USER_NAME];
    const shipmentNoRaw = row[columns.SHIPMENT_NO];
    const itemCodeRaw = row[columns.ITEM_CODE];
    const qtyOrderRaw = row[columns.QTY_ORDER];
    const uomRaw = row[columns.UOM];
    const asnNoRaw = row[columns.ASN_NO];
    const vendorAsnNoRaw = row[columns.VENDOR_ASN_NO];
    const actQtyRaw = row[columns.ACT_QTY];
    const actUomRaw = row[columns.ACT_UOM];
    const palletIdRaw = row[columns.PALLET_ID];
    const binLocationRaw = row[columns.BIN_LOCATION];
    const grNoRaw = row[columns.GR_NO];
    const batchNoRaw = row[columns.BATCH_NO];
    const mfgDateRaw = row[columns.MFG_DATE];
    const expDateRaw = row[columns.EXP_DATE];
    const putawayNoRaw = row[columns.PUTAWAY_NO];

    // Rule 1: Shipment No. starts a new shipment (month + user stay with it)
    const shipmentNo = getNumber(shipmentNoRaw);
    if (shipmentNo !== null) {
      currentShipmentNo = shipmentNo;
      seenShipments.add(shipmentNo);
      // Month and user name may be provided on the same row; if not, keep previous
      const m = trimIfString(monthRaw);
      const u = trimIfString(userNameRaw);
      if (m !== null) currentMonth = m;
      if (u !== null) currentUserName = u;
      // New shipment resets item context
      currentItemCode = null;
      currentQtyOrder = null;
      currentUom = null;
      currentAsnNo = null;
      currentVendorAsnNo = null;
      currentGrNo = null;
      currentBatchNo = null;
      currentMfgDate = null;
      currentExpDate = null;
      currentPutawayNo = null;
    } else {
      // No new shipment: month/user may still be provided (forward fill within shipment)
      const m = trimIfString(monthRaw);
      const u = trimIfString(userNameRaw);
      if (m !== null) currentMonth = m;
      if (u !== null) currentUserName = u;
    }

    // Rule 2: Item Code starts a new item inside current shipment
    const itemCode = getNumber(itemCodeRaw);
    if (itemCode !== null) {
      currentItemCode = itemCode;
      const qo = getNumber(qtyOrderRaw);
      const u = trimIfString(uomRaw);
      const a = trimIfString(asnNoRaw);
      const va = trimIfString(vendorAsnNoRaw);
      const g = trimIfString(grNoRaw);
      const b = trimIfString(batchNoRaw);
      const md = maybeDate(mfgDateRaw);
      const ed = maybeDate(expDateRaw);
      const p = trimIfString(putawayNoRaw);
      if (qo !== null) currentQtyOrder = qo;
      if (u !== null) currentUom = u;
      if (a !== null) currentAsnNo = a;
      if (va !== null) currentVendorAsnNo = va;
      if (g !== null) currentGrNo = g;
      if (b !== null) currentBatchNo = b;
      if (md !== null) currentMfgDate = md;
      if (ed !== null) currentExpDate = ed;
      if (p !== null) currentPutawayNo = p;
    } else {
      // No new item: item-context columns may still be provided on this row (override)
      const qo = getNumber(qtyOrderRaw);
      const u = trimIfString(uomRaw);
      const a = trimIfString(asnNoRaw);
      const va = trimIfString(vendorAsnNoRaw);
      const g = trimIfString(grNoRaw);
      const b = trimIfString(batchNoRaw);
      const md = maybeDate(mfgDateRaw);
      const ed = maybeDate(expDateRaw);
      const p = trimIfString(putawayNoRaw);
      if (qo !== null) currentQtyOrder = qo;
      if (u !== null) currentUom = u;
      if (a !== null) currentAsnNo = a;
      if (va !== null) currentVendorAsnNo = va;
      if (g !== null) currentGrNo = g;
      if (b !== null) currentBatchNo = b;
      if (md !== null) currentMfgDate = md;
      if (ed !== null) currentExpDate = ed;
      if (p !== null) currentPutawayNo = p;
    }

    // Rule 3: Row with Act. Qty or Pallet ID = one pallet line of current item
    const actQty = getNumber(actQtyRaw);
    const palletId = getNumber(palletIdRaw);
    if (actQty !== null || palletId !== null) {
      if (currentItemCode === null || currentShipmentNo === null) {
        // Malformed: pallet line without item/shipment context — skip
        continue;
      }
      // Record this row index for the current shipment
      if (currentShipmentNo !== null) {
        const arr = shipmentRowIndices.get(currentShipmentNo) ?? [];
        arr.push(rowIdx);
        shipmentRowIndices.set(currentShipmentNo, arr);
      }
      const card: FormCheckerCard = {
        month: currentMonth ?? "",
        userName: currentUserName ?? "",
        shipmentNo: currentShipmentNo,
        itemCode: currentItemCode,
        qtyOrder: currentQtyOrder ?? 0,
        orderUom: currentUom ?? "",
        asnNo: currentAsnNo ?? null,
        vendorAsnNo: currentVendorAsnNo ?? null,
        actQty,
        actUom: trimIfString(actUomRaw) ?? currentUom ?? "",
        palletId: palletId !== null ? String(palletId) : "",
        binLocation: trimIfString(binLocationRaw) ?? null,
        grNo: currentGrNo,
        batchNo: currentBatchNo,
        mfgDate: currentMfgDate,
        expDate: currentExpDate,
        putawayNo: currentPutawayNo,
      };
      cards.push(card);
    }
    // Rows that only update context (no Act. Qty, no Pallet ID) do not produce a card
  }

  // Build spans: merge adjacent/overlapping row indices per shipment
  const spans: ParseResult["spans"] = [];
  for (const [shipmentNo, indices] of shipmentRowIndices) {
    if (indices.length === 0) continue;
    const sorted = [...indices].sort((a, b) => a - b);
    const ranges: [number, number][] = [];
    let rangeStart = sorted[0];
    let rangeEnd = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] <= rangeEnd + 1) {
        rangeEnd = sorted[i]; // merge adjacent or overlapping
      } else {
        ranges.push([rangeStart, rangeEnd]);
        rangeStart = sorted[i];
        rangeEnd = sorted[i];
      }
    }
    ranges.push([rangeStart, rangeEnd]);
    spans.push({ shipmentNo, dataSetRows: ranges });
  }

  return { cards, shipments: seenShipments.size, spans };
}
