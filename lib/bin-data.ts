import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bin, InventoryRow, Movement } from "@/lib/types";

export type BinDetail = { bin: Bin; inventory: InventoryRow[]; movements: Movement[]; fillRatio: number | null };

/** Everything the scan screen and the 3D side panel show for one bin. */
export async function getBinDetail(supabase: SupabaseClient, rawCode: string): Promise<BinDetail | null> {
  const code = decodeURIComponent(rawCode).trim().toUpperCase();
  const { data: bin } = await supabase.from("bins").select("*").eq("bin_code", code).maybeSingle();
  if (!bin) return null;

  const [{ data: inv }, { data: mv }, { data: holds }] = await Promise.all([
    supabase
      .from("inventory")
      .select("id, bin_id, item_id, batch_lot, quantity, expiry_date, received_date, items(sku, description, uom, abc_class, upp)")
      .eq("bin_id", bin.id)
      // FEFO: earliest expiry first; rows without a date go last.
      .order("expiry_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("movements")
      .select("id, type, quantity, batch_lot, created_at, note, reason_code, by_name, approved_by_name, items(sku, description), from_bin:bins!movements_from_bin_id_fkey(bin_code), to_bin:bins!movements_to_bin_id_fkey(bin_code), profiles(name)")
      .or(`from_bin_id.eq.${bin.id},to_bin_id.eq.${bin.id}`)
      .order("created_at", { ascending: false })
      .limit(10),
    // Held cartons per stock line (0017).
    supabase.from("inventory_detail").select("id, held, hold_reasons").eq("bin_id", bin.id).gt("held", 0),
  ]);

  const held = new Map((holds ?? []).map((h) => [h.id as string, { held: Number(h.held), hold_reasons: h.hold_reasons as string | null }]));
  const inventory = ((inv ?? []) as unknown as InventoryRow[]).map((r) => ({ ...r, held: held.get(r.id)?.held ?? 0, hold_reasons: held.get(r.id)?.hold_reasons ?? null }));
  // Utilisation in pallet equivalents: sum(qty / units-per-pallet) / capacity.
  let fillRatio: number | null = inventory.length === 0 ? 0 : null;
  if (inventory.length > 0 && bin.capacity && inventory.every((r) => r.items?.upp)) {
    fillRatio = inventory.reduce((s, r) => s + r.quantity / (r.items!.upp as number), 0) / bin.capacity;
  }
  return { bin: bin as Bin, inventory, movements: (mv ?? []) as unknown as Movement[], fillRatio };
}
