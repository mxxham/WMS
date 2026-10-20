/**
 * A broken pallet is one picklist line (pick N, move the rest to the pickface)
 * but two tasks (PICK + REPLENISH). The wave page shows and posts them as one
 * row: the REPLENISH right after (new plans) or right before (older plans) the
 * pick, from the same bin / SKU / batch / expiry, in the same state. Same rule
 * as sisaFromTasks (picklist-from-tasks.ts, via movesOfPicks). Posted tasks are compared on
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
const source = (t: Pairable, posted: boolean) => posted
  ? { bin: t.actual_from_bin ?? t.from_bin, batch: t.actual_batch_lot ?? t.batch_lot, expiry: t.actual_expiry_date ?? t.expiry_date }
  : { bin: t.from_bin, batch: t.batch_lot, expiry: t.expiry_date };
// Both posted: where both really came from. Otherwise the plan.
const samePallet = (a: Pairable, b: Pairable) => {
  const posted = a.status === "COMPLETED" && b.status === "COMPLETED";
  const x = source(a, posted), y = source(b, posted);
  return a.wave_id === b.wave_id && a.sku === b.sku && x.bin === y.bin && x.batch === y.batch && x.expiry === y.expiry;
};
// Posted together or open together; a cancelled task or a half-posted pair stays on its own.
const sameState = (a: Pairable, b: Pairable) => a.status === b.status && (a.status === "PLANNED" || a.status === "COMPLETED");
// The printed picklist keeps a half-posted pair together (as it always has); only a cancelled task stays apart.
const bothLive = (a: Pairable, b: Pairable) => a.status !== "CANCELLED" && b.status !== "CANCELLED";

/**
 * Each pick's move, over tasks already in execution order: the move right
 * after the pick, else right before it, from the same pallet. A move belongs to
 * one pick only (the first that claims it), so a split piece next to the line's
 * move never gets it too. The one pairing rule for the wave page (pairMoves) and
 * the reprint (sisaFromTasks, restNotesFromTasks); `anyState` is the reprint's.
 */
export function movesOfPicks<T extends Pairable>(ordered: T[], opts: { anyState?: boolean } = {}): Map<string, T> {
  const state = opts.anyState ? bothLive : sameState;
  const moveOf = new Map<string, T>();
  const taken = new Set<string>();
  ordered.forEach((t, i) => {
    if (t.task_type !== "PICK") return;
    const m = [ordered[i + 1], ordered[i - 1]].find((x) => x && x.task_type !== "PICK" && !taken.has(x.id) && samePallet(t, x) && state(t, x));
    if (m) { moveOf.set(t.id, m); taken.add(m.id); }
  });
  return moveOf;
}

export function pairMoves<T extends Pairable>(tasks: T[]): TaskRowItem<T>[] {
  const sorted = [...tasks].sort((a, b) => a.seq - b.seq);
  const moveOf = movesOfPicks(sorted);
  const taken = new Set([...moveOf.values()].map((m) => m.id));
  const out: TaskRowItem<T>[] = [];
  for (const t of sorted) {
    if (taken.has(t.id)) continue;
    const m = moveOf.get(t.id);
    out.push(m ? { kind: "pair", pick: t, move: m } : { kind: "single", task: t });
  }
  return out;
}
