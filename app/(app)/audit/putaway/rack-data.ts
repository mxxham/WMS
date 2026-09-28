import type { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { walkKey, type RackState, type RackSummary } from "../picking/rack-data";

/** One putaway (a pallet into a bin) on the date, with its latest audit (0027). */
export type PutawayRow = {
  movement_id: string; type: "putaway" | "inbound"; created_at: string; by: string | null;
  sku: string; description: string; uom: string | null;
  from_bin: string | null; to_bin: string; zone: string; batch_lot: string; expiry_date: string | null; quantity: number;
  note: string | null;
  audit: {
    result: "OK" | "MISMATCH"; counted: number; skuOk: boolean; batchOk: boolean; foundSku: string | null; foundBatch: string | null;
    checker: string | null; note: string | null; at: string; attempts: number;
  } | null;
};

type Detail = {
  movement_id: string; type: "putaway" | "inbound"; created_at: string; created_by_name: string | null; by_name: string | null;
  sku: string; description: string; uom: string | null; from_bin: string | null; to_bin: string; zone: string;
  batch_lot: string; expiry_date: string | null; quantity: number; note: string | null;
  audit_id: string | null; counted_qty: number | null; sku_ok: boolean | null; batch_ok: boolean | null; result: "OK" | "MISMATCH" | null;
  audit_note: string | null; audited_at: string | null; audited_by_name: string | null;
  checker_name: string | null; found_sku: string | null; found_batch: string | null; attempts: number;
};

/** Putaways made on `date` (Jakarta day), in walking order. */
export async function putawayRows(supabase: Awaited<ReturnType<typeof createClient>>, date: string, zone?: string): Promise<PutawayRow[]> {
  const start = new Date(`${date}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 86_400_000);
  const data = await fetchAll<Detail>((from, to) => {
    let q = supabase.from("putaway_audit_detail").select("*")
      .gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
    if (zone) q = q.eq("zone", zone);
    return q.order("created_at").order("movement_id").range(from, to);
  });
  return data.map((m): PutawayRow => ({
    movement_id: m.movement_id, type: m.type, created_at: m.created_at, by: m.by_name ?? m.created_by_name,
    sku: m.sku, description: m.description, uom: m.uom, from_bin: m.from_bin, to_bin: m.to_bin, zone: m.zone,
    batch_lot: m.batch_lot, expiry_date: m.expiry_date, quantity: Number(m.quantity), note: m.note,
    audit: m.audit_id ? {
      result: m.result!, counted: Number(m.counted_qty), skuOk: !!m.sku_ok, batchOk: !!m.batch_ok,
      foundSku: m.found_sku, foundBatch: m.found_batch, checker: m.checker_name ?? m.audited_by_name,
      note: m.audit_note, at: m.audited_at!, attempts: m.attempts,
    } : null,
  })).sort((a, b) => walkKey(a.to_bin).localeCompare(walkKey(b.to_bin)) || a.created_at.localeCompare(b.created_at));
}

/** Per rack: bins put away into, putaways, and how many are audited OK. */
export function putawaySummary(rows: PutawayRow[]): RackSummary[] {
  const by = new Map<string, RackSummary & { binSet: Set<string> }>();
  for (const r of rows) {
    const s = by.get(r.zone) ?? { zone: r.zone, bins: 0, lines: 0, todo: 0, mismatch: 0, done: 0, state: "DONE" as RackState, binSet: new Set<string>() };
    s.binSet.add(r.to_bin); s.lines += 1;
    if (!r.audit) s.todo += 1; else if (r.audit.result === "MISMATCH") s.mismatch += 1; else s.done += 1;
    by.set(r.zone, s);
  }
  return [...by.values()].map(({ binSet, ...s }): RackSummary => ({
    ...s, bins: binSet.size, state: s.mismatch ? "MISMATCH" : s.todo ? "TODO" : "DONE",
  })).sort((a, b) => a.zone.localeCompare(b.zone));
}
