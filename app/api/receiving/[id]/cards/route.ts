import { NextResponse } from "next/server";
import { checkPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildPalletCardPdf } from "@/lib/form-checker/pdf";
import { receiptCards, type ReceiptPallet } from "@/lib/inbound/cards";

export const runtime = "nodejs";

/**
 * GET: the pallet cards of a checked receipt (0118), one per pallet with good stock, with the bin the auto
 * putaway chose and, for drum / pail / IBC / fluidbag, the manufacture date (0119). Same card as Kartu palet
 * (lib/form-checker/pdf.ts). Damaged cartons get no card (quarantine).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkPage("/receiving")) && !(await checkPage("/labels/pallet"))) {
    return NextResponse.json({ error: "Halaman ini tidak tersedia untuk peran Anda." }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Penerimaan tidak ada." }, { status: 404 });
  const supabase = await createClient();
  const [{ data: r }, { data: actuals, error }] = await Promise.all([
    supabase.from("receipts").select("doc_no, shipment_no, plan_date, doc_date, checked_by_name, status").eq("id", id).maybeSingle(),
    supabase.from("receipt_actuals").select("line_no, quantity, batch_lot, expiry_date, mfg_date, items(sku, uom, description), bins(bin_code)")
      .eq("receipt_id", id).gt("quantity", 0).order("line_no"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!r) return NextResponse.json({ error: "Penerimaan tidak ada." }, { status: 404 });
  const rows = (actuals ?? []) as unknown as ReceiptPallet[];
  if (!rows.length) return NextResponse.json({ error: "Belum ada palet: simpan pemeriksaan dulu." }, { status: 404 });
  const { cards, master } = receiptCards(r, rows);
  const pdf = await buildPalletCardPdf(cards, master);
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="kartu-palet-${r.doc_no}.pdf"` },
  });
}
