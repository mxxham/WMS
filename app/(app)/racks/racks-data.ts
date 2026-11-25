import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import type { BinState, RackBin } from "@/lib/racks";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Res = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

/** A Block C floor slot (0147): one dedicated SKU, `capacity` pallets high. */
export type BlockCSlot = { bin_code: string; state: BinState; assigned_sku: string | null; capacity: number | null; qty: number; pallets: number };
export type RacksData = { bins: RackBin[]; aisleOrder: string[]; baysPerSide: number; blockC: BlockCSlot[] };

/** Every bin with its stock summary, state and owner (bin_summary, 0132), and the layout the plan is drawn by. */
export async function loadRacks(supabase: Supabase): Promise<RacksData> {
  const [rows, { data: layout }, slotRows, stock] = await Promise.all([
    fetchAll<RackBin>((a, b) => supabase.from("bin_summary")
      .select("id, bin_code, zone, rack, level, position, status, block_kind, block_reason, owner, total_qty, fill_ratio, abc_class, min_expiry, skus")
      .order("bin_code").range(a, b) as unknown as Res),
    supabase.from("settings").select("value").eq("key", "layout").maybeSingle(),
    supabase.from("bins").select("bin_code, status, block_kind, assigned_sku, capacity").eq("site", "BLOCKC").order("bin_code"),
    fetchAll<{ quantity: number; bins: { bin_code: string } | null; items: { upp: number | null } | null }>((a, b) =>
      supabase.from("inventory").select("quantity, bins!inner(bin_code, site), items(upp)").eq("bins.site", "BLOCKC").gt("quantity", 0).order("id").range(a, b) as unknown as Res),
  ]);
  // Pallets in a slot = ceil(cartons / UPP), the same count the database uses for the stack height.
  const qty = new Map<string, number>(), pal = new Map<string, number>();
  for (const r of stock) {
    const code = r.bins?.bin_code; if (!code) continue;
    qty.set(code, (qty.get(code) ?? 0) + Number(r.quantity));
    pal.set(code, (pal.get(code) ?? 0) + (r.items?.upp && Number(r.items.upp) > 0 ? Number(r.quantity) / Number(r.items.upp) : 1));
  }
  const blockC: BlockCSlot[] = ((slotRows.data ?? []) as { bin_code: string; status: "active" | "blocked"; block_kind: Exclude<BinState, "ACTIVE"> | null; assigned_sku: string | null; capacity: number | null }[])
    .map((b) => ({ bin_code: b.bin_code, state: b.status === "active" ? "ACTIVE" : b.block_kind ?? "BLOCKED", assigned_sku: b.assigned_sku,
      capacity: b.capacity === null ? null : Number(b.capacity), qty: qty.get(b.bin_code) ?? 0, pallets: Math.ceil((pal.get(b.bin_code) ?? 0) - 1e-9) }));
  const value = (layout?.value ?? {}) as { aisle_order?: string[]; bays_per_side?: number };
  const bins = rows.map((r) => ({ ...r, total_qty: Number(r.total_qty), fill_ratio: r.fill_ratio === null ? null : Number(r.fill_ratio) }));
  return { bins, aisleOrder: value.aisle_order ?? [], baysPerSide: Number(value.bays_per_side) || 20, blockC };
}
