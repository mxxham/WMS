import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { OCCUPANCY_EXCLUDED_ZONES, RACK_BIN_REGEX } from "@/config/warehouse";
import { DEFAULT_CONFIG } from "@/lib/allocator/config";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Res = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

export type PlanItem = { sku: string; description: string; uom: string | null; upp: number | null; expected: number };
export type PutawaySetup = { items: PlanItem[]; emptyBins: string[]; pickfaces: Record<string, string>; allItems: Record<string, Omit<PlanItem, "expected">> };

/**
 * What the auto putaway needs for one receipt: its plan lines with master data, the rack bins it may use
 * (active, empty, not blocked in config, not the CKB aisles, not chosen by another receipt waiting to be
 * posted) and every SKU's pickface. The database re-checks each bin on save (record_receipt_check, 0118).
 */
export async function loadPutawaySetup(supabase: Supabase, receiptId: string): Promise<PutawaySetup> {
  const [expected, bins, stocked, reserved, pickfaces, items] = await Promise.all([
    supabase.from("receipt_expected").select("quantity, items(sku, description, uom, upp)").eq("receipt_id", receiptId).order("line_no"),
    fetchAll<{ bin_code: string; zone: string; status: string }>((a, b) =>
      supabase.from("bins").select("bin_code, zone, status").eq("status", "active").order("bin_code").range(a, b) as unknown as Res),
    fetchAll<{ bin_id: string; bins: { bin_code: string } | null }>((a, b) =>
      supabase.from("inventory").select("bin_id, bins(bin_code)").gt("quantity", 0).order("id").range(a, b) as unknown as Res),
    supabase.from("inbound_reserved_bins").select("bin_code, receipt_id").neq("receipt_id", receiptId),
    supabase.from("pickfaces").select("items(sku), bins(bin_code)"),
    fetchAll<{ sku: string; description: string; uom: string | null; upp: number | null }>((a, b) =>
      supabase.from("items").select("sku, description, uom, upp").order("sku").range(a, b) as unknown as Res),
  ]);
  const taken = new Set<string>([
    ...stocked.map((s) => s.bins?.bin_code).filter((c): c is string => !!c),
    ...((reserved.data ?? []) as { bin_code: string }[]).map((r) => r.bin_code),
    ...DEFAULT_CONFIG.blockedBins,
  ]);
  const emptyBins = bins.filter((b) => RACK_BIN_REGEX.test(b.bin_code) && !OCCUPANCY_EXCLUDED_ZONES.includes(b.zone) && !taken.has(b.bin_code))
    .map((b) => b.bin_code);
  const pf: Record<string, string> = {};
  for (const p of (pickfaces.data ?? []) as unknown as { items: { sku: string } | null; bins: { bin_code: string } | null }[]) {
    if (p.items && p.bins) pf[p.items.sku] = p.bins.bin_code;
  }
  const plan = ((expected.data ?? []) as unknown as { quantity: number; items: Omit<PlanItem, "expected"> | null }[])
    .filter((e) => e.items).map((e) => ({ ...e.items!, upp: e.items!.upp === null ? null : Number(e.items!.upp), expected: Number(e.quantity) }));
  const merged = new Map<string, PlanItem>();
  for (const p of plan) { const m = merged.get(p.sku); if (m) m.expected += p.expected; else merged.set(p.sku, { ...p }); }
  return {
    items: [...merged.values()], emptyBins, pickfaces: pf,
    allItems: Object.fromEntries(items.map((i) => [i.sku, { ...i, upp: i.upp === null ? null : Number(i.upp) }])),
  };
}
