import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCkb } from "@/lib/ckb/auth";
import { loadHistory, loadSession, loadTaskEvidence, loadTasks } from "@/lib/ckb/stocktake-data";
import { CLASSIFICATION, TASK_STATUS, type Classification } from "@/lib/ckb/stocktake";
import { CkbHeader, CkbBody, EmptyState, Notice, Pill } from "@/components/ckb/ui";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtNum } from "@/lib/utils";
import { TaskHistory } from "../task-history";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Selisih" };

/** Investigation view: every task that is not a plain match, with its full count history. */
export default async function DiscrepanciesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ semua?: string }> }) {
  const { id } = await params;
  const user = await requireCkb(`/ckb/stock-take/${id}/discrepancies`);
  const { semua } = await searchParams;
  const s = await loadSession(id);
  if (!s) notFound();
  const tasks = await loadTasks(id);
  const shown = semua ? tasks : tasks.filter((t) => t.classification !== "MATCH");
  const [{ counts, notes }, evidence] = await Promise.all([loadHistory(shown.map((t) => t.id)), loadTaskEvidence(shown.map((t) => t.id))]);
  const open = s.status === "COUNTING" || s.status === "REVIEW";

  return (
    <main>
      <CkbHeader title={`Selisih ${s.ref_no}`} subtitle={`${s.customer_name} · terhadap ${s.baseline_ref} (${fmtDate(s.baseline_date)})`} back={{ href: `/ckb/stock-take/${id}`, label: s.ref_no }}
        live={["ckb_counts", "ckb_stocktakes"]}>
        {s.status === "REVIEW" && <Button asChild><Link href={`/ckb/stock-take/${id}/review`}>Ke review</Link></Button>}
      </CkbHeader>
      <CkbBody>
        <Notice>Setiap selisih dinilai per bin dan per identitas stok. Kekurangan di satu bin tidak pernah ditutup dengan kelebihan di bin lain;
          bila material yang sama lebih di bin lain, tugas ditandai &quot;mungkin salah bin&quot; untuk diinvestigasi.</Notice>
        <p className="text-sm"><a className="text-ckb hover:underline" href={semua ? "?" : "?semua=1"}>{semua ? "Hanya selisih" : "Tampilkan juga yang cocok"}</a></p>
        {shown.length === 0 ? <EmptyState title="Tidak ada selisih">Semua tugas cocok dengan snapshot SAP.</EmptyState> : (
          <ul className="space-y-3">
            {shown.map((t) => {
              const cls = CLASSIFICATION[t.classification as Classification];
              return (
                <li key={t.id} className="rounded-lg border border-steel-100 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium"><span className="mr-2 rounded-plate bg-plate px-1.5 font-cond font-bold text-steel">{t.storage_bin || "–"}</span>#{t.seq} {t.material_code}</p>
                      <p className="text-sm text-steel-500">{t.description} · {t.batch || "tanpa batch"}{t.expiry_date ? ` · exp ${fmtDate(t.expiry_date)}` : ""} · {t.uom}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {cls && <Pill tone={cls.tone}>{cls.label}</Pill>}
                      <Pill tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Pill>
                      {t.wrong_bin_hint && <Pill tone="warn">Mungkin salah bin</Pill>}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-sm sm:max-w-md">
                    <div><span className="block text-xs text-steel-500">SAP</span>{t.baseline_qty === null ? "–" : fmtNum(Number(t.baseline_qty), 3)}</div>
                    <div><span className="block text-xs text-steel-500">{t.accepted_qty !== null ? "Diterima" : "Hitungan terakhir"}</span>{fmtNum(t.accepted_qty ?? t.latest_qty, 3)}</div>
                    <div><span className="block text-xs text-steel-500">Selisih</span><span className={Number(t.variance) < 0 ? "text-bad" : "text-warn"}>{t.variance === null ? "–" : `${Number(t.variance) > 0 ? "+" : ""}${fmtNum(Number(t.variance), 3)}`}</span></div>
                  </div>
                  {cls && <p className="mt-1 text-xs text-steel-500">{cls.hint}</p>}
                  {t.decision_reason && <p className="mt-1 text-sm">Keputusan: {t.decision_reason} <span className="text-xs text-steel-500">({t.decided_by_name})</span></p>}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-ckb">Riwayat hitung, catatan dan bukti</summary>
                    <div className="mt-2">
                      <TaskHistory taskId={t.id} uom={t.uom} counts={counts.filter((c) => c.task_id === t.id)} notes={notes.filter((n) => n.task_id === t.id)}
                        evidence={evidence.filter((e) => e.entity_id === t.id)} me={user.id} canNote={open} canUpload={open} />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </CkbBody>
    </main>
  );
}
