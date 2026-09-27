import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/app/page-header";
import { parsePolicy, quantityAccuracy } from "@/lib/inventory-control";
import { CountsClient, type CountTask, type Schedule } from "./counts-client";

export const dynamic = "force-dynamic";

export default async function CountsPage() {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: open }, { data: done }, status, applied, { data: policy }, { data: items }] = await Promise.all([
    // Open tasks in bin order: one walk through the racks.
    supabase.from("count_task_detail").select("*").in("status", ["OPEN", "RECOUNT", "COUNTED"]).order("bin_code"),
    supabase.from("count_task_detail").select("*").in("status", ["APPLIED", "CLOSED"]).order("closed_at", { ascending: false }).limit(30),
    fetchAll<{ abc_class: string; has_stock: boolean; last_counted_at: string | null; due_date: string | null; open_task: boolean }>((a, b) =>
      supabase.from("cycle_count_status").select("abc_class, has_stock, last_counted_at, due_date, open_task").order("bin_id").range(a, b)),
    fetchAll<{ system_qty: number | null; variance_qty: number | null; first_variance_qty: number | null; tolerance: number }>((a, b) =>
      supabase.from("count_accuracy").select("system_qty, variance_qty, first_variance_qty, tolerance").gte("closed_at", since).order("id").range(a, b)),
    supabase.rpc("inventory_policy"),
    supabase.from("items").select("sku, shelf_life_months").not("shelf_life_months", "is", null),
  ]);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  const pol = parsePolicy(policy);
  const firstKnown = applied.filter((a) => a.first_variance_qty !== null);
  const schedule: Schedule = {
    bins: status.length,
    due: Object.fromEntries(["A", "B", "C"].map((k) => [k, status.filter((s) => s.abc_class === k && !s.open_task && (!s.due_date || s.due_date <= today)).length])),
    neverCounted: status.filter((s) => !s.last_counted_at && s.has_stock).length,
    countedLast30: applied.length,
    accurateLast30: applied.filter((a) => Number(a.variance_qty ?? 0) <= Number(a.tolerance)).length,
    qtyAccuracy: quantityAccuracy(applied),
    firstCountAccurate: firstKnown.filter((a) => Number(a.first_variance_qty) <= Number(a.tolerance)).length,
    firstCountKnown: firstKnown.length,
    target: pol.ira_target_pct,
  };
  return (
    <main>
      <PageHeader title="Cycle count" live={["count_tasks", "movements"]} />
      <CountsClient open={(open ?? []) as CountTask[]} done={(done ?? []) as CountTask[]} supervisor={user.role !== "operator"} schedule={schedule}
        shelfLife={Object.fromEntries((items ?? []).map((i) => [i.sku as string, Number(i.shelf_life_months)]))} defaultShelfLife={pol.default_shelf_life_months} />
    </main>
  );
}
