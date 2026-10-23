import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtNum, cn } from "@/lib/utils";
import { LINE_STATE_LABEL, type LineState, PICK_ERROR_LABEL } from "@/lib/pick-audit";
import { MoveAuditClient, type MoveLineView, type MoveAttemptView } from "./move-audit-client";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MoveRow = {
  task_id: string; seq: number; sku: string; description: string; uom: string | null;
  from_bin: string; zone: string | null; to_bin: string; to_zone: string | null;
  batch_lot: string; expiry_date: string | null; planned_qty: number; moved_qty: number;
  deviation_reason: string | null; picked_by_name: string | null; bulk_posted: boolean;
  scanned_code: string | null; line_state: LineState; attempts: number;
  wave_id: string; wave_no: string; planned_date: string; wave_status: string;
};

export default async function WaveMoveAuditPage({ params }: { params: Promise<{ wave: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
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

  // Fetch move audit lines for this wave
  const { data: moves } = await supabase
    .from("pick_audit_move")
    .select("*")
    .eq("wave_id", wave)
    .order("seq");

  // Fetch all attempts for these tasks
  const taskIds = (moves ?? []).map((m) => m.task_id);
  const { data: attempts } = taskIds.length
    ? await supabase
        .from("pick_audits")
        .select("*")
        .in("task_id", taskIds)
        .order("attempt_no")
    : { data: [] };

  const rows = (moves ?? []) as MoveRow[];
  const byTask = new Map<string, MoveAttemptView[]>();
  for (const a of (attempts ?? []) as (MoveAttemptView & { errors: string[] })[]) {
    const arr = byTask.get(a.task_id) ?? [];
    byTask.set(a.task_id, [...arr, a]);
  }

  const view: MoveLineView[] = rows.map((l) => ({
    task_id: l.task_id,
    seq: l.seq,
    sku: l.sku,
    description: l.description,
    uom: l.uom,
    from_bin: l.from_bin,
    from_zone: l.zone,
    to_bin: l.to_bin,
    to_zone: l.to_zone,
    batch_lot: l.batch_lot,
    expiry_date: l.expiry_date,
    planned_qty: Number(l.planned_qty),
    moved_qty: Number(l.moved_qty),
    deviation_reason: l.deviation_reason,
    picked_by_name: l.picked_by_name,
    bulk_posted: l.bulk_posted,
    scanned_code: l.scanned_code,
    state: l.line_state,
    attempts: l.attempts,
    picked: l.line_state === "TODO" ? undefined : {
      qty: Number(l.moved_qty),
      planned_qty: Number(l.planned_qty),
      batch: l.batch_lot,
      expiry: l.expiry_date,
      deviation: l.deviation_reason,
    },
  }));

  const tries: MoveAttemptView[] = ((attempts ?? []) as (MoveAttemptView & { errors: string[] })[]).map((a) => ({
    id: a.id,
    task_id: a.task_id,
    attempt_no: a.attempt_no,
    checker_name: a.checker_name,
    found_sku: a.found_sku,
    found_batch: a.found_batch,
    found_expiry: a.found_expiry,
    counted_qty: Number(a.counted_qty),
    damaged: a.damaged,
    expected_sku: a.expected_sku,
    expected_batch: a.expected_batch,
    expected_expiry: a.expected_expiry,
    expected_qty: Number(a.expected_qty),
    errors: a.errors as any,
    result: a.result,
    note: a.note,
    resolution: a.resolution,
    resolved_by_name: a.resolved_by_name,
    resolved_at: a.resolved_at,
    resolution_note: a.resolution_note,
    created_at: a.created_at,
    legacy: a.legacy,
    correction: a.correction,
  }));

  const todo = view.filter((l) => l.state === "TODO").length;
  const mismatch = view.filter((l) => l.state === "MISMATCH").length;
  const ok = view.filter((l) => l.state === "OK" || l.state === "AUTO_PASS").length;

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
              <Table sticky>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>SKU</Th>
                    <Th>Dari bin / zona</Th>
                    <Th>Ke bin / zona</Th>
                    <Th>Petugas</Th>
                    <Th>Status</Th>
                    <Th>Direncanakan / dipindah</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => {
                    const hist = byTask.get(l.task_id) ?? [];
                    const last = hist[hist.length - 1];
                    const frozen = waveData.status === "CANCELLED";
                    return (
                      <tr key={l.task_id} className={cn(l.line_state === "MISMATCH" && "bg-bad/5")}>
                        <Td className="tabular">{l.seq}</Td>
                        <Td>
                          <span className="font-semibold">{l.sku}</span>
                          <br />
                          <span className="text-xs text-steel-500">{l.description}</span>
                        </Td>
                        <Td className="font-semibold">
                          {l.from_bin}
                          {l.zone && <span className="text-xs text-steel-500"> · {l.zone}</span>}
                        </Td>
                        <Td className="font-semibold text-ckb">
                          {l.to_bin}
                          {l.to_zone && <span className="text-xs text-steel-500"> · {l.to_zone}</span>}
                        </Td>
                        <Td className="text-xs">
                          {l.picked_by_name ?? "(tidak tercatat)"}
                          {l.bulk_posted && <span className="block text-warn">diposting massal</span>}
                        </Td>
                        <Td className={cn("text-xs font-semibold", {
                          "text-steel-500": l.line_state === "AUTO_PASS" || l.line_state === "TODO",
                          "text-ok": l.line_state === "OK",
                          "text-bad": l.line_state === "MISMATCH",
                          "text-warn": l.line_state === "RESOLVED",
                        })}>
                          {LINE_STATE_LABEL[l.line_state]}
                        </Td>
                        <Td className="space-y-1 text-xs">
                          {l.line_state !== "TODO" ? (
                            <p>
                              {fmtNum(l.moved_qty)} {l.uom ?? ""} · batch {l.batch_lot || "–"}
                              {l.expiry_date && ` · exp ${fmtDate(l.expiry_date)}`}
                              {l.moved_qty !== l.planned_qty && (
                                <span className="text-warn">
                                  {" "}
                                  (rencana {fmtNum(l.planned_qty)}
                                  {l.deviation_reason ? `: ${l.deviation_reason}` : ""})
                                </span>
                              )}
                            </p>
                          ) : (
                            <p className="text-steel-500">disembunyikan sampai diaudit</p>
                          )}
                          {hist.map((a) => (
                            <MoveAttemptLine key={a.id} a={a} />
                          ))}
                        </Td>
                        <Td className="space-y-1 text-right">
                          {!frozen && (l.line_state === "TODO" || l.line_state === "MISMATCH") && (
                            <MoveAuditClient
                              key={l.task_id}
                              line={view.find((v) => v.task_id === l.task_id)!}
                              attempts={hist}
                              supervisor={user.role !== "operator"}
                              frozen={frozen}
                            />
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

function MoveAttemptLine({ a }: { a: MoveAttemptView }) {
  return (
    <div className="rounded border border-steel-100 p-1.5">
      <p>
        {a.result === "OK" ? (
          <span className="inline-flex items-center gap-1 font-semibold text-ok">OK</span>
        ) : (
          <span className="inline-flex items-center gap-1 font-semibold text-bad">
            {a.errors.map((e) => PICK_ERROR_LABEL[e]).join(", ")}
          </span>
        )}{" "}
        · audit {a.attempt_no}{a.legacy ? " (lama)" : ""}{a.correction ? " · ubah" : ""} · {a.checker_name} ·{" "}
        {new Date(a.created_at).toLocaleString("id-ID", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      {a.result === "MISMATCH" && (
        <p className="text-steel-700">
          ditemukan {a.found_sku} · {fmtNum(a.counted_qty)} · batch {a.found_batch || "–"}
          {a.found_expiry ? ` · exp ${fmtDate(a.found_expiry)}` : ""}
          {a.damaged ? " · rusak" : ""}
        </p>
      )}
      {a.note && <p className="text-steel-700">{a.note}</p>}
      {a.resolution && a.resolved_at && (
        <p className="text-warn">
          {a.resolution === "ACCEPT_SHORT" ? "Terima kurang" : "Terima batch ini"} oleh{" "}
          {a.resolved_by_name} ·{" "}
          {new Date(a.resolved_at).toLocaleString("id-ID", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}: {a.resolution_note}
        </p>
      )}
    </div>
  );
}