/**
 * Two kinds of file go through the Import page (both read from the WMS sheet, same column mapping):
 *  - `wms`: the regular daily WMS workbook. Remain Qty is the stock after the day's picks; the admin chooses
 *    between replacing the whole stock and updating only the listed rows.
 *  - `opname`: the stock-opname result (e.g. "STOCK TAKE 22 NOV' 2026"): the same sheet plus audit columns
 *    (CC, audit remain qty, Qty fisik ...). Its counted stock is the `on hand` column: a formula (Qty + putaway)
 *    until the team types the physical number over it (114 cells on the 22 Nov 2026 file, e.g. CE01D01 = 0 while
 *    Qty says 48). Remain Qty is NOT the count (it sums to 65,970, `on hand` to the sheet's own 64,883), and the
 *    `Qty fisik` columns are empty. The file is the whole warehouse, so it always replaces the stock.
 */
export type ImportKind = "wms" | "opname";

export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  wms: "WMS harian",
  opname: "Hasil stock opname",
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const OPNAME_TEXT = /stock\s*(take|opname)|stok\s*opname/;
const OPNAME_HEADERS = ["audit remain qty", "qty fisik", "cek kedua"];

function labelAbove(rows: unknown[][], headerRow: number): string | null {
  for (let r = 0; r < Math.min(headerRow, 6); r++) {
    const hit = (rows[r] ?? []).find((c) => typeof c === "string" && OPNAME_TEXT.test(norm(c)));
    if (typeof hit === "string") return hit.trim();
  }
  return null;
}

/** Guesses the kind from the rows of the sheet (as read by readSheet); the admin can override it on the page. */
export function detectImportKind(rows: unknown[][], headerRow: number): ImportKind {
  if (labelAbove(rows, headerRow)) return "opname"; // a label above the header, e.g. K1 "STOCK TAKE 22 NOV' 2026"
  const header = (rows[headerRow] ?? []).map(norm);
  return OPNAME_HEADERS.filter((h) => header.includes(h)).length >= 2 ? "opname" : "wms";
}

/** The count's own label ("STOCK TAKE 22 NOV' 2026"), for the screen; null when the sheet has none. */
export function opnameLabel(rows: unknown[][], headerRow: number): string | null {
  return labelAbove(rows, headerRow);
}

/**
 * Quantity the sheet itself declares as its total (a numeric cell above the header row, in the quantity column:
 * 64,883 over `on hand` on the 22 Nov file). null when the sheet carries none.
 */
export function declaredTotal(rows: unknown[][], headerRow: number, qtyCol: number | undefined): number | null {
  if (qtyCol === undefined) return null;
  for (let r = headerRow - 1; r >= 0; r--) {
    const v = (rows[r] ?? [])[qtyCol];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * How many data rows carry a number in the `on hand` column. A stock-opname file counts by that column (blank =
 * nothing on the shelf) only when it holds numbers; with no column or an empty one the import falls back to
 * Remain Qty and says so, rather than zeroing the warehouse.
 */
export function countColumnFill(rows: unknown[][], headerRow: number, col: number | undefined): number {
  if (col === undefined) return 0;
  let n = 0;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const v = (rows[i] ?? [])[col];
    if (typeof v === "number" ? Number.isFinite(v) : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) n++;
  }
  return n;
}
