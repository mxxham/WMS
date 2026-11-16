"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Boxes, CalendarClock, Download, Info, MapPin, OctagonAlert, PackageCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, ExpiryBadge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { expiryStatus } from "@/config/warehouse";
import { batchMfgDate, MISMATCH_LABEL } from "@/lib/batch-code";
import { LOC_LABEL, type LocType } from "@/lib/inventory-view";
import {
  MANUAL_SHIPMENT, MOVE_LABEL, binHint, expiryRows, historyRows, jakartaDateTime, positionRows, shipmentRows, traceFileName, traceSheets,
  type Alert, type ExpiryGroup, type HistoryRow, type Position, type SheetRow, type ShipRow, type SkuSummary, type TraceData, type TraceHold, type TraceTask,
} from "@/lib/trace";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

type Tab = "posisi" | "kirim" | "riwayat" | "hold";
const PAGE = 200;

/** Loaded on click: the Excel library (~140 kB) is not part of the page. */
async function download(sheets: Record<string, SheetRow[]>, filename: string) {
  const { saveSheets } = await import("@/lib/save-xlsx");
  saveSheets(sheets, filename, "Tidak ada data");
}

const daysText = (d: number | null) => (d === null ? "tanpa tanggal" : d < 0 ? `lewat ${fmtNum(-d)} hari` : d === 0 ? "expired hari ini" : `${fmtNum(d)} hari lagi`);
const signed = (v: number) => `${v > 0 ? "+" : ""}${fmtNum(v)}`;

// ---- Recent lookups (this device only) ------------------------------------

const RECENT_KEY = "trace.recent.v1";
type Recent = { batch: string; sku: string };
function readRecent(): Recent[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is Recent => !!x && typeof x.batch === "string" && typeof x.sku === "string").slice(0, 8) : [];
  } catch { return []; }
}
export const traceHref = (batch: string, sku = "") => `/trace?batch=${encodeURIComponent(batch)}${sku ? `&sku=${encodeURIComponent(sku)}` : ""}`;

/** The last batches traced on this device, as shortcuts. Renders nothing until there is one. */
export function RecentTraces({ remember }: { remember?: Recent }) {
  const [list, setList] = useState<Recent[]>([]);
  const rb = remember?.batch, rs = remember?.sku ?? "";
  useEffect(() => {
    let next = readRecent();
    if (rb) {
      next = [{ batch: rb, sku: rs }, ...next.filter((x) => !(x.batch === rb && x.sku === rs))].slice(0, 8);
      try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private window: shortcuts are a convenience */ }
    }
    setList(next);
  }, [rb, rs]);
  const shown = list.filter((x) => !(x.batch === rb && x.sku === rs));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-steel-500">Terakhir dilacak:</span>
      {shown.map((x) => (
        <Link key={`${x.batch}|${x.sku}`} href={traceHref(x.batch, x.sku)}
          className="rounded-full border border-steel-300 bg-white px-3 py-1 font-mono text-xs hover:border-ckb hover:text-ckb">
          {x.batch}{x.sku ? <span className="text-steel-500"> · {x.sku}</span> : null}
        </Link>
      ))}
    </div>
  );
}

// ---- The trace ------------------------------------------------------------

export function TraceView({ data, nearDays, initialTab }: { data: TraceData; nearDays: number; initialTab?: string }) {
  const { batch, positions, summary, expiries, ships, destinations, history, tasks, holds, alerts } = data;
  const [tab, setTab] = useState<Tab>(["posisi", "kirim", "riwayat", "hold"].includes(initialTab ?? "") ? (initialTab as Tab) : "posisi");
  const activeHolds = holds.filter((h) => h.status === "ACTIVE").length;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "posisi", label: "Posisi sekarang", count: positions.length },
    { key: "kirim", label: "Dikirim ke", count: ships.length },
    { key: "riwayat", label: "Riwayat", count: history.length },
    { key: "hold", label: "Hold & pesanan wave", count: activeHolds + tasks.length },
  ];

  return (
    <div className="space-y-4">
      <BatchHeader data={data} />
      <Kpis data={data} nearDays={nearDays} />
      {alerts.length > 0 && <Alerts alerts={alerts} />}
      {summary.length > 1 && <SkuTable summary={summary} batch={batch} />}

      <div>
        <div role="tablist" aria-label="Bagian lacak batch" className="flex gap-1 overflow-x-auto rounded-t-lg border border-b-0 border-steel-100 bg-white px-2">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" id={`trace-tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`trace-panel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={cn("whitespace-nowrap border-b-2 px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ckb",
                tab === t.key ? "border-ckb font-semibold text-ckb" : "border-transparent text-steel-500 hover:text-steel")}>
              {t.label}
              <span className={cn("ml-1.5 rounded-full px-1.5 text-xs tabular", tab === t.key ? "bg-ckb text-white" : "bg-steel-100 text-steel-700")}>{fmtNum(t.count)}</span>
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`trace-panel-${tab}`} aria-labelledby={`trace-tab-${tab}`} className="rounded-b-lg border border-steel-100 bg-white p-4">
          {tab === "posisi" && <PositionsPanel positions={positions} expiries={expiries} batch={batch} />}
          {tab === "kirim" && <ShipmentsPanel ships={ships} destinations={destinations} batch={batch} />}
          {tab === "riwayat" && <HistoryPanel history={history} batch={batch} />}
          {tab === "hold" && <HoldsPanel holds={holds} tasks={tasks} />}
        </div>
      </div>
    </div>
  );
}

