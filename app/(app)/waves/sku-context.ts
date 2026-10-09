import { createClient } from "@/lib/supabase/client";
import type { FixClaim, FixStock } from "@/lib/wave-fix";
import type { ImpStock, ImpTask } from "@/lib/wave-impact";
import type { TaskRow } from "@/lib/allocator/picklist-from-tasks";
import { fmtNum } from "@/lib/utils";

/** One SKU set's stock and every open row (any date, active or parked waves): what Perbaiki and the impact check read. */
export type SkuContext = { stock: (ImpStock & FixStock)[]; tasks: ImpTask[] };

type OpenRow = { id: string; wave_id: string; wave_no: string; wave_status: string; planned_date: string; seq: number; task_type: "PICK" | "REPLENISH";
  sku: string; from_bin: string; to_bin: string | null; batch_lot: string; expiry_date: string | null; quantity: number };

export const taskLabel = (wave: string, seq: number, type: string, qty: number, from: string, to: string | null) =>
  `NO ${wave} #${seq} · ${type === "PICK" ? `ambil ${fmtNum(qty)} dari ${from}` : `pindah ${fmtNum(qty)} ${from} → ${to}`}`;

export async function loadSkuContext(skus: string[]): Promise<SkuContext> {
  const list = [...new Set(skus)];
  if (!list.length) return { stock: [], tasks: [] };
  const db = createClient();
  const [{ data: inv, error: e1 }, { data: open, error: e2 }] = await Promise.all([
    db.from("inventory_detail").select("bin_code, bin_status, sku, batch_lot, expiry_date, quantity").in("sku", list).range(0, 4999),
    db.from("pick_task_detail").select("id, wave_id, wave_no, wave_status, planned_date, seq, task_type, sku, from_bin, to_bin, batch_lot, expiry_date, quantity")
      .in("sku", list).eq("status", "PLANNED").in("wave_status", ["PENDING", "RESCHEDULED"]).range(0, 4999),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  const stock = ((inv ?? []) as { bin_code: string; bin_status: string; sku: string; batch_lot: string; expiry_date: string | null; quantity: number }[])
    .map((r) => ({ bin: r.bin_code, sku: r.sku, batch: r.batch_lot, expiry: r.expiry_date, qty: Number(r.quantity), blocked: r.bin_status === "blocked" }));
  const dates = new Set(((open ?? []) as OpenRow[]).map((r) => r.planned_date));
  const tasks = ((open ?? []) as OpenRow[]).map((r): ImpTask => ({
    id: r.id, wave: r.wave_id, parked: r.wave_status === "RESCHEDULED", type: r.task_type, sku: r.sku, from: r.from_bin, to: r.to_bin,
    batch: r.batch_lot, expiry: r.expiry_date, qty: Number(r.quantity),
    label: taskLabel(r.wave_no, r.seq, r.task_type, Number(r.quantity), r.from_bin, r.to_bin) + (dates.size > 1 ? ` (${r.planned_date})` : ""),
  }));
  return { stock, tasks };
}

/** The other open rows of a SKU as Perbaiki claims (this row and its move left out). */
export function claimsOf(ctx: SkuContext, sku: string, exclude: string[]): FixClaim[] {
  return ctx.tasks.filter((t) => t.sku === sku && !exclude.includes(t.id))
    .map((t) => ({ from: t.from, to: t.to, batch: t.batch, expiry: t.expiry, qty: t.qty }));
}

/** A posted row as it comes back when its posting is undone: what was really taken, from where it really came. */
export function reopened(t: TaskRow, label: string): ImpTask {
  return {
    id: t.id, wave: t.wave_id, parked: false, label, type: t.task_type, sku: t.sku,
    from: t.actual_from_bin ?? t.from_bin, to: t.to_bin, batch: t.actual_batch_lot ?? t.batch_lot,
    expiry: t.actual_expiry_date ?? t.expiry_date, qty: Number(t.actual_quantity ?? t.quantity),
  };
}

/** A wave row as Perbaiki's input (what is picked, from where) and its paired move. */
export const fixRowOf = (t: TaskRow) => ({ from: t.from_bin, sku: t.sku, batch: t.actual_batch_lot ?? t.batch_lot, expiry: t.actual_expiry_date ?? t.expiry_date,
  qty: Number(t.quantity), upp: Number(t.upp) || 1 });
export const fixMoveOf = (m?: TaskRow | null) => (m && m.to_bin ? { to: m.to_bin, qty: Number(m.quantity) } : null);
