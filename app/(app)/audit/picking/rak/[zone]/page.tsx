import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditHeader, auditDate } from "../../../audit-header";
import { RackAudit } from "../../rack-audit";
import { rackBins, rackSummary } from "../../rack-data";
import { DownloadPickAudit } from "../../download-pick-audit";

export const dynamic = "force-dynamic";

/** One rack (aisle) on a date: the bins picked from it, counted at the rack (0025). */
export default async function RackAuditPage({ params, searchParams }: {
  params: Promise<{ zone: string }>; searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const zone = decodeURIComponent((await params).zone).toUpperCase();
  const date = auditDate((await searchParams).date);
  if (!/^[A-Z0-9_]{1,20}$/.test(zone)) notFound();
  // Grouped by bin like the WMS-file audit: CA17A01, CA17A02 … CA17C01, CA17C02 under a CA17 header.
  const bins = (await rackBins(await createClient(), date, zone)).sort((a, b) => a.bin_code.localeCompare(b.bin_code) || a.sku.localeCompare(b.sku));
  const [summary] = rackSummary(bins);

  return (
    <main>
      <AuditHeader title={`Audit rak ${zone}`} date={date} active="picking" putaway={false}
        live={["pick_tasks", "pick_audits", "shipment_loads", "waves", "movements"]} />
      <div className="space-y-4 p-4 lg:p-8">
        {summary && <DownloadPickAudit date={date} zone={zone} />}
        {summary
          ? <RackAudit zone={zone} date={date} bins={bins} summary={summary} canCorrect={user.role !== "operator"} groupByRack />
          : <p className="text-sm text-steel-500">Tidak ada pick dari rak {zone} di tanggal ini.</p>}
      </div>
    </main>
  );
}
