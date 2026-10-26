import { NextResponse } from "next/server";
import { checkCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/ckb/evidence";
import { exportFileName, type ExportLineData } from "@/lib/ckb/export-file";
import { sapExportXlsx } from "@/lib/ckb/report-file";

const jakarta = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

/** The export file, rebuilt from its frozen lines. Every download is logged first (ckb_log_export_download). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await checkCkb(["admin", "supervisor"]);
  if (!user) return NextResponse.json({ error: "Hanya supervisor atau admin CKB." }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Tidak ditemukan." }, { status: 404 });
  const db = await createClient();
  const { data: e } = await db.from("ckb_sap_exports").select("*").eq("id", id).maybeSingle();
  if (!e) return NextResponse.json({ error: "Tidak ditemukan." }, { status: 404 });
  if (e.status === "VOIDED") return NextResponse.json({ error: "Ekspor ini sudah dibatalkan." }, { status: 410 });
  const [{ data: lines, error }, { data: customer }, { data: original }] = await Promise.all([
    db.from("ckb_sap_export_lines").select("line_no, data").eq("export_id", id).order("line_no"),
    db.from("ckb_customers").select("code, name").eq("id", e.customer_id).single(),
    e.original_export_id ? db.from("ckb_sap_exports").select("ref_no").eq("id", e.original_export_id).single() : Promise.resolve({ data: null }),
  ]);
  if (error || !lines?.length || !customer) return NextResponse.json({ error: "Baris ekspor tidak bisa dibaca." }, { status: 500 });
  const { error: logErr } = await db.rpc("ckb_log_export_download", { p_export: id });
  if (logErr) return NextResponse.json({ error: logErr.message }, { status: 400 });

  const header = { ref_no: e.ref_no, kind: e.kind, original_ref: original?.ref_no ?? null, reason: e.reason, customer_code: customer.code,
    customer_name: customer.name, created_by_name: e.created_by_name, created_at: `${jakarta(e.created_at)} WIB`,
    format_version: e.format_version, format_verified: e.format_verified };
  const body = await sapExportXlsx(header, lines as { line_no: number; data: ExportLineData }[]);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${exportFileName(header)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
