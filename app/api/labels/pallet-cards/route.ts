import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { checkRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { readSheet } from "@/lib/read-sheet";
import { parseFormChecker, detectColumns, FC_COL, type ParseResult } from "@/lib/form-checker/parse";
import { buildPalletCardPdf, type CardMaster } from "@/lib/form-checker/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

type Summary = {
  cards: number; shipments: number; itemCodes: number;
  shipmentsList: string[]; shipmentCounts: Record<string, number>;
  months: string[]; users: string[]; masterMissing: number;
  shipmentRows: Record<string, string>;
};

// POST multipart (file + action) -> summary JSON or PDF. Supervisor/admin only.
// The upload is a "Form Checker" workbook (docs/FORM_CHECKER_FORMAT.md); one printed
// card per pallet row, one card per A4 page. action=print may carry a `shipment`
// number to print only that shipment's cards; without it every shipment is printed.
export async function POST(req: Request) {
  if (!(await checkRole(["supervisor", "admin"]))) {
    return NextResponse.json({ error: "Hanya supervisor/admin yang bisa mencetak kartu palet." }, { status: 403 });
  }
  let file: FormDataEntryValue | null = null;
  let action = "summary";
  let shipmentFilter = "";
  try {
    const fd = await req.formData();
    file = fd.get("file");
    action = String(fd.get("action") ?? "summary");
    shipmentFilter = String(fd.get("shipment") ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Kirim berkas Form Checker (.xlsx) pada field 'file'." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Tidak ada berkas. Pilih berkas Form Checker (.xlsx)." }, { status: 400 });
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
  } catch {
    return NextResponse.json({ error: "Berkas tidak dapat dibaca sebagai workbook Excel." }, { status: 400 });
  }
  const sheetName = wb.SheetNames.includes("FORM CHECKER") ? "FORM CHECKER" : wb.SheetNames[0];
  if (!sheetName) return NextResponse.json({ error: "Workbook tidak berisi sheet." }, { status: 400 });
  const { rows, lines } = readSheet(wb, sheetName); // stops at the last non-empty cell, skips blank rows as data rows — the parser keeps the fill context
  if (rows.length <= 1) return NextResponse.json({ error: "Sheet 'FORM CHECKER' tidak berisi data." }, { status: 400 });

  // Detect columns from header row; fall back silently to fixed map if detection fails
  const headerRow = rows[0];
  const detectedColumns = detectColumns(headerRow);
  const columns = detectedColumns ?? FC_COL;

  const dataRows = rows.slice(1);
  const dataLines = lines.slice(1);
  const { cards, shipments, spans } = parseFormChecker(dataRows, columns);
  if (!cards.length) return NextResponse.json({ error: "Tidak ada baris palet (Act. Qty / Pallet ID) di berkas ini." }, { status: 404 });

  // Master data by SKU: description, UoM and UPP are not in the workbook.
  const supabase = await createClient();
  const skus = [...new Set(cards.map((c) => String(c.itemCode)))];
  let master = new Map<string, CardMaster>();
  try {
    const items = await fetchAll<{ sku: string; uom: string | null }>((a, b) =>
      supabase.from("items").select("sku, uom").in("sku", skus).range(a, b));
    master = new Map(items.map((i) => [i.sku, { uom: i.uom }]));
  } catch (e) {
    return NextResponse.json({ error: `Gagal membaca master item: ${(e as Error).message}` }, { status: 500 });
  }
  const masterMissing = skus.filter((s) => !master.has(s)).length;

  // Build shipmentRows: map shipment number -> formatted Excel row ranges
  const shipmentRows: Record<string, string> = {};
  for (const span of spans) {
    const formattedRanges = span.dataSetRows.map(([start, end]) => {
      const excelStart = dataLines[start];
      const excelEnd = dataLines[end];
      return excelStart === excelEnd ? String(excelStart) : `${excelStart}–${excelEnd}`;
    });
    shipmentRows[String(span.shipmentNo)] = formattedRanges.join(", ");
  }

  if (action !== "print") {
    const counts: Record<string, number> = {};
    for (const c of cards) counts[String(c.shipmentNo)] = (counts[String(c.shipmentNo)] ?? 0) + 1;
    const summary: Summary = {
      cards: cards.length, shipments,
      itemCodes: skus.length,
      shipmentsList: Object.keys(counts), shipmentCounts: counts,
      months: [...new Set(cards.map((c) => c.month).filter(Boolean))],
      users: [...new Set(cards.map((c) => c.userName).filter(Boolean))],
      masterMissing,
      shipmentRows,
    };
    return NextResponse.json(summary);
  }

  // Single shipment on request: print just its cards, never the whole file.
  const printable = shipmentFilter
    ? cards.filter((c) => String(c.shipmentNo) === shipmentFilter)
    : cards;
  if (!printable.length) {
    return NextResponse.json({ error: `Shipment ${shipmentFilter} tidak ada paletnya di berkas ini.` }, { status: 404 });
  }

  const pdf = await buildPalletCardPdf(printable, master);
  const name = shipmentFilter ? `kartu-palet-${shipmentFilter}-${Date.now()}` : `kartu-palet-${Date.now()}`;
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"` },
  });
}
