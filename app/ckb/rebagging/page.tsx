import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { CkbHeader } from "@/components/ckb/ui";
import { RebaggingList, type RebaggingJobSummary } from "./rebagging-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rebagging" };

/** Rebagging job list page — CKB 3PL operational module. `?baru=1` opens the new-job form. */
export default async function RebaggingPage({ searchParams }: { searchParams: Promise<{ baru?: string }> }) {
  const user = await requireCkb("/ckb/rebagging");
  const { baru } = await searchParams;
  const supabase = await createClient();

  const [{ data }, { data: customers }] = await Promise.all([
    supabase.from("ckb_rebagging_job_summary").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("ckb_customers").select("name").eq("active", true).order("name"),
  ]);

  return (
    <main>
      <CkbHeader title="Rebagging" subtitle="Ganti kemasan rusak, pecah, label ulang dan gabung kemasan." live={["ckb_rebagging_jobs", "ckb_rebagging_outputs", "ckb_rebagging_evidence", "ckb_rebagging_events"]} />
      <RebaggingList jobs={(data ?? []) as RebaggingJobSummary[]} role={user.ckbRole as "operator" | "supervisor" | "admin"}
        customers={(customers ?? []).map((c) => c.name)} startOpen={baru === "1"} />
    </main>
  );
}
