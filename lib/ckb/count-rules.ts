/**
 * CKB blind count (0133): the rules the counter's and the assignment pages show. Pure.
 * `photoReason` mirrors SQL `ckb_photo_reason`; the database enforces it, the page only explains it first.
 */

export function photoReason(t: { origin: string; round: number }, qty: number | null,
  opts: { photoRules: boolean; customerAlways: boolean }): string | null {
  if (!opts.photoRules || qty === null) return null;
  if (qty === 0) return "hitungan 0";
  if (t.origin === "FOUND") return "barang temuan";
  if (t.round > 1) return "hitungan ulang";
  if (opts.customerAlways) return "wajib untuk pelanggan ini";
  return null;
}

/** The aisle / area a location belongs to: the code before its last run of digits (SIP-15 → SIP-). */
export function locationPrefix(bin: string): string {
  const b = bin.trim();
  if (!b) return "(tanpa lokasi)";
  const m = /^(.*?)(\d+)$/.exec(b);
  return m && m[1] ? m[1] : b;
}

export type LocationRow = { storage_bin: string; lines: number; assigned_to: string | null; counted: number };
export type LocationGroup = { prefix: string; bins: LocationRow[]; lines: number; counted: number };

export function groupLocations(rows: LocationRow[]): LocationGroup[] {
  const by = new Map<string, LocationRow[]>();
  for (const r of rows) {
    const p = locationPrefix(r.storage_bin);
    by.set(p, [...(by.get(p) ?? []), r]);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([prefix, bins]) => {
    const sorted = [...bins].sort((a, b) => a.storage_bin.localeCompare(b.storage_bin, undefined, { numeric: true }));
    return { prefix, bins: sorted, lines: sorted.reduce((s, b) => s + b.lines, 0), counted: sorted.reduce((s, b) => s + b.counted, 0) };
  });
}

const WAITING = new Set(["OPEN", "RECOUNT_REQUESTED"]);
const rank = (status: string) => (status === "RECOUNT_REQUESTED" ? 0 : status === "OPEN" ? 1 : 2);

/** The counter's list: asked-again lines first, then not counted, then done; each by location, then seq. */
export function listOrder<T extends { seq: number; status: string; storage_bin: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => rank(a.status) - rank(b.status)
    || a.storage_bin.localeCompare(b.storage_bin, undefined, { numeric: true }) || a.seq - b.seq);
}

export function progress(tasks: { status: string }[]): { done: number; total: number } {
  return { done: tasks.filter((t) => !WAITING.has(t.status)).length, total: tasks.length };
}
