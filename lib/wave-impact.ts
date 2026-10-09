/**
 * "This will affect…" on the wave page: before a risky action, which open rows
 * of OTHER waves get worse. Pure — the page loads the SKU's stock and every
 * open row (any date) and asks before showing the confirmation.
 *
 * The two problem states are the database's own rules, replayed on a
 * simulated state before and after the action:
 *   short   — task_shortfalls (0007): physical + incoming moves into the
 *             identity < everything open rows take from it;
 *   waiting — task_waits (0038): the row's bin holds less than it needs while
 *             an open Bin To Bin into that bin (same SKU + batch) is pending;
 *   held    — that pending move belongs to a wave on Tunda, so nobody can post
 *             it on the normal path (5 Oct: NO 1 on Tunda held NO 3 and NO 6).
 * A row is reported only when its state is worse after than before.
 */

export type ImpStock = { bin: string; sku: string; batch: string; expiry: string | null; qty: number };
export type ImpTask = {
  id: string; label: string; wave: string; parked: boolean;
  type: "PICK" | "REPLENISH"; sku: string; from: string; to: string | null; batch: string; expiry: string | null; qty: number;
};
export type ImpState = "ok" | "short" | "waiting" | "held";
export type Impact = { id: string; label: string; before: ImpState; after: ImpState };

export type Change =
  /** Posting Bin To Bin saja: the move happens now. */
  | { kind: "postMove"; moveId: string }
  /** Tunda: the wave's open rows can no longer be worked. */
  | { kind: "park"; wave: string }
  /** Batalkan posting: these posted rows come back open, their stock goes back. */
  | { kind: "unpost"; tasks: ImpTask[] }
  /** Ubah baris / Perbaiki: rows replaced by others (stock unchanged until posting). */
  | { kind: "replace"; remove: string[]; add: ImpTask[] };

const key = (bin: string, sku: string, batch: string, expiry: string | null) => `${bin}|${sku}|${batch}|${expiry ?? ""}`;
const rank: Record<ImpState, number> = { ok: 0, waiting: 1, held: 2, short: 3 };

export function states(stock: ImpStock[], tasks: ImpTask[]): Map<string, ImpState> {
  const phys = new Map<string, number>();
  for (const s of stock) phys.set(key(s.bin, s.sku, s.batch, s.expiry), (phys.get(key(s.bin, s.sku, s.batch, s.expiry)) ?? 0) + Number(s.qty));
  const reserved = new Map<string, number>(), incoming = new Map<string, number>();
  for (const t of tasks) {
    const k = key(t.from, t.sku, t.batch, t.expiry);
    reserved.set(k, (reserved.get(k) ?? 0) + t.qty);
    if (t.to) { const i = key(t.to, t.sku, t.batch, t.expiry); incoming.set(i, (incoming.get(i) ?? 0) + t.qty); }
  }
  const out = new Map<string, ImpState>();
  for (const t of tasks) {
    const k = key(t.from, t.sku, t.batch, t.expiry);
    const p = phys.get(k) ?? 0;
    if (p + (incoming.get(k) ?? 0) < (reserved.get(k) ?? 0)) { out.set(t.id, "short"); continue; }
    const feeder = p < t.qty ? tasks.find((m) => m.id !== t.id && m.type !== "PICK" && m.to === t.from && m.sku === t.sku && m.batch === t.batch) : undefined;
    out.set(t.id, !feeder ? "ok" : feeder.parked && !t.parked ? "held" : "waiting");
  }
  return out;
}

export function applyChange(stock: ImpStock[], tasks: ImpTask[], c: Change): { stock: ImpStock[]; tasks: ImpTask[] } {
  const add = (list: ImpStock[], bin: string, t: ImpTask, q: number) => list.concat({ bin, sku: t.sku, batch: t.batch, expiry: t.expiry, qty: q });
  switch (c.kind) {
    case "postMove": {
      const m = tasks.find((t) => t.id === c.moveId);
      if (!m || !m.to) return { stock, tasks };
      return { stock: add(add(stock, m.from, m, -m.qty), m.to, m, m.qty), tasks: tasks.filter((t) => t.id !== m.id) };
    }
    case "park":
      return { stock, tasks: tasks.map((t) => (t.wave === c.wave ? { ...t, parked: true } : t)) };
    case "unpost": {
      let s = stock;
      for (const t of c.tasks) s = t.to ? add(add(s, t.to, t, -t.qty), t.from, t, t.qty) : add(s, t.from, t, t.qty);
      return { stock: s, tasks: tasks.concat(c.tasks) };
    }
    case "replace":
      return { stock, tasks: tasks.filter((t) => !c.remove.includes(t.id)).concat(c.add) };
  }
}

/** Open rows outside `ownIds` whose state is worse after the change than before. */
export function impactOf(stock: ImpStock[], tasks: ImpTask[], c: Change, ownIds: string[]): Impact[] {
  const before = states(stock, tasks);
  const next = applyChange(stock, tasks, c);
  const after = states(next.stock, next.tasks);
  const own = new Set(ownIds);
  const ownWave = c.kind === "park" ? c.wave : null;
  return next.tasks
    .filter((t) => !own.has(t.id) && t.wave !== ownWave)
    .map((t) => ({ id: t.id, label: t.label, before: before.get(t.id) ?? "ok", after: after.get(t.id) ?? "ok" }))
    .filter((x) => rank[x.after] > rank[x.before]);
}

export const STATE_TEXT: Record<ImpState, string> = {
  ok: "aman", short: "jadi stok kurang", waiting: "harus menunggu Bin To Bin", held: "tertahan: Bin To Bin-nya di wave yang ditunda",
};
