"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { Table, Th, Td } from "@/components/ui/table";
import { Pill, EmptyState } from "@/components/ckb/ui";
import { callRpc } from "@/components/ckb/rpc-button";
import { CLASSIFICATION, ADJUSTMENT_STATUS, TASK_STATUS, reviewActions, classify, type AdjustmentStatus, type Classification } from "@/lib/ckb/stocktake";
import type { CountRow, NoteRow, TaskEvidence, TaskRow } from "@/lib/ckb/stocktake-data";
import { fmtDate, fmtNum } from "@/lib/utils";
import { TaskHistory } from "../task-history";

type Decision = "ACCEPT" | "RECOUNT" | "EXCLUDE";
const DECISION_LABEL: Record<Decision, string> = { ACCEPT: "Terima", RECOUNT: "Hitung ulang", EXCLUDE: "Kecualikan" };

export function ReviewClient({ tasks, counts, notes, evidence, me }: { tasks: TaskRow[]; counts: CountRow[]; notes: NoteRow[]; evidence: TaskEvidence[]; me: string }) {
  if (tasks.length === 0) return <EmptyState title="Semua tugas sudah diputuskan">Tutup sesi dari tombol di atas.</EmptyState>;
  return (
    <Card>
      <CardHeader><CardTitle>Belum diputuskan ({tasks.length})</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {tasks.map((t) => <TaskDecision key={t.id} t={t} counts={counts.filter((c) => c.task_id === t.id)} notes={notes.filter((n) => n.task_id === t.id)}
          evidence={evidence.filter((e) => e.entity_id === t.id)} me={me} />)}
      </CardContent>
    </Card>
  );
}

