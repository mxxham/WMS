import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { loadSession, loadTasks } from "@/lib/ckb/stocktake-data";
import { isLead, isStaff } from "@/lib/ckb/permissions";
import { STOCKTAKE_STATUS, TASK_STATUS, CLASSIFICATION, ADJUSTMENT_STATUS, SCOPE_LABEL, type AdjustmentStatus, type Classification } from "@/lib/ckb/stocktake";
import { CkbHeader, CkbBody, Facts, Notice, Pill, StatTile } from "@/components/ckb/ui";
import { RpcButton } from "@/components/ckb/rpc-button";
import { EvidencePanel, type EvidenceRow } from "@/components/ckb/evidence-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Th, Td } from "@/components/ui/table";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sesi stock take" };

export default async function StocktakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCkb(`/ckb/stock-take/${id}`);
  const s = await loadSession(id);
  if (!s) notFound();
  const db = await createClient();
  const [tasks, { data: adjustments }, { data: evidence }, { data: counters }] = await Promise.all([
    loadTasks(id),
    db.from("ckb_adjustments").select("id, ref_no, material_code, storage_bin, batch, uom, delta, status, decided_by_name, decision_reason").eq("stocktake_id", id).order("ref_no"),
    db.from("ckb_evidence").select("id, kind, mime, size_bytes, description, uploaded_by, uploaded_by_name, uploaded_at, legal_hold").eq("entity_type", "STOCKTAKE").eq("entity_id", id).order("uploaded_at"),
    isStaff(user.ckbRole) ? db.from("ckb_stocktake_counters").select("user_id, profiles(name)").eq("stocktake_id", id) : Promise.resolve({ data: [] }),
  ]);
  const lead = isLead(user.ckbRole);
  const staff = isStaff(user.ckbRole);
  const n = (pred: (t: (typeof tasks)[number]) => boolean) => tasks.filter(pred).length;
  const showsBaseline = tasks.some((t) => t.baseline_qty !== null);
  const classes = (Object.keys(CLASSIFICATION) as (Classification | "COUNTED")[]).map((c) => [c, n((t) => t.classification === c)] as const).filter(([, k]) => k > 0);
  const st = STOCKTAKE_STATUS[s.status];
  const open = s.status === "DRAFT" || s.status === "COUNTING" || s.status === "REVIEW";

  return (
    <main>
      <CkbHeader title={`Stock take ${s.ref_no}`} subtitle={`${s.customer_name} · ${SCOPE_LABEL[s.scope_type]}`} back={{ href: "/ckb/stock-take", label: "Stock take" }}
        live={["ckb_stocktakes", "ckb_counts", "ckb_adjustments"]}>
        <Pill tone={st.tone}>{st.label}</Pill>
        {s.status === "DRAFT" && lead && (
          <RpcButton rpc="ckb_start_stocktake" args={{ p_id: id }} title="Mulai penghitungan"
            summary={`${tasks.length} tugas hitung ${s.ref_no} dibuka untuk penghitung${s.blind ? "; qty SAP tidak ditampilkan kepada operator" : ""}.`} confirmLabel="Mulai">Mulai penghitungan</RpcButton>
        )}
        {(s.status === "DRAFT" || s.status === "COUNTING" || s.status === "REVIEW") && lead && <Button asChild variant="outline"><Link href={`/ckb/stock-take/${id}/assign`}>Penugasan hitung</Link></Button>}
        {(s.status === "COUNTING" || s.status === "REVIEW") && staff && <Button asChild><Link href={`/ckb/stock-take/${id}/count`}>Hitung</Link></Button>}
        {s.status === "COUNTING" && lead && (
          <RpcButton rpc="ckb_close_counting" args={{ p_id: id }} variant="outline" title="Tutup penghitungan"
            summary={`Penghitungan ditutup dan sesi masuk review. ${n((t) => t.status === "OPEN")} tugas belum dihitung; tugas itu harus dihitung ulang atau dikecualikan di review.`}
            confirmLabel="Masuk review">Tutup penghitungan</RpcButton>
        )}
        {s.status !== "DRAFT" && s.status !== "CANCELLED" && lead && <Button asChild variant="outline"><Link href={`/ckb/stock-take/${id}/discrepancies`}>Selisih</Link></Button>}
        {(s.status === "REVIEW" || s.status === "CLOSED") && lead && <Button asChild variant="outline"><Link href={`/ckb/stock-take/${id}/review`}>Review</Link></Button>}
        {s.status === "CLOSED" && lead && <Button asChild variant="outline"><Link href={`/ckb/stock-take/${id}/export`}>Ekspor</Link></Button>}
        {open && lead && (adjustments ?? []).length === 0 && (
          <RpcButton rpc="ckb_cancel_stocktake" args={{ p_id: id }} variant="ghost" title="Batalkan sesi"
            summary={`${s.ref_no} dibatalkan. Hitungan yang sudah ada tetap tersimpan sebagai riwayat.`} confirmLabel="Batalkan sesi"
            reason={{ arg: "p_reason", label: "Alasan pembatalan", required: true }}>Batalkan</RpcButton>
        )}
      </CkbHeader>
      <CkbBody>
        {s.status === "CANCELLED" && <Notice tone="warn">Dibatalkan {fmtDateTime(s.cancelled_at)}: {s.cancel_reason}</Notice>}
        {staff && !s.baseline_verified && <Notice tone="warn">Snapshot dasar dibaca dengan pemetaan kolom SAP yang belum diverifikasi.</Notice>}
        <Facts items={[
          ["Snapshot dasar", staff ? <Link key="b" className="text-ckb hover:underline" href={`/ckb/sap/import/${s.baseline_import_id}`}>{s.baseline_ref}</Link> : s.baseline_ref],
          ["Stok SAP per", s.baseline_date ? fmtDate(s.baseline_date) : "–"], ["Gudang", s.warehouse],
          ["Cakupan", s.scope_type === "FULL" ? "Semua stok" : `${SCOPE_LABEL[s.scope_type]}: ${s.scope_values.join(", ")}`],
          ["Hitung buta", s.blind ? "Ya" : "Tidak"], ["Dibuat", `${s.created_by_name} · ${fmtDateTime(s.created_at)}`],
          ["Mulai dihitung", fmtDateTime(s.started_at)], ["Review", fmtDateTime(s.review_started_at)],
          ["Ditutup", s.closed_at ? `${s.closed_by_name} · ${fmtDateTime(s.closed_at)}` : "–"],
          ...(staff ? [["Penghitung", (counters as { profiles: { name: string } | null }[] ?? []).map((c) => c.profiles?.name).join(", ") || "Semua operator"] as [string, string]] : []),
          ["Catatan", s.notes ?? "–"],
        ]} />

        {/* Every tile counts the same rows the table below prints, so a tile cannot disagree with it:
            "Hitung ulang" is exactly the RECOUNT_REQUESTED rows and "Sudah diputuskan" the ACCEPTED and
            EXCLUDED ones. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Tugas" value={tasks.length} />
          <StatTile label="Sudah dihitung" value={n((t) => t.count_total > 0)} />
          <StatTile label="Belum dihitung" value={n((t) => t.count_total === 0 && t.status !== "EXCLUDED")} tone="warn" />
          <StatTile label="Hitung ulang" value={n((t) => t.status === "RECOUNT_REQUESTED")} tone="warn" />
          <StatTile label="Sudah diputuskan" value={n((t) => t.status === "ACCEPTED" || t.status === "EXCLUDED")} tone="ok" />
        </div>
        {showsBaseline && classes.length > 0 && (
          <div className="flex flex-wrap gap-2">{classes.map(([c, k]) => <Pill key={c} tone={CLASSIFICATION[c].tone}>{CLASSIFICATION[c].label}: {k}</Pill>)}</div>
        )}

        <Card>
          <CardHeader><CardTitle>Tugas hitung</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table sticky>
              <thead><tr><Th>#</Th><Th>Bin</Th><Th>Material</Th><Th>Batch / expired</Th><Th>Satuan</Th>{showsBaseline && <Th className="text-right">Qty SAP</Th>}<Th className="text-right">Hitungan</Th>{showsBaseline && <Th className="text-right">Selisih</Th>}<Th>Status</Th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <Td>{t.seq}</Td>
                    <Td className="font-cond font-semibold">{t.storage_bin || "–"}</Td>
                    <Td><span className="font-medium">{t.material_code}</span>{t.origin === "FOUND" && <Pill tone="warn" className="ml-1">temuan</Pill>}<span className="block max-w-[16rem] truncate text-xs text-steel-500">{t.description}</span></Td>
                    <Td>{t.batch || "–"}<span className="block text-xs text-steel-500">{t.expiry_date ? fmtDate(t.expiry_date) : ""}</span></Td>
                    <Td>{t.uom}</Td>
                    {showsBaseline && <Td className="text-right">{t.baseline_qty === null ? "–" : fmtNum(Number(t.baseline_qty), 3)}</Td>}
                    <Td className="text-right">{t.accepted_qty !== null ? fmtNum(Number(t.accepted_qty), 3) : t.latest_qty !== null ? fmtNum(Number(t.latest_qty), 3) : <span className="text-steel-500">belum</span>}
                      {t.count_rounds > 1 && <span className="block text-xs text-steel-500">{t.count_rounds} putaran</span>}</Td>
                    {showsBaseline && <Td className={`text-right font-medium ${Number(t.variance) < 0 ? "text-bad" : Number(t.variance) > 0 ? "text-warn" : ""}`}>{t.variance === null ? "–" : `${Number(t.variance) > 0 ? "+" : ""}${fmtNum(Number(t.variance), 3)}`}</Td>}
                    <Td className="space-y-1">
                      <Pill tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Pill>
                      {showsBaseline && t.classification !== "UNCOUNTED" && <Pill tone={CLASSIFICATION[t.classification as Classification]?.tone ?? "neutral"} className="ml-1">{CLASSIFICATION[t.classification as Classification]?.label ?? t.classification}</Pill>}
                      {t.wrong_bin_hint && <span className="block text-xs text-warn">Material sama lebih di bin lain</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>

        {(adjustments ?? []).length > 0 && (
          <Card>
            <CardHeader><CardTitle>Penyesuaian dari sesi ini</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <thead><tr><Th>Ref</Th><Th>Material</Th><Th>Bin</Th><Th>Batch</Th>{showsBaseline && <Th className="text-right">Selisih</Th>}<Th>Status</Th><Th>Keputusan</Th></tr></thead>
                <tbody>
                  {(adjustments ?? []).map((a) => (
                    <tr key={a.id}>
                      <Td>{a.ref_no}</Td><Td>{a.material_code}</Td><Td>{a.storage_bin}</Td><Td>{a.batch || "–"}</Td>
                      {/* An adjustment delta is accepted − SAP, which gives back the SAP quantity the
                          task table hides from a blind counter: the same flag hides it here. */}
                      {showsBaseline && <Td className={`text-right font-medium ${a.delta < 0 ? "text-bad" : "text-ok"}`}>{a.delta > 0 ? "+" : ""}{fmtNum(Number(a.delta), 3)} {a.uom}</Td>}
                      <Td><Pill tone={ADJUSTMENT_STATUS[a.status as AdjustmentStatus].tone}>{ADJUSTMENT_STATUS[a.status as AdjustmentStatus].label}</Pill></Td>
                      <Td className="text-xs text-steel-500">{a.decided_by_name ?? "–"}{a.decision_reason ? ` · ${a.decision_reason}` : ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Bukti sesi</CardTitle></CardHeader>
          <CardContent>
            <EvidencePanel entityType="STOCKTAKE" entityId={id} rows={(evidence ?? []) as EvidenceRow[]} canUpload={staff && open} me={user.id} lead={lead} />
          </CardContent>
        </Card>
      </CkbBody>
    </main>
  );
}