// ---- Header: what batch this is -------------------------------------------

function BatchHeader({ data }: { data: TraceData }) {
  const { batch, summary, skuFilter } = data;
  const mfg = batchMfgDate(batch);
  const plant = mfg ? batch.trim().toUpperCase().slice(-2) : null;
  const one = summary.length === 1 ? summary[0] : null;
  return (
    <div className="overflow-hidden rounded-lg bg-jeir-bar text-white">
      <div className="flex flex-wrap items-start justify-between gap-4 p-4 lg:p-5">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-ckb-tint">Batch</p>
          <p className="break-all font-cond text-3xl font-semibold leading-tight lg:text-4xl">{batch}</p>
          {one
            ? <p className="mt-1 text-sm text-white/90"><span className="font-semibold">{one.sku}</span> · {one.description}</p>
            : <p className="mt-1 text-sm text-white/90">{fmtNum(summary.length)} SKU memakai kode batch ini</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {mfg
              ? <><Chip>Produksi {fmtDate(mfg)}</Chip><Chip>Pabrik {plant}</Chip></>
              : <Chip>Kode batch tanpa tanggal produksi</Chip>}
            {one?.uom && <Chip>Satuan {one.uom}</Chip>}
            {one?.upp ? <Chip>{fmtNum(Number(one.upp))} per palet</Chip> : null}
            {skuFilter && <Link href={traceHref(batch)} className="rounded-full bg-white/15 px-2.5 py-1 underline hover:bg-white/25">Tampilkan semua SKU batch ini</Link>}
          </div>
        </div>
        <Button variant="accent" onClick={() => void download(traceSheets(data), traceFileName(batch))}>
          <Download className="h-4 w-4" />Unduh Excel lengkap
        </Button>
      </div>
    </div>
  );
}
const Chip = ({ children }: { children: React.ReactNode }) => <span className="rounded-full bg-white/15 px-2.5 py-1">{children}</span>;

// ---- Numbers --------------------------------------------------------------

function Kpis({ data, nearDays }: { data: TraceData; nearDays: number }) {
  const { summary, positions, ships, destinations, expiries } = data;
  const t = summary.reduce((a, s) => ({
    onHand: a.onHand + s.onHand, reserved: a.reserved + s.reserved, held: a.held + s.held, available: a.available + s.available,
    shipped: a.shipped + s.shipped,
  }), { onHand: 0, reserved: 0, held: 0, available: 0, shipped: 0 });
  const pallets = positions.some((p) => p.pallets !== null) ? positions.reduce((s, p) => s + (p.pallets ?? 0), 0) : null;
  const bins = new Set(positions.map((p) => p.bin_code)).size;
  const uom = summary.length === 1 ? summary[0].uom ?? "" : "";
  const first = [...expiries].sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999"))[0];
  const realShips = new Set(ships.filter((s) => s.shipment !== MANUAL_SHIPMENT).map((s) => s.shipment)).size;
  const total = Math.max(t.shipped + t.onHand, 1);
  const pct = (v: number) => `${(v / total) * 100}%`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<Boxes className="h-4 w-4" />} label="Stok sekarang" value={fmtNum(t.onHand)} unit={uom}
          sub={pallets !== null ? `${fmtNum(pallets, 1)} palet setara` : undefined} />
        <Kpi icon={<PackageCheck className="h-4 w-4" />} label="Tersedia" value={fmtNum(t.available)} unit={uom} tone={t.onHand > 0 && t.available === 0 ? "bad" : undefined}
          sub={t.reserved + t.held > 0 ? `${fmtNum(t.reserved)} dipesan · ${fmtNum(t.held)} ditahan` : "tidak ada yang dipesan atau ditahan"} />
        <Kpi icon={<MapPin className="h-4 w-4" />} label="Bin" value={fmtNum(bins)} sub={bins ? `${fmtNum(positions.length)} baris stok` : "tidak ada di gudang"} />
        <Kpi icon={<CalendarClock className="h-4 w-4" />} label="Expired terdekat" value={first?.expiry ? fmtDate(first.expiry) : "–"}
          tone={first?.days != null ? (first.days < 0 ? "bad" : first.days <= nearDays ? "warn" : undefined) : undefined}
          sub={first ? daysText(first.days) : "tidak ada stok"} small />
        <Kpi icon={<Truck className="h-4 w-4" />} label="Sudah dikirim" value={fmtNum(t.shipped)} unit={uom}
          sub={`${fmtNum(realShips)} shipment · ${fmtNum(destinations.length)} tujuan`} />
        <Kpi icon={<Info className="h-4 w-4" />} label="Mutasi tercatat" value={fmtNum(data.history.length)}
          sub={data.history.length ? `terakhir ${jakartaDateTime(data.history[data.history.length - 1].created_at)}` : "belum ada"} />
      </div>

      {t.shipped + t.onHand > 0 && (
        <div className="rounded-lg border border-steel-100 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold">Ke mana batch ini pergi</span>
            <span className="text-steel-500">dari {fmtNum(t.shipped + t.onHand)} unit yang pernah ada</span>
          </div>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-steel-100" role="img"
            aria-label={`Dikirim ${fmtNum(t.shipped)}, tersedia ${fmtNum(t.available)}, dipesan ${fmtNum(t.reserved)}, ditahan ${fmtNum(t.held)}`}>
            <div className="bg-steel-500" style={{ width: pct(t.shipped) }} />
            <div className="bg-ok" style={{ width: pct(t.available) }} />
            <div className="bg-ckb-light" style={{ width: pct(t.reserved) }} />
            <div className="bg-warn" style={{ width: pct(t.held) }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <Legend className="bg-steel-500" label="Dikirim" value={t.shipped} />
            <Legend className="bg-ok" label="Di gudang, tersedia" value={t.available} />
            <Legend className="bg-ckb-light" label="Dipesan wave" value={t.reserved} />
            <Legend className="bg-warn" label="Ditahan / karantina" value={t.held} />
          </div>
        </div>
      )}
    </div>
  );
}
function Kpi({ icon, label, value, unit, sub, tone, small }: { icon: React.ReactNode; label: string; value: string; unit?: string; sub?: string; tone?: "bad" | "warn"; small?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-white p-3", tone === "bad" ? "border-bad/50" : tone === "warn" ? "border-warn/60" : "border-steel-100")}>
      <div className="flex items-center gap-1.5 text-xs text-steel-500">{icon}{label}</div>
      <div className={cn("mt-1 font-cond font-semibold tabular", small ? "text-xl" : "text-2xl", tone === "bad" && "text-bad")}>
        {value}{unit ? <span className="ml-1 text-xs font-normal text-steel-500">{unit}</span> : null}
      </div>
      {sub && <div className={cn("mt-0.5 text-xs", tone === "bad" ? "text-bad" : "text-steel-500")}>{sub}</div>}
    </div>
  );
}
const Legend = ({ className, label, value }: { className: string; label: string; value: number }) => (
  <span className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-sm", className)} />{label} <b className="tabular">{fmtNum(value)}</b></span>
);

