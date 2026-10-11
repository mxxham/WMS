/**
 * A broken pallet is one picklist line (pick N, move the rest to the pickface)
 * but two tasks (PICK + REPLENISH). The wave page shows and posts them as one
 * row: the REPLENISH right after (new plans) or right before (older plans) the
 * pick, from the same bin / SKU / batch / expiry, in the same state. Same rule
 * as sisaFromTasks (picklist-from-tasks.ts). Posted tasks are compared on
 * where they really came from (actual bin / batch / expiry, the plan where
 * none is recorded): a split piece keeps its pick's planned bin, but was taken
 * elsewhere and is never that move's pick (final review C1).
 */
type Pairable = {
  id: string; wave_id: string; seq: number; task_type: string; status: string;
  from_bin: string; sku: string; batch_lot: string; expiry_date: string | null;
  actual_from_bin?: string | null; actual_batch_lot?: string | null; actual_expiry_date?: string | null;
};
export type TaskRowItem<T> = { kind: "single"; task: T } | { kind: "pair"; pick: T; move: T };

/** Where a task takes from: the plan, or once posted what was really taken. */
const source = (t: Pairable) => t.status === "COMPLETED"
  ? { bin: t.actual_from_bin ?? t.from_bin, batch: t.actual_batch_lot ?? t.batch_lot, expiry: t.actual_expiry_date ?? t.expiry_date }
  : { bin: t.from_bin, batch: t.batch_lot, expiry: t.expiry_date };
const samePallet = (a: Pairable, b: Pairable) => {
  const x = source(a), y = source(b);
  return a.wave_id === b.wave_id && a.sku === b.sku && x.bin === y.bin && x.batch === y.batch && x.expiry === y.expiry;
};
// Posted together or open together; a cancelled task or a half-posted pair stays on its own.
const sameState = (a: Pairable, b: Pairable) => a.status === b.status && (a.status === "PLANNED" || a.status === "COMPLETED");

export function pairMoves<T extends Pairable>(tasks: T[]): TaskRowItem<T>[] {
  const sorted = [...tasks].sort((a, b) => a.seq - b.seq);
  const moveOf = new Map<string, T>();
  const taken = new Set<string>();
  sorted.forEach((t, i) => {
    if (t.task_type !== "PICK") return;
    const m = [sorted[i + 1], sorted[i - 1]].find((x) => x && x.task_type !== "PICK" && !taken.has(x.id) && samePallet(t, x) && sameState(t, x));
    if (m) { moveOf.set(t.id, m); taken.add(m.id); }
  });
  const out: TaskRowItem<T>[] = [];
  for (const t of sorted) {
    if (taken.has(t.id)) continue;
    const m = moveOf.get(t.id);
    out.push(m ? { kind: "pair", pick: t, move: m } : { kind: "single", task: t });
  }
  return out;
}
