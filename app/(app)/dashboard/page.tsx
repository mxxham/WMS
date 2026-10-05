import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { parsePolicy, quantityAccuracy } from "@/lib/inventory-control";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpiryBadge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { NEAR_EXPIRY_DAYS, expiryStatus } from "@/config/warehouse";
import type { BinSummary } from "@/lib/warehouse-types";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import { unstable_cache } from "next/cache";
import { jakartaDate, locType } from "@/lib/inventory-view";

// fefo_exceptions takes ~8s on the live data set; cache the counts for 15 min
// so dashboard loads don't wait on it. A cached function may not read cookies
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
  return { bad: ((exc.data ?? []) as unknown[]).length, n: Number(picks.data ?? 0) };
}, ["dashboard-fefo-compliance"], { revalidate: 900 });

export const dynamic = "force-dynamic";

type Inv = { bin_code: string; zone: string; rack: string | null; sku: string; description: string; uom: string | null; upp: number | null; item_abc: string | null; batch_lot: string; quantity: number; expiry_date: string | null; received_date: string | null; days_remaining: number | null };
type Task = { status: string; task_type: string; quantity: number; actual_quantity: number | null; actual_from_bin: string | null; from_bin: string; actual_batch_lot: string | null; batch_lot: string; completed_at: string | null; planned_date: string };
type Mv = { type: string; quantity: number; from_bin_id: string | null };
type Audit = { kind: "PICK" | "PUTAWAY"; result: "OK" | "MISMATCH" };

