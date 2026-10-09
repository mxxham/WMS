import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { checkDigit, parseLocation } from '../pickpath';
import { binToBin, sisaPrinted, uomLabel } from '../picklist';

import { expiryText, withConfig, type AllocatorConfig } from '../config';
import type { BinToBinRow } from '../picklist-from-tasks';
import type { AllocationResult, PickfaceAssignment, Picklist } from '../types';

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

// ── Page geometry helpers ────────────────────────────────────────────────────

interface PageGeometry {
  pageWidth: number;
  pageHeight: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  contentWidth: number;
  contentBottom: number;
}

function getPageGeometry(doc: jsPDF): PageGeometry {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 14;
  const marginRight = 14;
  const marginTop = 12;
  const marginBottom = 12;
  return {
    pageWidth,
    pageHeight,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    contentWidth: pageWidth - marginLeft - marginRight,
    contentBottom: pageHeight - marginBottom,
  };
}

function wrapText(doc: jsPDF, text: string, width: number): string[] {
  return doc.splitTextToSize(text, width);
}

// ── Layout constants ─────────────────────────────────────────────────────────

const SIGNATURE_GAP = 8;
const SIGNATURE_LINE_OFFSET = 22;
const PAGE_NUMBER_RESERVE = 5;
const SIGNATURE_BLOCK_HEIGHT = SIGNATURE_GAP + SIGNATURE_LINE_OFFSET + PAGE_NUMBER_RESERVE;

// ── Picklist header ──────────────────────────────────────────────────────────

function picklistHeaderHeight(doc: jsPDF, pl: Picklist, geo: PageGeometry): number {
  let h = 9;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const row1Parts = [
    `NO (Wave): ${pl.waveNo}`,
    `Slot: ${pl.slotTime ?? '-'}`,
    `Truck: ${pl.truckType ?? '-'}`,
    `Total: ${pl.totalCartons} ctn / ${pl.lines.length} stop`,
  ];
  const row1Lines = wrapText(doc, row1Parts.join('   |   '), geo.contentWidth);
  h += row1Lines.length * 5 + 1;

  const tujuanLines = wrapText(doc, `Tujuan: ${escape(pl.destination)} — ${escape(pl.shipToLocation)}`, geo.contentWidth);
  h += tujuanLines.length * 5 + 1;

  const doText = pl.orderNos.length ? pl.orderNos.join(', ') : '-';
  const doLines = wrapText(doc, `DO Number: ${doText}`, geo.contentWidth);
  h += doLines.length * 5 + 1;

  if (pl.shortages?.length) {
    doc.setFont('helvetica', 'bold');
    h += wrapText(doc, shortageText(pl), geo.contentWidth).length * 5 + 1;
    doc.setFont('helvetica', 'normal');
  }

  const printedDate = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const printedLines = wrapText(doc, `Printed: ${printedDate}`, geo.contentWidth);
  h += printedLines.length * 5 + 4;

  return h;
}

function drawPicklistHeader(doc: jsPDF, pl: Picklist, geo: PageGeometry): void {
  let y = geo.marginTop;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`PICKLIST ${pl.picklistId}`, geo.marginLeft, y + 4);
  y += 9;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const row1Parts = [
    `NO (Wave): ${pl.waveNo}`,
    `Slot: ${pl.slotTime ?? '-'}`,
    `Truck: ${pl.truckType ?? '-'}`,
    `Total: ${pl.totalCartons} ctn / ${pl.lines.length} stop`,
  ];
  const row1Lines = wrapText(doc, row1Parts.join('   |   '), geo.contentWidth);
  for (const line of row1Lines) {
    doc.text(line, geo.marginLeft, y + 4);
    y += 5;
  }
  y += 1;

  const tujuanLines = wrapText(doc, `Tujuan: ${escape(pl.destination)} — ${escape(pl.shipToLocation)}`, geo.contentWidth);
  for (const line of tujuanLines) {
    doc.text(line, geo.marginLeft, y + 4);
    y += 5;
  }
  y += 1;

  const doText = pl.orderNos.length ? pl.orderNos.join(', ') : '-';
  const doLines = wrapText(doc, `DO Number: ${doText}`, geo.contentWidth);
  for (const line of doLines) {
    doc.text(line, geo.marginLeft, y + 4);
    y += 5;
  }
  y += 1;

  // The truck leaves short: said on the paper, so picker, checker and driver know before loading.
  if (pl.shortages?.length) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(192, 57, 43);
    for (const line of wrapText(doc, shortageText(pl), geo.contentWidth)) {
      doc.text(line, geo.marginLeft, y + 4);
      y += 5;
    }
    y += 1;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
  }

  const printedDate = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  doc.text(`Printed: ${printedDate}`, geo.marginLeft, y + 4);
}

