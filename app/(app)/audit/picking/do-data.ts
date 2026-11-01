import { mergeDos } from "@/lib/audit-do";
import type { createClient } from "@/lib/supabase/server";

/**
 * The DOs typed on the Wave page (`shipment_do_no`, 0079). They are shipment
 * paperwork, typed after allocation with no link to an item, so the audit
 * shows them on the shipment's header only. An item's own DOs come from the
 * database rule (`task_do_nos`, 0124) or the file (`sheet_pick_lines.do_nos`).
 */

/** The DO lookups run from server pages and from the browser alike. */
type Db = Awaited<ReturnType<typeof createClient>>;

/** A shipment's manual DOs are keyed by its wave and its shipment number. */
export const doKey = (waveId: string, shipmentNumber: string) => `${waveId}|${shipmentNumber}`;

/** The manual DOs of these waves, keyed `wave_id|shipment_number`. */
export async function manualDos(db: Db, waveIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ids = [...new Set(waveIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from("shipment_do_no").select("wave_id, shipment_number, do_nos")
      .in("wave_id", ids.slice(i, i + 100));
    if (error) throw new Error(`DO dari halaman Wave tidak terbaca: ${error.message}`);
    for (const r of (data ?? []) as { wave_id: string; shipment_number: string; do_nos: string[] | null }[]) {
      out.set(doKey(r.wave_id, r.shipment_number), r.do_nos ?? []);
    }
  }
  return out;
}

/**
 * The same map addressed by the wave's number: the WMS file only carries `wave_no`,
 * so its wave is looked up by date first. No matching wave, no manual DOs.
 */
export async function manualDosByWaveNo(db: Db, date: string): Promise<Map<string, string[]>> {
  const { data: waves, error } = await db.from("waves").select("id, wave_no").eq("planned_date", date);
  if (error) throw new Error(`Wave tidak terbaca: ${error.message}`);
  const rows = (waves ?? []) as { id: string; wave_no: string }[];
  const byId = await manualDos(db, rows.map((w) => w.id));
  const noOf = new Map(rows.map((w) => [w.id, w.wave_no]));
  const out = new Map<string, string[]>();
  for (const [k, dos] of byId) {
    const at = k.indexOf("|");
    const waveNo = noOf.get(k.slice(0, at));
    if (!waveNo) continue;
    const key = `${waveNo}${k.slice(at)}`;
    out.set(key, mergeDos(out.get(key), dos));
  }
  return out;
}
