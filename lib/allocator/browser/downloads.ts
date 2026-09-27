import { jsPDF } from 'jspdf';
import { renderPicklistPdfPage, stampPageNumbers, type PdfPageRange } from '../adapters/pdf-output';
import type { AllocationResult, MovementRow, PickfaceAssignment, Picklist } from '../types';
import { buildWorkbook, downloadWorkbook } from './browser-output';

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Every picklist in one A4-landscape PDF, page numbers restarting per picklist. */
export function downloadPicklistPdf(
  picklists: Picklist[],
  pickfaces: Map<string, { location: string }> | undefined,
  filename: string,
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const ranges: PdfPageRange[] = [];
  picklists.forEach((pl, i) => {
    if (i > 0) doc.addPage();
    const startPage = doc.getNumberOfPages();
    renderPicklistPdfPage(doc, pl, pickfaces);
    ranges.push({ startPage, endPage: doc.getNumberOfPages() });
  });
  stampPageNumbers(doc, ranges);
  triggerDownload(doc.output('blob'), filename);
}

export function downloadAllocationWorkbook(
  result: AllocationResult,
  movement: MovementRow[],
  pickfaces: Map<string, PickfaceAssignment>,
  filename: string,
): void {
  downloadWorkbook(buildWorkbook(result, movement, pickfaces), filename);
}
