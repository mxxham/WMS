import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import type { StagingLine } from "@/lib/staging";
import { StagingClient } from "./staging-client";

export const dynamic = "force-dynamic";

/**
 * Staging (0134): what waits in a staging location (Rekap inbound STAGE-IN drums, and anything else put there),
 * oldest first, and the move of a line into a rack. Reads only staging_stock(); posts only staging_to_rack().
 */
export default async function StagingPage() {
  await requirePage("/staging");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staging_stock");
  const lines = ((data ?? []) as StagingLine[]).map((l) => ({
    ...l, quantity: Number(l.quantity), reserved: Number(l.reserved),
    days_waiting: l.days_waiting === null ? null : Number(l.days_waiting),
  }));
  return (
    <main>
      <PageHeader title="Staging" live={["movements", "pick_tasks"]} />
      <div className="flex flex-col gap-5 p-4 lg:p-8">
        {error ? <p className="rounded-md bg-bad/10 p-3 text-sm text-bad">{error.message}</p> : <StagingClient lines={lines} />}
      </div>
    </main>
  );
}
