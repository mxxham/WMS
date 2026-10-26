import { NextResponse } from "next/server";
import { checkCkb } from "@/lib/ckb/auth";
import { cleanFilters, loadReport } from "@/lib/ckb/report-data";
import { REPORTS, isReportKind } from "@/lib/ckb/reports";
import { reportPdf, reportXlsx } from "@/lib/ckb/report-file";

const jakarta = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" }).format(new Date());

/**
 * Download a report as .xlsx or .pdf. The rows come from the same loader as the page, under the
 * caller's own session, so a representative's file holds only their customers' records.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  if (!isReportKind(kind)) return NextResponse.json({ error: "Laporan tidak dikenal." }, { status: 400 });
  const user = await checkCkb(REPORTS[kind].roles);
  if (!user) return NextResponse.json({ error: "Laporan ini tidak tersedia untuk peran Anda." }, { status: 403 });
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const f = cleanFilters(Object.fromEntries(url.searchParams));
  const { rows, truncated } = await loadReport(kind, f);
  const meta = {
    generatedBy: user.name, generatedAt: `${jakarta()} WIB`, truncated,
    filters: Object.entries(f).map(([k, v]) => `${k}=${v}`).join(", "),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `ckb_${kind}_${stamp}.${format}`;
  const body = format === "pdf" ? reportPdf(kind, rows, meta) : await reportXlsx(kind, rows, meta);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
