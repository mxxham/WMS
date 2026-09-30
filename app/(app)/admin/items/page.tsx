import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/app/page-header";
import { parsePolicy } from "@/lib/inventory-control";
import { ItemsClient, type ItemRow } from "./items-client";

export const dynamic = "force-dynamic";

/** Item master fields inventory control owns: carton barcode, shelf life, dispatch minimum. */
export default async function ItemsPage() {
  await requireRole(["supervisor", "admin"]);
  const supabase = await createClient();
  const [items, { data: policy }] = await Promise.all([
    fetchAll<ItemRow>((a, b) => supabase.from("items").select("sku, description, uom, upp, volume_l, abc_class, ean, shelf_life_months, min_dispatch_days").order("sku").range(a, b)),
    supabase.rpc("inventory_policy"),
  ]);
  const p = parsePolicy(policy);
  return (
    <main>
      <PageHeader title="Master item" live={["items"]} />
      <ItemsClient items={items} defaultShelfLife={p.default_shelf_life_months} defaultMinDispatch={p.min_dispatch_days} />
    </main>
  );
}
