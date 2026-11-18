import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import type { StockLine } from "@/lib/stockcheck";

/**
 * The rows of Cek stok rak for one aisle: the bins Shell may use, every stock line in the aisle
 * (also in a bin Shell may not use, stock is stock) and what open wave tasks have promised on each.
 * Used by the page (server client) and by the Excel download (browser client).
 */
export async function loadAisle(db: SupabaseClient, aisle: string): Promise<{ bins: string[]; lines: StockLine[] }> {
  const like = `${aisle}%`;
  type Inv = Omit<StockLine, "reserved" | "waves"> & { quantity: number };
  const [bins, inv, tasks] = await Promise.all([
    // Only positions Shell can use are listed when empty (CKB 3PL, missing and planned bins are not free space).
    fetchAll<{ bin_code: string }>((a, b) => db.from("bin_summary").select("bin_code")
      .like("bin_code", like).not("rack", "is", null).eq("status", "active").eq("owner", "SHELL").order("bin_code").range(a, b)),
    fetchAll<Inv>((a, b) => db.from("inventory_detail")
      .select("bin_code, sku, description, uom, batch_lot, quantity, expiry_date, held")
      .like("bin_code", like).gt("quantity", 0).order("bin_code").order("sku").order("batch_lot").order("id").range(a, b)),
    fetchAll<{ sku: string; from_bin: string; batch_lot: string; expiry_date: string; quantity: number; wave_no: string }>((a, b) => db.from("pick_task_detail")
      .select("sku, from_bin, batch_lot, expiry_date, quantity, wave_no")
      .like("from_bin", like).eq("status", "PLANNED").in("wave_status", ["PENDING", "RESCHEDULED"]).order("id").range(a, b)),
  ]);

  const promised = new Map<string, { qty: number; waves: Set<string> }>();
  for (const t of tasks) {
    const k = `${t.from_bin}|${t.sku}|${t.batch_lot}|${t.expiry_date}`;
    const p = promised.get(k) ?? { qty: 0, waves: new Set<string>() };
    p.qty += Number(t.quantity); p.waves.add(t.wave_no); promised.set(k, p);
  }
  const lines: StockLine[] = inv.map((l) => {
    const p = promised.get(`${l.bin_code}|${l.sku}|${l.batch_lot}|${l.expiry_date ?? ""}`);
    return { ...l, quantity: Number(l.quantity), held: Number(l.held ?? 0), reserved: p?.qty ?? 0, waves: p ? [...p.waves].sort() : [] };
  });
  return { bins: bins.map((b) => b.bin_code), lines };
}

/** The aisles to choose from: the layout's order (Rak & Lokasi), else CA–CF. */
export async function loadAisles(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from("settings").select("value").eq("key", "layout").maybeSingle();
  const order = ((data?.value as { aisle_order?: string[] } | null)?.aisle_order ?? []).filter((a) => /^[A-Z]{2}$/.test(a));
  return order.length ? order : ["CA", "CB", "CC", "CD", "CE", "CF"];
}
