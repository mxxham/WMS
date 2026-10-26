import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { ImportClient } from "./import-client";
import { HeldPanel, type HeldRow } from "./held-panel";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireRole(["admin"]);
  // Stock a full import held back instead of zeroing (0108), still waiting for a decision.
  const { data: held } = await (await createClient()).from("import_hold_detail").select("*")
    .is("resolution", null).order("bin_code").order("sku");
  return (
    <main>
      <PageHeader title="Import data WMS" live={["import_holds"]} />
      {!!held?.length && <div className="px-4 pt-4 lg:px-8"><HeldPanel rows={held as HeldRow[]} /></div>}
      <ImportClient />
    </main>
  );
}