function TaskDecision({ t, counts, notes, evidence, me }: { t: TaskRow; counts: CountRow[]; notes: NoteRow[]; evidence: TaskEvidence[]; me: string }) {
  const router = useRouter();
  const latest = counts.at(-1) ?? null;
  const [countId, setCountId] = useState<string | null>(latest?.id ?? null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = counts.find((c) => c.id === countId) ?? null;
  const cls = classify({ origin: t.origin, identityIssue: t.identity_issue, baseline: Number(t.baseline_qty ?? 0), qty: chosen ? Number(chosen.qty) : null,
    batchOk: chosen?.batch_matches ?? null, expiryOk: chosen?.expiry_matches ?? null });
  const actions = reviewActions({ status: t.status, classification: cls, countTotal: counts.length });
  const variance = chosen ? Number(chosen.qty) - Number(t.baseline_qty ?? 0) : null;
  const needReason = decision !== "ACCEPT" || (variance !== null && variance !== 0);

  async function decide() {
    if (!decision) return;
    setBusy(true); setError(null);
    const [, err] = await callRpc("ckb_decide_task", { p_task: t.id, p_decision: decision, p_count: decision === "ACCEPT" ? countId : null, p_reason: reason || null });
    setBusy(false);
    if (err) { setError(err); return; }
    setDecision(null); setReason(""); router.refresh();
  }

  const summary = decision === "ACCEPT"
    ? `Terima ${fmtNum(chosen ? Number(chosen.qty) : null, 3)} ${t.uom} untuk ${t.material_code} di ${t.storage_bin}. ${variance ? `Selisih ${variance > 0 ? "+" : ""}${fmtNum(variance, 3)} menjadi usulan penyesuaian.` : "Cocok, tanpa penyesuaian."}`
    : decision === "RECOUNT" ? `Minta hitung ulang ${t.material_code} di ${t.storage_bin}. Hitungan lama tetap tersimpan.`
    : `Kecualikan ${t.material_code} di ${t.storage_bin} dari sesi ini. Tidak ada penyesuaian.`;

  return (
    <div className="rounded-md border border-steel-100 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium"><span className="mr-2 rounded-plate bg-plate px-1.5 font-cond font-bold text-steel">{t.storage_bin || "–"}</span>#{t.seq} {t.material_code}
            {t.origin === "FOUND" && <span className="ml-1 text-xs text-warn">temuan</span>}</p>
          <p className="text-sm text-steel-500">{t.description} · {t.batch || "tanpa batch"}{t.expiry_date ? ` · exp ${fmtDate(t.expiry_date)}` : ""} · SAP {fmtNum(Number(t.baseline_qty ?? 0), 3)} {t.uom}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Pill tone={CLASSIFICATION[cls].tone}>{CLASSIFICATION[cls].label}</Pill>
          <Pill tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Pill>
          {t.wrong_bin_hint && <Pill tone="warn">Mungkin salah bin</Pill>}
        </div>
      </div>
      <div className="mt-2">
        <TaskHistory taskId={t.id} uom={t.uom} counts={counts} notes={notes} evidence={evidence} me={me} canNote canUpload
          selectedCount={countId} onSelectCount={setCountId} />
      </div>
      {cls === "AMBIGUOUS" || cls === "BATCH_MISMATCH" ? <p className="mt-2 text-sm text-warn">{CLASSIFICATION[cls].hint}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((a) => <Button key={a} size="sm" variant={a === "ACCEPT" ? "default" : "outline"} onClick={() => { setDecision(a); setError(null); }}>{DECISION_LABEL[a]}</Button>)}
      </div>
      <Dialog open={decision !== null} onOpenChange={(o) => { if (!o) setDecision(null); }}>
        <DialogContent title={decision ? DECISION_LABEL[decision] : ""}>
          <div className="space-y-3">
            <p className="rounded-md bg-plate/30 p-3">{summary}</p>
            <div>
              <Label htmlFor={`r-${t.id}`}>Alasan{needReason ? "" : " (opsional)"}</Label>
              <textarea id={`r-${t.id}`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-md border border-steel-300 bg-white p-2 text-sm" />
            </div>
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" onClick={() => setDecision(null)}>Batal</Button>
              <Button size="lg" onClick={decide} disabled={busy || (needReason && reason.trim().length < 3)}>{busy ? "Memproses…" : "Konfirmasi"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type AdjRow = {
  id: string; ref_no: string; material_code: string; description: string; storage_bin: string; batch: string; expiry_date: string | null; uom: string;
  baseline_qty: number; accepted_qty: number; delta: number; classification: string; status: AdjustmentStatus; proposed_by_name: string;
  decided_by_name: string | null; decision_reason: string | null; counter_id: string | null; counter_name: string | null;
};

/** Approve or reject proposed adjustments, several at once (one transaction: all or nothing). */
export function AdjustmentsClient({ rows, me }: { rows: AdjRow[]; me: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proposed = rows.filter((r) => r.status === "PROPOSED");
  const own = (r: AdjRow) => r.counter_id === me;

  async function run() {
    setBusy(true); setError(null);
    const [, err] = await callRpc("ckb_decide_adjustments", { p_ids: picked, p_approve: mode === "approve", p_reason: reason || null });
    setBusy(false);
    if (err) { setError(err); return; }
    setMode(null); setPicked([]); setReason(""); router.refresh();
  }
  if (rows.length === 0) return null;
  const sum = rows.filter((r) => picked.includes(r.id)).reduce((s, r) => s + Number(r.delta), 0);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Penyesuaian ({proposed.length} menunggu)</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" disabled={picked.length === 0} onClick={() => setMode("approve")}>Setujui ({picked.length})</Button>
          <Button size="sm" variant="outline" disabled={picked.length === 0} onClick={() => setMode("reject")}>Tolak</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <thead><tr><Th className="w-8" /><Th>Ref</Th><Th>Bin</Th><Th>Material</Th><Th className="text-right">SAP</Th><Th className="text-right">Fisik</Th><Th className="text-right">Selisih</Th><Th>Penghitung</Th><Th>Status</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>{r.status === "PROPOSED" && !own(r) && (
                  <input type="checkbox" aria-label={`Pilih ${r.ref_no}`} className="h-4 w-4" checked={picked.includes(r.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
                )}</Td>
                <Td>{r.ref_no}</Td><Td className="font-cond font-semibold">{r.storage_bin}</Td>
                <Td>{r.material_code}<span className="block text-xs text-steel-500">{r.batch || "tanpa batch"} · {CLASSIFICATION[r.classification as Classification]?.label ?? r.classification}</span></Td>
                <Td className="text-right">{fmtNum(Number(r.baseline_qty), 3)}</Td><Td className="text-right">{fmtNum(Number(r.accepted_qty), 3)}</Td>
                <Td className={`text-right font-medium ${r.delta < 0 ? "text-bad" : "text-ok"}`}>{r.delta > 0 ? "+" : ""}{fmtNum(Number(r.delta), 3)} {r.uom}</Td>
                <Td className="text-xs">{r.counter_name ?? "–"}{own(r) && r.status === "PROPOSED" && <span className="block text-warn">hitungan Anda: disetujui orang lain</span>}</Td>
                <Td><Pill tone={ADJUSTMENT_STATUS[r.status].tone}>{ADJUSTMENT_STATUS[r.status].label}</Pill>
                  {r.decided_by_name && <span className="block text-xs text-steel-500">{r.decided_by_name}{r.decision_reason ? ` · ${r.decision_reason}` : ""}</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </CardContent>
      <Dialog open={mode !== null} onOpenChange={(o) => { if (!o) setMode(null); }}>
        <DialogContent title={mode === "approve" ? "Setujui penyesuaian" : "Tolak penyesuaian"}>
          <div className="space-y-3">
            <p className="rounded-md bg-plate/30 p-3">{mode === "approve"
              ? `${picked.length} penyesuaian (total ${sum > 0 ? "+" : ""}${fmtNum(sum, 3)}) disetujui dan siap diekspor ke SAP. Stok di SAP baru berubah setelah diposting di sana.`
              : `${picked.length} penyesuaian ditolak. Hitungannya tetap tersimpan sebagai riwayat.`}</p>
            <div><Label htmlFor="adj-reason">Alasan{mode === "approve" ? " (opsional)" : ""}</Label>
              <textarea id="adj-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-md border border-steel-300 bg-white p-2 text-sm" /></div>
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" onClick={() => setMode(null)}>Batal</Button>
              <Button size="lg" onClick={run} disabled={busy || (mode === "reject" && reason.trim().length < 3)} variant={mode === "reject" ? "danger" : "default"}>{busy ? "Memproses…" : "Konfirmasi"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