function shortageText(pl: Picklist): string {
  const list = pl.shortages ?? [];
  const total = list.reduce((n, s) => n + s.qtyShort, 0);
  return `KURANG ${total} ctn: ${list.map((s) => `${s.sku} x${s.qtyShort}`).join(', ')}`;
}

function drawSignatures(doc: jsPDF, finalY: number, geo: PageGeometry): void {
  const footY = finalY + SIGNATURE_GAP;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Picker', geo.marginLeft, footY);
  doc.text('Checker', 90, footY);
  doc.text('Admin / Supervisor', 160, footY);
  doc.line(geo.marginLeft, footY + SIGNATURE_LINE_OFFSET, 70, footY + SIGNATURE_LINE_OFFSET);
  doc.line(90, footY + SIGNATURE_LINE_OFFSET, 146, footY + SIGNATURE_LINE_OFFSET);
  doc.line(160, footY + SIGNATURE_LINE_OFFSET, 216, footY + SIGNATURE_LINE_OFFSET);
}

// ── Page numbering ───────────────────────────────────────────────────────────

export type PdfPageRange = {
  startPage: number;
  endPage: number;
};

export function stampPageNumbers(doc: jsPDF, pageRanges?: PdfPageRange[]): void {
  const geo = getPageGeometry(doc);

  if (pageRanges) {
    for (const range of pageRanges) {
      const picklistPageCount = range.endPage - range.startPage + 1;
      for (let p = 0; p < picklistPageCount; p++) {
        doc.setPage(range.startPage + p);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`Page ${p + 1} of ${picklistPageCount}`, geo.pageWidth - geo.marginRight, geo.pageHeight - 5, { align: 'right' });
      }
    }
  } else {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`Page ${i} of ${pageCount}`, geo.pageWidth - geo.marginRight, geo.pageHeight - 5, { align: 'right' });
    }
  }
}

// ── Picklist column widths (A4 landscape content = 268mm) ────────────────────

const PICKLIST_COL_WIDTHS = [10, 30, 22, 50, 26, 20, 20, 14, 20, 12, 10] as const;
// idx:  0-No  1-Lokasi  2-Material  3-Description  4-DO  5-BinToBin  6-Batch  7-ExpDate  8-QtyPick  9-UOM  10-Sisa

// ── Picklist PDF rendering ──────────────────────────────────────────────────

