import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditHeader, auditDate } from "../../../audit-header";
import { PutawayRackAudit } from "../../rack-audit";
import { putawayRows, putawaySummary } from "../../rack-data";

export const dynamic = "force-dynamic";

/** One rack on a date: its putaways, audited at the rack with SKU, batch and qty (0027). */
export default async function PutawayRackPage({ params, searchParams }: {
  params: Promise<{ zone: string }>; searchParams: Promise<{ date?: string }>;
}) {
  await requireRole(["operator", "supervisor", "admin"]);
  const zone = decodeURIComponent((await params).zone).toUpperCase();
  const date = auditDate((await searchParams).date);
  if (!/^[A-Z0-9_]{1,20}$/.test(zone)) notFound();
  const rows = await putawayRows(await createClient(), date, zone);
  const [summary] = putawaySummary(rows);

  return (
    <main>
      <AuditHeader title={`Audit putaway rak ${zone}`} date={date} active="putaway" />
      <div className="p-4 lg:p-8">
        {summary
          ? <PutawayRackAudit zone={zone} date={date} rows={rows} summary={summary} />
          : <p className="text-sm text-steel-500">Tidak ada putaway ke rak {zone} di tanggal ini.</p>}
      </div>
    </main>
  );
}
