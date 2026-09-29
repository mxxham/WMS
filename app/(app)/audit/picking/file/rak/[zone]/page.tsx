import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditHeader, auditDate } from "../../../../audit-header";
import { RackAudit } from "../../../rack-audit";
import { rackSummary } from "../../../rack-data";
import { sheetRackBins, sheetZone, type SheetLineRow } from "../../data";
import { DownloadAudit } from "../../download-audit";

export const dynamic = "force-dynamic";

/** One rack (aisle) of the WMS file's picks on a date, counted at the rack against the file (0030). */
export default async function FileRackAuditPage({ params, searchParams }: {
  params: Promise<{ zone: string }>; searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const zone = decodeURIComponent((await params).zone).toUpperCase();
  const date = auditDate((await searchParams).date);
  if (!/^[A-Z0-9_]{1,20}$/.test(zone)) notFound();
  const { data } = await (await createClient()).from("sheet_pick_line_state").select("*")
    .eq("pick_date", date).like("bin_code", `${zone}%`);
  const bins = sheetRackBins(((data ?? []) as SheetLineRow[]).filter((l) => sheetZone(l.bin_code) === zone));
  const [summary] = rackSummary(bins);

  return (
    <main>
      <AuditHeader title={`Audit rak ${zone} · file WMS`} date={date} active="picking" putaway={false}
        live={["sheet_pick_lines", "sheet_pick_audits"]} />
      <div className="space-y-4 p-4 lg:p-8">
        {summary && <DownloadAudit date={date} zone={zone} />}
        {summary
          ? <RackAudit zone={zone} date={date} bins={bins} summary={summary} rpc="record_sheet_rack_audit" canCorrect={user.role !== "operator"}
              backHref={`/audit/picking?tab=file&date=${date}`} />
          : <p className="text-sm text-steel-500">Tidak ada pick dari rak {zone} di file tanggal ini.</p>}
      </div>
    </main>
  );
}
