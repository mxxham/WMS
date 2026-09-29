/**
 * A broken pallet is one picklist line (pick N, move the rest to the pickface)
 * but two tasks (PICK + REPLENISH). The wave page shows and posts them as one
 * row: the REPLENISH right after (new plans) or right before (older plans) the
 * pick, from the same bin / SKU / batch / expiry, in the same state. Same rule
 * as sisaFromTasks (picklist-from-tasks.ts).
 */
type Pairable = {
  id: string; wave_id: string; seq: number; task_type: string; status: string;
  from_bin: string; sku: string; batch_lot: string; expiry_date: string | null;
};
export type TaskRowItem<T> = { kind: "single"; task: T } | { kind: "pair"; pick: T; move: T };

const samePallet = (a: Pairable, b: Pairable) =>
  a.wave_id === b.wave_id && a.from_bin === b.from_bin && a.sku === b.sku && a.batch_lot === b.batch_lot && a.expiry_date === b.expiry_date;
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
