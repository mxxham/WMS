/**
 * Picking audit (migration 0024): vocabulary, the error rule and the KPI
 * maths. The database derives and enforces every result; this file mirrors
 * the rule for labels, the result preview and the accuracy page.
 */

export const PICK_ERRORS = ["WRONG_SKU", "SHORT", "OVER", "WRONG_BATCH", "WRONG_EXPIRY", "DAMAGED"] as const;
export type PickError = (typeof PICK_ERRORS)[number];
export const PICK_ERROR_LABEL: Record<PickError, string> = {
  WRONG_SKU: "SKU salah",
  SHORT: "Kurang",
  OVER: "Lebih",
  WRONG_BATCH: "Batch salah",
  WRONG_EXPIRY: "Expired beda",
  DAMAGED: "Rusak",
};

export type LineState = "AUTO_PASS" | "TODO" | "OK" | "MISMATCH" | "RESOLVED";
export const LINE_STATE_LABEL: Record<LineState, string> = {
  AUTO_PASS: "Tidak dipick (0)",
  TODO: "Belum diaudit",
  OK: "OK",
  MISMATCH: "Selisih",
  RESOLVED: "Diterima supervisor",
};

export type ShipmentState = "PICKING" | "READY_AUDIT" | "HAS_MISMATCH" | "READY_LOAD" | "LOADED" | "CANCELLED";
export const SHIPMENT_STATE_LABEL: Record<ShipmentState, string> = {
  PICKING: "Picking",
  READY_AUDIT: "Siap audit",
  HAS_MISMATCH: "Ada selisih",
  READY_LOAD: "Siap muat",
  LOADED: "Dimuat",
  CANCELLED: "Dibatalkan",
};
export const SHIPMENT_STATE_TONE: Record<ShipmentState, string> = {
  PICKING: "bg-steel-100 text-steel",
  READY_AUDIT: "bg-plate text-steel",
  HAS_MISMATCH: "bg-bad text-white",
  READY_LOAD: "bg-ok text-white",
  LOADED: "bg-ckb text-white",
  CANCELLED: "bg-steel-100 text-steel-500 line-through",
};

export type Resolution = "ACCEPT_SHORT" | "ACCEPT_BATCH";
export const RESOLUTION_LABEL: Record<Resolution, string> = {
  ACCEPT_SHORT: "Terima kurang",
  ACCEPT_BATCH: "Terima batch ini",
};

/** Same as norm_batch() in 0024: no whitespace, upper case. */
export function normBatch(b: string | null | undefined): string {
  return (b ?? "").replace(/\s/g, "").toUpperCase();
}

export type Expected = { sku: string; batch: string; expiry: string | null; qty: number };
export type Found = { sku: string; batch: string; expiry: string | null; qty: number; damaged: boolean };

/** Same rule and order as pick_audit_errors() in 0024. */
export function pickAuditErrors(e: Expected, f: Found): PickError[] {
  const out: PickError[] = [];
  if (f.sku !== e.sku) out.push("WRONG_SKU");
  else {
    if (f.qty < e.qty) out.push("SHORT");
    if (f.qty > e.qty) out.push("OVER");
    if (normBatch(f.batch) !== normBatch(e.batch)) out.push("WRONG_BATCH");
    if (f.expiry && e.expiry && f.expiry.slice(0, 10) !== e.expiry.slice(0, 10)) out.push("WRONG_EXPIRY");
  }
  if (f.damaged) out.push("DAMAGED");
  return out;
}

/** What a supervisor may accept instead of a floor fix (resolve_pick_mismatch guards the same). */
export function allowedResolutions(errors: PickError[], counted: number, expected: number): Resolution[] {
  if (errors.length === 1 && errors[0] === "SHORT") return ["ACCEPT_SHORT"];
  if (errors.length > 0 && counted === expected && errors.every((e) => e === "WRONG_BATCH" || e === "WRONG_EXPIRY")) return ["ACCEPT_BATCH"];
  return [];
}

/** One row of pick_audit_first: the first attempt of a line. */
export type FirstAttempt = {
  task_id: string; result: "OK" | "MISMATCH"; errors: PickError[]; expected_qty: number; counted_qty: number;
  picked_by_name: string | null; sku: string; description: string; zone: string; bulk_posted: boolean;
  minutes_to_audit: number | null; wave_id: string; shipment_number: string;
};
export type ShipmentKey = { wave_id: string; shipment_number: string };

