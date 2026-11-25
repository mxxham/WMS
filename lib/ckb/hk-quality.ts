/**
 * Housekeeping phase 2, weekly quality: pure rules and shapes (zero I/O), mirrored by migration 0160.
 * A supervisor rates every active checklist item Baik / Perlu perbaikan / Buruk for a rack and a week; a finding is a
 * problem found on a photo, fixed by the rack's PIC and verified by a different lead.
 */
import type { Tone } from "@/lib/ckb/stocktake";

export type Rating = "GOOD" | "FAIR" | "POOR";
export const RATING_LABEL: Record<Rating, string> = { GOOD: "Baik", FAIR: "Perlu perbaikan", POOR: "Buruk" };
export const RATING_POINTS: Record<Rating, number> = { GOOD: 2, FAIR: 1, POOR: 0 };
export const RATINGS: Rating[] = ["GOOD", "FAIR", "POOR"];

/** The week's score: points over the best possible, whole percent (same rounding as ckb_hk_score_week). Null with nothing rated. */
export function scorePct(ratings: readonly Rating[]): number | null {
  if (ratings.length === 0) return null;
  const points = ratings.reduce((n, r) => n + RATING_POINTS[r], 0);
  return Math.round((100 * points) / (2 * ratings.length));
}

export const scoreTone = (p: number | null): Tone => (p === null ? "muted" : p >= 85 ? "ok" : p >= 70 ? "warn" : "bad");

/** Every active item has exactly one rating: the only complete input the database accepts. */
export function missingItems(activeIds: readonly string[], rated: Readonly<Record<string, Rating | undefined>>): string[] {
  return activeIds.filter((id) => !rated[id]);
}

export type FindingStatus = "OPEN" | "FIXED" | "VERIFIED" | "CANCELLED";
/** What a customer is shown: a verified finding reads as done, a cancelled one is never sent. */
export type CustomerFindingStatus = "OPEN" | "FIXED" | "DONE";

export const FINDING_STATE: Record<FindingStatus | "DONE", { label: string; tone: Tone }> = {
  OPEN: { label: "Terbuka", tone: "bad" },
  FIXED: { label: "Menunggu verifikasi", tone: "warn" },
  VERIFIED: { label: "Selesai", tone: "ok" },
  DONE: { label: "Selesai", tone: "ok" },
  CANCELLED: { label: "Dibatalkan", tone: "muted" },
};

/** A finding the lead may verify: fixed, and not raised or fixed by them (the database re-checks). */
export function canVerify(f: { status: FindingStatus; raised_by: string; fixed_by: string | null }, userId: string): boolean {
  return f.status === "FIXED" && f.raised_by !== userId && f.fixed_by !== userId;
}

/** Overdue = still open past its due date. A fixed finding waits on the lead, not on the PIC. */
export const isOverdue = (f: { status: string; due_date: string | null }, today: string): boolean => f.status === "OPEN" && !!f.due_date && f.due_date < today;

export type ScoreRow = { area_id: string; week_start: string; version: number; pct: number };
/** The latest version per rack and week (a re-score is a new version). */
export function latestScores<T extends { area_id: string; week_start: string; version: number }>(rows: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.area_id}|${r.week_start}`;
    const cur = best.get(k);
    if (!cur || r.version > cur.version) best.set(k, r);
  }
  return [...best.values()];
}

/** The last `n` weeks (Monday dates, oldest first) ending at the week of `today`. */
export function lastWeeks(today: string, n: number): string[] {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;   // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow - 7 * (n - 1));
  return Array.from({ length: n }, (_, i) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + 7 * i); return x.toISOString().slice(0, 10); });
}

/** Change from the previous scored week to the latest one; null when fewer than two weeks are scored. */
export function trend(pcts: readonly (number | null)[]): number | null {
  const scored = pcts.filter((p): p is number => p !== null);
  return scored.length < 2 ? null : scored[scored.length - 1] - scored[scored.length - 2];
}

export const trendLabel = (d: number | null): string => (d === null ? "–" : d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${-d}` : "= 0");

export type FindingCounts = { open: number; fixed: number; done: number; overdue: number };
export function countFindings(rows: readonly { status: string; due_date: string | null }[], today: string): FindingCounts {
  return {
    open: rows.filter((r) => r.status === "OPEN").length,
    fixed: rows.filter((r) => r.status === "FIXED").length,
    done: rows.filter((r) => r.status === "VERIFIED" || r.status === "DONE").length,
    overdue: rows.filter((r) => isOverdue(r, today)).length,
  };
}
