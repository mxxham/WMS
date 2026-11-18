import ExcelJS from "exceljs";
import { BRAND } from "../config/brand";
import { bayOf, type CheckRow } from "./stockcheck";

/**
 * The list to take to the rack (Cek stok rak): what the system holds, bin by bin in the order of the
 * screen, with empty columns to write what is really there. One sheet per aisle, A4 landscape, header
 * repeated on every printed page. Every colour and border is set on the cells themselves (table styles
 * are not drawn by LibreOffice / WPS, see wms-day-workbook.ts).
 */
export type StockCheckSheet = { aisle: string; rows: CheckRow[] };

const FONT = { name: "Calibri", size: 11 };
const C = { navy: "FF1F3864", band: "FFF3F6FA", line: "FF9AA5B1", write: "FFFFF8DC", head: "FFDDE4EE", grey: "FF7F7F7F" };
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin = { style: "thin" as const, color: { argb: C.line } };
const GRID: Partial<ExcelJS.Borders> = { top: thin, bottom: thin, left: thin, right: thin };
const BAY_TOP = { style: "medium" as const, color: { argb: C.navy } };

/** "YYYY-MM-DD" as a real Excel date (UTC midnight: no timezone shift). */
function asDate(s: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
}

const COLUMNS: { header: string; width: number; write?: boolean }[] = [
  { header: "Bin", width: 11 },
  { header: "SKU", width: 12 },
  { header: "Deskripsi", width: 34 },
  { header: "Batch", width: 13 },
  { header: "Expired", width: 12 },
  { header: "Satuan", width: 8 },
  { header: "Qty sistem", width: 11 },
  { header: "Qty fisik", width: 12, write: true },
  { header: "Batch fisik", width: 14, write: true },
  { header: "Expired fisik", width: 14, write: true },
  { header: "Catatan", width: 24, write: true },
];

export async function buildStockCheckWorkbook(sheets: StockCheckSheet[], meta: { date: string }): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.appName;
  wb.created = new Date();

  for (const s of sheets) {
    const ws = wb.addWorksheet(`Rak ${s.aisle}`, {
      views: [{ state: "frozen", ySplit: 4 }],
      pageSetup: {
        paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
        printTitlesRow: "4:4",
      },
      headerFooter: { oddFooter: "&LCek stok rak " + s.aisle + "&CHalaman &P dari &N&RDiperiksa oleh: ____________" },
    });
    ws.columns = COLUMNS.map((c) => ({ width: c.width }));

    const stockRows = s.rows.filter((r) => r.line);
    const cartons = stockRows.reduce((n, r) => n + Number(r.line!.quantity), 0);
    ws.mergeCells(1, 1, 1, COLUMNS.length);
    const title = ws.getCell(1, 1);
    title.value = `CEK STOK RAK ${s.aisle} · ${BRAND.owner} · ${BRAND.site}`;
    title.font = { ...FONT, size: 15, bold: true, color: { argb: C.navy } };
    ws.mergeCells(2, 1, 2, COLUMNS.length);
    ws.getCell(2, 1).value = `Tanggal sistem: ${meta.date} · ${stockRows.length} baris stok di ${new Set(s.rows.map((r) => r.bin)).size} bin · ${cartons.toLocaleString("id-ID")} karton menurut sistem`;
    ws.getCell(2, 1).font = { ...FONT, color: { argb: C.grey } };
    ws.mergeCells(3, 1, 3, COLUMNS.length);
    ws.getCell(3, 1).value = "Tulis hasil hitung di kolom kuning. Bin kosong yang ternyata berisi: tulis SKU di Catatan. Lalu ketik ke sistem di halaman Cek stok rak.";
    ws.getCell(3, 1).font = { ...FONT, italic: true };

    const head = ws.getRow(4);
    COLUMNS.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.header;
      cell.font = { ...FONT, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = fill(c.write ? "FF9C6500" : C.navy);
      cell.alignment = { vertical: "middle", horizontal: i >= 6 && i <= 7 ? "center" : "left", wrapText: true };
      cell.border = GRID;
    });
    head.height = 24;

    let prevBin = "", prevBay: number | null = null, band = false;
    for (const r of s.rows) {
      const bay = bayOf(r.bin);
      if (bay !== prevBay) { band = !band; }
      const l = r.line;
      const row = ws.addRow([
        r.bin, l?.sku ?? "", l ? l.description : "(kosong)", l?.batch_lot ?? "", asDate(l?.expiry_date ?? null), l?.uom ?? "",
        l ? Number(l.quantity) : null, null, null, null, null,
      ]);
      row.height = 24;
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.font = { ...FONT, bold: col === 1, italic: !l && col === 3, color: !l && col === 3 ? { argb: C.grey } : undefined };
        cell.alignment = { vertical: "middle", horizontal: col === 7 ? "right" : "left", wrapText: col === 3 };
        cell.border = { ...GRID, ...(r.bin !== prevBin && bay !== prevBay ? { top: BAY_TOP } : {}) };
        if (COLUMNS[col - 1]?.write) cell.fill = fill(C.write);
        else if (band) cell.fill = fill(C.band);
      });
      row.getCell(5).numFmt = "dd/mm/yyyy";
      row.getCell(7).numFmt = "#,##0";
      row.getCell(10).numFmt = "dd/mm/yyyy";
      prevBin = r.bin; prevBay = bay;
    }
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Saves the workbook as a file in the browser. */
export async function downloadStockCheck(sheets: StockCheckSheet[], meta: { date: string }, filename: string): Promise<void> {
  const buf = await buildStockCheckWorkbook(sheets, meta);
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
