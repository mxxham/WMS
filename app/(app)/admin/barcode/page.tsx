import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/app/page-header";
import { BindBarcodeClient, type BindItem } from "./bind-client";

export const dynamic = "force-dynamic";

/** Bind a carton barcode to a SKU (supervisor/admin). */
export default async function BarcodePage() {
  await requireRole(["supervisor", "admin"]);
  const supabase = await createClient();
  const items = await fetchAll<BindItem>((from, to) =>
    supabase
      .from("items")
      .select("sku, description, uom, ean, shelf_life_months, min_dispatch_days")
      .order("sku")
      .range(from, to),
  );
  return (
    <main>
      <PageHeader title="Ikat barcode" live={["items"]} />
      <BindBarcodeClient items={items} />
    </main>
  );
}
