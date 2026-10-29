import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDate, fmtNum, cn } from "@/lib/utils";
import { loadMoves, MoveTable } from "../move-table";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WaveMoveAuditPage({ params }: { params: Promise<{ wave: string }> }) {
  const user = await requirePage("/audit/picking");
  const { wave } = await params;
  if (!UUID.test(wave)) notFound();

  const supabase = await createClient();

  // Fetch wave info
  const { data: waveData } = await supabase
    .from("waves")
    .select("id, wave_no, planned_date, planned_slot, status")
    .eq("id", wave)
    .maybeSingle();

  if (!waveData) notFound();

  // Fetch shipment audits for this wave (for links)
  const { data: shipments } = await supabase
    .from("pick_audit_shipment")
    .select("shipment_number")
    .eq("wave_id", wave)
    .order("shipment_number");

  const { rows, attempts, binQty } = await loadMoves(supabase, { wave });
  // A line passes when both its source bin and its destination bin passed.
  const passed = (s: string) => s === "OK" || s === "AUTO_PASS" || s === "RESOLVED";
  const todo = rows.filter((l) => l.line_state === "TODO" || l.from_state === "TODO").length;
  const mismatch = rows.filter((l) => l.line_state === "MISMATCH" || l.from_state === "MISMATCH").length;
  const ok = rows.filter((l) => passed(l.line_state) && (l.from_state === undefined || passed(l.from_state))).length;

  return (
    <main>
      <PageHeader
        title={`Pindahan bin (replenish) · NO ${waveData.wave_no}`}
        live={["pick_tasks", "pick_audits", "waves", "movements"]}
      >
        <Link
          href={`/audit/picking?date=${waveData.planned_date}`}
          className="inline-flex items-center gap-1 text-sm underline"
        >
          <ArrowLeft className="h-4 w-4" />Semua tanggal
        </Link>
      </PageHeader>
      <div className="p-4 lg:p-8 space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="font-cond text-2xl font-semibold">NO {waveData.wave_no}</h2>
                <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", {
                  "bg-plate text-steel": waveData.status === "PENDING",
                  "bg-ok text-white": waveData.status === "COMPLETED",
                  "bg-steel-100 text-steel-500 line-through": waveData.status === "CANCELLED",
                  "bg-warn text-white": waveData.status === "RESCHEDULED",
                })}>
                  {waveData.status}
                </span>
              </div>
              <p className="text-sm text-steel-500">
                Tanggal {fmtDate(waveData.planned_date)}
                {waveData.planned_slot ? ` · Slot ${waveData.planned_slot}` : ""}
              </p>
              <p className="text-sm">
                {fmtNum(ok)}/{fmtNum(rows.length)} baris lolos
                {todo > 0 && ` · ${fmtNum(todo)} belum diaudit`}
                {mismatch > 0 && <span className="text-bad"> · {fmtNum(mismatch)} selisih</span>}
              </p>
            </div>
            {shipments && shipments.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-sm">
                <span className="text-steel-500">Shipment audit:</span>
                {shipments.map((s) => (
                  <Link
                    key={s.shipment_number}
                    href={`/audit/picking/${wave}/${encodeURIComponent(s.shipment_number)}`}
                    className="underline text-steel-500 hover:text-ckb"
                  >
                    SH {s.shipment_number}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <p className="text-sm text-steel-500">Tidak ada tugas pindahan bin (REPLENISH) di wave ini.</p>
        ) : (
          <Card>
            <CardContent>
              <MoveTable rows={rows} attempts={attempts} binQty={binQty} supervisor={user.role !== "operator"} />
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
