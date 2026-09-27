import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBinDetail } from "@/lib/bin-data";
import { PageHeader } from "@/components/app/page-header";
import { AdjustClient } from "./adjust-client";

export const dynamic = "force-dynamic";

/** Look up one bin (typed or scanned) and adjust its stock lines in place. */
export default async function AdjustPage({ searchParams }: { searchParams: Promise<{ bin?: string }> }) {
  await requireRole(["supervisor", "admin"]);
  const code = ((await searchParams).bin ?? "").trim().toUpperCase();
  const detail = code ? await getBinDetail(await createClient(), code) : null;
  return (
    <main>
      <PageHeader title="Adjust stok" />
      <AdjustClient code={code} detail={detail} />
    </main>
  );
}
