import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import type { RackBin } from "@/lib/racks";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Res = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

export type RacksData = { bins: RackBin[]; aisleOrder: string[]; baysPerSide: number };

/** Every bin with its stock summary, state and owner (bin_summary, 0132), and the layout the plan is drawn by. */
export async function loadRacks(supabase: Supabase): Promise<RacksData> {
  const [rows, { data: layout }] = await Promise.all([
    fetchAll<RackBin>((a, b) => supabase.from("bin_summary")
      .select("id, bin_code, zone, rack, level, position, status, block_kind, block_reason, owner, total_qty, fill_ratio, abc_class, min_expiry, skus")
      .order("bin_code").range(a, b) as unknown as Res),
    supabase.from("settings").select("value").eq("key", "layout").maybeSingle(),
  ]);
  const value = (layout?.value ?? {}) as { aisle_order?: string[]; bays_per_side?: number };
  const bins = rows.map((r) => ({ ...r, total_qty: Number(r.total_qty), fill_ratio: r.fill_ratio === null ? null : Number(r.fill_ratio) }));
  return { bins, aisleOrder: value.aisle_order ?? [], baysPerSide: Number(value.bays_per_side) || 20 };
}