// Occupancy heat grid: one hue (brand green), light -> dark, 5 fixed steps.
const OCC_STEPS = [
  { min: 0, bg: "#E3ECE9", fg: "text-steel" },
  { min: 0.2, bg: "#B8CFC7", fg: "text-steel" },
  { min: 0.4, bg: "#89AFA2", fg: "text-steel" },
  { min: 0.6, bg: "#3E7C66", fg: "text-white" },
  { min: 0.8, bg: "#135F45", fg: "text-white" },
];
const occStep = (p: number) => [...OCC_STEPS].reverse().find((s) => p >= s.min)!;
const LEVELS = ["A", "B", "C", "D", "E"];
const ACCURACY_DAYS = 30;
// Expiry calendar ranges: up to 2 years per month, longer ranges per quarter
// (60 monthly bars would be too thin to read).
const CAL_RANGES = [1, 2, 3, 5] as const;
type CalRange = (typeof CAL_RANGES)[number];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ kalender?: string }> }) {
  await requireRole(["supervisor", "admin"]);
  const supabase = await createClient();
  const today = jakartaDate();
  const todayStart = new Date(`${today}T00:00:00+07:00`);
  const accSince = new Date(Date.now() - ACCURACY_DAYS * 86_400_000).toISOString();
  const [bins, inv, todayTasks, recentTasks, moves, audits, { count: openCounts }, { data: todayWaves }, cycleApplied,
    { count: pendingApprovals }, { count: activeHolds }, { count: openReceipts }, { data: lastRecon }, pickFirsts, { count: shipmentsWaiting }, { data: policyRaw }, fefo] = await Promise.all([
    fetchAll<BinSummary>((a, b) => supabase.from("bin_summary").select("id, bin_code, zone, rack, level, total_qty, fill_ratio, status").order("bin_code").range(a, b)),
    fetchAll<Inv>((a, b) => supabase.from("inventory_detail").select("bin_code, zone, rack, sku, description, uom, upp, item_abc, batch_lot, quantity, expiry_date, received_date, days_remaining").order("id").range(a, b)),
    fetchAll<Task>((a, b) => supabase.from("pick_task_detail").select("status, task_type, quantity, actual_quantity, actual_from_bin, from_bin, actual_batch_lot, batch_lot, completed_at, planned_date").eq("planned_date", today).order("id").range(a, b)),
    fetchAll<Task>((a, b) => supabase.from("pick_task_detail").select("status, task_type, quantity, actual_quantity, actual_from_bin, from_bin, actual_batch_lot, batch_lot, completed_at, planned_date").eq("status", "COMPLETED").gte("completed_at", accSince).order("id").range(a, b)),
    fetchAll<Mv>((a, b) => supabase.from("movements").select("type, quantity, from_bin_id").in("type", ["inbound", "putaway", "picking"]).gte("created_at", todayStart.toISOString()).order("id").range(a, b)),
    fetchAll<Audit>((a, b) => supabase.from("audits").select("kind, result").gte("audited_at", accSince).order("id").range(a, b)),
    supabase.from("count_tasks").select("id", { count: "exact", head: true }).in("status", ["OPEN", "COUNTED", "RECOUNT"]),
    supabase.from("waves").select("status").eq("planned_date", today),
    fetchAll<{ system_qty: number | null; variance_qty: number | null; tolerance: number }>((a, b) =>
      supabase.from("count_accuracy").select("system_qty, variance_qty, tolerance").gte("closed_at", accSince).order("id").range(a, b)),
    supabase.from("adjustment_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
    supabase.from("stock_holds").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
    supabase.from("receipts").select("id", { count: "exact", head: true }).in("status", ["OPEN", "CHECKED"]),
    supabase.from("stock_recon_summary").select("as_of, accuracy_pct, open_diffs").order("as_of", { ascending: false }).limit(1).maybeSingle(),
    fetchAll<{ result: string }>((a, b) => supabase.from("pick_audit_first").select("result").gte("audited_at", accSince).order("task_id").range(a, b)),
    supabase.from("pick_audit_shipment").select("wave_id", { count: "exact", head: true }).in("state", ["READY_AUDIT", "HAS_MISMATCH", "READY_LOAD"]),
    supabase.rpc("inventory_policy"),
    // A slow or failing count must never take the dashboard down: the tile shows "–" instead.
    getFefoCompliance().catch(() => null),
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
  const noDate = inv.filter((r) => r.expiry_date === null).length;

  // ---- Today ---------------------------------------------------------------
  const picks = todayTasks.filter((t) => t.task_type === "PICK" && t.status !== "CANCELLED");
  const picksDone = picks.filter((t) => t.status === "COMPLETED").length;
  const waveCount = { total: todayWaves?.length ?? 0, done: (todayWaves ?? []).filter((w) => w.status === "COMPLETED").length };

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

  // ---- Staging (dock-to-stock stand-in) ------------------------------------
  const staged = inv.filter((r) => locType(r) === "staging");
  const stagedQty = staged.reduce((s, r) => s + Number(r.quantity), 0);
  const oldestStaged = staged.map((r) => r.received_date).filter(Boolean).sort()[0] ?? null;

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
  const pct = (x: { n: number; ok: number }) => (x.n ? `${Math.round((x.ok / x.n) * 1000) / 10}%` : "–");
  const recentPicks = recentTasks.filter((t) => t.task_type === "PICK");
  const deviated = recentPicks.filter((t) =>
    (t.actual_quantity !== null && Number(t.actual_quantity) !== Number(t.quantity))
    || (t.actual_from_bin && t.actual_from_bin !== t.from_bin)
    || (t.actual_batch_lot !== null && t.actual_batch_lot !== t.batch_lot)).length;

  // ---- Expiry calendar: cartons expiring per month (<= 2 years) or quarter -------
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
  let expiredQty = 0, laterQty = 0, noDateQty = 0;
  for (const r of inv) {
    const q = Number(r.quantity);
    if (!r.expiry_date) { noDateQty += q; continue; }
    if (r.expiry_date < today) { expiredQty += q; continue; }
    const i = monthIdx.get(bucketKey(r.expiry_date));
    if (i === undefined) laterQty += q;
    else { months[i].qty += q; months[i].skus.add(r.sku); }
  }
  const monthMax = Math.max(1, ...months.map((m) => m.qty));
  const nextCal = months.reduce((s, m) => s + m.qty, 0);

  // ---- Top SKUs by stock ------------------------------------------------------
  const bySku = new Map<string, { sku: string; description: string; uom: string | null; qty: number; pallets: number; bins: Set<string> }>();
  for (const r of inv) {
    const e = bySku.get(r.sku) ?? { sku: r.sku, description: r.description, uom: r.uom, qty: 0, pallets: 0, bins: new Set<string>() };
    e.qty += Number(r.quantity); e.pallets += r.upp ? Number(r.quantity) / Number(r.upp) : 0; e.bins.add(r.bin_code);
    bySku.set(r.sku, e);
  }
  const topSkus = [...bySku.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);

  return (
    <main>
      <PageHeader title="Dashboard gudang" live={["pick_tasks", "movements", "audits", "count_tasks", "stock_holds", "adjustment_requests", "receipts", "pick_audits", "shipment_loads"]} liveDebounceMs={5000} />
      <div className="space-y-6 p-4 lg:p-8">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Total bin" value={fmtNum(bins.length)} note={`${fmtNum(rackBins.length)} rak · ${fmtNum(bins.length - rackBins.length)} lantai`} />
          <Kpi label="Terisi" value={fmtNum(occupied)} note={`${Math.round((occupied / Math.max(bins.length, 1)) * 100)}% dari semua bin`} />
          <Kpi label="Kosong" value={fmtNum(bins.length - occupied)} note={`${blocked} bin diblokir`} />
          <Kpi label={`Expired / ≤ ${NEAR_EXPIRY_DAYS} hari`} value={fmtNum(risky.length)} note={`${noDate} baris tanpa tanggal expired`} tone={risky.length ? "bad" : undefined} />
        </div>

        <section aria-labelledby="today" className="space-y-2">
          <h2 id="today" className="font-cond text-lg font-semibold">Operasi hari ini · {fmtDate(today)}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi label="Wave" value={fmtNum(waveCount.total)} note={`${fmtNum(waveCount.done)} selesai`} href={`/waves?date=${today}`} />
            <Kpi label="Tugas pick" value={`${fmtNum(picksDone)}/${fmtNum(picks.length)}`} note={picks.length ? `${Math.round((picksDone / picks.length) * 100)}% diposting` : "belum ada rencana"} href={`/waves?date=${today}`} />
            <Kpi label="Karton keluar" value={fmtNum(todayFlow.keluar)} note="picking hari ini" />
            <Kpi label="Karton masuk" value={fmtNum(todayFlow.masuk)} note="terima + putaway baru" href={`/audit/putaway?date=${today}`} />
            <Kpi label="Menunggu di staging" value={fmtNum(stagedQty)} note={stagedQty ? `${staged.length} baris · tertua ${fmtDate(oldestStaged)}` : "staging kosong"} tone={oldestStaged && oldestStaged < today ? "warn" : undefined} />
          </div>
        </section>

        <section aria-labelledby="acc" className="space-y-2">
          <h2 id="acc" className="font-cond text-lg font-semibold">Akurasi · {ACCURACY_DAYS} hari terakhir</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Akurasi picking (audit)" value={pct(pickAcc)} note={`percobaan pertama · ${fmtNum(pickAcc.ok)} OK dari ${fmtNum(pickAcc.n)} · target ≥ ${fmtNum(pickTarget, 1)}%`} href="/audit/picking?tab=akurasi" tone={pickAcc.n && (pickAcc.ok / pickAcc.n) * 100 < pickTarget ? "warn" : undefined} />
            <Kpi label="FEFO compliance" value={fefoN ? `${Math.round((fefoOk / fefoN) * 1000) / 10}%` : "–"}
              note={!fefo ? "tidak terbaca, coba muat ulang" : fefoN ? `${fmtNum(fefoBad)} pelanggaran dari ${fmtNum(fefoN)} pick rak` : "belum ada pick rak"} href="/inventory?tab=fefo"
              tone={fefoBad ? "warn" : undefined} />
            <Kpi label="Shipment menunggu audit / muat" value={fmtNum(shipmentsWaiting ?? 0)} note="semua baris harus lolos audit sebelum dimuat" href="/audit/picking" tone={shipmentsWaiting ? "warn" : undefined} />
            <Kpi label="Akurasi putaway (audit)" value={pct(putAcc)} note={`${fmtNum(putAcc.ok)} OK dari ${fmtNum(putAcc.n)} diaudit · target ≥ 99,5%`} href="/audit/putaway" tone={putAcc.n && putAcc.ok / putAcc.n < 0.995 ? "warn" : undefined} />
            <Kpi label="Picker lapor beda" value={recentPicks.length ? `${Math.round((deviated / recentPicks.length) * 1000) / 10}%` : "–"} note={`${fmtNum(deviated)} dari ${fmtNum(recentPicks.length)} pick selesai`} />
            <Kpi label="Akurasi stok (cycle count)" value={qtyIra === null ? "–" : `${qtyIra.toFixed(1)}%`}
              note={`akurasi qty · ${fmtNum(cycleOk)} dari ${fmtNum(cycleApplied.length)} bin tepat · ${fmtNum(openCounts ?? 0)} tugas terbuka · target ≥ 98%`} href="/inventory?tab=akurasi"
              tone={qtyIra !== null && qtyIra < 98 ? "warn" : undefined} />
          </div>
        </section>

        <section aria-labelledby="ctl" className="space-y-2">
          <h2 id="ctl" className="font-cond text-lg font-semibold">Kontrol inventory</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Adjustment menunggu persetujuan" value={fmtNum(pendingApprovals ?? 0)} note="di atas batas, perlu orang lain" href="/inventory?tab=persetujuan" tone={pendingApprovals ? "warn" : undefined} />
            <Kpi label="Stok ditahan (hold aktif)" value={fmtNum(activeHolds ?? 0)} note="QC, rusak, investigasi, recall" href="/inventory?tab=hold" />
            <Kpi label="Penerimaan belum diposting" value={fmtNum(openReceipts ?? 0)} note="dicek dengan DO Shell" href="/receiving" tone={openReceipts ? "warn" : undefined} />
            <Kpi label="Rekonsiliasi SAP terakhir" value={lastRecon?.accuracy_pct != null ? `${Number(lastRecon.accuracy_pct).toFixed(1)}%` : "–"}
              note={lastRecon ? `${fmtDate(lastRecon.as_of)} · ${fmtNum(lastRecon.open_diffs)} selisih belum dijelaskan` : "belum ada"} href="/inventory?tab=rekonsiliasi"
              tone={lastRecon?.open_diffs ? "warn" : undefined} />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>Okupansi rak · aisle × level</CardTitle>
              <span className={cn("text-sm font-semibold", rackOcc.pct > 0.85 ? "text-warn" : "text-steel-700")}>
                Total {Math.round(rackOcc.pct * 100)}% · {fmtNum(rackOcc.occ)}/{fmtNum(rackOcc.total)} posisi
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              <table className="w-full table-fixed border-separate border-spacing-[3px] text-center text-sm">
                <thead><tr className="text-xs text-steel-500">
                  <th className="w-12 text-left font-medium">Aisle</th>
                  {LEVELS.map((lv) => <th key={lv} className="font-medium">Level {lv}</th>)}
                  <th className="font-medium">Total</th>
                </tr></thead>
                <tbody>
                  {grid.map((g) => (
                    <tr key={g.zone}>
                      <th scope="row" className="text-left font-cond text-base font-semibold">{g.zone}</th>
                      {g.cells.map((c) => {
                        const st = occStep(c.pct);
                        return (
                          <td key={c.level} className={cn("rounded p-0 font-semibold tabular", c.total ? st.fg : "text-steel-300")}
                            style={{ background: c.total ? st.bg : undefined }}>
                            {c.total ? (
                              <Link href={`/inventory?aisle=${g.zone}&level=${c.level}`} className="block rounded py-2 hover:ring-2 hover:ring-plate"
                                title={`${g.zone} level ${c.level}: ${c.occ}/${c.total} posisi terisi, ${c.total - c.occ} kosong. Klik untuk detail.`}>
                                {Math.round(c.pct * 100)}%
                              </Link>
                            ) : <span className="block py-2">–</span>}
                          </td>
                        );
                      })}
                      <td className="p-0 font-semibold tabular text-steel-700">
                        <Link href={`/inventory?aisle=${g.zone}`} className="block rounded py-2 hover:bg-paper hover:ring-1 hover:ring-ckb" title={`${g.zone}: ${g.all.occ}/${g.all.total} posisi. Klik untuk detail.`}>{Math.round(g.all.pct * 100)}%</Link>
                      </td>
                    </tr>
                  ))}
                  <tr className="text-steel-700">
                    <th scope="row" className="text-left text-xs font-medium">Total</th>
                    {levelTotals.map((c, i) => (
                      <td key={LEVELS[i]} className="p-0 text-xs font-semibold tabular">
                        <Link href={`/inventory?level=${LEVELS[i]}`} className="block rounded py-1 hover:bg-paper hover:ring-1 hover:ring-ckb" title={`Level ${LEVELS[i]}: ${c.occ}/${c.total} posisi. Klik untuk detail.`}>{Math.round(c.pct * 100)}%</Link>
                      </td>
                    ))}
                    <td className="py-1 text-xs font-semibold tabular">{Math.round(rackOcc.pct * 100)}%</td>
                  </tr>
                </tbody>
              </table>
              <div className="flex flex-wrap items-center gap-2 text-xs text-steel-500">
                <span>Posisi terisi:</span>
                {OCC_STEPS.map((st, i) => (
                  <span key={st.min} className="inline-flex items-center gap-1">
                    <span className="inline-block h-3 w-5 rounded-sm" style={{ background: st.bg }} />
                    {Math.round(st.min * 100)}{i < OCC_STEPS.length - 1 ? `–${Math.round(OCC_STEPS[i + 1].min * 100)}%` : "%+"}
                  </span>
                ))}
              </div>
              <p className="text-xs text-steel-500">Klik sel, total aisle atau total level untuk melihat isi dan posisi kosongnya. Sehat: 80–85% terisi. Di atas 85% gudang mulai sesak (putaway &amp; picking lebih lambat). Arahkan kursor ke sel untuk jumlah posisi.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>Kalender expired</CardTitle>
              <nav className="flex rounded-md border border-steel-300 text-xs" aria-label="Rentang kalender">
                {CAL_RANGES.map((y) => (
                  <Link key={y} href={`/dashboard?kalender=${y}`} scroll={false} aria-current={y === calYears ? "true" : undefined}
                    className={cn("px-2.5 py-1 first:rounded-l-md last:rounded-r-md", y === calYears ? "bg-ckb text-white" : "hover:bg-steel-100")}>
                    {y} th
                  </Link>
                ))}
              </nav>
              <span className="w-full text-sm text-steel-700">{fmtNum(nextCal)} karton expired dalam {calYears} tahun · per {byQuarter ? "kuartal" : "bulan"}</span>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex h-40 items-end gap-[3px] border-b border-steel-300" role="img" aria-label={`Karton yang expired per ${byQuarter ? "kuartal" : "bulan"}, ${calYears} tahun ke depan`}>
                {months.map((m) => (
                  <div key={m.ym} className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                    title={`${m.full}: ${fmtNum(m.qty)} karton, ${m.skus.size} SKU`}>
                    {m.qty > 0 && <span className="text-[9px] font-semibold tabular text-steel-700">{fmtNum(m.qty)}</span>}
                    <div className={cn("w-full max-w-5 rounded-t", m.ym === thisMonth ? "bg-warn" : "bg-ckb-light")}
                      style={{ height: m.qty ? `max(3px, ${(m.qty / monthMax) * 85}%)` : 0 }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-[3px] text-[10px] text-steel-500">
                {months.map((m, i) => {
                  // Every label up to 12 bars; with more, every third bar plus each year start. Year under the first bar and each year start.
                  const show = months.length <= 12 || i === 0 || m.yearStart || i % 3 === 0;
                  return (
                    <span key={m.ym} className={cn("flex-1 overflow-visible whitespace-nowrap text-center", m.yearStart && "font-semibold text-steel-700")}>
                      {show ? m.label : ""}{i === 0 || m.yearStart ? <><br />{m.year}</> : null}
                    </span>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className={cn("rounded-md p-2", expiredQty ? "bg-bad/10" : "bg-paper")}>
                  <div className={cn("font-semibold tabular", expiredQty && "text-bad")}>{fmtNum(expiredQty)}</div><div className="text-xs text-steel-500">sudah expired</div>
                </div>
                <div className="rounded-md bg-paper p-2"><div className="font-semibold tabular">{fmtNum(laterQty)}</div><div className="text-xs text-steel-500">expired setelah {calYears} tahun</div></div>
                <div className="rounded-md bg-paper p-2"><div className="font-semibold tabular">{fmtNum(noDateQty)}</div><div className="text-xs text-steel-500">tanpa tanggal expired</div></div>
              </div>
              <p className="text-xs text-steel-500">{byQuarter ? "Kuartal" : "Bulan"} ini berwarna kuning. Arahkan kursor ke batang untuk periode, jumlah karton dan SKU. Detail per SKU di <Link className="underline" href="/inventory">Inventory</Link>.</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Keterisian per aisle</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {zones.map((z) => (
                <Link key={z.zone} href={`/inventory?aisle=${z.zone}`} title={`Lihat isi dan posisi kosong aisle ${z.zone}`}
                  className="-mx-2 grid grid-cols-[3rem_1fr_7rem] items-center gap-3 rounded-md px-2 py-1 text-sm hover:bg-paper hover:ring-1 hover:ring-ckb">
                  <span className="font-cond text-lg font-semibold">{z.zone}</span>
                  <div className="h-5 rounded bg-steel-100"><div className="h-5 rounded bg-ckb" style={{ width: `${z.pct * 100}%` }} /></div>
                  <span className="text-right tabular">{Math.round(z.pct * 100)}% · {z.occ}/{z.total} ›</span>
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Stok per kelas ABC</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {abc.map((a) => (
                <Link key={a.k} href={`/inventory?abc=${encodeURIComponent(a.k)}&sort=qty`} title={`Lihat ${a.skus} SKU kelas ${a.k === "–" ? "tanpa kelas" : a.k} di Inventory`}
                  className="-mx-2 grid grid-cols-[3rem_1fr_9rem] items-center gap-3 rounded-md px-2 py-1 text-sm hover:bg-paper hover:ring-1 hover:ring-ckb">
                  <span className="font-cond text-lg font-semibold">{a.k === "–" ? "Tanpa" : a.k}</span>
                  <div className="h-5 rounded bg-steel-100"><div className="h-5 rounded bg-plate" style={{ width: `${(a.qty / Math.max(totalQty, 1)) * 100}%` }} /></div>
                  <span className="text-right tabular">{fmtNum(a.qty)} unit · {a.skus} SKU ›</span>
                </Link>
              ))}
              <p className="text-xs text-steel-500">Klik kelas untuk melihat SKU-nya di Inventory. Kelas ABC berdasarkan frekuensi baris picking. Hitung ulang di Pengaturan setelah data mutasi cukup.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Top 10 SKU menurut stok</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>SKU</Th><Th>Deskripsi</Th><Th className="text-right">Stok</Th><Th className="text-right">Palet (setara)</Th><Th className="text-right">Bin</Th></tr></thead>
              <tbody>{topSkus.map((t) => (
                <tr key={t.sku}>
                  <Td><Link className="font-semibold underline" href={`/inventory?q=${t.sku}`}>{t.sku}</Link></Td><Td>{t.description}</Td>
                  <Td className="text-right tabular">{fmtNum(t.qty)} {t.uom}</Td><Td className="text-right tabular">{fmtNum(t.pallets, 1)}</Td><Td className="text-right tabular">{t.bins.size}</Td>
                </tr>
              ))}</tbody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Stok expired dan mendekati expired</CardTitle></CardHeader>
          <CardContent>
            {risky.length === 0 ? <p className="text-sm text-steel-500">Tidak ada stok yang expired atau expired dalam {NEAR_EXPIRY_DAYS} hari.</p> : (
              <Table>
                <thead><tr><Th>Bin</Th><Th>SKU</Th><Th>Deskripsi</Th><Th>Batch</Th><Th className="text-right">Qty</Th><Th>Expired</Th><Th className="text-right">Sisa hari</Th><Th>Status</Th></tr></thead>
                <tbody>{risky.map((r, i) => (
                  <tr key={i}>
                    <Td><Link className="font-semibold underline" href={`/bin/${r.bin_code}`}>{r.bin_code}</Link></Td><Td>{r.sku}</Td><Td>{r.description}</Td><Td>{r.batch_lot || "–"}</Td>
                    <Td className="text-right">{fmtNum(r.quantity)} {r.uom}</Td><Td>{fmtDate(r.expiry_date)}</Td><Td className="text-right">{r.days_remaining}</Td><Td><ExpiryBadge status={expiryStatus(r.expiry_date)} /></Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Kpi({ label, value, note, tone, href }: { label: string; value: string; note: string; tone?: "bad" | "warn"; href?: string }) {
  const body = (
    <>
      <div className="text-sm text-steel-500">{label}</div>
      <div className="font-cond text-4xl font-semibold tabular">{value}</div>
      <div className="text-xs text-steel-500">{note}</div>
    </>
  );
  const cls = cn("block rounded-lg bg-white p-4", tone === "bad" && "border-l-4 border-bad", tone === "warn" && "border-l-4 border-warn", href && "hover:ring-2 hover:ring-ckb");
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

