import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditHeader, auditDate } from "../../../audit-header";
import { RackAudit } from "../../rack-audit";
import { rackBins, rackSummary, walkKey } from "../../rack-data";
import { loadMoves, MoveTable } from "../../move-table";
import { Card, CardContent } from "@/components/ui/card";
import { fmtNum } from "@/lib/utils";
import { DownloadPickAudit } from "../../download-pick-audit";

export const dynamic = "force-dynamic";

/** One rack (aisle) on a date: the bins picked from it, counted at the rack (0025), and the Bin To Bin moves into it (0088). */
export default async function RackAuditPage({ params, searchParams }: {
  params: Promise<{ zone: string }>; searchParams: Promise<{ date?: string }>;
}) {
  const user = await requirePage("/audit/picking/rak");
  const zone = decodeURIComponent((await params).zone).toUpperCase();
  const date = auditDate((await searchParams).date);
  if (!/^[A-Z0-9_]{1,20}$/.test(zone)) notFound();
  // Grouped by bin like the WMS-file audit: CA17A01, CA17A02 … CA17C01, CA17C02 under a CA17 header.
  const supabase = await createClient();
  const [picked, moves] = await Promise.all([rackBins(supabase, date, zone), loadMoves(supabase, { date, zone })]);
  const bins = picked.sort((a, b) => a.bin_code.localeCompare(b.bin_code) || a.sku.localeCompare(b.sku));
  const [summary] = rackSummary(bins);
  // Bin To Bin from or into this rack, in walking order of the bin checked here. A move inside the
  // rack (CB05C01 -> CB07A01) is two checks on one row.
  const binHere = (m: (typeof moves.rows)[number]) => (m.zone === zone ? m.from_bin : m.to_bin);
  const moveRows = moves.rows.filter((m) => m.line_state !== "AUTO_PASS" && (m.to_zone === zone || m.from_state !== undefined))
    .sort((a, b) => walkKey(binHere(a)).localeCompare(walkKey(binHere(b))) || a.wave_no.localeCompare(b.wave_no) || a.seq - b.seq);
  const checks = moveRows.flatMap((m) => [...(m.zone === zone && m.from_state ? [m.from_state] : []), ...(m.to_zone === zone ? [m.line_state] : [])]);
  const moveTodo = checks.filter((s) => s === "TODO").length;
  const moveBad = checks.filter((s) => s === "MISMATCH").length;

  return (
    <main>
      <AuditHeader title={`Audit rak ${zone}`} date={date} active="picking" putaway={false}
        live={["pick_tasks", "pick_audits", "shipment_loads", "waves", "movements"]} />
      <div className="space-y-4 p-4 lg:p-8">
        {(summary || moveRows.length > 0) && <DownloadPickAudit date={date} zone={zone} />}
        {summary
          ? <RackAudit zone={zone} date={date} bins={bins} summary={summary} canCorrect={user.role !== "operator"} groupByRack />
          : <p className="text-sm text-steel-500">Tidak ada pick dari rak {zone} di tanggal ini.</p>}
        {moveRows.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-cond text-lg font-semibold">Bin To Bin di rak {zone}</h2>
            <p className="text-sm text-steel-500">
              Bin asal di rak ini: hitung <b>sisa</b> SKU di bin. Bin tujuan di rak ini: hitung <b>yang tiba</b>.{" "}
              {fmtNum(checks.length - moveTodo - moveBad)}/{fmtNum(checks.length)} cek lolos
              {moveTodo > 0 && ` · ${fmtNum(moveTodo)} belum diaudit`}
              {moveBad > 0 && <span className="text-bad"> · {fmtNum(moveBad)} selisih</span>}
            </p>
            <Card><CardContent>
              <MoveTable rows={moveRows} attempts={moves.attempts} binQty={moves.binQty} supervisor={user.role !== "operator"} zone={zone} showWave />
            </CardContent></Card>
          </section>
        )}
      </div>
    </main>
  );
}
