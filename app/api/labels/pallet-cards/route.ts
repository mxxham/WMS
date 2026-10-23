import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { checkRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { readSheet } from "@/lib/read-sheet";
import { parseFormChecker } from "@/lib/form-checker/parse";
import { buildPalletCardPdf, type CardMaster } from "@/lib/form-checker/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

type Summary = {
  cards: number; shipments: number; itemCodes: number;
  shipmentsList: string[]; months: string[]; users: string[]; masterMissing: number;
};

// POST multipart (file + action) -> summary JSON or PDF. Supervisor/admin only.
// The upload is a "Form Checker" workbook (docs/FORM_CHECKER_FORMAT.md); one printed
// card per pallet row, one card per A4 page.
export async function POST(req: Request) {
  if (!(await checkRole(["supervisor", "admin"]))) {
    return NextResponse.json({ error: "Hanya supervisor/admin yang bisa mencetak kartu palet." }, { status: 403 });
  }
  let file: FormDataEntryValue | null = null;
  let action = "summary";
  try {
    const fd = await req.formData();
    file = fd.get("file");
    action = String(fd.get("action") ?? "summary");
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
  const { rows } = readSheet(wb, sheetName); // stops at the last non-empty cell, skips blank rows as data rows — the parser keeps the fill context
  if (rows.length <= 1) return NextResponse.json({ error: "Sheet 'FORM CHECKER' tidak berisi data." }, { status: 400 });

  const { cards, shipments } = parseFormChecker(rows.slice(1));
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

  if (action !== "print") {
    const summary: Summary = {
      cards: cards.length, shipments,
      itemCodes: skus.length,
      shipmentsList: [...new Set(cards.map((c) => String(c.shipmentNo)))],
      months: [...new Set(cards.map((c) => c.month).filter(Boolean))],
      users: [...new Set(cards.map((c) => c.userName).filter(Boolean))],
      masterMissing,
    };
    return NextResponse.json(summary);
  }

  const pdf = await buildPalletCardPdf(cards, master);
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="kartu-palet-${Date.now()}.pdf"` },
  });
}
