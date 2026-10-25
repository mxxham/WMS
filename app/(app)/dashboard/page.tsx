import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownRight, ArrowUpRight, Boxes, CalendarClock, CalendarOff, CalendarX2, ChevronRight, CircleCheck,
  ClipboardCheck, ClipboardList, Droplets, Gauge, Layers, PackageSearch, Route, ShieldAlert, Truck, Warehouse,
} from "lucide-react";
import { requireRole } from "@/lib/auth";
import { parsePolicy, quantityAccuracy } from "@/lib/inventory-control";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/app/page-header";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { StackedBar } from "@/components/dashboard/StackedBar";
import { ExpiryBadge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { NEAR_EXPIRY_DAYS, expiryStatus } from "@/config/warehouse";
import type { BinSummary } from "@/lib/warehouse-types";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import { unstable_cache } from "next/cache";
import { SHELF_BUCKETS, jakartaDate, locType, shelfBucket } from "@/lib/inventory-view";

// fefo_exceptions timed out (over 8 s) before 0070 made it ~0.1 s; the counts
// are still cached for 15 min so dashboard loads don't wait on it. A cached function may not read cookies
// (5 Oct: every /dashboard load crashed, digest 2046118177), so it uses the
// server-only client: two read-only, warehouse-wide counts with no per-user
// rule, and the page has already required a signed-in supervisor.
const getFefoCompliance = unstable_cache(async () => {
  const supabase = createServiceClient();
  const accSince = new Date(Date.now() - ACCURACY_DAYS * 86_400_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const [exc, picks] = await Promise.all([
    supabase.rpc("fefo_exceptions", { p_from: accSince, p_to: to }),
    supabase.rpc("fefo_pick_count", { p_from: accSince, p_to: to }),
  ]);
  if (exc.error || picks.error) throw new Error(exc.error?.message ?? picks.error?.message);
  const rows = (exc.data ?? []) as Array<{ zone: string | null }>;
  const byZone: Record<string, number> = {};
  for (const r of rows) {
    const z = r.zone ?? "–";
    byZone[z] = (byZone[z] ?? 0) + 1;
  }
  return { bad: rows.length, n: Number(picks.data ?? 0), byZone };
}, ["dashboard-fefo-compliance"], { revalidate: 900 });

export const dynamic = "force-dynamic";

type Inv = { bin_code: string; zone: string; rack: string | null; sku: string; description: string; uom: string | null; upp: number | null; item_abc: string | null; batch_lot: string; quantity: number; expiry_date: string | null; received_date: string | null; days_remaining: number | null };
type Task = { status: string; task_type: string; quantity: number; actual_quantity: number | null; actual_from_bin: string | null; from_bin: string; actual_batch_lot: string | null; batch_lot: string; completed_at: string | null; planned_date: string };
type Mv = { type: string; quantity: number; from_bin_id: string | null };
type Audit = { kind: "PICK" | "PUTAWAY"; result: "OK" | "MISMATCH"; audited_at: string | null };
type Vol = { day: string; boxes: number | null; litres: number | null; picks: number | null };
/** Outbound-volume window (today included). One strip, every day rendered. */
const VOL_DAYS = 14;

// Occupancy heat grid: one hue from the Coastal Blues ramp, light -> dark, 5 fixed steps.
// Steps 4 and 5 carry white 12px bold text, so they stay on ckb (#2A6F97, 5.0:1) and
// ckb-dark (#01497C, 7.5:1) rather than the lighter ckb-light.
const OCC_STEPS = [
  { min: 0, bg: "#E8F1F7", fg: "text-steel-700" },
  { min: 0.2, bg: "#CBE2EE", fg: "text-steel-700" },
  { min: 0.4, bg: "#A9D6E5", fg: "text-steel" },
  { min: 0.6, bg: "#2A6F97", fg: "text-white" },
  { min: 0.8, bg: "#01497C", fg: "text-white" },
];
const occStep = (p: number) => [...OCC_STEPS].reverse().find((s) => p >= s.min)!;
/** One decimal, rounded (7,27% reads as 7,3% — the old page rounded, floor looked like a drop). */
const dec1 = (x: number) => Math.round(x * 10) / 10;

/** Jakarta calendar date (YYYY-MM-DD) of an ISO timestamp. */
function jDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
}

/** Bucket index 0 (oldest) .. 4 (newest) over the last 30 Jakarta days; null = outside window / no date. */
function weekBucket(todayStart: Date, iso: string | null): number | null {
  const jd = jDay(iso);
  if (!jd) return null;
  const daysAgo = Math.floor((todayStart.getTime() - new Date(`${jd}T00:00:00+07:00`).getTime()) / 86_400_000);
  if (daysAgo < 0 || daysAgo >= 30) return null;
  return 4 - Math.floor(daysAgo / 6);
}

/** Mean of a per-row 0/1 value per week bucket, expressed as a percentage. null bucket = no data (a gap). */
function rateByWeek<T>(todayStart: Date, rows: T[], date: (r: T) => string | null, value: (r: T) => number): (number | null)[] {
  const buckets: (number | null)[] = Array(5).fill(null);
  const n = Array(5).fill(0), s = Array(5).fill(0);
  for (const r of rows) {
    const b = weekBucket(todayStart, date(r));
    if (b === null) continue;
    n[b]++; s[b] += value(r);
  }
  return buckets.map((_, i) => (n[i] ? (s[i] / n[i]) * 100 : null));
}

/** Delta between the newest and previous known bucket, in percentage points. */
function deltaPt(series: (number | null)[]): number | null {
  let prev: number | null = null;
  for (let i = series.length - 2; i >= 0; i--) {
    if (series[i] != null) { prev = series[i]; break; }
  }
  const last = series[series.length - 1];
  if (last == null || prev == null) return null;
  return last - prev;
}

const LEVELS = ["A", "B", "C", "D", "E"];
const ACCURACY_DAYS = 30;
// Expiry calendar ranges: up to 2 years per month, longer ranges per quarter
// (60 monthly bars would be too thin to read).
const CAL_RANGES = [1, 2, 3, 5] as const;
type CalRange = (typeof CAL_RANGES)[number];

/** Shelf-life horizon: the same buckets the Inventory page uses, so the two screens agree. */
const SHELF_FILL: Record<string, string> = {
  expired: "#C0392B", d90: "#D9941A", d180: "#89C2D9", d365: "#468FAF",
  y2: "#2A6F97", y3: "#01497C", more: "#032741", none: "#A3B2BE",
};
/** ABC classes on the Coastal Blues ramp (no plate: the owner moved bars off the pale accent). */
const ABC_FILL: Record<string, string> = { A: "#01497C", B: "#2A6F97", C: "#468FAF", "–": "#A3B2BE" };

type Tone = "bad" | "warn" | "wait" | "ok";
const PANEL = "flex flex-col overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(3,39,65,0.05)] ring-1 ring-steel-100";
const TONE_TILE: Record<Tone, string> = { bad: "bg-bad/10 text-bad", warn: "bg-warn/10 text-warn", wait: "bg-ckb/10 text-ckb-dark", ok: "bg-ok/10 text-ok" };
const TONE_FILL: Record<Tone, string> = { bad: "bg-bad", warn: "bg-warn", wait: "bg-ckb", ok: "bg-ok" };
const TONE_DOT: Record<Tone, string> = { bad: "bg-bad", warn: "bg-warn", wait: "bg-ckb", ok: "bg-ok" };
const TONE_RANK: Record<Tone, number> = { bad: 0, warn: 1, wait: 2, ok: 3 };

type AttentionItem = { key: string; label: string; detail: string; count: number; unit: string; tone: Tone; href: string; icon: LucideIcon };
const RISKY_ROWS = 25;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ kalender?: string }> }) {
  await requireRole(["supervisor", "admin"]);
  const supabase = await createClient();
  const today = jakartaDate();
  const todayStart = new Date(`${today}T00:00:00+07:00`);
  const accSince = new Date(Date.now() - ACCURACY_DAYS * 86_400_000).toISOString();
  // Outbound-volume window: the last VOL_DAYS Jakarta calendar days (today included).
  const volSince = new Date(todayStart.getTime() - (VOL_DAYS - 1) * 86_400_000)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const [bins, inv, todayTasks, recentTasks, moves, audits, { count: openCounts }, { data: todayWaves }, cycleApplied,
    { count: pendingApprovals }, { count: activeHolds }, { count: openReceipts }, { data: lastRecon }, pickFirsts, { count: shipReadyAudit }, { count: shipMismatch }, { count: shipReadyLoad }, { data: policyRaw }, fefo, volRows, volInRows] = await Promise.all([
    fetchAll<BinSummary>((a, b) => supabase.from("bin_summary").select("id, bin_code, zone, rack, level, total_qty, fill_ratio, status").order("bin_code").range(a, b)),
    fetchAll<Inv>((a, b) => supabase.from("inventory_detail").select("bin_code, zone, rack, sku, description, uom, upp, item_abc, batch_lot, quantity, expiry_date, received_date, days_remaining").order("id").range(a, b)),
    fetchAll<Task>((a, b) => supabase.from("pick_task_detail").select("status, task_type, quantity, actual_quantity, actual_from_bin, from_bin, actual_batch_lot, batch_lot, completed_at, planned_date").eq("planned_date", today).order("id").range(a, b)),
    fetchAll<Task>((a, b) => supabase.from("pick_task_detail").select("status, task_type, quantity, actual_quantity, actual_from_bin, from_bin, actual_batch_lot, batch_lot, completed_at, planned_date").eq("status", "COMPLETED").gte("completed_at", accSince).order("id").range(a, b)),
    fetchAll<Mv>((a, b) => supabase.from("movements").select("type, quantity, from_bin_id").in("type", ["inbound", "putaway", "picking"]).gte("created_at", todayStart.toISOString()).order("id").range(a, b)),
    fetchAll<Audit>((a, b) => supabase.from("audits").select("kind, result, audited_at").gte("audited_at", accSince).order("id").range(a, b)),
    supabase.from("count_tasks").select("id", { count: "exact", head: true }).in("status", ["OPEN", "COUNTED", "RECOUNT"]),
    supabase.from("waves").select("status").eq("planned_date", today),
    fetchAll<{ system_qty: number | null; variance_qty: number | null; tolerance: number; closed_at: string | null }>((a, b) =>
      supabase.from("count_accuracy").select("system_qty, variance_qty, tolerance, closed_at").gte("closed_at", accSince).order("id").range(a, b)),
    supabase.from("adjustment_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
    supabase.from("stock_holds").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
    supabase.from("receipts").select("id", { count: "exact", head: true }).in("status", ["OPEN", "CHECKED"]),
    supabase.from("stock_recon_summary").select("as_of, accuracy_pct, open_diffs").order("as_of", { ascending: false }).limit(1).maybeSingle(),
    fetchAll<{ result: string; audited_at: string | null }>((a, b) => supabase.from("pick_audit_first").select("result, audited_at").gte("audited_at", accSince).order("task_id").range(a, b)),
    supabase.from("pick_audit_shipment").select("wave_id", { count: "exact", head: true }).eq("state", "READY_AUDIT"),
    supabase.from("pick_audit_shipment").select("wave_id", { count: "exact", head: true }).eq("state", "HAS_MISMATCH"),
    supabase.from("pick_audit_shipment").select("wave_id", { count: "exact", head: true }).eq("state", "READY_LOAD"),
    supabase.rpc("inventory_policy"),
    // A slow or failing count must never take the dashboard down: the tile shows "–" instead.
    getFefoCompliance().catch(() => null),
    fetchAll<Vol>((a, b) => supabase.from("volume_out_daily").select("day, boxes, litres")
      .gte("day", volSince).order("day", { ascending: true }).range(a, b)),
    fetchAll<Vol>((a, b) => supabase.from("volume_in_daily").select("day, boxes, litres")
      .gte("day", volSince).order("day", { ascending: true }).range(a, b)),
  ]);
  const cycleOk = cycleApplied.filter((c) => Number(c.variance_qty ?? 0) <= Number(c.tolerance)).length;
  const qtyIra = quantityAccuracy(cycleApplied);

  const occupied = bins.filter((b) => Number(b.total_qty) > 0).length;
  const blocked = bins.filter((b) => b.status === "blocked").length;
  // CG is not in the warehouse mapping table — exclude it from occupancy.
  const rackBins = bins.filter((b) => b.rack && b.zone !== "CG");

  // Per-aisle occupancy: occupied positions / total positions (rack bins only).
  const zones = [...new Set(rackBins.map((b) => b.zone))].sort().map((z) => {
    const zb = rackBins.filter((b) => b.zone === z);
    const occ = zb.filter((b) => Number(b.total_qty) > 0).length;
    return { zone: z, total: zb.length, occ, pct: zb.length ? occ / zb.length : 0 };
  });

  // Stock by ABC class (quantity and number of SKUs).
  const abc = ["A", "B", "C", "–"].map((k) => {
    const rows = inv.filter((r) => (r.item_abc ?? "–") === k);
    return { k, qty: rows.reduce((s, r) => s + Number(r.quantity), 0), skus: new Set(rows.map((r) => r.sku)).size };
  });
  const totalQty = abc.reduce((s, a) => s + a.qty, 0);

  const risky = inv
    .filter((r) => r.days_remaining !== null && r.days_remaining <= NEAR_EXPIRY_DAYS)
    .sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0));
  const expiredRows = risky.filter((r) => (r.days_remaining ?? 0) < 0);
  const nearRows = risky.filter((r) => (r.days_remaining ?? 0) >= 0);
  const noDate = inv.filter((r) => r.expiry_date === null).length;
  const noDateQty = inv.filter((r) => r.expiry_date === null).reduce((s, r) => s + Number(r.quantity), 0);
  const sumQty = (rows: Inv[]) => rows.reduce((s, r) => s + Number(r.quantity), 0);

  // ---- Today ---------------------------------------------------------------
  const picks = todayTasks.filter((t) => t.task_type === "PICK" && t.status !== "CANCELLED");
  const picksDone = picks.filter((t) => t.status === "COMPLETED").length;
  const repl = todayTasks.filter((t) => t.task_type === "REPLENISH" && t.status !== "CANCELLED");
  const replDone = repl.filter((t) => t.status === "COMPLETED").length;
  // Cancelled waves were never going to run: they are not part of today's plan.
  const planWaves = (todayWaves ?? []).filter((w) => w.status !== "CANCELLED");
  const wavesDone = planWaves.filter((w) => w.status === "COMPLETED").length;
  const pickPct = picks.length ? picksDone / picks.length : 0;
  const wavePct = planWaves.length ? wavesDone / planWaves.length : 0;
  const hasPlan = picks.length > 0 || planWaves.length > 0;
  const planPct = picks.length ? pickPct : wavePct;
  const cartonsPlanned = picks.reduce((s, t) => s + Number(t.quantity), 0);
  const cartonsPosted = picks.reduce((s, t) => s + (t.status === "COMPLETED" ? Number(t.actual_quantity ?? t.quantity) : 0), 0);

  // Today's flow: in = new receipts (inbound, putaway without a source bin), out = picking.
  const todayFlow = { masuk: 0, keluar: 0 };
  for (const m of moves) {
    if (m.type === "picking") todayFlow.keluar += Number(m.quantity);
    else if (m.type === "inbound" || !m.from_bin_id) todayFlow.masuk += Number(m.quantity);
  }

  // ---- Occupancy: rack positions holding stock, per aisle x level ------------
  const occCell = (zb: BinSummary[]) => {
    const occ = zb.filter((b) => Number(b.total_qty) > 0).length;
    return { occ, total: zb.length, pct: zb.length ? occ / zb.length : 0 };
  };
  const grid = zones.map((z) => ({
    zone: z.zone,
    cells: LEVELS.map((lv) => ({ level: lv, ...occCell(rackBins.filter((b) => b.zone === z.zone && b.level === lv)) })),
    all: occCell(rackBins.filter((b) => b.zone === z.zone)),
  }));
  const levelTotals = LEVELS.map((lv) => occCell(rackBins.filter((b) => b.level === lv)));
  const rackOcc = occCell(rackBins);
  const rackState = rackOcc.pct > 0.85 ? "sesak" : rackOcc.pct >= 0.8 ? "sehat" : "longgar";

  // ---- Staging (dock-to-stock stand-in) ------------------------------------
  const staged = inv.filter((r) => locType(r) === "staging");
  const stagedQty = staged.reduce((s, r) => s + Number(r.quantity), 0);
  const oldestStaged = staged.map((r) => r.received_date).filter(Boolean).sort()[0] ?? null;
  const stagedDays = oldestStaged ? Math.floor((todayStart.getTime() - new Date(`${oldestStaged}T00:00:00+07:00`).getTime()) / 86_400_000) : null;
  // Staging aging, weighted by quantity: <1 hari / 1-2 hari / 3+ hari from received_date.
  const stagedAging = { "<1": 0, "1-2": 0, "3+": 0 };
  for (const r of staged) {
    const rd = r.received_date;
    if (!rd) continue;
    const days = Math.floor((todayStart.getTime() - new Date(`${rd}T00:00:00+07:00`).getTime()) / 86_400_000);
    const q = Number(r.quantity);
    if (days <= 0) stagedAging["<1"] += q;
    else if (days <= 2) stagedAging["1-2"] += q;
    else stagedAging["3+"] += q;
  }
  // True only when at least one staged row carries a received date: with no dates
  // the bucket break-down would be an empty bar, so the UI gets a quiet note instead.
  const stagedAgingKnown = stagedAging["<1"] + stagedAging["1-2"] + stagedAging["3+"] > 0;

  // ---- Accuracy (last 30 days) ---------------------------------------------
  const acc = (k: Audit["kind"]) => {
    const a = audits.filter((x) => x.kind === k);
    return { n: a.length, ok: a.filter((x) => x.result === "OK").length };
  };
  const pickAcc = { n: pickFirsts.length, ok: pickFirsts.filter((x) => x.result === "OK").length };
  const putAcc = acc("PUTAWAY");
  const fefoN = fefo?.n ?? 0;
  const fefoBad = fefo?.bad ?? 0;
  const fefoOk = fefoN - fefoBad;
  const pickTarget = parsePolicy(policyRaw).pick_accuracy_target_pct;
  const pickPctAcc = pickAcc.n ? (pickAcc.ok / pickAcc.n) * 100 : null;
  const putPctAcc = putAcc.n ? (putAcc.ok / putAcc.n) * 100 : null;
  const fefoPct = fefo ? (fefoN ? (fefoOk / fefoN) * 100 : 100) : null;
  // FEFO violations per zone (aisle): top 6 + "lainnya", share of all violations.
  const fefoZoneEntries = Object.entries(fefo?.byZone ?? {}).sort((a, b) => b[1] - a[1]);
  const fefoZoneTotal = fefoZoneEntries.reduce((s, [, c]) => s + c, 0);
  const fefoZoneTop = fefoZoneEntries.slice(0, 6);
  const fefoZoneLainnya = fefoZoneEntries.slice(6).reduce((s, [, c]) => s + c, 0);
  const fefoZoneRows: [string, number][] = [...fefoZoneTop];
  if (fefoZoneLainnya > 0) fefoZoneRows.push(["Lainnya", fefoZoneLainnya]);
  const pct = (x: { n: number; ok: number }) => (x.n ? `${Math.round((x.ok / x.n) * 1000) / 10}%` : "–");
  const recentPicks = recentTasks.filter((t) => t.task_type === "PICK");
  const deviated = recentPicks.filter((t) =>
    (t.actual_quantity !== null && Number(t.actual_quantity) !== Number(t.quantity))
    || (t.actual_from_bin && t.actual_from_bin !== t.from_bin)
    || (t.actual_batch_lot !== null && t.actual_batch_lot !== t.batch_lot)).length;
  const devPct = recentPicks.length ? (deviated / recentPicks.length) * 100 : null;

  // ---- Weekly trends (last 30 days, 4-5 buckets) for the Mutu & kendali sparklines ----
  // FEFO and SAP reconciliation are skipped: both come from a single cached snapshot
  // (fefo_exceptions RPC / last stock_recon row) with no per-week series, and deriving
  // a weekly FEFO series would require re-running the exceptions lookup per week.
  const pickTrend = rateByWeek(todayStart, pickFirsts, (r) => r.audited_at, (r) => (r.result === "OK" ? 1 : 0));
  const putTrend = rateByWeek(todayStart, audits.filter((a) => a.kind === "PUTAWAY"), (a) => a.audited_at, (a) => (a.result === "OK" ? 1 : 0));
  const devTrend = rateByWeek(todayStart, recentPicks, (r) => r.completed_at, (r) => Number(deviatedPick(r)) ? 1 : 0);
  const cycleTrend = rateByWeek(todayStart, cycleApplied, (c) => c.closed_at, (c) => Math.abs(Number(c.variance_qty ?? 0)) <= Number(c.tolerance ?? 0) ? 1 : 0);

  function deviatedPick(t: Task): boolean {
    return (t.actual_quantity !== null && Number(t.actual_quantity) !== Number(t.quantity))
      || (t.actual_from_bin && t.actual_from_bin !== t.from_bin)
      || (t.actual_batch_lot !== null && t.actual_batch_lot !== t.batch_lot);
  }

  const calRaw = Number((await searchParams).kalender);
  const calYears: CalRange = (CAL_RANGES as readonly number[]).includes(calRaw) ? (calRaw as CalRange) : 2;
  const byQuarter = calYears > 2;
  const y0 = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)) - 1;
  const bucketKey = (iso: string) => {
    const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1;
    return byQuarter ? `${y}-Q${Math.floor(m / 3) + 1}` : iso.slice(0, 7);
  };
  const thisMonth = bucketKey(today);
  const months = Array.from({ length: byQuarter ? calYears * 4 : calYears * 12 }, (_, i) => {
    const d = new Date(Date.UTC(y0, byQuarter ? Math.floor(m0 / 3) * 3 + i * 3 : m0 + i, 1));
    const iso = d.toISOString().slice(0, 10);
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return {
      ym: bucketKey(iso),
      label: byQuarter ? `Q${q}` : d.toLocaleDateString("id-ID", { month: "short", timeZone: "UTC" }),
      full: byQuarter ? `Q${q} ${d.getUTCFullYear()}` : d.toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }),
      yearStart: byQuarter ? q === 1 : d.getUTCMonth() === 0,
      year: d.getUTCFullYear(), qty: 0, skus: new Set<string>(),
    };
  });
  const monthIdx = new Map(months.map((m, i) => [m.ym, i]));
  let expiredQty = 0, laterQty = 0;
  for (const r of inv) {
    const q = Number(r.quantity);
    if (!r.expiry_date) continue;
    if (r.expiry_date < today) { expiredQty += q; continue; }
    const i = monthIdx.get(bucketKey(r.expiry_date));
    if (i === undefined) laterQty += q;
    else { months[i].qty += q; months[i].skus.add(r.sku); }
  }
  const monthMax = Math.max(1, ...months.map((m) => m.qty));
  const nextCal = months.reduce((s, m) => s + m.qty, 0);
  const calPeak = months.reduce((best, m) => (m.qty > best.qty ? m : best), months[0]);

  // ---- Shelf life: every stock row in its horizon bucket ---------------------
  const shelf = SHELF_BUCKETS.map((b) => ({ key: b.key as string, label: b.label as string, qty: 0, rows: 0, skus: new Set<string>() }));
  const shelfIdx = new Map(SHELF_BUCKETS.map((b, i) => [b.key as string, i]));
  for (const r of inv) {
    const bucket = shelf[shelfIdx.get(shelfBucket(r.days_remaining))!]!;
    bucket.qty += Number(r.quantity); bucket.rows++; bucket.skus.add(r.sku);
  }
  const shelfTotal = Math.max(1, shelf.reduce((s, b) => s + b.qty, 0));

  // ---- Top SKUs by stock ------------------------------------------------------
  const bySku = new Map<string, { sku: string; description: string; uom: string | null; qty: number; pallets: number; bins: Set<string> }>();
  for (const r of inv) {
    const e = bySku.get(r.sku) ?? { sku: r.sku, description: r.description, uom: r.uom, qty: 0, pallets: 0, bins: new Set<string>() };
    e.qty += Number(r.quantity); e.pallets += r.upp ? Number(r.quantity) / Number(r.upp) : 0; e.bins.add(r.bin_code);
    bySku.set(r.sku, e);
  }
  const topSkus = [...bySku.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);

  // ---- What needs a hand right now -------------------------------------------
  const attention: AttentionItem[] = [];
  if (expiredRows.length) attention.push({
    key: "expired", label: "Stok sudah expired", tone: "bad", icon: CalendarX2, href: "#risiko",
    detail: `${fmtNum(sumQty(expiredRows))} karton · ${expiredRows.length} posisi · pisahkan sebelum picking`,
    count: expiredRows.length, unit: "posisi",
  });
  if (fefoBad) attention.push({
    key: "fefo", label: "Pick tidak mengikuti FEFO", tone: "bad", icon: Route, href: "/inventory?tab=fefo",
    detail: `${fmtNum(fefoBad)} dari ${fmtNum(fefoN)} pick rak · ${fmtNum(dec1(fefoN ? (fefoBad / fefoN) * 100 : 0), 1)}% tidak FEFO`,
    count: fefoBad, unit: "pick",
  });
  if (nearRows.length) attention.push({
    key: "near", label: `Expired dalam ${NEAR_EXPIRY_DAYS} hari`, tone: "warn", icon: CalendarClock, href: "#risiko",
    detail: `${fmtNum(sumQty(nearRows))} karton · ${new Set(nearRows.map((r) => r.sku)).size} SKU · sisa umur terpendek ${fmtNum(Math.min(...nearRows.map((r) => r.days_remaining ?? 0)))} hari`,
    count: nearRows.length, unit: "posisi",
  });
  if (activeHolds) attention.push({
    key: "hold", label: "Stok ditahan", tone: "warn", icon: ShieldAlert, href: "/inventory?tab=hold",
    detail: "QC, rusak, investigasi, recall — tidak bisa dipicking",
    count: activeHolds, unit: "hold",
  });
  if (stagedDays !== null && stagedDays > 0) attention.push({
    key: "staging", label: "Barang mengendap di staging", tone: "warn", icon: Boxes, href: "/inventory?tab=inap",
    detail: `Tertua ${fmtDate(oldestStaged)} · ${stagedDays} hari belum masuk rak`,
    count: staged.length, unit: "baris",
  });
  // shipmentsWaiting keeps the original total; per-state counts drive the stacked bar.
  const shipmentsWaiting = (shipReadyAudit ?? 0) + (shipMismatch ?? 0) + (shipReadyLoad ?? 0);
  if (shipmentsWaiting) attention.push({
    key: "shipments", label: "Shipment menunggu audit / muat", tone: "wait", icon: Truck, href: "/audit/picking",
    detail: "Setiap baris harus lolos audit sebelum dimuat",
    count: shipmentsWaiting, unit: "shipment",
  });
  if (openCounts) attention.push({
    key: "counts", label: "Tugas cycle count terbuka", tone: "wait", icon: ClipboardList, href: "/inventory?tab=akurasi",
    detail: "Hitung fisik sudah dibuka, belum ditutup",
    count: openCounts, unit: "tugas",
  });
  if (openReceipts) attention.push({
    key: "receipts", label: "Penerimaan belum diposting", tone: "wait", icon: PackageSearch, href: "/receiving",
    detail: "Cocokkan dengan DO Shell lalu posting",
    count: openReceipts, unit: "penerimaan",
  });
  if (pendingApprovals) attention.push({
    key: "approvals", label: "Adjustment menunggu persetujuan", tone: "wait", icon: ClipboardCheck, href: "/inventory?tab=persetujuan",
    detail: "Di atas batas, perlu orang lain menyetujui",
    count: pendingApprovals, unit: "permintaan",
  });
  if (noDate) attention.push({
    key: "nodate", label: "Baris tanpa tanggal expired", tone: "wait", icon: CalendarOff, href: "/inventory?tab=fefo",
    detail: `${fmtNum(noDateQty)} karton tidak bisa diurutkan FEFO`,
    count: noDate, unit: "baris",
  });
  attention.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.count - a.count);
  const attentionMax = Math.max(1, ...attention.map((a) => a.count));
  const attentionBad = attention.filter((a) => a.tone === "bad").length;
  const attentionWorst: Tone = attention.length === 0 ? "ok" : attention[0]!.tone;

  const dayName = todayStart.toLocaleDateString("id-ID", { weekday: "long", timeZone: "Asia/Jakarta" });

  // Goods flow (masuk + keluar), 14 slots ascending: real days from the two
  // daily volume views, zero slots for quiet days — the strip never collapses
  // and never invents data. Both directions share one scale so the pair per
  // day is directly comparable; heights use a square-root scale because a
  // drum day in the thousands of litres otherwise pins carton days to the
  // 6 px floor and makes healthy small days look empty.
  const volByDay = new Map(volRows.map((v) => [v.day, v]));
  const volInByDay = new Map(volInRows.map((v) => [v.day, v]));
  let prevMonth = "";
  const flowSeries = Array.from({ length: VOL_DAYS }, (_, i) => {
    const d = new Date(todayStart.getTime() - (VOL_DAYS - 1 - i) * 86_400_000);
    const day = d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const out = volByDay.get(day);
    const inn = volInByDay.get(day);
    const num = d.toLocaleDateString("id-ID", { day: "numeric", timeZone: "Asia/Jakarta" });
    const month = d.toLocaleDateString("id-ID", { month: "short", timeZone: "Asia/Jakarta" });
    const showMonth = month !== prevMonth;
    prevMonth = month;
    return {
      day,
      label: showMonth ? `${num} ${month}` : num,
      outL: Number(out?.litres ?? 0), outB: Number(out?.boxes ?? 0),
      inL: Number(inn?.litres ?? 0), inB: Number(inn?.boxes ?? 0),
    };
  });
  const flowToday = flowSeries[flowSeries.length - 1];
  const flowMax = Math.max(1, ...flowSeries.flatMap((v) => [v.inL, v.outL]));
  // Tall track (150 px inside a 176 px h-44 column): differences between small
  // days must survive the sqrt scale, so the multiplier tracks the column.
  const flowBarH = (litres: number) => (litres > 0 ? Math.max(8, Math.round(Math.sqrt(litres / flowMax) * 150)) : 0);
  const in14 = flowSeries.reduce((s, v) => ({ l: s.l + v.inL, b: s.b + v.inB }), { l: 0, b: 0 });
  const out14 = flowSeries.reduce((s, v) => ({ l: s.l + v.outL, b: s.b + v.outB }), { l: 0, b: 0 });
  const net14 = in14.b - out14.b;
  const avgOut = out14.l / VOL_DAYS;
  const avgOutOffset = Math.round(Math.sqrt(Math.max(0, avgOut) / flowMax) * 150);
  const riskyShown = risky.slice(0, RISKY_ROWS);

  return (
    <main>
      <PageHeader title="Dashboard gudang" live={["pick_tasks", "movements", "audits", "count_tasks", "stock_holds", "adjustment_requests", "receipts", "pick_audits", "shipment_loads"]} liveDebounceMs={5000} />
      <div className="space-y-5 p-4 lg:p-8">

        {/* ---- Today: the plan, the flow, what is waiting on the dock ------------- */}
        <section aria-labelledby="hari-ini" className="home-rise relative overflow-hidden rounded-2xl bg-jeir-side text-white ring-1 ring-jeir-navy/30">
          <span aria-hidden className="home-dots pointer-events-none absolute -right-10 -top-10 h-40 w-72 opacity-80" />
          <div className="relative px-4 pt-4 lg:px-6">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-jeir-teal">Operasi hari ini</p>
                <h2 id="hari-ini" className="font-cond text-xl font-semibold leading-tight lg:text-2xl">{dayName}, {fmtDate(today)}</h2>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/85 ring-1 ring-inset ring-white/15">
                <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", hasPlan ? "bg-jeir-teal" : "bg-white/50")} />
                {hasPlan ? `Rencana berjalan · ${Math.round(planPct * 100)}%${planWaves.length && wavesDone === planWaves.length && picksDone === picks.length ? " · selesai" : ""}` : "Belum ada rencana"}
              </span>
            </div>

            <div className="mt-4">
              {hasPlan ? (
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <PlanGauge label="Tugas pick" done={picksDone} total={picks.length} pct={pickPct}
                    note={`${fmtNum(cartonsPosted)} dari ${fmtNum(cartonsPlanned)} karton terposting${repl.length ? ` · isi ulang pickface ${fmtNum(replDone)}/${fmtNum(repl.length)}` : ""}`} />
                  <PlanGauge label="Wave" done={wavesDone} total={planWaves.length} pct={wavePct}
                    note={`${fmtNum(wavesDone)} selesai · ${fmtNum(planWaves.length - wavesDone)} belum selesai`} />
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-lg bg-white/[0.06] p-3 ring-1 ring-inset ring-white/10 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-jeir-teal"><CalendarClock className="h-5 w-5" /></span>
                    <div>
                      <p className="font-cond text-base font-semibold">Rencana hari ini belum disimpan</p>
                      <p className="text-sm text-white/65">Belum ada picklist dan urutan jalan. Susun wave dari order Shell.</p>
                    </div>
                  </div>
                  <Link href={`/waves?date=${today}`}
                    className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md bg-jeir-teal px-4 py-2 text-sm font-semibold text-jeir-navy transition-colors hover:bg-ckb-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-jeir-navy sm:py-1.5">
                    Buka Wave<ChevronRight aria-hidden className="h-4 w-4" />
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="relative mt-4 grid grid-cols-2 border-t border-white/10 sm:grid-cols-4">
            <BandStat label="Karton masuk" value={fmtNum(todayFlow.masuk)} sub="terima + putaway" href={`/audit/putaway?date=${today}`} icon={ArrowDownRight} />
            <BandStat label="Karton keluar" value={fmtNum(todayFlow.keluar)} sub="picking hari ini" href={`/waves?date=${today}`} icon={ArrowUpRight} />
            <BandStat label="Di staging" value={fmtNum(stagedQty)} sub={staged.length ? `${fmtNum(staged.length)} baris${stagedDays !== null ? ` · ${stagedDays} hari` : ""}` : "kosong"} href="/inventory?tab=inap" icon={Boxes} tone={stagedDays !== null && stagedDays > 0 ? "warn" : undefined} />
            <BandStat label="Rak terisi" value={`${Math.round(rackOcc.pct * 100)}%`} sub={`${fmtNum(rackOcc.occ)}/${fmtNum(rackOcc.total)} posisi · ${rackState}`} href="#okupansi" icon={Warehouse} tone={rackState === "sesak" ? "warn" : undefined} />
          </div>
        </section>

        {/* ---- Arus barang: litres in and out per day; outbound days click into the picking audit ---- */}
        <section aria-labelledby="volume-title" className={PANEL}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ckb-tint text-ckb-dark"><Droplets className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h2 id="volume-title" className="font-cond text-lg font-semibold leading-tight">Arus barang</h2>
                <p className="text-xs text-steel-500">Karton dan liter yang masuk dan keluar, {VOL_DAYS} hari terakhir — klik satu hari untuk membuka audit picking.</p>
              </div>
            </div>
            <Link href={`/audit/picking?date=${today}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ckb-dark hover:bg-paper">
              Buka audit picking<ChevronRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="flex flex-col gap-3 border-t border-steel-100 px-4 py-4">
            <div className="shrink-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-steel-500">Hari ini</p>
              <p className="font-cond text-3xl font-semibold leading-tight tabular">
                {fmtNum(flowToday.outL, 1)} <span className="text-base font-semibold text-steel-500">liter keluar</span>
              </p>
              <p className="text-xs text-steel-500">
                {fmtNum(flowToday.outB)} karton keluar · masuk {fmtNum(flowToday.inL, 1)} liter ({fmtNum(flowToday.inB)} karton)
              </p>
              <p className="mt-1 text-xs text-steel-600">
                {VOL_DAYS} hari: masuk {fmtNum(in14.b)} ktn · keluar {fmtNum(out14.b)} ktn · net{" "}
                {net14 === 0 ? "imbang" : `${net14 > 0 ? "+" : "−"}${fmtNum(Math.abs(net14))} karton (${net14 > 0 ? "stok bertambah" : "stok berkurang"})`}
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-steel-600">
                <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-2 rounded-sm bg-ckb" /> Keluar</span>
                <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-2 rounded-sm bg-ckb-tint" /> Masuk</span>
                <span className="inline-flex items-center gap-1"><span aria-hidden className="h-0 w-5 border-t border-dashed border-steel-400" /> rata-rata {fmtNum(avgOut, 1)} L/hari</span>
              </div>
              <div className="relative mt-2 flex h-40 items-end gap-[3px] lg:h-44">
                {flowSeries.map((v) => {
                  const inner = (
                    <>
                      <span className="flex min-w-0 flex-1 items-end self-stretch justify-center gap-[3px]">
                        <span aria-hidden className={cn("w-full max-w-[10px] rounded-sm lg:max-w-[16px]", v.day === today ? "bg-ckb-dark" : "bg-ckb/70")}
                          style={{ height: `${v.outL > 0 ? flowBarH(v.outL) : 3}px` }} />
                        <span aria-hidden className={cn("w-full max-w-[10px] rounded-sm lg:max-w-[16px]", v.day === today ? "bg-ckb-light" : "bg-ckb-tint")}
                          style={{ height: `${v.inL > 0 ? flowBarH(v.inL) : 3}px` }} />
                      </span>
                      <span className={cn("whitespace-nowrap text-[10px] leading-none tabular", v.day === today ? "font-semibold text-ckb-dark" : "text-steel-500")}>{v.label}</span>
                    </>
                  );
                  const title = `${v.label} — keluar ${fmtNum(v.outL, 1)} L / ${fmtNum(v.outB)} karton, masuk ${fmtNum(v.inL, 1)} L / ${fmtNum(v.inB)} karton`;
                  return v.outL > 0 ? (
                    <Link key={v.day} href={`/audit/picking?date=${v.day}`}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-md outline-offset-2 hover:bg-ckb-tint/30 focus-visible:outline-2 focus-visible:outline-ckb"
                      title={title}
                      aria-label={`Buka audit picking ${v.label}: keluar ${fmtNum(v.outL, 1)} liter, masuk ${fmtNum(v.inL, 1)} liter`}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={v.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={title}>
                      {inner}
                    </div>
                  );
                })}
                <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-steel-400/80"
                  style={{ bottom: `calc(18px + ${avgOutOffset}px)` }} title={`Rata-rata keluar ${fmtNum(avgOut, 1)} liter per hari`} />
              </div>
            </div>
          </div>
          <p className="border-t border-steel-100 px-4 py-2 text-[11px] text-steel-500">
            Liter = karton terposting × volume per karton menurut MASTER DATA (items.volume_l). Masuk = penerimaan + putaway;
            keluar = picking. Hari tanpa movement tampil sebagai garis tipis; SKU tanpa volume tidak dihitung.
          </p>
        </section>

        {/* ---- What needs a hand right now --------------------------------------- */}
        <section aria-labelledby="perhatian-title" className={PANEL}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ckb-tint text-ckb-dark"><ShieldAlert className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h2 id="perhatian-title" className="font-cond text-lg font-semibold leading-tight">Butuh perhatian sekarang</h2>
                <p className="text-xs text-steel-500">Antrean dan penyimpangan yang menunggu orang — bukan sekadar angka.</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-paper px-2.5 py-1 text-xs font-semibold text-steel-700 ring-1 ring-inset ring-steel-100">
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[attentionWorst])} />
              {attention.length === 0 ? "Tidak ada antrean" : `${fmtNum(attention.length)} hal${attentionBad ? ` · ${fmtNum(attentionBad)} bermasalah` : " · menunggu"}`}
            </span>
          </div>

          {attention.length === 0 ? (
            <div className="flex items-center gap-3 border-t border-steel-100 px-4 py-5">
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ok/10 text-ok"><CircleCheck className="h-5 w-5" /></span>
              <div>
                <p className="font-cond text-base font-semibold">Tidak ada yang perlu dicek</p>
                <p className="text-sm text-steel-500">Antrean persetujuan, hold, penerimaan tertunda, dan hitung terbuka semuanya kosong. Stok berisiko juga tidak ada.</p>
              </div>
            </div>
          ) : (
            <ul className="grid gap-x-2 border-t border-steel-100 p-2 sm:grid-cols-2">
              {attention.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-paper">
                    <span aria-hidden className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", TONE_TILE[a.tone])}><a.icon className="h-[18px] w-[18px]" /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-steel">{a.label}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-steel-500">{a.detail}</span>
                      <span aria-hidden className="mt-2 block h-[3px] overflow-hidden rounded-full bg-steel-300/45">
                        <span className={cn("block h-full rounded-full", TONE_FILL[a.tone])} style={{ width: `${Math.max(4, (a.count / attentionMax) * 100)}%` }} />
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-cond text-2xl font-semibold leading-none tabular text-steel">{fmtNum(a.count)}</span>
                      <span className="block text-[11px] leading-tight text-steel-500">{a.unit}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {/* Rincian antrean: per-state shipment, staging aging, dan FEFO per rak. */}
          {(shipmentsWaiting > 0 || stagedQty > 0 || fefoZoneTotal > 0) && (
            <div className="border-t border-steel-100 px-4 py-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel-500">Rincian antrean</h3>
              <div className="mt-2 space-y-4">
                {shipmentsWaiting > 0 && (
                  <>
                    <p className="text-xs text-steel-700">Shipment menunggu audit / muat menurut status</p>
                    <StackedBar
                      segments={[
                        { label: "Siap audit", value: shipReadyAudit ?? 0, fill: "#2A6F97" },
                        { label: "Ada selisih", value: shipMismatch ?? 0, fill: "#C0392B" },
                        { label: "Siap muat", value: shipReadyLoad ?? 0, fill: "#468FAF" },
                      ]}
                      ariaLabel={`Shipment menunggu audit atau muat: ${fmtNum(shipReadyAudit ?? 0)} siap audit, ${fmtNum(shipMismatch ?? 0)} ada selisih, ${fmtNum(shipReadyLoad ?? 0)} siap muat`}
                    />
                  </>
                )}
                {stagedQty > 0 && (
                  <>
                    <p className="text-xs text-steel-700">Umur barang di staging (berdasarkan tanggal diterima)</p>
                    {stagedAgingKnown ? (
                      <StackedBar
                        segments={[
                          { label: "<1 hari", value: stagedAging["<1"], fill: "#2E7D4F" },
                          { label: "1-2 hari", value: stagedAging["1-2"], fill: "#D9941A" },
                          { label: "3+ hari", value: stagedAging["3+"], fill: "#C0392B" },
                        ]}
                        ariaLabel={`Barang di staging: ${fmtNum(stagedAging["<1"])} kurang dari 1 hari, ${fmtNum(stagedAging["1-2"])} 1-2 hari, ${fmtNum(stagedAging["3+"])} lebih dari 3 hari`}
                      />
                    ) : (
                      <p className="text-xs text-steel-500">Belum ada data tanggal diterima pada baris staging.</p>
                    )}
                  </>
                )}
                {fefoZoneTotal > 0 && (
                  <>
                    <p className="text-xs text-steel-700">Pelanggaran FEFO menurut rak (aisle)</p>
                    <div className="space-y-1">
                      {fefoZoneRows.map(([zone, count]) => (
                        <div key={zone} className="flex items-center gap-2">
                          <span className="w-12 text-[11px] text-steel-600">{zone}</span>
                          <div className="flex-1 h-6 bg-steel-100 rounded overflow-hidden">
                            <div className="h-full" style={{ width: `${(count / fefoZoneTotal) * 100}%`, background: "#2A6F97" }} />
                          </div>
                          <span className="w-16 text-right text-[11px] tabular text-steel-800">
                            {fmtNum(count)} ({((count / fefoZoneTotal) * 100).toFixed(0)}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          <p className="border-t border-steel-100 px-4 py-2 text-[11px] text-steel-500">
            Panjang batang membandingkan jumlah di dalam panel ini, bukan target. Klik satu baris untuk membuka daftar kerjanya.
          </p>
        </section>

        {/* ---- Stock health: capacity, then shelf life -------------------------- */}
        <div className="grid gap-5 lg:grid-cols-5">
          <section aria-labelledby="okupansi-title" id="okupansi" className={cn(PANEL, "scroll-mt-4 lg:col-span-3")}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-2 pt-4">
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ckb-tint text-ckb-dark"><Warehouse className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <h2 id="okupansi-title" className="font-cond text-lg font-semibold leading-tight">Okupansi rak</h2>
                  <p className="text-xs text-steel-500">Posisi terisi per aisle dan level.</p>
                </div>
              </div>
              <span className={cn("inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                rackState === "sesak" ? "bg-warn/10 text-steel ring-warn/30" : rackState === "sehat" ? "bg-ok/10 text-steel ring-ok/30" : "bg-paper text-steel-700 ring-steel-100")}>
                <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", rackState === "sesak" ? "bg-warn" : rackState === "sehat" ? "bg-ok" : "bg-ckb")} />
                {Math.round(rackOcc.pct * 100)}% · {rackState}
              </span>
            </div>

            <div className="px-3 pt-1 sm:px-4">
              <table className="w-full table-fixed border-separate border-spacing-[2px] text-center text-[11px] sm:border-spacing-[3px]">
                <caption className="sr-only">Posisi rak terisi per aisle dan level, dalam persen. Klik sel untuk melihat posisi kosongnya.</caption>
                <thead>
                  <tr className="text-[10px] text-steel-500">
                    <th scope="col" className="w-9 text-left font-medium sm:w-10">Aisle</th>
                    {LEVELS.map((lv) => <th key={lv} scope="col" className="font-medium"><span className="sm:hidden">{lv}</span><span className="hidden sm:inline">Level {lv}</span></th>)}
                    <th scope="col" className="w-11 font-medium sm:w-12">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map((g) => (
                    <tr key={g.zone}>
                      <th scope="row" className="text-left font-cond text-sm font-semibold text-steel">{g.zone}</th>
                      {g.cells.map((c) => {
                        const st = occStep(c.pct);
                        return (
                          <td key={c.level} className={cn("rounded font-semibold tabular", c.total ? st.fg : "text-steel-300")}
                            style={{ background: c.total ? st.bg : undefined }}>
                            {c.total ? (
                              <Link href={`/inventory?aisle=${g.zone}&level=${c.level}`} className="block rounded py-[7px] transition-shadow hover:ring-2 hover:ring-ckb/40"
                                title={`${g.zone} level ${c.level}: ${c.occ}/${c.total} posisi terisi, ${c.total - c.occ} kosong. Klik untuk detail.`}>
                                {Math.round(c.pct * 100)}%
                              </Link>
                            ) : <span className="block py-[7px]">–</span>}
                          </td>
                        );
                      })}
                      <td className="rounded bg-paper font-semibold tabular text-steel-700">
                        <Link href={`/inventory?aisle=${g.zone}`} className="block rounded py-[3px] leading-tight transition-shadow hover:ring-2 hover:ring-ckb/40"
                          title={`${g.zone}: ${g.all.occ}/${g.all.total} posisi terisi. Klik untuk detail.`}>
                          <span className="block text-xs">{Math.round(g.all.pct * 100)}%</span>
                          <span className="block text-[9px] font-medium text-steel-500">{g.all.occ}/{g.all.total}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                  <tr className="text-steel-700">
                    <th scope="row" className="text-left text-[10px] font-medium text-steel-500">Total</th>
                    {levelTotals.map((c, i) => (
                      <td key={LEVELS[i]} className="rounded">
                        <Link href={`/inventory?level=${LEVELS[i]}`} className="block rounded py-1 text-[11px] font-semibold tabular transition-colors hover:bg-paper hover:ring-1 hover:ring-ckb/40"
                          title={`Level ${LEVELS[i]}: ${c.occ}/${c.total} posisi terisi. Klik untuk detail.`}>{Math.round(c.pct * 100)}%</Link>
                      </td>
                    ))}
                    <td className="rounded border-t-2 border-steel-300 py-1 text-[11px] font-semibold tabular">{Math.round(rackOcc.pct * 100)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-auto space-y-2.5 px-4 pb-4 pt-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-steel-500">
                <span>Posisi terisi:</span>
                {OCC_STEPS.map((st, i) => (
                  <span key={st.min} className="inline-flex items-center gap-1">
                    <span aria-hidden className="inline-block h-3 w-5 rounded-sm ring-1 ring-inset ring-steel/5" style={{ background: st.bg }} />
                    {Math.round(st.min * 100)}{i < OCC_STEPS.length - 1 ? `–${Math.round(OCC_STEPS[i + 1]!.min * 100)}%` : "%+"}
                  </span>
                ))}
              </div>
              <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-lg bg-steel-100 text-center">
                {[
                  { k: "Bin", v: fmtNum(bins.length) },
                  { k: "Terisi", v: fmtNum(occupied) },
                  { k: "Kosong", v: fmtNum(bins.length - occupied) },
                  { k: "Diblokir", v: fmtNum(blocked) },
                ].map((s) => (
                  <div key={s.k} className="bg-white px-1 py-2">
                    <dt className="text-[10px] text-steel-500">{s.k}</dt>
                    <dd className="font-cond text-base font-semibold leading-tight tabular">{s.v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[11px] text-steel-500">
                {fmtNum(rackBins.length)} posisi rak di grid; {fmtNum(bins.length - rackBins.length)} bin lantai/staging tidak dihitung.
                Sehat 80–85% terisi — di atas 85% gudang sesak, putaway dan picking melambat.
              </p>
            </div>
          </section>

          <section aria-labelledby="expired-title" className={cn(PANEL, "lg:col-span-2")}>
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pb-3 pt-4">
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ckb-tint text-ckb-dark"><CalendarClock className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <h2 id="expired-title" className="font-cond text-lg font-semibold leading-tight">Umur simpan stok</h2>
                  <p className="text-xs text-steel-500">Berapa karton, dan berapa lama lagi.</p>
                </div>
              </div>
              <nav className="flex rounded-md bg-paper p-0.5 text-[11px] ring-1 ring-inset ring-steel-100" aria-label="Rentang kalender">
                {CAL_RANGES.map((y) => (
                  <Link key={y} href={`/dashboard?kalender=${y}`} scroll={false} aria-current={y === calYears ? "true" : undefined}
                    className={cn("rounded px-2 py-1", y === calYears ? "bg-ckb font-semibold text-white" : "text-steel-700 hover:bg-steel-100")}>
                    {y} th
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex-1 space-y-3 px-4 pb-4">
              {/* The whole shelf in one bar: the answer to "is stock healthy", before the month detail. */}
              <div>
                <div className="flex h-3 overflow-hidden rounded-full ring-1 ring-inset ring-steel/10" role="img"
                  aria-label={`Sebaran umur simpan: ${shelf.map((b) => `${b.label} ${fmtNum(b.qty)} karton`).join(", ")}`}>
                  {shelf.map((b) => b.qty > 0 ? (
                    <span key={b.key} title={`${b.label}: ${fmtNum(b.qty)} karton · ${fmtNum(b.rows)} baris · ${fmtNum(b.skus.size)} SKU`}
                      style={{ width: `${(b.qty / shelfTotal) * 100}%`, background: SHELF_FILL[b.key] }} />
                  ) : null)}
                </div>
                <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  {shelf.map((b) => (
                    <li key={b.key} className="flex items-center gap-1.5">
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ background: SHELF_FILL[b.key] }} />
                      <span className="truncate text-steel-500">{b.label}</span>
                      <span className="ml-auto font-semibold tabular text-steel-700">{fmtNum(b.qty)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-steel-700">Karton kedaluwarsa per {byQuarter ? "kuartal" : "bulan"}</h3>
                  <span className="text-[11px] text-steel-500">{fmtNum(nextCal)} dalam {calYears} tahun</span>
                </div>
                <div className="mt-1.5 flex h-20 items-end gap-[3px] border-b border-steel-300" role="img"
                  aria-label={`Karton yang kedaluwarsa per ${byQuarter ? "kuartal" : "bulan"} dalam ${calYears} tahun ke depan`}>
                  {months.map((m) => (
                    <div key={m.ym} className="relative flex h-full flex-1 flex-col items-center justify-end"
                      title={`${m.full}: ${fmtNum(m.qty)} karton, ${m.skus.size} SKU`}>
                      {m.qty > 0
                        ? <span className={cn("mb-0.5 text-[9px] font-semibold tabular", m.ym === thisMonth ? "text-warn" : "text-steel-700")}>{fmtNum(m.qty)}</span>
                        : <span aria-hidden className="mb-0.5 h-0.5 w-2.5 rounded-full bg-steel-300" />}
                      <div className={cn("w-full max-w-5 rounded-t", m.ym === thisMonth ? "bg-warn" : "bg-ckb")}
                        style={{ height: m.qty ? `max(3px, ${(m.qty / monthMax) * 78}%)` : 0 }} />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-[3px] text-[9px] text-steel-500">
                  {months.map((m, i) => {
                    // Every label up to 12 bars; with more, every third bar plus each year start. Year under the first bar and each year start.
                    const show = months.length <= 12 || i === 0 || m.yearStart || i % 3 === 0;
                    return (
                      <span key={m.ym} className={cn("flex-1 whitespace-nowrap text-center", m.yearStart && "font-semibold text-steel-700")}>
                        {show ? m.label : ""}{i === 0 || m.yearStart ? <><br />{m.year}</> : null}
                      </span>
                    );
                  })}
                </div>
              </div>

              <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-steel-100 text-center">
                {[
                  { k: `Dalam ${calYears} th`, v: fmtNum(nextCal) },
                  { k: "Setelahnya", v: fmtNum(laterQty) },
                  { k: "Tanpa tanggal", v: fmtNum(noDateQty) },
                ].map((s) => (
                  <div key={s.k} className="bg-white px-1 py-2">
                    <dt className="flex min-h-[1.8em] items-end justify-center text-[10px] leading-tight text-steel-500">{s.k}</dt>
                    <dd className="font-cond text-base font-semibold leading-tight tabular">{s.v}</dd>
                  </div>
                ))}
              </dl>

              <p className="text-[11px] text-steel-500">
                {expiredQty > 0
                  ? <>{fmtNum(expiredQty)} karton sudah lewat tanggal dan harus dipisahkan. </>
                  : <>Tidak ada karton yang sudah lewat tanggal. </>}
                {calPeak.qty > 0 ? <>Puncak terdekat {calPeak.full}: {fmtNum(calPeak.qty)} karton.</> : null}
                {byQuarter ? " Kuartal" : " Bulan"} berjalan berwarna kuning. Rincian per SKU ada di <Link className="underline" href="/inventory?tab=fefo">Inventory</Link>.
              </p>
            </div>
          </section>
        </div>

        {/* ---- Quality: process accuracy next to where the stock sits ------------- */}
        <div className="grid gap-5 lg:grid-cols-5">
          <section aria-labelledby="mutu-title" className={cn(PANEL, "lg:col-span-3")}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-1 pt-4">
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ckb-tint text-ckb-dark"><Gauge className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <h2 id="mutu-title" className="font-cond text-lg font-semibold leading-tight">Mutu &amp; kendali</h2>
                  <p className="text-xs text-steel-500">{ACCURACY_DAYS} hari terakhir, dibanding target.</p>
                </div>
              </div>
            </div>
            <div className="grid gap-x-2 p-2 sm:grid-cols-2">
              <Metric label="Akurasi picking (audit)" value={pct(pickAcc)} pct={pickPctAcc} target={pickTarget}
                note={`${fmtNum(pickAcc.ok)} OK dari ${fmtNum(pickAcc.n)} percobaan pertama · target ≥ ${fmtNum(pickTarget, 1)}%`}
                tone={pickPctAcc === null ? undefined : pickPctAcc >= pickTarget ? "ok" : "warn"} href="/audit/picking?tab=akurasi"
                trend={pickTrend} trendBetter="up" />
              <Metric label="Akurasi putaway (audit)" value={pct(putAcc)} pct={putPctAcc} target={99.5}
                note={putAcc.n ? `${fmtNum(putAcc.ok)} OK dari ${fmtNum(putAcc.n)} diaudit · target ≥ 99,5%` : "Belum ada audit putaway 30 hari · target ≥ 99,5%"}
                tone={putPctAcc === null ? undefined : putPctAcc >= 99.5 ? "ok" : "warn"} href="/audit/putaway"
                trend={putTrend} trendBetter="up" />
              <Metric label="FEFO compliance" value={fefoPct === null ? "–" : `${fmtNum(dec1(fefoPct), 1)}%`} pct={fefoPct} target={100}
                note={!fefo ? "Tidak terbaca, coba muat ulang" : fefoN ? `${fmtNum(fefoBad)} pelanggaran dari ${fmtNum(fefoN)} pick rak · wajib 100%` : "Belum ada pick rak 30 hari"}
                tone={fefoPct === null ? undefined : fefoPct >= 100 ? "ok" : "bad"} href="/inventory?tab=fefo" />
              <Metric label="Picker lapor beda" value={devPct === null ? "–" : `${fmtNum(dec1(devPct), 1)}%`} pct={devPct}
                note={recentPicks.length ? `${fmtNum(deviated)} dari ${fmtNum(recentPicks.length)} pick selesai · makin kecil makin baik` : "Belum ada pick selesai 30 hari"}
                tone={devPct === null ? undefined : "warn"} href="/audit/picking"
                trend={devTrend} trendBetter="down" />
              <Metric label="Akurasi stok (cycle count)" value={qtyIra === null ? "–" : `${qtyIra.toFixed(1)}%`} pct={qtyIra} target={98}
                note={`${fmtNum(cycleOk)} dari ${fmtNum(cycleApplied.length)} bin tepat · ${fmtNum(openCounts ?? 0)} tugas terbuka · target ≥ 98%`}
                tone={qtyIra === null ? undefined : qtyIra >= 98 ? "ok" : "warn"} href="/inventory?tab=akurasi"
                trend={cycleTrend} trendBetter="up" />
              <Metric label="Rekonsiliasi SAP terakhir" value={lastRecon?.accuracy_pct != null ? `${fmtNum(Number(lastRecon.accuracy_pct), 1)}%` : "–"}
                pct={lastRecon?.accuracy_pct != null ? Number(lastRecon.accuracy_pct) : null}
                note={lastRecon ? `${fmtDate(lastRecon.as_of)} · ${fmtNum(lastRecon.open_diffs)} selisih belum dijelaskan` : "Belum ada rekonsiliasi"}
                tone={lastRecon?.accuracy_pct == null ? undefined : Number(lastRecon.accuracy_pct) >= 99 ? "ok" : "warn"} href="/inventory?tab=rekonsiliasi" />
            </div>
            <p className="mt-auto border-t border-steel-100 px-4 py-2 text-[11px] text-steel-500">
              Garis kecil di batang adalah target; isian adalah capaian {ACCURACY_DAYS} hari. Klik baris untuk membuka auditnya.
            </p>
          </section>

          <section aria-labelledby="abc-title" className={cn(PANEL, "lg:col-span-2")}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4">
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ckb-tint text-ckb-dark"><Layers className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <h2 id="abc-title" className="font-cond text-lg font-semibold leading-tight">Kelas ABC stok</h2>
                  <p className="text-xs text-steel-500">Kelas dari frekuensi baris picking.</p>
                </div>
              </div>
              <span className="text-[11px] text-steel-500">{fmtNum(totalQty)} karton</span>
            </div>
            <div className="flex-1 space-y-3 px-4 pb-4">
              <div className="flex h-3 overflow-hidden rounded-full ring-1 ring-inset ring-steel/10" role="img"
                aria-label={`Sebaran stok: ${abc.map((a) => `${a.k === "–" ? "tanpa kelas" : `kelas ${a.k}`} ${fmtNum(a.qty)} karton`).join(", ")}`}>
                {abc.map((a) => a.qty > 0 ? (
                  <span key={a.k} title={`${a.k === "–" ? "Tanpa kelas" : `Kelas ${a.k}`}: ${fmtNum(a.qty)} karton · ${fmtNum(a.skus)} SKU`}
                    style={{ width: `${(a.qty / Math.max(totalQty, 1)) * 100}%`, background: ABC_FILL[a.k] }} />
                ) : null)}
              </div>
              <ul className="grid grid-cols-2 gap-2">
                {abc.map((a) => (
                  <li key={a.k}>
                    <Link href={`/inventory?abc=${encodeURIComponent(a.k)}&sort=qty`} title={`Lihat ${a.skus} SKU kelas ${a.k === "–" ? "tanpa kelas" : a.k} di Inventory`}
                      className="block h-full rounded-lg bg-paper px-2.5 py-2 transition-colors hover:bg-steel-100 hover:ring-1 hover:ring-ckb/40">
                      <span className="flex items-center gap-1.5 text-[11px] text-steel-500">
                        <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: ABC_FILL[a.k] }} />
                        {a.k === "–" ? "Tanpa kelas" : `Kelas ${a.k}`}
                      </span>
                      <span className="block font-cond text-xl font-semibold leading-tight tabular">{Math.round((a.qty / Math.max(totalQty, 1)) * 100)}%</span>
                      <span className="block text-[11px] leading-tight text-steel-500">{fmtNum(a.qty)} karton · {fmtNum(a.skus)} SKU</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-steel-500">
                Kelas A paling sering dipicking, jadi paletnya di dekat jalur. Hitung ulang kelas di Pengaturan setelah data mutasi cukup.
              </p>
            </div>
          </section>
        </div>

        {/* ---- Top SKUs: a desktop table, cards on the floor -------------------- */}
        <section aria-labelledby="top-title" className={PANEL}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ckb-tint text-ckb-dark"><Boxes className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h2 id="top-title" className="font-cond text-lg font-semibold leading-tight">Top 10 SKU menurut stok</h2>
                <p className="text-xs text-steel-500">Karton, setara palet, dan jumlah bin yang dipakai.</p>
              </div>
            </div>
            <Link href="/inventory" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-ckb-dark hover:bg-paper">
              Buka Inventory<ChevronRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="hidden border-t border-steel-100 px-4 pb-4 pt-2 md:block">
            <Table>
              <thead><tr><Th>SKU</Th><Th>Deskripsi</Th><Th className="text-right">Stok</Th><Th className="text-right">Palet (setara)</Th><Th className="text-right">Bin</Th></tr></thead>
              <tbody>{topSkus.map((t) => (
                <tr key={t.sku} className="hover:bg-paper">
                  <Td><Link className="font-cond font-semibold text-ckb-dark underline decoration-steel-300 underline-offset-2 hover:decoration-ckb" href={`/inventory?q=${t.sku}`}>{t.sku}</Link></Td>
                  <Td className="text-steel-700">{t.description}</Td>
                  <Td className="text-right font-semibold tabular">{fmtNum(t.qty)} {t.uom}</Td><Td className="text-right tabular">{fmtNum(t.pallets, 1)}</Td><Td className="text-right tabular">{t.bins.size}</Td>
                </tr>
              ))}</tbody>
            </Table>
          </div>
          <ul className="divide-y divide-steel-100 border-t border-steel-100 md:hidden">
            {topSkus.map((t) => (
              <li key={t.sku} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <Link href={`/inventory?q=${t.sku}`} className="font-cond text-sm font-semibold text-ckb-dark">{t.sku}</Link>
                  <span className="block truncate text-[11px] text-steel-500">{t.description}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular">{fmtNum(t.qty)} {t.uom}</span>
                  <span className="block text-[11px] text-steel-500">{fmtNum(t.pallets, 1)} palet · {t.bins.size} bin</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---- The stock that needs separating, in full ------------------------- */}
        <section aria-labelledby="risiko-title" id="risiko" className={cn(PANEL, "scroll-mt-4")}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4">
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", expiredRows.length ? TONE_TILE.bad : TONE_TILE.warn)}><CalendarX2 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h2 id="risiko-title" className="font-cond text-lg font-semibold leading-tight">Stok expired dan mendekati expired</h2>
                <p className="text-xs text-steel-500">Expired, atau sisa umur ≤ {NEAR_EXPIRY_DAYS} hari — terdekat lebih dulu.</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-paper px-2.5 py-1 text-xs font-semibold text-steel-700 ring-1 ring-inset ring-steel-100">
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[risky.length ? (expiredRows.length ? "bad" : "warn") : "ok"])} />
              {risky.length ? `${fmtNum(risky.length)} posisi · ${fmtNum(sumQty(risky))} karton` : "Tidak ada"}
            </span>
          </div>
          {risky.length === 0 ? (
            <p className="flex items-center gap-2 border-t border-steel-100 px-4 py-4 text-sm text-steel-500">
              <CircleCheck aria-hidden className="h-4 w-4 text-ok" />Tidak ada stok yang expired atau expired dalam {NEAR_EXPIRY_DAYS} hari.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-steel-100 border-t border-steel-100 md:hidden">
                {riskyShown.map((r, i) => (
                  <li key={`${r.bin_code}-${r.sku}-${i}`} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/bin/${r.bin_code}`} className="font-cond text-base font-semibold text-ckb-dark">{r.bin_code}</Link>
                        <p className="text-sm text-steel-700">{r.sku} · {r.batch_lot || "–"}</p>
                        <p className="truncate text-[11px] text-steel-500">{r.description}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-cond text-lg font-semibold leading-tight tabular">{fmtNum(r.quantity)} {r.uom}</p>
                        <ExpiryBadge status={expiryStatus(r.expiry_date)} />
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-steel-500">{fmtDate(r.expiry_date)} · sisa {fmtNum(r.days_remaining)} hari</p>
                  </li>
                ))}
              </ul>
              <div className="hidden border-t border-steel-100 px-4 pb-4 pt-2 md:block">
                <Table>
                  <thead><tr><Th>Bin</Th><Th>SKU</Th><Th>Deskripsi</Th><Th>Batch</Th><Th className="text-right">Qty</Th><Th>Expired</Th><Th className="text-right">Sisa hari</Th><Th>Status</Th></tr></thead>
                  <tbody>{riskyShown.map((r, i) => (
                    <tr key={i} className="hover:bg-paper">
                      <Td><Link className="font-cond font-semibold text-ckb-dark underline decoration-steel-300 underline-offset-2 hover:decoration-ckb" href={`/bin/${r.bin_code}`}>{r.bin_code}</Link></Td><Td>{r.sku}</Td><Td className="text-steel-700">{r.description}</Td><Td>{r.batch_lot || "–"}</Td>
                      <Td className="text-right tabular">{fmtNum(r.quantity)} {r.uom}</Td><Td>{fmtDate(r.expiry_date)}</Td><Td className="text-right tabular">{fmtNum(r.days_remaining)}</Td><Td><ExpiryBadge status={expiryStatus(r.expiry_date)} /></Td>
                    </tr>
                  ))}</tbody>
                </Table>
              </div>
              {risky.length > RISKY_ROWS && (
                <p className="border-t border-steel-100 px-4 py-2 text-[11px] text-steel-500">
                  Menampilkan {RISKY_ROWS} dari {fmtNum(risky.length)} posisi.{" "}
                  <Link className="underline" href="/inventory?tab=fefo">Buka daftar lengkap di Inventory</Link>.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

/** One block of the navy band: a labelled progress meter over a real ratio. */
function PlanGauge({ label, done, total, pct, note }: { label: string; done: number; total: number; pct: number; note: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{label}</span>
        <span className="font-cond text-2xl font-semibold leading-none tabular">{fmtNum(done)}<span className="text-white/45">/{fmtNum(total)}</span></span>
      </div>
      <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-jeir-teal" style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-white/60">{note}</p>
    </div>
  );
}

function BandStat({ label, value, sub, href, icon: Icon, tone }: { label: string; value: string; sub: string; href: string; icon: LucideIcon; tone?: "warn" }) {
  return (
    <Link href={href} className="min-w-0 border-t border-white/10 px-3 py-3 transition-colors [&:nth-child(-n+2)]:border-t-0 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 sm:border-l sm:border-t-0 sm:first:border-l-0 lg:px-6 lg:py-4">
      <span className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-wide text-white/55 sm:text-[10px]">
        <Icon aria-hidden className="hidden h-3.5 w-3.5 sm:block" />{label}
      </span>
      <span className="mt-0.5 block font-cond text-2xl font-semibold leading-none tabular">{value}</span>
      <span className={cn("mt-1 block text-[11px] text-white/55", tone === "warn" && "text-warn")}>{sub}</span>
    </Link>
  );
}

/** A metric against its target: the fill is the achievement, the tick is the goal. */
function Metric({ label, value, note, pct, target, tone, href, trend, trendBetter = "up" }: {
  label: string; value: string; note: string; pct: number | null; target?: number;
  tone?: "bad" | "warn" | "ok"; href: string;
  trend?: (number | null)[]; trendBetter?: "up" | "down";
}) {
  const delta = trend ? deltaPt(trend) : null;
  const deltaDir = delta == null ? "neutral" : trendBetter === "up"
    ? (delta > 0 ? "up" : delta < 0 ? "down" : "flat")
    : (delta < 0 ? "up" : delta > 0 ? "down" : "flat");
  const deltaTone = deltaDir === "up" ? "ok" : deltaDir === "down" ? "bad" : "neutral";
  const deltaText = delta == null ? null : `${delta >= 0 ? "+" : ""}${fmtNum(Math.abs(delta), 1)} pt`;

  return (
    <Link href={href} className="block rounded-lg px-2.5 py-2 transition-colors hover:bg-paper">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-steel-700">{label}</span>
        <span className={cn("font-cond text-xl font-semibold leading-none tabular", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-steel")}>{value}</span>
      </span>
      {trend && (
        <span className="mt-1 flex items-center gap-1.5">
          <Sparkline values={trend} />
          {deltaText && <span className={cn("text-[11px] leading-none shrink-0", deltaTone === "ok" ? "text-ok" : deltaTone === "bad" ? "text-bad" : "text-steel-500")}>{deltaText}</span>}
        </span>
      )}
      {pct !== null && (
        <span aria-hidden className="relative mt-1.5 block h-1.5 rounded-full bg-steel-300/45">
          <span className={cn("block h-full rounded-full", tone === "ok" ? "bg-ok" : tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : "bg-ckb")}
            style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
          {target !== undefined && <span title={`Target ${fmtNum(target, 1)}%`} className="absolute -top-[2px] h-[10px] w-[2px] rounded-full bg-steel shadow-[0_0_0_1px_rgba(255,255,255,0.9)]" style={{ left: `calc(${Math.min(100, target)}% - 1px)` }} />}
        </span>
      )}
      <span className="mt-1 block text-[11px] leading-snug text-steel-500">{note}</span>
    </Link>
  );
}
