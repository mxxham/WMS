import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { checkRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { movementQuery, type MovementFilters } from "@/lib/movement-query";
import { REASON_CODES, type ReasonCode } from "@/lib/inventory-control";

export const runtime = "nodejs";

type Row = {
  created_at: string; type: string; quantity: number; batch_lot: string; note: string | null;
  reason_code: string | null; by_name: string | null; approved_by_name: string | null;
  items: { sku: string; description: string; uom: string | null } | null;
  from_bin: { bin_code: string } | null; to_bin: { bin_code: string } | null; profiles: { name: string } | null;
};

// Same filters as /movements, all matching rows, as .xlsx.
// Unbounded: a ledger-sized pull must never be built in memory, so an export
// without a date window defaults to the last 30 days and anything above the
// row cap is refused with a message to narrow the range.
const MAX_ROWS = 100_000;

export async function GET(req: Request) {
  if (!(await checkRole(["supervisor", "admin"]))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const f = Object.fromEntries(new URL(req.url).searchParams) as MovementFilters;
  if (!f.from && !f.to) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    f.to = today;
    f.from = new Date(new Date(`${today}T00:00:00+07:00`).getTime() - 29 * 86_400_000)
      .toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  }
  const supabase = await createClient();
  const build = await movementQuery(supabase, f);
  const rows = build ? await fetchAll<Row>(build) : [];
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Terlalu banyak baris untuk diekspor (${rows.length.toLocaleString("id-ID")}). Batas ${MAX_ROWS.toLocaleString("id-ID")} baris — persempit rentang tanggal atau filter.` },
      { status: 413 },
    );
  }
  const sheet = XLSX.utils.json_to_sheet(rows.map((m) => ({
    Waktu: new Date(m.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }), Jenis: m.type,
    SKU: m.items?.sku, Deskripsi: m.items?.description, Batch: m.batch_lot, Qty: Number(m.quantity), UoM: m.items?.uom,
    Dari: m.from_bin?.bin_code, Ke: m.to_bin?.bin_code,
    Alasan: m.reason_code ? REASON_CODES[m.reason_code as ReasonCode] ?? m.reason_code : "", Catatan: m.note,
    Oleh: m.by_name ?? m.profiles?.name ?? "", Disetujui: m.approved_by_name ?? "",
  })));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Mutasi");
  const buf = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="mutasi-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
