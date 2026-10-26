import "server-only";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { REPORTS, cellText, reportSummary, type ReportKind, type ReportRow } from "./reports";
import { EXPORT_COLUMNS, exportNotice, exportRows, exportTotals, type ExportHeader, type ExportLineData } from "./export-file";

export type FileMeta = { generatedBy: string; generatedAt: string; filters: string; truncated: boolean };

const head = (kind: ReportKind, m: FileMeta) => [
  `CKB 3PL · ${REPORTS[kind].title}`,
  `Dibuat ${m.generatedAt} oleh ${m.generatedBy}. ${m.filters || "Tanpa filter."}`,
  m.truncated ? "Hasil dipotong: persempit filter untuk laporan lengkap." : "",
].filter(Boolean);

/** Excel: a title block, the headline totals, then the rows exactly as the page shows them. */
export async function reportXlsx(kind: ReportKind, rows: ReportRow[], m: FileMeta): Promise<Buffer> {
  const def = REPORTS[kind];
  const wb = new ExcelJS.Workbook();
  wb.creator = "CKB 3PL";
  const ws = wb.addWorksheet(def.title.slice(0, 31));
  for (const line of head(kind, m)) ws.addRow([line]);
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.addRow(reportSummary(kind, rows).map((s) => `${s.label}: ${s.value}`));
  ws.addRow([]);
  const header = ws.addRow(def.columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7ED" } }; });
  for (const r of rows) {
    ws.addRow(def.columns.map((c) => (c.type === "num" && typeof r[c.key] === "number" ? r[c.key] : cellText(r[c.key], c.type))));
  }
  def.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.type === "num" ? 12 : Math.min(40, Math.max(10, c.header.length + 4)); });
  ws.views = [{ state: "frozen", ySplit: header.number }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** PDF, A4 landscape, same columns. */
export function reportPdf(kind: ReportKind, rows: ReportRow[], m: FileMeta): Uint8Array {
  const def = REPORTS[kind];
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let y = 12;
  doc.setFontSize(13); doc.text(head(kind, m)[0], 10, y); y += 6;
  doc.setFontSize(8);
  for (const line of head(kind, m).slice(1)) { doc.text(doc.splitTextToSize(line, 275), 10, y); y += 4; }
  doc.text(reportSummary(kind, rows).map((s) => `${s.label}: ${s.value}`).join("   ·   "), 10, y); y += 3;
  autoTable(doc, {
    startY: y + 2, head: [def.columns.map((c) => c.header)],
    body: rows.map((r) => def.columns.map((c) => cellText(r[c.key], c.type))),
    styles: { fontSize: 6.5, cellPadding: 1 }, headStyles: { fillColor: [3, 39, 65] }, margin: { left: 10, right: 10 },
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

/** The SAP export worksheet (format CKB-INTERNAL-1), regenerated from the frozen lines. */
export async function sapExportXlsx(h: ExportHeader, lines: { line_no: number; data: ExportLineData }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CKB 3PL";
  const ws = wb.addWorksheet(h.ref_no);
  for (const line of exportNotice(h)) ws.addRow([line]);
  ws.getRow(1).font = { bold: true, size: 13 };
  if (!h.format_verified) ws.getRow(3).font = { bold: true, color: { argb: "FFC0392B" } };
  const t = exportTotals(lines);
  ws.addRow([`Baris: ${t.lines} · Tambah: ${t.gain} · Kurang: ${t.loss}`]);
  ws.addRow([]);
  const header = ws.addRow(EXPORT_COLUMNS.map((c) => c.header));
  header.font = { bold: true };
  for (const r of exportRows(lines)) ws.addRow(r);
  EXPORT_COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
  ws.views = [{ state: "frozen", ySplit: header.number }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
