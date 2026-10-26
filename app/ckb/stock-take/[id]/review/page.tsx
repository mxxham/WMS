import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { loadHistory, loadSession, loadTaskEvidence, loadTasks } from "@/lib/ckb/stocktake-data";
import { STOCKTAKE_STATUS } from "@/lib/ckb/stocktake";
import { CkbHeader, CkbBody, Notice, Pill } from "@/components/ckb/ui";
import { RpcButton } from "@/components/ckb/rpc-button";
import { ReviewClient, AdjustmentsClient, type AdjRow } from "./review-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review stock take" };

/** Review: decide every task (accept a count, recount, or exclude), then approve or reject adjustments. */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCkb(`/ckb/stock-take/${id}/review`);
  const s = await loadSession(id);
  if (!s) notFound();
  const tasks = await loadTasks(id);
  const undecided = tasks.filter((t) => t.status !== "ACCEPTED" && t.status !== "EXCLUDED");
  const db = await createClient();
  const [{ counts, notes }, evidence, { data: adjustments }] = await Promise.all([
    loadHistory(undecided.map((t) => t.id)), loadTaskEvidence(undecided.map((t) => t.id)),
    db.from("ckb_adjustments").select("id, ref_no, material_code, description, storage_bin, batch, expiry_date, uom, baseline_qty, accepted_qty, delta, classification, status, proposed_by_name, decided_by_name, decision_reason, accepted_count_id").eq("stocktake_id", id).order("ref_no"),
  ]);
  const { data: counters } = await db.from("ckb_counts").select("id, counter_id, counter_name").in("id", (adjustments ?? []).map((a) => a.accepted_count_id).slice(0, 200));
  const counterOf = new Map((counters ?? []).map((c) => [c.id, c]));
  const adjRows: AdjRow[] = (adjustments ?? []).map((a) => ({ ...a, counter_id: counterOf.get(a.accepted_count_id)?.counter_id ?? null, counter_name: counterOf.get(a.accepted_count_id)?.counter_name ?? null }));

  return (
    <main>
      <CkbHeader title={`Review ${s.ref_no}`} subtitle={`${s.customer_name} · terhadap ${s.baseline_ref}`} back={{ href: `/ckb/stock-take/${id}`, label: s.ref_no }}
        live={["ckb_counts", "ckb_stocktakes", "ckb_adjustments"]}>
        <Pill tone={STOCKTAKE_STATUS[s.status].tone}>{STOCKTAKE_STATUS[s.status].label}</Pill>
        {s.status === "REVIEW" && (
          <RpcButton rpc="ckb_close_stocktake" args={{ p_id: id }} disabled={undecided.length > 0} title="Tutup sesi"
            summary={`${s.ref_no} ditutup. Hasilnya terlihat oleh perwakilan ${s.customer_name}. Penyesuaian yang belum diputuskan tetap bisa disetujui setelahnya.`}
            confirmLabel="Tutup sesi" reason={{ arg: "p_note", label: "Catatan penutupan" }}>
            {undecided.length > 0 ? `${undecided.length} tugas belum diputuskan` : "Tutup sesi"}
          </RpcButton>
        )}
      </CkbHeader>
      <CkbBody>
        {s.status === "COUNTING" && <Notice tone="warn">Penghitungan masih berjalan. Tutup penghitungan di halaman sesi untuk mulai review.</Notice>}
        <Notice>Menerima hitungan tidak mengubah stok: selisih menjadi usulan penyesuaian yang harus disetujui supervisor/admin lain dari penghitungnya, lalu diekspor ke SAP.</Notice>
        {s.status === "REVIEW" && (
          <ReviewClient tasks={undecided} counts={counts} notes={notes} evidence={evidence} me={user.id} />
        )}
        <AdjustmentsClient rows={adjRows} me={user.id} />
      </CkbBody>
    </main>
  );
}
