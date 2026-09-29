import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditHeader, auditDate } from "../../../audit-header";
import { PutawayRackAudit } from "../../rack-audit";
import { putawayRows, putawaySummary } from "../../rack-data";
import { DownloadPutawayAudit } from "../../download-putaway-audit";

export const dynamic = "force-dynamic";

/** One rack on a date: its putaways, audited at the rack with SKU, batch and qty (0027). */
export default async function PutawayRackPage({ params, searchParams }: {
  params: Promise<{ zone: string }>; searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const zone = decodeURIComponent((await params).zone).toUpperCase();
  const date = auditDate((await searchParams).date);
  if (!/^[A-Z0-9_]{1,20}$/.test(zone)) notFound();
  // Grouped by bin (CD03E01, CD03E02 …) under a header per rack number.
  const rows = (await putawayRows(await createClient(), date, zone)).sort((a, b) => a.to_bin.localeCompare(b.to_bin) || a.created_at.localeCompare(b.created_at));
  const [summary] = putawaySummary(rows);

  return (
    <main>
      <AuditHeader title={`Audit putaway rak ${zone}`} date={date} active="putaway" />
      <div className="space-y-4 p-4 lg:p-8">
        {summary && <DownloadPutawayAudit date={date} zone={zone} />}
        {summary
          ? <PutawayRackAudit zone={zone} date={date} rows={rows} summary={summary} canCorrect={user.role !== "operator"} />
          : <p className="text-sm text-steel-500">Tidak ada putaway ke rak {zone} di tanggal ini.</p>}
      </div>
    </main>
  );
}
