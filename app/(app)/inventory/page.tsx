import { packLines } from "@/lib/inventory-pack";
import { requireRole } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { unstable_cache } from "next/cache";
import { PageHeader } from "@/components/app/page-header";
import { TabsNav } from "@/components/app/tabs-nav";
import { parsePolicy } from "@/lib/inventory-control";
import { InventoryClient, type InvLine, type OpenTask } from "./inventory-client";
import { FefoTab, type FefoException } from "./tabs/fefo-tab";
import { StayTab } from "./tabs/stay-tab";
import { HoldsTab, type HoldRow } from "./tabs/holds-tab";
import { AccuracyTab, type AccuracyRow, type AdjustmentRow } from "./tabs/accuracy-tab";
import { ReconTab, type ReconLine, type ReconSummary } from "./tabs/recon-tab";
import { ApprovalsTab, type RequestRow } from "./tabs/approvals-tab";
import { EmptyTab, type EmptyBin } from "./tabs/empty-tab";
import { WmsDayDownload } from "./wms-day-download";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "stok", label: "Stok" },
  { key: "fefo", label: "Expired & FEFO" },
  { key: "inap", label: "Lama di gudang" },
  { key: "kosong", label: "Bin kosong" },
  { key: "hold", label: "Hold & karantina" },
  { key: "akurasi", label: "Akurasi & adjustment" },
  { key: "rekonsiliasi", label: "Rekonsiliasi SAP" },
  { key: "persetujuan", label: "Persetujuan" },
] as const;
type Tab = (typeof TABS)[number]["key"];

type Params = { tab?: string; near?: string; q?: string; abc?: string; sort?: string; aisle?: string; level?: string; view?: string; days?: string; recon?: string };

// fefo_exceptions takes ~8s on the live data set; cache both counts per window
// for 15 min, mirroring the dashboard's getFefoCompliance, so the FEFO tab
// does not wait on it. A cached function may not read cookies, so it uses the
// server-only client: two read-only, warehouse-wide queries with no per-user
// rule, and the page has already required a signed-in user. A failed call is
// not cached — it throws, and the caller shows the message.
const getFefoCompliance = unstable_cache(async (days: number) => {
  const supabase = createServiceClient();
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const [exc, picks] = await Promise.all([
    supabase.rpc("fefo_exceptions", { p_from: from, p_to: to }),
    supabase.rpc("fefo_pick_count", { p_from: from, p_to: to }),
  ]);
  if (exc.error || picks.error) throw new Error(exc.error?.message ?? picks.error?.message);
  return { exceptions: (exc.data ?? []) as FefoException[], picks: Number(picks.data ?? 0) };
}, ["inventory-fefo-compliance"], { revalidate: 900 });

