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
  const [{ data: assigned }, { data: customer }] = await Promise.all([
    db.from("ckb_stocktake_counters").select("user_id").eq("stocktake_id", id),
    db.from("ckb_customers").select("count_photo_required").eq("id", s.customer_id).maybeSingle(),
  ]);
  // 0133: the task list already holds only the lines this account may count; none = nothing assigned here.
  const notAssigned = user.ckbRole === "operator" && tasks.length === 0
    && (assigned ?? []).length > 0 && !(assigned ?? []).some((a) => a.user_id === user.id);
  const lead = isLead(user.ckbRole);
  const open = s.status === "COUNTING" || s.status === "REVIEW";

  return (
    <main>
      <CkbHeader title={`Hitung ${s.ref_no}`} subtitle={`${s.customer_name} · ${s.warehouse}`} back={{ href: `/ckb/stock-take/${id}`, label: s.ref_no }} live={["ckb_stocktakes", "ckb_counts"]}>
        <Pill tone={STOCKTAKE_STATUS[s.status].tone}>{STOCKTAKE_STATUS[s.status].label}</Pill>
      </CkbHeader>
      <CkbBody className="max-w-5xl">
        {!open && <Notice tone="warn">Sesi ini tidak sedang dihitung ({STOCKTAKE_STATUS[s.status].label}).</Notice>}
        {s.status === "REVIEW" && <Notice>Sesi dalam review: hanya tugas yang diminta hitung ulang yang bisa dihitung.</Notice>}
        {notAssigned && <Notice tone="warn">Belum ada baris yang ditugaskan ke Anda di sesi ini. Minta supervisor menugaskan lokasi.</Notice>}
        <CountClient sessionId={id} sessionStatus={s.status} tasks={tasks} evidence={evidence}
          lead={lead} canCount={open && !notAssigned}
          rules={{ photoRules: s.photo_rules !== false, customerAlways: !!customer?.count_photo_required }}
          title={`Hitung stok ${s.customer_name}`}
          subtitle={`${s.ref_no} · ${s.warehouse}${lead ? "" : " · ditugaskan ke Anda"}${s.blind && !lead ? " · hitung buta" : ""}`} />
      </CkbBody>
    </main>
  );
}