export type AccuracySummary = {
  lines: number; ok: number;
  lineAccuracy: number | null; unitAccuracy: number | null; mispicksPer1000: number | null; medianMinutes: number | null;
  byError: { error: PickError; n: number }[];
  byPicker: { name: string; lines: number; errors: number; accuracy: number; bulk: number }[];
  bySku: { sku: string; description: string; lines: number; errors: number }[];
  byZone: { zone: string; lines: number; errors: number }[];
};

const pct = (part: number, whole: number) => (whole ? (part * 100) / whole : null);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Wrong units of one first attempt: all of them when the item itself is wrong, else the count difference. */
function wrongUnits(r: FirstAttempt): number {
  const exp = Number(r.expected_qty);
  if (r.errors.some((e) => e === "WRONG_SKU" || e === "WRONG_BATCH" || e === "WRONG_EXPIRY" || e === "DAMAGED")) return exp;
  return Math.abs(Number(r.counted_qty) - exp);
}

export function summarizeAccuracy(rows: FirstAttempt[]): AccuracySummary {
  const ok = rows.filter((r) => r.result === "OK").length;
  const expected = rows.reduce((s, r) => s + Number(r.expected_qty), 0);
  const wrong = rows.reduce((s, r) => s + wrongUnits(r), 0);
  const bad = (r: FirstAttempt) => (r.result === "MISMATCH" ? 1 : 0);

  const byError = new Map<PickError, number>();
  for (const r of rows) for (const e of r.errors) byError.set(e, (byError.get(e) ?? 0) + 1);

  const group = <K extends string>(key: (r: FirstAttempt) => K) => {
    const m = new Map<K, FirstAttempt[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m.entries()];
  };
  const worstFirst = <T extends { errors: number; lines: number }>(a: T, b: T) => b.errors / b.lines - a.errors / a.lines || b.errors - a.errors || b.lines - a.lines;

  return {
    lines: rows.length,
    ok,
    lineAccuracy: pct(ok, rows.length),
    unitAccuracy: expected ? (Math.max(0, expected - wrong) * 100) / expected : null,
    mispicksPer1000: rows.length ? ((rows.length - ok) * 1000) / rows.length : null,
    medianMinutes: median(rows.map((r) => r.minutes_to_audit).filter((m): m is number => m !== null).map(Number)),
    byError: PICK_ERRORS.filter((e) => byError.has(e)).map((e) => ({ error: e, n: byError.get(e)! })).sort((a, b) => b.n - a.n),
    byPicker: group((r) => r.picked_by_name ?? "(tidak tercatat)")
      .map(([name, rs]) => {
        const errors = rs.reduce((s, r) => s + bad(r), 0);
        return { name, lines: rs.length, errors, accuracy: ((rs.length - errors) * 100) / rs.length, bulk: rs.filter((r) => r.bulk_posted).length };
      })
      .sort(worstFirst),
    bySku: group((r) => r.sku)
      .map(([sku, rs]) => ({ sku, description: rs[0].description, lines: rs.length, errors: rs.reduce((s, r) => s + bad(r), 0) }))
      .sort((a, b) => b.errors - a.errors || b.lines - a.lines),
    byZone: group((r) => r.zone)
      .map(([zone, rs]) => ({ zone, lines: rs.length, errors: rs.reduce((s, r) => s + bad(r), 0) }))
      .sort(worstFirst),
  };
}

/** Loaded shipments whose every line passed on the first attempt. */
export function shipmentFirstPass(loaded: ShipmentKey[], rows: FirstAttempt[]): number | null {
  const failed = new Set(rows.filter((r) => r.result === "MISMATCH").map((r) => `${r.wave_id}|${r.shipment_number}`));
  return pct(loaded.filter((s) => !failed.has(`${s.wave_id}|${s.shipment_number}`)).length, loaded.length);
}

/** Loaded shipments with nothing left unaudited or unresolved; anything under 100 % is a bug. */
export function auditCoverage(loaded: { todo: number; mismatch: number }[]): number | null {
  return pct(loaded.filter((s) => Number(s.todo) === 0 && Number(s.mismatch) === 0).length, loaded.length);
}

export function scanCompliance(scanned: boolean[]): number | null {
  return pct(scanned.filter(Boolean).length, scanned.length);
}
