import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RebaggingWorkspaceClient } from "./workspace-client";

export const dynamic = "force-dynamic";

/** Rebagging job detail page — server component fetches job + related data. */
export default async function RebaggingJobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"], "ckb_3pl");
  const { id } = await params;
  const supabase = await createClient();

  // Fetch job with item join
  const { data: job, error: jobError } = await supabase
    .from("ckb_rebagging_jobs")
    .select("*, items(sku, description, uom)")
    .eq("id", id)
    .single();

  if (jobError || !job) notFound();

  // Fetch sources with bins and packages joins
  const { data: sources } = await supabase
    .from("ckb_rebagging_sources")
    .select("*, bins(bin_code), ckb_packages(package_no)")
    .eq("job_id", id)
    .order("line_no");

  // Fetch outputs with bins join
  const { data: outputs } = await supabase
    .from("ckb_rebagging_outputs")
    .select("*, bins(bin_code)")
    .eq("job_id", id)
    .order("line_no");

  // Fetch evidence
  const { data: evidence } = await supabase
    .from("ckb_rebagging_evidence")
    .select("*")
    .eq("job_id", id)
    .order("uploaded_at");

  // Fetch events
  const { data: events } = await supabase
    .from("ckb_rebagging_events")
    .select("*")
    .eq("job_id", id)
    .order("at");

  return (
    <main>
      <RebaggingWorkspaceClient
        userRole={user.role}
        userName={user.name}
        userShared={user.shared}
        job={job}
        sources={sources ?? []}
        outputs={outputs ?? []}
        evidence={evidence ?? []}
        events={events ?? []}
      />
    </main>
  );
}