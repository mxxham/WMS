import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { RebaggingList, type RebaggingJobSummary } from "./rebagging-list";

export const dynamic = "force-dynamic";

/** Rebagging job list page — CKB 3PL operational module. */
export default async function RebaggingPage() {
  const user = await requireRole(["operator", "supervisor", "admin"], "ckb_3pl");
  const supabase = await createClient();

  const { data } = await supabase
    .from("ckb_rebagging_job_summary")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <main>
      <PageHeader title="Rebagging" live={["ckb_rebagging_jobs", "ckb_rebagging_outputs", "ckb_rebagging_evidence", "ckb_rebagging_events"]} />
      <RebaggingList jobs={(data ?? []) as RebaggingJobSummary[]} role={user.role} />
    </main>
  );
}