/**
 * Inventory control in one place: the stock (with what is reserved and what
 * is held), expiry and FEFO, holds, count accuracy and adjustments, the
 * reconciliation with Shell's SAP stock and the approval queue.
 */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const sp = await searchParams;
  const supervisor = user.role !== "operator";
  const tab: Tab = (TABS.some((t) => t.key === sp.tab) ? sp.tab : "stok") as Tab;
  const supabase = await createClient();
  const [{ count: pending }, { count: holds }, { data: policyRaw }] = await Promise.all([
    supabase.from("adjustment_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
    supabase.from("stock_holds").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
    supabase.rpc("inventory_policy"),
  ]);
  const policy = parsePolicy(policyRaw);
  const tabs = TABS.filter((t) => supervisor || t.key === "stok" || t.key === "fefo" || t.key === "inap" || t.key === "kosong")
    .map((t) => ({ ...t, badge: t.key === "persetujuan" ? pending ?? 0 : t.key === "hold" ? holds ?? 0 : undefined }));

  return (
    <main>
      <PageHeader title="Inventory" live={["movements", "pick_tasks", "count_tasks", "stock_holds", "adjustment_requests", "stock_recon_lines", "stock_recons"]} liveDebounceMs={2000} />
      <TabsNav base="/inventory" tabs={tabs} active={tab} />
      {tab === "stok" && <WmsDayDownload />}
      {tab === "stok" && await stockTab(sp)}
      {tab === "fefo" && await fefoTab(sp, policy.near_expiry_days, policy.default_shelf_life_months)}
      {tab === "inap" && await stayTab()}
      {tab === "kosong" && <EmptyTab bins={await fetchAll<EmptyBin>((a, b) => supabase.from("empty_bins").select("*").order("bin_code").range(a, b))}
        near={(sp.near ?? "").trim().toUpperCase()} aisle={sp.aisle ?? ""} level={sp.level ?? ""} />}
      {tab === "hold" && supervisor && await holdTab()}
      {tab === "akurasi" && supervisor && await accuracyTab(policy.ira_target_pct)}
      {tab === "rekonsiliasi" && supervisor && await reconTab(sp.recon)}
      {tab === "persetujuan" && supervisor && await approvalsTab(policy.adjust_approval_qty)}
    </main>
  );

  async function stockTab(p: Params) {
    const aisle = /^[A-Z]{2}$/.test(p.aisle?.toUpperCase() ?? "") ? p.aisle!.toUpperCase() : undefined;
    const level = /^[A-E]$/.test(p.level?.toUpperCase() ?? "") ? p.level!.toUpperCase() : undefined;
    const [lines, tasks, empty] = await Promise.all([
      fetchAll<InvLine>((a, b) => supabase.from("inventory_detail")
        .select("bin_code, zone, rack, level, bin_status, sku, description, uom, upp, item_abc, batch_lot, quantity, expiry_date, received_date, days_remaining, held, hold_reasons")
        .order("sku").order("bin_code").order("id").range(a, b)),
      fetchAll<OpenTask>((a, b) => supabase.from("pick_task_detail")
        .select("task_type, sku, from_bin, to_bin, batch_lot, expiry_date, quantity, wave_no, planned_date")
        .eq("status", "PLANNED").in("wave_status", ["PENDING", "RESCHEDULED"]).order("id").range(a, b)),
      // Opened from the dashboard's occupancy grid: the empty rack positions of that aisle / level too.
      aisle || level
        ? fetchAll<{ bin_code: string; status: string }>((a, b) => {
            let qb = supabase.from("bin_summary").select("bin_code, status").not("rack", "is", null).eq("total_qty", 0);
            if (aisle) qb = qb.eq("zone", aisle);
            if (level) qb = qb.eq("level", level);
            return qb.order("bin_code").range(a, b);
          })
        : Promise.resolve([]),
    ]);
    return (
      <InventoryClient packed={packLines(lines)} tasks={tasks} canAdjust={supervisor} initialQuery={p.q ?? ""} initialAbc={p.abc} initialSort={p.sort}
        initialAisle={aisle} initialLevel={level} initialView={p.view === "line" || aisle || level ? "line" : "sku"}
        emptyBins={empty.map((e) => ({ code: e.bin_code, blocked: e.status === "blocked" }))} />
    );
  }

  async function fefoTab(p: Params, nearDays: number, defaultShelfLife: number) {
    const days = [7, 30, 90].includes(Number(p.days)) ? Number(p.days) : 30;
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const [lines, { data: exceptions, error: e1 }, { data: picks }, { data: items }] = await Promise.all([
      fetchAll<FefoLine>((a, b) => supabase.from("inventory_detail")
        .select("bin_code, zone, rack, bin_status, sku, description, uom, batch_lot, quantity, expiry_date, received_date, days_remaining, held")
        .order("expiry_date", { nullsFirst: false }).order("sku").order("id").range(a, b)),
      supabase.rpc("fefo_exceptions", { p_from: from, p_to: to }),
      supabase.rpc("fefo_pick_count", { p_from: from, p_to: to }),
      supabase.from("items").select("sku, shelf_life_months").not("shelf_life_months", "is", null),
    ]);
    return (
      <FefoTab lines={lines} nearDays={nearDays} days={days} exceptions={(exceptions ?? []) as FefoException[]} picks={Number(picks ?? 0)}
        error={e1?.message ?? null} shelfLife={Object.fromEntries((items ?? []).map((i) => [i.sku as string, Number(i.shelf_life_months)]))}
        defaultShelfLife={defaultShelfLife} />
    );
  }

  async function stayTab() {
    const lines = await fetchAll<FefoLine>((a, b) => supabase.from("inventory_detail")
      .select("bin_code, zone, rack, bin_status, sku, description, uom, batch_lot, quantity, expiry_date, received_date, days_remaining, held")
      .order("received_date", { nullsFirst: false }).order("sku").order("id").range(a, b));
    return <StayTab lines={lines} />;
  }

  async function holdTab() {
    const [{ data: active }, { data: released }] = await Promise.all([
      supabase.from("stock_hold_detail").select("*").eq("status", "ACTIVE").order("created_at", { ascending: false }),
      supabase.from("stock_hold_detail").select("*").eq("status", "RELEASED").order("released_at", { ascending: false }).limit(50),
    ]);
    return <HoldsTab active={(active ?? []) as HoldRow[]} released={(released ?? []) as HoldRow[]} />;
  }

  async function accuracyTab(target: number) {
    const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const [counts, adjustments, { data: recons }] = await Promise.all([
      fetchAll<AccuracyRow>((a, b) => supabase.from("count_accuracy")
        .select("id, bin_code, abc_class, closed_at, system_qty, variance_qty, first_variance_qty, rounds, reason_code, tolerance")
        .gte("closed_at", since90).order("closed_at").range(a, b)),
      fetchAll<AdjustmentRow>((a, b) => supabase.from("movements")
        .select("created_at, quantity, reason_code, note, by_name, approved_by_name, items(sku, description)")
        .eq("type", "adjustment").gte("created_at", since90).order("created_at").range(a, b)),
      supabase.from("stock_recon_summary").select("id, as_of, accuracy_pct, skus, skus_match").order("as_of", { ascending: false }).limit(6),
    ]);
    return <AccuracyTab counts={counts} adjustments={adjustments} target={target} recons={(recons ?? []) as { id: string; as_of: string; accuracy_pct: number | null; skus: number; skus_match: number }[]} />;
  }

  async function reconTab(reconId?: string) {
    const [{ data: runs }, lines] = await Promise.all([
      supabase.from("stock_recon_summary").select("*").order("created_at", { ascending: false }).limit(20),
      reconId ? fetchAll<ReconLine>((a, b) => supabase.from("stock_recon_lines").select("*").eq("recon_id", reconId).order("sku").range(a, b)) : Promise.resolve(null),
    ]);
    return <ReconTab runs={(runs ?? []) as ReconSummary[]} selected={reconId ?? null} lines={lines} />;
  }

  async function approvalsTab(limit: number) {
    const [{ data: open }, { data: done }] = await Promise.all([
      supabase.from("adjustment_request_detail").select("*").eq("status", "PENDING").order("requested_at"),
      supabase.from("adjustment_request_detail").select("*").neq("status", "PENDING").order("decided_at", { ascending: false }).limit(30),
    ]);
    return <ApprovalsTab open={(open ?? []) as RequestRow[]} done={(done ?? []) as RequestRow[]} limit={limit} />;
  }
}

export type FefoLine = {
  bin_code: string; zone: string; rack: string | null; bin_status: string; sku: string; description: string; uom: string | null;
  batch_lot: string; quantity: number; expiry_date: string | null; received_date: string | null; days_remaining: number | null; held: number;
};
