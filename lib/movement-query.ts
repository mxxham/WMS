import type { SupabaseClient } from "@supabase/supabase-js";

export type MovementFilters = { from?: string; to?: string; type?: string; user?: string; bin?: string; sku?: string; reason?: string; person?: string };

export const MOVEMENT_SELECT =
  "id, type, quantity, batch_lot, created_at, note, reason_code, by_name, approved_by_name, items(sku, description, uom), from_bin:bins!movements_from_bin_id_fkey(bin_code), to_bin:bins!movements_to_bin_id_fkey(bin_code), profiles(name)";

/**
 * Resolves bin code / SKU to ids once, then returns a builder that applies
 * the same filters to any page range (used by the table and the .xlsx export).
 * Returns null when a filter matches nothing, so callers can show "no rows".
 */
export async function movementQuery(supabase: SupabaseClient, f: MovementFilters) {
  let binId: string | undefined, itemId: string | undefined;
  if (f.bin) {
    const { data } = await supabase.from("bins").select("id").eq("bin_code", f.bin.trim().toUpperCase()).maybeSingle();
    if (!data) return null;
    binId = data.id;
  }
  if (f.sku) {
    const { data } = await supabase.from("items").select("id").eq("sku", f.sku.trim()).maybeSingle();
    if (!data) return null;
    itemId = data.id;
  }
  return (from: number, to: number) => {
    let q = supabase.from("movements").select(MOVEMENT_SELECT).order("created_at", { ascending: false });
    if (f.from) q = q.gte("created_at", `${f.from}T00:00:00+07:00`); // WIB
    if (f.to) q = q.lte("created_at", `${f.to}T23:59:59+07:00`);
    if (f.type) q = q.eq("type", f.type);
    if (f.user) q = q.eq("user_id", f.user);
    if (binId) q = q.or(`from_bin_id.eq.${binId},to_bin_id.eq.${binId}`);
    if (itemId) q = q.eq("item_id", itemId);
    if (f.reason) q = q.eq("reason_code", f.reason);
    if (f.person) q = q.or(`by_name.ilike.%${f.person.replace(/[%,()]/g, "")}%,approved_by_name.ilike.%${f.person.replace(/[%,()]/g, "")}%`);
    return q.range(from, to);
  };
}
