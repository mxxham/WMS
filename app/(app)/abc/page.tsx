import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { fetchAll } from "@/lib/fetch-all";
import { parsePolicy } from "@/lib/inventory-control";
import { packOf } from "@/lib/inbound/putaway-plan";
import { jakartaDay } from "@/lib/ledger/dates";
import { rackOf, type AbcClass, type AbcItem, type AbcRow, type AbcRun } from "@/lib/abc";
import { AbcClient } from "./abc-client";

export const dynamic = "force-dynamic";

const HISTORY_RUNS = 6;
type Res = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/**
 * Kelas ABC (0126): which SKUs are picked most, from a stored run, next to what the warehouse holds now.
 * Opening the page (or the Dashboard) in a new month computes and applies last month once (abc_ensure_monthly).
 * ?run= shows another run; by default the run in force (the latest applied), else the latest preview.
 */
export default async function AbcPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const user = await requirePage("/abc");
  const supabase = await createClient();
  // Never let the monthly run take the page down: the page still shows the runs that exist.
  const monthly = await supabase.rpc("abc_ensure_monthly").then((r) => (r.error ? null : (r.data as string | null)), () => null);

  const [{ data: runsRaw }, { data: policyRaw }] = await Promise.all([
    supabase.from("abc_runs").select("*").order("period_to", { ascending: false }).order("created_at", { ascending: false }).limit(36),
    supabase.rpc("inventory_policy"),
  ]);
  const runs = ((runsRaw ?? []) as AbcRun[]).map((r) => ({ ...r, a_pct: Number(r.a_pct), b_pct: Number(r.b_pct), total_cartons: Number(r.total_cartons) }));
  const wanted = (await searchParams).run;
  const run = runs.find((r) => r.id === wanted)
    ?? [...runs].filter((r) => r.applied_at).sort((a, b) => b.applied_at!.localeCompare(a.applied_at!))[0]
    ?? runs[0] ?? null;

  const policy = parsePolicy(policyRaw);
  const canRun = ["inventory", "leader", "admin"].includes(user.job);
  const base = { runs, policy: { a: policy.abc_a_pct, b: policy.abc_b_pct }, canRun, canSetLimits: user.job === "admin",
    today: jakartaDay(), monthlyRan: !!monthly };

  if (!run) {
    return (
      <main>
        <PageHeader title="Kelas ABC" live={["movements"]} />
        <AbcClient {...base} run={null} rows={[]} trend={[]} />
      </main>
    );
  }

  // Earlier applied runs for each SKU's class history and the month-to-month trend.
  const earlier = runs.filter((r) => r.id !== run.id && r.applied_at && r.period_to <= run.period_to).slice(0, HISTORY_RUNS);
  const [items, histItems, stock, { data: pickfaces }, master] = await Promise.all([
    fetchAll<AbcItem>((a, b) => supabase.from("abc_run_items").select("item_id, sku, description, class, prev_class, rank, pick_lines, cartons, pick_days, share, cum_share")
      .eq("run_id", run.id).order("rank").range(a, b) as unknown as Res),
    earlier.length ? fetchAll<{ run_id: string; item_id: string; class: AbcClass; pick_lines: number }>((a, b) =>
      supabase.from("abc_run_items").select("run_id, item_id, class, pick_lines").in("run_id", earlier.map((r) => r.id))
        .order("run_id").order("item_id").range(a, b) as unknown as Res) : Promise.resolve([]),
    fetchAll<{ item_id: string; quantity: number; bins: { bin_code: string } | null }>((a, b) =>
      supabase.from("inventory").select("item_id, quantity, bins(bin_code)").gt("quantity", 0).order("id").range(a, b) as unknown as Res),
    supabase.from("pickfaces").select("item_id, bins(bin_code)"),
    fetchAll<{ id: string; sku: string; uom: string | null; description: string }>((a, b) =>
      supabase.from("items").select("id, sku, uom, description").order("sku").range(a, b) as unknown as Res),
  ]);

  const onHand = new Map<string, { qty: number; bins: Set<string>; racks: Set<string> }>();
  for (const s of stock) {
    const o = onHand.get(s.item_id) ?? onHand.set(s.item_id, { qty: 0, bins: new Set(), racks: new Set() }).get(s.item_id)!;
    o.qty += Number(s.quantity);
    if (s.bins) { o.bins.add(s.bins.bin_code); const r = rackOf(s.bins.bin_code); if (r) o.racks.add(r); }
  }
  const pf = new Map(((pickfaces ?? []) as unknown as { item_id: string; bins: { bin_code: string } | null }[])
    .filter((p) => p.bins).map((p) => [p.item_id, p.bins!.bin_code]));
  const itemById = new Map(master.map((m) => [m.id, m]));
  const histBy = new Map<string, Map<string, AbcClass>>();
  for (const h of histItems) (histBy.get(h.item_id) ?? histBy.set(h.item_id, new Map()).get(h.item_id)!).set(h.run_id, h.class);

  const rows: AbcRow[] = items.map((i) => {
    const o = onHand.get(i.item_id), m = itemById.get(i.item_id);
    return {
      ...i, pick_lines: Number(i.pick_lines), cartons: Number(i.cartons), pick_days: Number(i.pick_days), share: Number(i.share), cum_share: Number(i.cum_share),
      stock: o?.qty ?? 0, bins: o?.bins.size ?? 0, racks: o?.racks.size ?? 0, pickface: pf.get(i.item_id) ?? null,
      pack: m ? packOf(m.sku, m.uom, m.description) : null,
      history: earlier.map((r) => histBy.get(i.item_id)?.get(r.id) ?? null),
    };
  });
  // Month-to-month: SKUs per class and lines per class in each earlier run, newest first.
  const trend = earlier.map((r) => {
    const of = histItems.filter((h) => h.run_id === r.id);
    const count = (c: AbcClass) => of.filter((h) => h.class === c).length;
    return { id: r.id, from: r.period_from, to: r.period_to, lines: r.total_lines, A: count("A"), B: count("B"), C: count("C") };
  });

  return (
    <main>
      <PageHeader title="Kelas ABC" live={["movements"]} />
      <AbcClient {...base} run={run} rows={rows} trend={trend} />
    </main>
  );
}
