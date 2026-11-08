import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { RACK_BIN_REGEX } from "@/config/warehouse";
import { usableForShell } from "@/lib/racks";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Res = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

export type PlanItem = { sku: string; description: string; uom: string | null; upp: number | null; expected: number };
export type PutawaySetup = {
  items: PlanItem[]; emptyBins: string[]; pickfaces: Record<string, string>; allItems: Record<string, Omit<PlanItem, "expected">>;
  /** Where each SKU already is: bins with stock, and bins other receipts waiting to be posted have chosen. Groups pallets by SKU. */
  occupied: { bin: string; sku: string }[];
};

/**
 * What the auto putaway needs for one receipt: its plan lines with master data, the rack bins it may use
 * (active and Shell's (0132), empty, not chosen by another receipt waiting to be
 * posted) and every SKU's pickface. The database re-checks each bin on save (record_receipt_check, 0118).
 */
export async function loadPutawaySetup(supabase: Supabase, receiptId: string): Promise<PutawaySetup> {
  const [expected, bins, stocked, reserved, pickfaces, items] = await Promise.all([
    supabase.from("receipt_expected").select("quantity, items(sku, description, uom, upp)").eq("receipt_id", receiptId).order("line_no"),
    fetchAll<{ bin_code: string; zone: string; status: "active" | "blocked"; owner: "SHELL" | "CKB" | null }>((a, b) =>
      supabase.from("bins").select("bin_code, zone, status, owner").eq("status", "active").order("bin_code").range(a, b) as unknown as Res),
    fetchAll<{ bin_id: string; bins: { bin_code: string } | null; items: { sku: string } | null }>((a, b) =>
      supabase.from("inventory").select("bin_id, bins(bin_code), items(sku)").gt("quantity", 0).order("id").range(a, b) as unknown as Res),
    supabase.from("inbound_reserved_bins").select("bin_code, receipt_id, item_id").neq("receipt_id", receiptId),
    supabase.from("pickfaces").select("items(sku), bins(bin_code)"),
    fetchAll<{ id: string; sku: string; description: string; uom: string | null; upp: number | null }>((a, b) =>
      supabase.from("items").select("id, sku, description, uom, upp").order("sku").range(a, b) as unknown as Res),
  ]);
  const taken = new Set<string>([
    ...stocked.map((s) => s.bins?.bin_code).filter((c): c is string => !!c),
    ...((reserved.data ?? []) as { bin_code: string }[]).map((r) => r.bin_code),
  ]);
  // 0132: only racks Shell may use (not lent to CKB 3PL, not blocked, missing or planned).
  const emptyBins = bins.filter((b) => RACK_BIN_REGEX.test(b.bin_code) && usableForShell(b) && !taken.has(b.bin_code))
    .map((b) => b.bin_code);
  const pf: Record<string, string> = {};
  for (const p of (pickfaces.data ?? []) as unknown as { items: { sku: string } | null; bins: { bin_code: string } | null }[]) {
    if (p.items && p.bins) pf[p.items.sku] = p.bins.bin_code;
  }
  const plan = ((expected.data ?? []) as unknown as { quantity: number; items: Omit<PlanItem, "expected"> | null }[])
    .filter((e) => e.items).map((e) => ({ ...e.items!, upp: e.items!.upp === null ? null : Number(e.items!.upp), expected: Number(e.quantity) }));
  const merged = new Map<string, PlanItem>();
  for (const p of plan) { const m = merged.get(p.sku); if (m) m.expected += p.expected; else merged.set(p.sku, { ...p }); }
  const skuOf = new Map(items.map((i) => [i.id, i.sku]));
  const occupied = [
    ...stocked.flatMap((s) => (s.bins && s.items ? [{ bin: s.bins.bin_code, sku: s.items.sku }] : [])),
    ...((reserved.data ?? []) as { bin_code: string; item_id: string }[]).flatMap((r) => (skuOf.has(r.item_id) ? [{ bin: r.bin_code, sku: skuOf.get(r.item_id)! }] : [])),
  ];
  return {
    items: [...merged.values()], emptyBins, pickfaces: pf, occupied,
    allItems: Object.fromEntries(items.map(({ id: _, ...i }) => [i.sku, { ...i, upp: i.upp === null ? null : Number(i.upp) }])),
  };
}
