import type { createClient } from "@/lib/supabase/server";
import type { LineState } from "@/lib/pick-audit";

/** Audit state of one bin + SKU, and of a rack (aisle) as a whole. */
export type BinState = "TODO" | "MISMATCH" | "RESOLVED" | "OK";
export type RackState = "TODO" | "MISMATCH" | "DONE";

export const BIN_STATE_LABEL: Record<BinState, string> = { TODO: "Belum dihitung", MISMATCH: "Selisih", RESOLVED: "Diterima supervisor", OK: "OK" };
export const BIN_STATE_TONE: Record<BinState, string> = {
  TODO: "bg-steel-100 text-steel-700", MISMATCH: "bg-bad/10 text-bad", RESOLVED: "bg-warn/10 text-warn", OK: "bg-ok/10 text-ok",
};
export const RACK_STATE_LABEL: Record<RackState, string> = { TODO: "Belum selesai", MISMATCH: "Ada selisih", DONE: "Selesai" };
export const RACK_STATE_TONE: Record<RackState, string> = { TODO: "bg-steel-100 text-steel-700", MISMATCH: "bg-bad/10 text-bad", DONE: "bg-ok/10 text-ok" };

/** One bin + SKU picked on the date. `system` / `counted` only once the bin was counted at the rack. */
export type RackBin = {
  bin_code: string; zone: string; sku: string; description: string; uom: string | null;
  lines: number; shipments: string[]; pickers: string[]; state: BinState;
  /** what the system holds of the SKU in the bin now, all batches (only when one rack is loaded) */
  bin_qty: number | null;
  /** open to a count: still has lines to audit on a shipment that is not loaded */
  countable: boolean;
  /** already counted and still open to a supervisor's correction (Ubah, 0032) */
  correctable: boolean;
  last: { checker: string; system: number | null; counted: number | null; at: string } | null;
};
export type RackSummary = { zone: string; bins: number; lines: number; todo: number; mismatch: number; done: number; state: RackState };

type Line = {
  task_id: string; from_bin: string; zone: string; sku: string; description: string; uom: string | null; shipment_number: string;
  picked_by_name: string | null; line_state: LineState; loaded: boolean;
};

// Walking order inside an aisle: rack, then position, then level (CC15A02 -> 15, 02, A).
export function walkKey(bin: string): string {
  const m = /^([A-Z]{2})(\d{2})([A-Z])(\d{2})$/.exec(bin);
  return m ? `${m[1]}${m[2]}${m[4]}${m[3]}` : bin;
}

/** Every bin + SKU picked on `date` (cancelled waves and 0-picks left out), in walking order. */
export async function rackBins(supabase: Awaited<ReturnType<typeof createClient>>, date: string, zone?: string): Promise<RackBin[]> {
  let q = supabase.from("pick_audit_line")
    .select("task_id, from_bin, zone, sku, description, uom, shipment_number, picked_by_name, line_state, loaded")
    .eq("planned_date", date).neq("wave_status", "CANCELLED").neq("line_state", "AUTO_PASS");
  if (zone) q = q.eq("zone", zone);
  const { data } = await q;
  const lines = (data ?? []) as Line[];
  if (!lines.length) return [];

  const { data: counts } = await supabase.from("pick_audits")
    .select("task_id, checker_name, rack_system, rack_counted, created_at, pick_tasks!inner(waves!inner(planned_date))")
    .eq("method", "RACK").eq("pick_tasks.waves.planned_date", date).order("created_at");

  const byBin = new Map<string, { bin: RackBin; states: LineState[]; open: boolean; fixable: boolean }>();
  for (const l of lines) {
    const k = `${l.from_bin}|${l.sku}`;
    const g = byBin.get(k) ?? {
      bin: { bin_code: l.from_bin, zone: l.zone, sku: l.sku, description: l.description, uom: l.uom, lines: 0,
             shipments: [], pickers: [], state: "OK" as BinState, bin_qty: null, countable: false, correctable: false, last: null },
      states: [], open: false, fixable: false,
    };
    g.bin.lines += 1;
    if (!g.bin.shipments.includes(l.shipment_number)) g.bin.shipments.push(l.shipment_number);
    if (l.picked_by_name && !g.bin.pickers.includes(l.picked_by_name)) g.bin.pickers.push(l.picked_by_name);
    g.states.push(l.line_state);
    if (!l.loaded && (l.line_state === "TODO" || l.line_state === "MISMATCH")) g.open = true;
    if (!l.loaded && (l.line_state === "OK" || l.line_state === "MISMATCH")) g.fixable = true;
    byBin.set(k, g);
  }
  if (zone) {
    const { data: stock } = await supabase.from("inventory_detail").select("bin_code, sku, quantity")
      .in("bin_code", [...new Set(lines.map((l) => l.from_bin))]);
    for (const g of byBin.values()) g.bin.bin_qty = 0;
    for (const r of (stock ?? []) as { bin_code: string; sku: string; quantity: number }[]) {
      const g = byBin.get(`${r.bin_code}|${r.sku}`);
      if (g) g.bin.bin_qty! += Number(r.quantity);
    }
  }
  const binOf = new Map(lines.map((l) => [l.task_id, `${l.from_bin}|${l.sku}`]));
  for (const c of counts ?? []) {
    const g = byBin.get(binOf.get(c.task_id) ?? "");
    if (g) g.bin.last = { checker: c.checker_name, system: c.rack_system, counted: c.rack_counted, at: c.created_at };
  }
  return [...byBin.values()].map(({ bin, states, open, fixable }): RackBin => ({
    ...bin,
    countable: open,
    correctable: fixable,
    state: states.includes("MISMATCH") ? "MISMATCH" : states.includes("TODO") ? "TODO" : states.includes("RESOLVED") ? "RESOLVED" : "OK",
  })).sort((a, b) => walkKey(a.bin_code).localeCompare(walkKey(b.bin_code)) || a.sku.localeCompare(b.sku));
}

/** Per aisle (CA, CB, ...): how many bins were picked and how far the count is. */
export function rackSummary(bins: RackBin[]): RackSummary[] {
  const by = new Map<string, RackSummary>();
  for (const b of bins) {
    const s = by.get(b.zone) ?? { zone: b.zone, bins: 0, lines: 0, todo: 0, mismatch: 0, done: 0, state: "DONE" as RackState };
    s.bins += 1; s.lines += b.lines;
    if (b.state === "TODO") s.todo += 1; else if (b.state === "MISMATCH") s.mismatch += 1; else s.done += 1;
    by.set(b.zone, s);
  }
  return [...by.values()].map((s) => ({ ...s, state: s.mismatch ? "MISMATCH" : s.todo ? "TODO" : "DONE" } as RackSummary))
    .sort((a, b) => a.zone.localeCompare(b.zone));
}