export function renderPicklistPdfPage(doc: jsPDF, pl: Picklist, pickfaces?: Map<string, { location: string }>) {
  const geo = getPageGeometry(doc);
  const headerH = picklistHeaderHeight(doc, pl, geo);
  const tableStartY = geo.marginTop + headerH;

  const head = [['No', 'Lokasi', 'Material', 'Description', 'Bin To Bin', 'Batch', 'Exp Date', 'Qty Pick', 'UOM', 'Sisa', '']];
  const body: any[][] = [];
  let lastPickType: string | null = null;
  for (const l of pl.lines) {
    if (lastPickType !== l.pickType) {
      const label = l.pickType === 'CASE' ? '— HANDPICK / ECERAN —' : '— FORKLIFT / FULL PALLET —';
      body.push([{ content: label, colSpan: 11, styles: { pageBreak: 'before', fillColor: [230, 230, 230], fontStyle: 'bold', halign: 'center', textColor: [0, 0, 0] } }]);
      lastPickType = l.pickType;
    }
    // The recorded pallet-break move (relocateByWaveOrder), never guessed here.
    const keLokasi = binToBin(l);
    body.push([
      String(l.seq),
      l.location,
      l.sku,
      escape(l.description),
      keLokasi,
      l.batch ?? '-',
      expiryText(l.expiryDate),
      String(l.qtyPick),
      `${uomLabel(l.uom)}${l.breaksPallet ? ' buka palet' : ''}`,
      String(sisaPrinted(l)),
      '',
    ]);
  }

  autoTable(doc, {
    startY: tableStartY,
    head,
    body,
    theme: 'grid',
    pageBreak: 'auto',
    rowPageBreak: 'auto',
    showHead: 'everyPage',
    margin: {
      left: geo.marginLeft,
      right: geo.marginRight,
      top: tableStartY,
      bottom: SIGNATURE_BLOCK_HEIGHT,
    },
    styles: {
      fontSize: 10,
      cellPadding: 1.5,
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      lineColor: [0, 0, 0],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 10,
      lineWidth: 0.2,
      lineColor: [0, 0, 0],
    },
    columnStyles: {
      1: { fontStyle: 'bold' },
      3: { overflow: 'linebreak' },
      4: { fontStyle: 'bold' },
      7: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'center' },
    },
    didDrawPage() {
      drawPicklistHeader(doc, pl, geo);
    },
    didDrawCell(data: any) {
      if (data.column.index === 10 && data.section === 'body') {
        const { x, y, width, height } = data.cell;
        const size = Math.min(width, height) * 0.5;
        const cx = x + width / 2 - size / 2;
        const cy = y + height / 2 - size / 2;
        doc.rect(cx, cy, size, size);
      }
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? tableStartY + 20;
  drawSignatures(doc, finalY, geo);
}

// ── Generate all picklist PDFs ──────────────────────────────────────────────

export function generatePicklistPdfs(
  result: AllocationResult,
  config?: AllocatorConfig,
  pickfaces?: Map<string, PickfaceAssignment>,
): { name: string; data: Uint8Array }[] {
  const cfg = config ?? withConfig();
  const pdfs: { name: string; data: Uint8Array }[] = [];

  for (const pl of result.picklists) {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    renderPicklistPdfPage(doc, pl, pickfaces);
    stampPageNumbers(doc);
    const data = new Uint8Array(doc.output('arraybuffer'));
    const name = `picklist_${pl.picklistId}.pdf`;
    pdfs.push({ name, data });
  }

  return pdfs;
}

// ── Bin To Bin work sheet (A4 landscape content = 268mm) ────────────────────

const BIN_TO_BIN_COL_WIDTHS = [10, 26, 26, 24, 41, 30, 24, 22, 14, 17, 19, 12] as const;
// idx:  0-No  1-Dari Bin  2-Ke Bin  3-Material  4-Description  5-Shipment  6-Batch  7-ExpDate  8-Qty  9-UOM  10-Wave NO  11-(check)

const BIN_TO_BIN_COLS = 12;
const BIN_TO_BIN_CHECK_COL = 11;

function printedStamp(): string {
  return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function binToBinTitle(rows: BinToBinRow[], opts?: { date?: string }): string {
  const today = new Date().toLocaleDateString('en-CA');
  return `BIN TO BIN — ${opts?.date ?? rows[0]?.planned_date ?? today}`;
}

function binToBinTotals(rows: BinToBinRow[]): string {
  const cartons = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
  return `Total: ${rows.length} move / ${cartons} ctn`;
}

function binToBinHeaderHeight(doc: jsPDF, rows: BinToBinRow[], geo: PageGeometry): number {
  let h = 9;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  h += wrapText(doc, `Printed: ${printedStamp()}`, geo.contentWidth).length * 5 + 1;
  h += wrapText(doc, binToBinTotals(rows), geo.contentWidth).length * 5 + 4;

  return h;
}

function drawBinToBinHeader(doc: jsPDF, rows: BinToBinRow[], opts: { date?: string } | undefined, geo: PageGeometry): void {
  let y = geo.marginTop;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(binToBinTitle(rows, opts), geo.marginLeft, y + 4);
  y += 9;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  for (const line of wrapText(doc, `Printed: ${printedStamp()}`, geo.contentWidth)) {
    doc.text(line, geo.marginLeft, y + 4);
    y += 5;
  }
  y += 1;
  doc.text(binToBinTotals(rows), geo.marginLeft, y + 4);
}

/** Every planned bin-to-bin move on one sheet: no signature block, a check box per move. */
export function renderBinToBinPdfPage(doc: jsPDF, rows: BinToBinRow[], opts?: { date?: string }): void {
  const geo = getPageGeometry(doc);
  const headerH = binToBinHeaderHeight(doc, rows, geo);
  const tableStartY = geo.marginTop + headerH;

  const head = [['No', 'Dari Bin', 'Ke Bin', 'Material', 'Description', 'Shipment', 'Batch', 'Exp Date', 'Qty', 'UOM', 'Wave NO', '']];
  const body: any[][] = [];
  let lastAisle: string | null = null;
  for (const r of rows) {
    if (r.aisle !== lastAisle) {
      body.push([{ content: `— LORONG ${r.aisle} —`, colSpan: BIN_TO_BIN_COLS, styles: { pageBreak: 'before', fillColor: [230, 230, 230], fontStyle: 'bold', halign: 'center', textColor: [0, 0, 0] } }]);
      lastAisle = r.aisle;
    }
    body.push([
      String(r.seq),
      r.from_bin,
      r.to_bin,
      r.sku,
      escape(r.description),
      r.shipment_number,
      r.batch_lot,
      r.expiry_date,
      String(r.quantity),
      r.uom,
      r.wave_no,
      '',
    ]);
  }

  autoTable(doc, {
    startY: tableStartY,
    head,
    body,
    theme: 'grid',
    pageBreak: 'auto',
    rowPageBreak: 'auto',
    showHead: 'everyPage',
    margin: {
      left: geo.marginLeft,
      right: geo.marginRight,
      top: tableStartY,
      bottom: SIGNATURE_BLOCK_HEIGHT,
    },
    styles: {
      fontSize: 10,
      cellPadding: 1.5,
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      lineColor: [0, 0, 0],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 10,
      lineWidth: 0.2,
      lineColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: BIN_TO_BIN_COL_WIDTHS[0] },
      1: { cellWidth: BIN_TO_BIN_COL_WIDTHS[1], fontStyle: 'bold' },
      2: { cellWidth: BIN_TO_BIN_COL_WIDTHS[2], fontStyle: 'bold' },
      3: { cellWidth: BIN_TO_BIN_COL_WIDTHS[3] },
      4: { cellWidth: BIN_TO_BIN_COL_WIDTHS[4], overflow: 'linebreak' },
      5: { cellWidth: BIN_TO_BIN_COL_WIDTHS[5] },
      6: { cellWidth: BIN_TO_BIN_COL_WIDTHS[6] },
      7: { cellWidth: BIN_TO_BIN_COL_WIDTHS[7], halign: 'right' },
      8: { cellWidth: BIN_TO_BIN_COL_WIDTHS[8], halign: 'right' },
      9: { cellWidth: BIN_TO_BIN_COL_WIDTHS[9], halign: 'right' },
      10: { cellWidth: BIN_TO_BIN_COL_WIDTHS[10] },
      11: { cellWidth: BIN_TO_BIN_COL_WIDTHS[11], halign: 'center' },
    },
    didDrawPage() {
      drawBinToBinHeader(doc, rows, opts, geo);
    },
    didDrawCell(data: any) {
      if (data.column.index === BIN_TO_BIN_CHECK_COL && data.section === 'body') {
        const { x, y, width, height } = data.cell;
        const size = Math.min(width, height) * 0.5;
        const cx = x + width / 2 - size / 2;
        const cy = y + height / 2 - size / 2;
        doc.rect(cx, cy, size, size);
      }
    },
  });
}

// ── Blank picklist PDF rendering ────────────────────────────────────────────

export function renderBlankPicklistPdf(
  doc: jsPDF,
  opts?: { rowCount?: number; title?: string },
): void {
  const geo = getPageGeometry(doc);
  const rowCount = opts?.rowCount ?? 20;
  const title = opts?.title ?? 'BLANK PICKLIST';

  // ── Header ──────────────────────────────────────────────────────────────
  let y = geo.marginTop;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, geo.marginLeft, y + 4);
  y += 9;

  const printedDate = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Printed: ${printedDate}`, geo.marginLeft, y + 4);
  y += 9;

  // ── Table ───────────────────────────────────────────────────────────────
  const head = [['No', 'Lokasi', 'Material', 'Description', 'Bin To Bin', 'Batch', 'Exp Date', 'Qty Pick', 'UOM', 'Sisa', '']];
  const body: any[][] = [];
  for (let i = 1; i <= rowCount; i++) {
    body.push([String(i), '', '', '', '', '', '', '', '', '', '']);
  }

  autoTable(doc, {
    startY: y,
    head,
    body,
    theme: 'grid',
    pageBreak: 'auto',
    rowPageBreak: 'auto',
    showHead: 'everyPage',
    margin: {
      left: geo.marginLeft,
      right: geo.marginRight,
      top: y,
      bottom: SIGNATURE_BLOCK_HEIGHT,
    },
    styles: {
      fontSize: 10,
      cellPadding: 1.5,
      textColor: [0, 0, 0],
      lineWidth: 0.2,
      lineColor: [0, 0, 0],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 10,
      lineWidth: 0.2,
      lineColor: [0, 0, 0],
    },
    alternateRowStyles: {
      fillColor: [240, 240, 240],
    },
    columnStyles: {
      1: { fontStyle: 'bold' },
      3: { overflow: 'linebreak' },
      4: { fontStyle: 'bold' },
      7: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'center' },
    },
    didDrawPage() {
      let pageY = geo.marginTop;
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(title, geo.marginLeft, pageY + 4);
      pageY += 9;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Printed: ${printedDate}`, geo.marginLeft, pageY + 4);
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? y + 20;
  drawSignatures(doc, finalY, geo);
}

export function generateBlankPicklistPdf(
  opts?: { rowCount?: number; title?: string },
): { name: string; data: Uint8Array }[] {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  renderBlankPicklistPdf(doc, opts);
  stampPageNumbers(doc);
  const data = new Uint8Array(doc.output('arraybuffer'));
  const name = `blank_picklist_${Date.now()}.pdf`;
  return [{ name, data }];
}
