import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditHeader, auditDate } from "../../../audit-header";
import { RackAudit } from "../../rack-audit";
import { rackBins, rackSummary } from "../../rack-data";

export const dynamic = "force-dynamic";

/** One rack (aisle) on a date: the bins picked from it, counted at the rack (0025). */
export default async function RackAuditPage({ params, searchParams }: {
  params: Promise<{ zone: string }>; searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const zone = decodeURIComponent((await params).zone).toUpperCase();
  const date = auditDate((await searchParams).date);
  if (!/^[A-Z0-9_]{1,20}$/.test(zone)) notFound();
  const bins = await rackBins(await createClient(), date, zone);
  const [summary] = rackSummary(bins);

  return (
    <main>
      <AuditHeader title={`Audit rak ${zone}`} date={date} active="picking" putaway={false}
        live={["pick_tasks", "pick_audits", "shipment_loads", "waves", "movements"]} />
      <div className="p-4 lg:p-8">
        {summary
          ? <RackAudit zone={zone} date={date} bins={bins} summary={summary} canCorrect={user.role !== "operator"} />
          : <p className="text-sm text-steel-500">Tidak ada pick dari rak {zone} di tanggal ini.</p>}
      </div>
    </main>
  );
}
