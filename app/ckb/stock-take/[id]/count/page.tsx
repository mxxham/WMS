import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { loadSession, loadTaskEvidence, loadTasks } from "@/lib/ckb/stocktake-data";
import { isLead } from "@/lib/ckb/permissions";
import { STOCKTAKE_STATUS } from "@/lib/ckb/stocktake";
import { CkbHeader, CkbBody, Notice, Pill } from "@/components/ckb/ui";
import { CountClient } from "./count-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hitung" };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCkb(`/ckb/stock-take/${id}/count`);
  const s = await loadSession(id);
  if (!s) notFound();
  const tasks = await loadTasks(id);
  const db = await createClient();
  const evidence = await loadTaskEvidence(tasks.map((t) => t.id));
  const { data: assigned } = await db.from("ckb_stocktake_counters").select("user_id").eq("stocktake_id", id);
  const notAssigned = user.ckbRole === "operator" && (assigned ?? []).length > 0 && !(assigned ?? []).some((a) => a.user_id === user.id);
  const open = s.status === "COUNTING" || s.status === "REVIEW";

  return (
    <main>
      <CkbHeader title={`Hitung ${s.ref_no}`} subtitle={`${s.customer_name} · ${s.warehouse}`} back={{ href: `/ckb/stock-take/${id}`, label: s.ref_no }} live={["ckb_stocktakes", "ckb_counts"]}>
        <Pill tone={STOCKTAKE_STATUS[s.status].tone}>{STOCKTAKE_STATUS[s.status].label}</Pill>
      </CkbHeader>
      <CkbBody className="max-w-3xl">
        {!open && <Notice tone="warn">Sesi ini tidak sedang dihitung ({STOCKTAKE_STATUS[s.status].label}).</Notice>}
        {s.status === "REVIEW" && <Notice>Sesi dalam review: hanya tugas yang diminta hitung ulang yang bisa dihitung.</Notice>}
        {notAssigned && <Notice tone="warn">Anda tidak ditugaskan di sesi ini. Minta supervisor menambahkan Anda.</Notice>}
        {s.blind && !isLead(user.ckbRole) && <Notice>Hitung buta: qty SAP tidak ditampilkan. Hitung apa yang ada di bin.</Notice>}
        <CountClient sessionId={id} sessionStatus={s.status} tasks={tasks} evidence={evidence}
          me={user.id} lead={isLead(user.ckbRole)} canCount={open && !notAssigned} />
      </CkbBody>
    </main>
  );
}
