import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { loadSession } from "@/lib/ckb/stocktake-data";
import { STOCKTAKE_STATUS } from "@/lib/ckb/stocktake";
import { CkbBody, CkbHeader, Notice, Pill } from "@/components/ckb/ui";
import { AssignClient, type OverviewRow } from "./assign-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Penugasan hitung" };

/** Penugasan hitung (0133): which counter counts which locations of one stock take. */
export default async function AssignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCkb(`/ckb/stock-take/${id}/assign`);
  const s = await loadSession(id);
  if (!s) notFound();
  const db = await createClient();
  const [{ data: rows }, { data: staff }] = await Promise.all([
    db.rpc("ckb_assignment_overview", { p_stocktake: id }),
    db.rpc("ckb_staff"),
  ]);
  const editable = s.status === "DRAFT" || s.status === "COUNTING" || s.status === "REVIEW";
  return (
    <main>
      <CkbHeader title="Penugasan hitung" subtitle={`${s.ref_no} · ${s.customer_name}`} back={{ href: `/ckb/stock-take/${id}`, label: s.ref_no }}
        live={["ckb_stocktakes", "ckb_counts"]}>
        <Pill tone={STOCKTAKE_STATUS[s.status].tone}>{STOCKTAKE_STATUS[s.status].label}</Pill>
      </CkbHeader>
      <CkbBody className="max-w-5xl">
        {!editable && <Notice tone="warn">Sesi ini sudah {STOCKTAKE_STATUS[s.status].label.toLowerCase()}: penugasan tidak bisa diubah.</Notice>}
        <AssignClient sessionId={id} rows={(rows ?? []) as OverviewRow[]} editable={editable}
          staff={((staff ?? []) as { user_id: string; name: string; role: string }[]).filter((p) => p.role !== "customer")} />
      </CkbBody>
    </main>
  );
}