// ---- Alerts ---------------------------------------------------------------

const ALERT_STYLE: Record<Alert["tone"], string> = {
  bad: "border-bad bg-bad/5",
  warn: "border-warn bg-warn/10",
  info: "border-ckb-light bg-ckb-tint/20",
};
function Alerts({ alerts }: { alerts: Alert[] }) {
  return (
    <ul className="space-y-2" aria-label="Yang perlu diperhatikan">
      {alerts.map((a, i) => (
        <li key={i} className={cn("flex items-start gap-2 rounded-md border-l-4 px-3 py-2 text-sm", ALERT_STYLE[a.tone])}>
          {a.tone === "bad" ? <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : a.tone === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-ckb" />}
          <span>{a.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ---- Several SKUs under one batch code ------------------------------------

function SkuTable({ summary, batch }: { summary: SkuSummary[]; batch: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>Per SKU</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <thead><tr>
            <Th>SKU</Th><Th>Deskripsi</Th><Th className="text-right">Saldo awal</Th><Th className="text-right">Diterima</Th><Th className="text-right">Dikirim</Th>
            <Th className="text-right">Penyesuaian</Th><Th className="text-right">Stok sekarang</Th><Th className="text-right">Tersedia</Th><Th className="text-right">Bin</Th><Th>Expired terdekat</Th>
          </tr></thead>
          <tbody>{summary.map((s) => (
            <tr key={s.sku}>
              <Td><Link className="font-semibold underline" href={traceHref(batch, s.sku)} title="Lacak hanya SKU ini">{s.sku}</Link></Td>
              <Td className="text-xs">{s.description}</Td>
              <Td className="text-right tabular">{fmtNum(s.opening)}</Td><Td className="text-right tabular">{fmtNum(s.received)}</Td>
              <Td className="text-right tabular">{fmtNum(s.shipped)}</Td><Td className="text-right tabular">{signed(s.adjusted)}</Td>
              <Td className="text-right font-semibold tabular">{fmtNum(s.onHand)} <span className="text-xs font-normal text-steel-500">{s.uom}</span></Td>
              <Td className="text-right tabular">{fmtNum(s.available)}</Td><Td className="text-right tabular">{fmtNum(s.bins)}</Td>
              <Td className="whitespace-nowrap text-xs">{s.expiries[0]?.expiry ? <>{fmtDate(s.expiries[0].expiry)} <ExpiryBadge status={expiryStatus(s.expiries[0].expiry)} /></> : "–"}</Td>
            </tr>
          ))}</tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Tab 1: where it is now ------------------------------------------------

type PosSort = "expiry" | "bin" | "qty" | "age";
const expKey = (g: { sku: string; expiry: string | null }) => `${g.sku}|${g.expiry ?? ""}`;

function PositionsPanel({ positions, expiries, batch }: { positions: Position[]; expiries: ExpiryGroup[]; batch: string }) {
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState<LocType | "all">("all");
  const [exp, setExp] = useState<string>("all");
  const [sort, setSort] = useState<PosSort>("expiry");
  const [onlyFree, setOnlyFree] = useState(false);
  const multiSku = new Set(positions.map((p) => p.sku)).size > 1;
  const locs = useMemo(() => [...new Set(positions.map((p) => p.loc))], [positions]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return positions.filter((p) =>
      (!needle || p.bin_code.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle))
      && (loc === "all" || p.loc === loc)
      && (exp === "all" || expKey({ sku: p.sku, expiry: p.expiry_date }) === exp)
      && (!onlyFree || p.available > 0))
      .sort((a, b) =>
        sort === "bin" ? a.bin_code.localeCompare(b.bin_code)
        : sort === "qty" ? b.quantity - a.quantity || a.bin_code.localeCompare(b.bin_code)
        : sort === "age" ? (b.ageDays ?? -1) - (a.ageDays ?? -1) || a.bin_code.localeCompare(b.bin_code)
        : (a.expiry_date ?? "9999").localeCompare(b.expiry_date ?? "9999") || a.bin_code.localeCompare(b.bin_code));
  }, [positions, q, loc, exp, sort, onlyFree]);

  if (positions.length === 0) {
    return <Empty title="Batch ini tidak ada di gudang" text="Tidak ada stok yang tercatat dengan kode batch ini. Lihat tab Dikirim ke dan Riwayat untuk tahu ke mana perginya." />;
  }
  const tot = rows.reduce((a, p) => ({ qty: a.qty + p.quantity, reserved: a.reserved + p.reserved, held: a.held + p.held, available: a.available + p.available, pallets: a.pallets + (p.pallets ?? 0) }),
    { qty: 0, reserved: 0, held: 0, available: 0, pallets: 0 });

  return (
    <div className="space-y-4">
      {/* Each expiry date with its bins: the answer most lookups are after. Click one to list only its bins. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {expiries.map((g) => {
          const k = expKey(g), on = exp === k;
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setExp(on ? "all" : k)}
              className={cn("rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb",
                on ? "border-ckb bg-ckb-tint/25" : "border-steel-100 bg-paper hover:border-ckb-light")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-cond text-lg font-semibold">{g.expiry ? fmtDate(g.expiry) : "Tanpa tanggal expired"}</span>
                <ExpiryBadge status={expiryStatus(g.expiry)} />
              </div>
              <div className="mt-0.5 text-xs text-steel-500">
                {multiSku && <span className="font-semibold text-steel-700">{g.sku} · </span>}{daysText(g.days)} · <b className="tabular text-steel">{fmtNum(g.qty)}</b> unit di {fmtNum(g.bins.length)} bin
              </div>
              {g.mismatch && g.expected && <div className="mt-1 text-xs font-medium text-bad">Kode batch: seharusnya {fmtDate(g.expected)} ({MISMATCH_LABEL[g.mismatch]})</div>}
              <div className="mt-2 flex flex-wrap gap-1">
                {g.bins.slice(0, 12).map((b) => (
                  <span key={b.code} className="rounded border border-steel-300 bg-white px-1.5 py-0.5 font-mono text-[11px]">{b.code} <span className="text-steel-500">{fmtNum(b.qty)}</span></span>
                ))}
                {g.bins.length > 12 && <span className="px-1 py-0.5 text-[11px] text-steel-500">+{fmtNum(g.bins.length - 12)} bin lagi</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-44 flex-1"><Label htmlFor="pos-q">Cari bin{multiSku ? " atau SKU" : ""}</Label>
          <Input id="pos-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="mis. CA10A02" /></div>
        {locs.length > 1 && (
          <div><Label htmlFor="pos-loc">Lokasi</Label>
            <Select id="pos-loc" value={loc} onChange={(e) => setLoc(e.target.value as LocType | "all")}>
              <option value="all">Semua</option>{locs.map((l) => <option key={l} value={l}>{LOC_LABEL[l]}</option>)}
            </Select></div>
        )}
        <div><Label htmlFor="pos-exp">Expired</Label>
          <Select id="pos-exp" value={exp} onChange={(e) => setExp(e.target.value)}>
            <option value="all">Semua tanggal</option>
            {expiries.map((g) => <option key={expKey(g)} value={expKey(g)}>{multiSku ? `${g.sku} · ` : ""}{g.expiry ? fmtDate(g.expiry) : "Tanpa tanggal"}</option>)}
          </Select></div>
        <div><Label htmlFor="pos-sort">Urutkan</Label>
          <Select id="pos-sort" value={sort} onChange={(e) => setSort(e.target.value as PosSort)}>
            <option value="expiry">Expired terdekat</option><option value="bin">Kode bin</option><option value="qty">Qty terbanyak</option><option value="age">Paling lama di gudang</option>
          </Select></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />Hanya yang tersedia</label>
        <Button variant="outline" disabled={rows.length === 0} className="ml-auto"
          onClick={() => void download({ "Posisi sekarang": positionRows(rows), "Per expired": expiryRows(expiries) }, traceFileName(batch, "posisi"))}>
          <Download className="h-4 w-4" />Excel posisi
        </Button>
      </div>

      {rows.length === 0 ? <p className="text-sm text-steel-500">Tidak ada bin untuk filter ini.</p> : (
        <>
          <div className="space-y-2 md:hidden">
            {rows.map((p) => (
              <div key={`${p.bin_code}|${p.sku}|${p.expiry_date}`} className="rounded-lg border border-steel-100 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link className="font-mono text-base font-semibold underline" href={`/bin/${encodeURIComponent(p.bin_code)}`}>{p.bin_code}</Link>
                    {p.bin_status === "blocked" && <span className="ml-1 text-xs text-bad">diblokir</span>}
                    <div className="text-xs text-steel-500">{binHint(p)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-cond text-xl font-semibold tabular">{fmtNum(p.quantity)} <span className="text-xs font-normal text-steel-500">{p.uom}</span></div>
                    {p.pallets !== null && <div className="text-xs text-steel-500">{fmtNum(p.pallets, 1)} palet</div>}
                  </div>
                </div>
                {multiSku && <div className="mt-1 text-xs"><b>{p.sku}</b> · {p.description}</div>}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">{p.expiry_date ? fmtDate(p.expiry_date) : "Tanpa expired"}</span><ExpiryBadge status={expiryStatus(p.expiry_date)} />
                  <span className="text-steel-500">{daysText(p.days_remaining)}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <Mini label="Tersedia" value={fmtNum(p.available)} strong />
                  <Mini label="Dipesan" value={p.reserved ? fmtNum(p.reserved) : "–"} />
                  <Mini label="Ditahan" value={p.held ? fmtNum(p.held) : "–"} warn={p.held > 0} />
                </div>
                {(p.waves.length > 0 || p.hold_reasons || p.received_date) && (
                  <div className="mt-2 text-xs text-steel-500">
                    {p.waves.length > 0 && <div>Wave: {p.waves.join(", ")}</div>}
                    {p.hold_reasons && <div className="text-warn">{p.hold_reasons}</div>}
                    {p.received_date && <div>Diterima {fmtDate(p.received_date)}{p.ageDays !== null ? ` · ${fmtNum(p.ageDays)} hari di gudang` : ""}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            <Table sticky>
              <thead><tr>
                <Th>Bin</Th><Th>Lokasi</Th>{multiSku && <Th>SKU</Th>}<Th>Expired</Th><Th className="text-right">Sisa hari</Th><Th className="text-right">Qty</Th>
                <Th className="text-right">Palet</Th><Th className="text-right">Dipesan</Th><Th className="text-right">Ditahan</Th><Th className="text-right">Tersedia</Th>
                <Th>Terima</Th><Th className="text-right">Lama</Th>
              </tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={`${p.bin_code}|${p.sku}|${p.expiry_date}`} className="hover:bg-paper">
                  <Td><Link className="font-mono font-semibold underline" href={`/bin/${encodeURIComponent(p.bin_code)}`}>{p.bin_code}</Link>
                    {p.bin_status === "blocked" && <span className="ml-1 text-xs text-bad">diblokir</span>}</Td>
                  <Td className="text-xs">{LOC_LABEL[p.loc]}{p.rack && <span className="block text-steel-500">{binHint(p)}</span>}</Td>
                  {multiSku && <Td><span className="font-semibold">{p.sku}</span><span className="block text-xs text-steel-500">{p.description}</span></Td>}
                  <Td className="whitespace-nowrap text-xs"><span className="font-semibold">{fmtDate(p.expiry_date)}</span> <ExpiryBadge status={expiryStatus(p.expiry_date)} /></Td>
                  <Td className={cn("text-right tabular", p.days_remaining !== null && p.days_remaining < 0 && "font-semibold text-bad")}>{p.days_remaining === null ? "–" : fmtNum(p.days_remaining)}</Td>
                  <Td className="text-right font-semibold tabular">{fmtNum(p.quantity)} <span className="text-xs font-normal text-steel-500">{p.uom}</span></Td>
                  <Td className="text-right tabular">{p.pallets === null ? "–" : fmtNum(p.pallets, 1)}</Td>
                  <Td className="text-right tabular">{p.reserved ? fmtNum(p.reserved) : "–"}
                    {p.waves.length > 0 && <span className="block text-[11px] text-steel-500">{p.waves.join(", ")}</span>}
                    {p.incoming > 0 && <span className="block text-[11px] text-ok">+{fmtNum(p.incoming)} masuk</span>}</Td>
                  <Td className={cn("text-right tabular", p.held > 0 && "text-warn")}>{p.held ? fmtNum(p.held) : "–"}{p.hold_reasons && <span className="block text-[11px]">{p.hold_reasons}</span>}</Td>
                  <Td className={cn("text-right font-semibold tabular", p.available === 0 && "text-bad")}>{fmtNum(p.available)}</Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(p.received_date)}</Td>
                  <Td className="whitespace-nowrap text-right text-xs tabular">{p.ageDays === null ? "–" : `${fmtNum(p.ageDays)} hr`}</Td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="bg-paper font-semibold">
                <Td colSpan={multiSku ? 5 : 4}>{fmtNum(rows.length)} baris · {fmtNum(new Set(rows.map((p) => p.bin_code)).size)} bin</Td>
                <Td className="text-right tabular">{fmtNum(tot.qty)}</Td><Td className="text-right tabular">{fmtNum(tot.pallets, 1)}</Td>
                <Td className="text-right tabular">{fmtNum(tot.reserved)}</Td><Td className="text-right tabular">{fmtNum(tot.held)}</Td>
                <Td className="text-right tabular">{fmtNum(tot.available)}</Td><Td colSpan={2} />
              </tr></tfoot>
            </Table>
          </div>
          <p className="text-xs text-steel-500 md:hidden">{fmtNum(rows.length)} baris · total {fmtNum(tot.qty)} · tersedia {fmtNum(tot.available)}</p>
        </>
      )}
      <p className="text-xs text-steel-500">Dipesan = akan diambil tugas wave yang belum dikerjakan. Ditahan = stok on hold atau di karantina. Tersedia = Qty dikurangi keduanya. Lama = hari sejak tanggal terima.</p>
    </div>
  );
}
const Mini = ({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) => (
  <div className="rounded bg-paper px-2 py-1"><div className="text-[11px] text-steel-500">{label}</div><div className={cn("tabular", strong && "font-semibold", warn && "text-warn")}>{value}</div></div>
);

// ---- Tab 2: where it went --------------------------------------------------

function ShipmentsPanel({ ships, destinations, batch }: { ships: ShipRow[]; destinations: TraceData["destinations"]; batch: string }) {
  const [q, setQ] = useState("");
  const [dest, setDest] = useState("all");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ships.filter((s) =>
      (dest === "all" || (s.destination || "") === dest)
      && (!needle || [s.shipment, s.sku, s.destination, s.orders, s.truck ?? "", s.bins.join(" ")].some((v) => v.toLowerCase().includes(needle))));
  }, [ships, q, dest]);
  const destNames = useMemo(() => [...new Set(ships.map((s) => s.destination).filter(Boolean))].sort(), [ships]);

  if (ships.length === 0) return <Empty title="Belum pernah dikirim" text="Batch ini belum pernah dipick untuk shipment mana pun." />;
  const qty = rows.reduce((s, r) => s + r.qty, 0);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Penerima batch ini</h3>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {destinations.map((d) => (
            <div key={d.destination} className="flex items-center justify-between gap-3 rounded-lg border border-steel-100 bg-paper px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold" title={d.destination}>{d.destination}</div>
                <div className="text-xs text-steel-500">{fmtNum(d.shipments)} shipment · {d.first === d.last ? fmtDate(d.first) : `${fmtDate(d.first)} – ${fmtDate(d.last)}`}</div>
              </div>
              <div className="font-cond text-xl font-semibold tabular">{fmtNum(d.qty)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-44 flex-1"><Label htmlFor="ship-q">Cari shipment, tujuan, no order, truk</Label>
          <Input id="ship-q" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {destNames.length > 1 && (
          <div className="max-w-xs"><Label htmlFor="ship-dest">Tujuan</Label>
            <Select id="ship-dest" value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="all">Semua tujuan</option>{destNames.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select></div>
        )}
        <Button variant="outline" className="ml-auto" disabled={rows.length === 0}
          onClick={() => void download({ "Dikirim ke": shipmentRows(rows) }, traceFileName(batch, "dikirim"))}>
          <Download className="h-4 w-4" />Excel pengiriman
        </Button>
      </div>

      {rows.length === 0 ? <p className="text-sm text-steel-500">Tidak ada shipment untuk filter ini.</p> : (
        <>
          <div className="space-y-2 md:hidden">
            {rows.map((s) => (
              <div key={`${s.shipment}|${s.sku}`} className="rounded-lg border border-steel-100 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-semibold">{s.shipment}</div><div className="text-xs text-steel-500">{fmtDate(s.date)}{s.wave ? ` · NO ${s.wave}` : ""}</div></div>
                  <div className="font-cond text-xl font-semibold tabular">{fmtNum(s.qty)}</div>
                </div>
                <div className="mt-1">{s.destination || "–"}</div>
                <div className="mt-1 text-xs text-steel-500">{s.sku}{s.truck ? ` · ${s.truck}` : ""}{s.orders ? ` · order ${s.orders}` : ""}</div>
                <div className="mt-1 font-mono text-xs text-steel-500">dari {s.bins.join(", ") || "–"}</div>
              </div>
            ))}
          </div>
          <div className="hidden md:block">
            <Table sticky>
              <thead><tr><Th>Shipment</Th><Th>Tanggal</Th><Th>Wave</Th><Th>Tujuan</Th><Th>Truk</Th><Th>No order</Th><Th>SKU</Th><Th className="text-right">Qty</Th><Th>Dari bin</Th><Th>Expired</Th></tr></thead>
              <tbody>{rows.map((s) => (
                <tr key={`${s.shipment}|${s.sku}`} className="hover:bg-paper">
                  <Td className="font-semibold">{s.shipment}</Td><Td className="whitespace-nowrap">{fmtDate(s.date)}</Td>
                  <Td>{s.wave ? <Link className="underline" href={`/waves?date=${s.date}`}>NO {s.wave}</Link> : "–"}</Td>
                  <Td>{s.destination || "–"}</Td><Td>{s.truck ?? "–"}</Td><Td className="text-xs">{s.orders || "–"}</Td><Td>{s.sku}</Td>
                  <Td className="text-right font-semibold tabular">{fmtNum(s.qty)}</Td><Td className="font-mono text-xs">{s.bins.join(", ") || "–"}</Td>
                  <Td className="whitespace-nowrap text-xs">{s.expiries.map((e) => fmtDate(e)).join(", ") || "–"}</Td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="bg-paper font-semibold"><Td colSpan={7}>{fmtNum(rows.length)} baris</Td><Td className="text-right tabular">{fmtNum(qty)}</Td><Td colSpan={2} /></tr></tfoot>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Tab 3: every movement -------------------------------------------------

function HistoryPanel({ history, batch }: { history: HistoryRow[]; batch: string }) {
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [newest, setNewest] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const types = useMemo(() => [...new Set(history.map((h) => h.type))], [history]);
  const multiSku = new Set(history.map((h) => h.sku)).size > 1;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = history.filter((h) =>
      (type === "all" || h.type === type)
      && (!needle || [h.from_bin ?? "", h.to_bin ?? "", h.shipment ?? "", h.note ?? "", h.by_name ?? "", h.user ?? "", h.sku].some((v) => v.toLowerCase().includes(needle))));
    return newest ? f.reverse() : f;
  }, [history, type, q, newest]);

  if (history.length === 0) return <Empty title="Belum ada mutasi" text="Belum ada mutasi yang tercatat dengan kode batch ini." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Jenis mutasi">
          {["all", ...types].map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => { setType(t); setLimit(PAGE); }}
              className={cn("rounded-full border px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb",
                type === t ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white hover:bg-steel-100")}>
              {t === "all" ? "Semua" : MOVE_LABEL[t] ?? t} <span className="tabular opacity-80">{fmtNum(t === "all" ? history.length : history.filter((h) => h.type === t).length)}</span>
            </button>
          ))}
        </div>
        <div className="min-w-44 flex-1"><Label htmlFor="his-q">Cari bin, shipment, petugas, catatan</Label>
          <Input id="his-q" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} /></div>
        <div><Label htmlFor="his-order">Urutan</Label>
          <Select id="his-order" value={newest ? "new" : "old"} onChange={(e) => setNewest(e.target.value === "new")}>
            <option value="new">Terbaru dulu</option><option value="old">Terlama dulu</option>
          </Select></div>
        <Button variant="outline" className="ml-auto" disabled={rows.length === 0}
          onClick={() => void download({ Riwayat: historyRows(newest ? [...rows].reverse() : rows) }, traceFileName(batch, "riwayat"))}>
          <Download className="h-4 w-4" />Excel riwayat
        </Button>
      </div>

      {rows.length === 0 ? <p className="text-sm text-steel-500">Tidak ada mutasi untuk filter ini.</p> : (
        <>
          <div className="space-y-2 md:hidden">
            {rows.slice(0, limit).map((h) => (
              <div key={h.id} className="rounded-lg border border-steel-100 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div><Badge>{MOVE_LABEL[h.type] ?? h.type}</Badge><div className="mt-1 text-xs text-steel-500">{jakartaDateTime(h.created_at)}</div></div>
                  <div className="text-right">
                    <div className={cn("font-cond text-xl font-semibold tabular", h.delta > 0 && "text-ok", h.delta < 0 && "text-bad")}>{h.delta === 0 ? fmtNum(h.quantity) : signed(h.delta)}</div>
                    <div className="text-xs text-steel-500">saldo {fmtNum(h.balance)}</div>
                  </div>
                </div>
                <div className="mt-1 font-mono text-xs">{h.from_bin ?? "–"} → {h.to_bin ?? "–"}</div>
                <div className="mt-1 text-xs text-steel-500">
                  {multiSku ? `${h.sku} · ` : ""}exp {fmtDate(h.expiry_date)}{h.shipment ? ` · ${h.shipment}` : ""} · {h.by_name ?? h.user ?? "sistem"}
                </div>
                {h.note && <div className="mt-1 text-xs">{h.note}</div>}
              </div>
            ))}
          </div>
          <div className="hidden md:block">
            <Table sticky>
              <thead><tr>
                <Th>Waktu</Th><Th>Jenis</Th>{multiSku && <Th>SKU</Th>}<Th>Expired</Th><Th className="text-right">Qty</Th><Th className="text-right">Efek stok</Th><Th className="text-right">Saldo batch</Th>
                <Th>Dari</Th><Th>Ke</Th><Th>Shipment</Th><Th>Oleh</Th><Th>Catatan</Th>
              </tr></thead>
              <tbody>{rows.slice(0, limit).map((h) => (
                <tr key={h.id} className="hover:bg-paper">
                  <Td className="whitespace-nowrap text-xs">{jakartaDateTime(h.created_at)}</Td>
                  <Td><Badge>{MOVE_LABEL[h.type] ?? h.type}</Badge></Td>
                  {multiSku && <Td>{h.sku}</Td>}
                  <Td className="whitespace-nowrap text-xs">{fmtDate(h.expiry_date)}</Td>
                  <Td className="text-right tabular">{fmtNum(h.quantity)}</Td>
                  <Td className={cn("text-right font-semibold tabular", h.delta > 0 && "text-ok", h.delta < 0 && "text-bad", h.delta === 0 && "font-normal text-steel-500")}>{h.delta === 0 ? "0" : signed(h.delta)}</Td>
                  <Td className="text-right tabular">{fmtNum(h.balance)}</Td>
                  <Td className="font-mono text-xs">{h.from_bin ? <Link className="underline" href={`/bin/${encodeURIComponent(h.from_bin)}`}>{h.from_bin}</Link> : "–"}</Td>
                  <Td className="font-mono text-xs">{h.to_bin ? <Link className="underline" href={`/bin/${encodeURIComponent(h.to_bin)}`}>{h.to_bin}</Link> : "–"}</Td>
                  <Td className="text-xs">{h.shipment ?? "–"}{h.wave_no && <span className="block text-steel-500">NO {h.wave_no}</span>}</Td>
                  <Td className="text-xs">{h.by_name ?? h.user ?? "sistem"}{h.approved_by_name && <span className="block text-steel-500">disetujui {h.approved_by_name}</span>}</Td>
                  <Td className="max-w-xs text-xs">{h.note ?? ""}</Td>
                </tr>
              ))}</tbody>
            </Table>
          </div>
          {rows.length > limit && (
            <Button variant="outline" onClick={() => setLimit(limit + PAGE)}>Tampilkan lebih banyak ({fmtNum(rows.length - limit)} lagi)</Button>
          )}
        </>
      )}
      <p className="text-xs text-steel-500">Efek stok = pengaruh mutasi ke jumlah batch di gudang (pindah antar bin = 0). Saldo batch = jumlah menurut riwayat sampai mutasi itu.</p>
    </div>
  );
}

// ---- Tab 4: holds and what open waves will take ----------------------------

function HoldsPanel({ holds, tasks }: { holds: TraceHold[]; tasks: TraceTask[] }) {
  const active = holds.filter((h) => h.status === "ACTIVE");
  const released = holds.filter((h) => h.status !== "ACTIVE");
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Hold aktif ({fmtNum(active.length)})</h3>
          <Link href="/inventory?tab=hold" className="text-sm text-ckb underline">Kelola di Inventory → Hold &amp; karantina</Link>
        </div>
        {active.length === 0 ? <p className="text-sm text-steel-500">Tidak ada hold aktif untuk batch ini.</p> : <HoldTable rows={active} />}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Dipesan wave yang belum dikerjakan ({fmtNum(tasks.length)})</h3>
        {tasks.length === 0 ? <p className="text-sm text-steel-500">Tidak ada tugas wave terbuka yang memakai batch ini.</p> : (
          <Table>
            <thead><tr><Th>Wave</Th><Th>Tanggal</Th><Th>Jenis</Th><Th>Shipment</Th><Th>SKU</Th><Th>Expired</Th><Th>Dari bin</Th><Th>Ke bin</Th><Th className="text-right">Qty</Th></tr></thead>
            <tbody>{tasks.map((t, i) => (
              <tr key={i} className="hover:bg-paper">
                <Td><Link className="font-semibold underline" href={`/waves?date=${t.planned_date}`}>NO {t.wave_no}</Link></Td>
                <Td className="whitespace-nowrap">{fmtDate(t.planned_date)}</Td>
                <Td><Badge>{t.task_type === "REPLENISH" ? "Bin To Bin" : "Pick"}</Badge></Td>
                <Td>{t.shipment_number ?? "–"}</Td><Td>{t.sku}</Td><Td className="whitespace-nowrap text-xs">{fmtDate(t.expiry_date)}</Td>
                <Td className="font-mono text-xs">{t.from_bin}</Td><Td className="font-mono text-xs">{t.to_bin ?? "–"}</Td>
                <Td className="text-right font-semibold tabular">{fmtNum(Number(t.quantity))}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </section>

      {released.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Hold yang sudah dilepas ({fmtNum(released.length)})</h3>
          <HoldTable rows={released} released />
        </section>
      )}
    </div>
  );
}
function HoldTable({ rows, released }: { rows: TraceHold[]; released?: boolean }) {
  return (
    <Table>
      <thead><tr><Th>Cakupan</Th><Th>Bin</Th><Th>SKU</Th><Th>Expired</Th><Th className="text-right">Qty</Th><Th>Alasan</Th><Th>Keterangan</Th><Th>Oleh</Th>{released && <Th>Dilepas</Th>}</tr></thead>
      <tbody>{rows.map((h) => (
        <tr key={h.id} className="hover:bg-paper">
          <Td>{h.scope === "BATCH" ? <Badge className="bg-bad/10 text-bad">Seluruh batch</Badge> : "Satu baris"}</Td>
          <Td className="font-mono text-xs">{h.bin_code ?? "semua bin"}</Td><Td>{h.sku}</Td>
          <Td className="whitespace-nowrap text-xs">{fmtDate(h.expiry_date)}</Td>
          <Td className="text-right tabular">{fmtNum(Number(h.scope === "BATCH" ? h.covered_qty ?? 0 : h.quantity ?? 0))}</Td>
          <Td><Badge>{h.reason_code}</Badge></Td><Td className="max-w-xs text-xs">{h.note}</Td>
          <Td className="text-xs">{h.created_by_name}<span className="block text-steel-500">{jakartaDateTime(h.created_at)}</span></Td>
          {released && <Td className="text-xs">{h.released_by_name ?? "–"}<span className="block text-steel-500">{jakartaDateTime(h.released_at)}</span>{h.release_note && <span className="block">{h.release_note}</span>}</Td>}
        </tr>
      ))}</tbody>
    </Table>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-steel-300 bg-paper px-4 py-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-steel-500">{text}</p>
    </div>
  );
}
