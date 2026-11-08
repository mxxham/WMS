import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { progress } from "@/lib/ckb/count-rules";
import { CkbBody, CkbHeader, EmptyState } from "@/components/ckb/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hitung saya" };

type Row = { id: string; ref_no: string; status: string; warehouse: string; customer_id: string; ckb_customers: { name: string } | null };

/**
 * Hitung saya (0133): the stock takes being counted that have lines for this account. One → straight in.
 * The progress is over the lines this account may count (ckb_stocktake_tasks returns only those to a counter).
 */
export default async function MyCountsPage() {
  await requireCkb("/ckb/count");
  const db = await createClient();
  const { data } = await db.from("ckb_stocktakes").select("id, ref_no, status, warehouse, customer_id, ckb_customers(name)")
    .in("status", ["COUNTING", "REVIEW"]).order("created_at", { ascending: false });
  const sessions = (data ?? []) as unknown as Row[];
  const withTasks = (await Promise.all(sessions.map(async (s) => {
    const { data: t } = await db.rpc("ckb_stocktake_tasks", { p_stocktake: s.id });
    const tasks = (t ?? []) as { status: string }[];
    const waiting = tasks.filter((x) => x.status === "OPEN" || x.status === "RECOUNT_REQUESTED").length;
    return { s, p: progress(tasks), waiting, again: tasks.filter((x) => x.status === "RECOUNT_REQUESTED").length };
  }))).filter((x) => x.p.total > 0 && (x.s.status === "COUNTING" || x.again > 0));
  if (withTasks.length === 1 && withTasks[0].waiting > 0) redirect(`/ckb/stock-take/${withTasks[0].s.id}/count`);

  return (
    <main>
      <CkbHeader title="Hitung saya" subtitle="Stock take yang sedang dihitung, dengan baris untuk Anda" live={["ckb_stocktakes", "ckb_counts"]} />
      <CkbBody className="max-w-2xl">
        {withTasks.length === 0 ? (
          <EmptyState title="Belum ada yang perlu dihitung">Supervisor akan menugaskan lokasi ke akun Anda. Halaman ini diperbarui sendiri.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {withTasks.map(({ s, p, again }) => (
              <li key={s.id}>
                <Link href={`/ckb/stock-take/${s.id}/count`} className="flex items-center gap-3 rounded-2xl bg-white p-4 hover:ring-2 hover:ring-ckb/30">
                  <span className="min-w-0 flex-1">
                    <span className="block font-cond text-lg font-semibold">{s.ckb_customers?.name ?? "Customer"} · {s.ref_no}</span>
                    <span className="block text-sm text-steel-500">{s.warehouse} · {p.done} dari {p.total} selesai{again ? ` · ${again} diminta hitung lagi` : ""}</span>
                    <span className="mt-2 block h-2 overflow-hidden rounded-full bg-steel-100"><span className="block h-full rounded-full bg-ckb" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></span>
                  </span>
                  <ChevronRight className="h-5 w-5 text-steel-300" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CkbBody>
    </main>
  );
}
