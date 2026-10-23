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
 */
export function parseFormChecker(
  rows: readonly unknown[][],
): { cards: FormCheckerCard[]; shipments: number } {
  const cards: FormCheckerCard[] = [];
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

  for (const row of rows) {
    if (isBlankRow(row)) {
      // Rule 5: blank row skipped, context preserved
      continue;
    }

    // Read raw values
    const monthRaw = row[FC_COL.MONTH];
    const userNameRaw = row[FC_COL.USER_NAME];
    const shipmentNoRaw = row[FC_COL.SHIPMENT_NO];
    const itemCodeRaw = row[FC_COL.ITEM_CODE];
    const qtyOrderRaw = row[FC_COL.QTY_ORDER];
    const uomRaw = row[FC_COL.UOM];
    const asnNoRaw = row[FC_COL.ASN_NO];
    const vendorAsnNoRaw = row[FC_COL.VENDOR_ASN_NO];
    const actQtyRaw = row[FC_COL.ACT_QTY];
    const actUomRaw = row[FC_COL.ACT_UOM];
    const palletIdRaw = row[FC_COL.PALLET_ID];
    const binLocationRaw = row[FC_COL.BIN_LOCATION];
    const grNoRaw = row[FC_COL.GR_NO];
    const batchNoRaw = row[FC_COL.BATCH_NO];
    const mfgDateRaw = row[FC_COL.MFG_DATE];
    const expDateRaw = row[FC_COL.EXP_DATE];
    const putawayNoRaw = row[FC_COL.PUTAWAY_NO];

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

  return { cards, shipments: seenShipments.size };
}