import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { findIssues, type StockRow } from "@/lib/data-quality";
import { PageHeader } from "@/components/app/page-header";
import { DataQualityClient } from "./data-quality-client";

export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  await requireRole(["supervisor", "admin"]);
  const supabase = await createClient();
  const [rows, { data: counts }, { data: items }, { data: policy }] = await Promise.all([
    fetchAll<StockRow>((from, to) => supabase.from("inventory_detail")
      .select("bin_code, rack, zone, sku, description, upp, batch_lot, quantity, expiry_date")
      .order("bin_code").order("sku").order("batch_lot").range(from, to)),
    supabase.from("count_task_detail").select("bin_code").in("status", ["OPEN", "COUNTED", "RECOUNT"]),
    supabase.from("items").select("sku, shelf_life_months").not("shelf_life_months", "is", null),
    supabase.rpc("inventory_policy"),
  ]);
  const shelfLife = new Map((items ?? []).map((i) => [i.sku as string, Number(i.shelf_life_months)]));
  const defaultShelfLife = Number((policy as { default_shelf_life_months?: number } | null)?.default_shelf_life_months ?? 48);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  return (
    <main>
      <PageHeader title="Kualitas data stok" live={["movements", "count_tasks"]} liveDebounceMs={2000} />
      <DataQualityClient issues={findIssues(rows, today, shelfLife, defaultShelfLife)} countBins={(counts ?? []).map((c) => c.bin_code as string)} />
    </main>
  );
}
