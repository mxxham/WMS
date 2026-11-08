"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Download, Info, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import {
  CLASSES, changeMatrix, changeOf, classify, coverDays, filterRows, periodDays, periodLabel, suggestions, summarize,
  type AbcClass, type AbcRow, type AbcRun, type Change, type Filters,
} from "@/lib/abc";
import { cn, fmtDateTime, fmtNum } from "@/lib/utils";
import { ChangeMatrix, ClassBadge, ParetoChart, ShareBars } from "./abc-charts";
import { ApplyRun, ManualRun, RunHistory } from "./abc-runs";

type Trend = { id: string; from: string; to: string; lines: number; A: number; B: number; C: number };
type Sort = "rank" | "stock" | "cover" | "racks" | "cartons";

const CHANGE_LABEL: Record<Change, string> = { up: "Naik", down: "Turun", same: "Tetap", new: "Baru" };
const NO_FILTER: Filters = { cls: "", change: "", pack: "", q: "", stockOnly: false };

export function AbcClient({ run, rows, trend, runs, policy, canRun, canSetLimits, today, monthlyRan }: {
  run: AbcRun | null; rows: AbcRow[]; trend: Trend[]; runs: AbcRun[]; policy: { a: number; b: number };
  canRun: boolean; canSetLimits: boolean; today: string; monthlyRan: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(NO_FILTER);
  const [sort, setSort] = useState<Sort>("rank");
  const [limit, setLimit] = useState(60);
  const inForce = [...runs].filter((r) => r.applied_at).sort((a, b) => b.applied_at!.localeCompare(a.applied_at!))[0]?.id ?? null;

  const days = run ? periodDays(run.period_from, run.period_to) : 0;
  const summary = useMemo(() => summarize(rows), [rows]);
  const matrix = useMemo(() => changeMatrix(rows), [rows]);
  const tips = useMemo(() => suggestions(rows), [rows]);
  const moved = rows.filter((r) => { const c = changeOf(r.prev_class, r.class); return c === "up" || c === "down" || c === "new"; }).length;
  const packs = useMemo(() => [...new Set(rows.map((r) => r.pack ?? "–"))].sort(), [rows]);

  const shown = useMemo(() => {
    const list = filterRows(rows, f);
    const cover = (r: AbcRow) => coverDays(r.stock, r.cartons, days) ?? Number.POSITIVE_INFINITY;
    const by: Record<Sort, (a: AbcRow, b: AbcRow) => number> = {
      rank: (a, b) => a.rank - b.rank,
      stock: (a, b) => b.stock - a.stock,
      cover: (a, b) => cover(a) - cover(b) || a.rank - b.rank,
      racks: (a, b) => b.racks - a.racks || a.rank - b.rank,
      cartons: (a, b) => b.cartons - a.cartons,
    };
    return [...list].sort(by[sort]);
  }, [rows, f, sort, days]);

  async function exportXlsx() {
    if (!run) return;
    const { saveSheets } = await import("@/lib/save-xlsx");
    const line = (r: AbcRow) => ({
      Peringkat: r.rank, SKU: r.sku, Deskripsi: r.description ?? "", Kemasan: r.pack ?? "", Kelas: r.class, "Kelas sebelumnya": r.prev_class ?? "",
      Perubahan: CHANGE_LABEL[changeOf(r.prev_class, r.class)], "Baris pick": r.pick_lines, "Hari dipick": r.pick_days, Karton: r.cartons,
      "% baris": Number((r.share * 100).toFixed(2)), "% kumulatif": Number((r.cum_share * 100).toFixed(2)), "Stok sekarang": r.stock,
      "Hari stok": (() => { const c = coverDays(r.stock, r.cartons, days); return c === null ? "" : Math.round(c); })(),
      Pickface: r.pickface ?? "", "Jumlah bin": r.bins, "Jumlah rak": r.racks,
      Riwayat: [...r.history].reverse().map((h) => h ?? "–").join(" "),
    });
    saveSheets({
      ABC: rows.map(line),
      Ringkasan: [
        ...summary.map((s) => ({ Kelas: s.cls, SKU: s.skus, "% SKU": Number(s.skuPct.toFixed(1)), "Baris pick": s.lines, "% baris": Number(s.linesPct.toFixed(1)), Karton: s.cartons, "% karton": Number(s.cartonsPct.toFixed(1)) })),
        { Kelas: `Periode ${periodLabel(run.period_from, run.period_to)}, batas A ${run.a_pct}% B ${run.b_pct}%, ${run.total_lines} baris pick`, SKU: "", "% SKU": "", "Baris pick": "", "% baris": "", Karton: "", "% karton": "" },
      ],
      Perubahan: rows.filter((r) => changeOf(r.prev_class, r.class) !== "same").map(line),
      Saran: tips.flatMap((t) => t.skus.map((sku) => ({ Saran: t.title, SKU: sku, Deskripsi: rows.find((r) => r.sku === sku)?.description ?? "" }))),
    }, `Kelas ABC ${periodLabel(run.period_from, run.period_to).replace(" s/d ", " sampai ")}.xlsx`);
  }

  if (!run) {
    return (
      <div className="space-y-6 p-4 lg:p-8">
        <Intro policy={policy} />
        <p className="rounded-md bg-white p-4 text-sm">Belum ada perhitungan ABC: belum ada bulan lalu dengan data picking. Hitung periode sendiri di bawah,
          atau tunggu awal bulan berikutnya.</p>
        {canRun && <ManualRun today={today} policy={policy} />}
      </div>
    );
  }

  const label = periodLabel(run.period_from, run.period_to);
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Intro policy={policy} />

      {/* Which run, and whether it is the one in force */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-cond text-2xl font-semibold leading-tight">{label}</h2>
          <p className="text-sm text-steel-500">{fmtNum(run.total_lines)} baris picking · {fmtNum(run.total_cartons)} karton · {fmtNum(days)} hari ·
            batas A {fmtNum(run.a_pct)}%, B {fmtNum(run.b_pct)}% · {run.source === "AUTO" ? "otomatis bulanan" : `manual oleh ${run.created_by_name}`}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="abc-run">Periode</Label>
            <Select id="abc-run" value={run.id} onChange={(e) => router.push(`/abc?run=${e.target.value}`)} className="w-auto">
              {runs.map((r) => <option key={r.id} value={r.id}>{periodLabel(r.period_from, r.period_to)}{r.id === inForce ? " (berlaku)" : r.applied_at ? "" : " (pratinjau)"}</option>)}
            </Select></div>
          <Button variant="outline" onClick={exportXlsx}><Download className="h-4 w-4" />Excel</Button>
        </div>
      </div>
      {monthlyRan && run.source === "AUTO" && run.id === inForce && (
        <p className="flex items-start gap-2 rounded-md bg-ok/10 p-3 text-sm"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
          Kelas {label} baru saja dihitung otomatis dan diterapkan ke semua SKU. {fmtNum(moved)} SKU berubah kelas.</p>
      )}
      {run.id === inForce ? (
        <p className="text-sm text-steel-500">Kelas ini <b className="text-ok">berlaku sekarang</b> (diterapkan {fmtDateTime(run.applied_at)}{run.applied_by_name && ` oleh ${run.applied_by_name}`}):
          dipakai Gudang 3D, Dashboard dan jadwal cycle count (A tiap 30 hari, B 90, C 180).</p>
      ) : run.applied_at ? (
        <p className="rounded-md bg-steel-100 p-3 text-sm">Perhitungan lama, pernah diterapkan {fmtDateTime(run.applied_at)}. Kelas yang berlaku sekarang dari perhitungan yang lebih baru.</p>
      ) : (
        <div className="space-y-3 rounded-md bg-warn/10 p-3 text-sm">
          <p><b>Pratinjau:</b> kelas ini belum dipakai. {fmtNum(moved)} SKU akan berubah kelas bila diterapkan.</p>
          {canRun && <ApplyRun run={run} changes={moved} />}
        </div>
      )}

      {/* Per class */}
      <div className="grid gap-4 md:grid-cols-3">
        {summary.map((s) => (
          <button key={s.cls} type="button" onClick={() => setF({ ...NO_FILTER, cls: f.cls === s.cls ? "" : s.cls })}
            className={cn("rounded-lg bg-white p-4 text-left shadow-sm ring-1 transition hover:ring-ckb", f.cls === s.cls ? "ring-2 ring-ckb" : "ring-steel-100")}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2"><ClassBadge cls={s.cls} className="h-8 w-8 text-lg" /><span className="font-cond text-lg font-semibold">Kelas {s.cls}</span></div>
              <div className="text-right"><div className="font-cond text-2xl font-semibold tabular-nums">{fmtNum(s.skus)}</div><div className="text-xs text-steel-500">SKU</div></div>
            </div>
            <ShareBars s={s} />
            <div className="mt-2 text-xs text-steel-500">{fmtNum(s.lines)} baris · {fmtNum(s.cartons)} karton</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Kurva Pareto</CardTitle></CardHeader>
          <CardContent><ParetoChart rows={rows} summary={summary} aPct={run.a_pct} bPct={run.b_pct} /></CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Perubahan kelas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <ChangeMatrix matrix={matrix} onPick={(from, to) => { setF({ ...NO_FILTER, cls: to, prev: from }); document.getElementById("abc-table")?.scrollIntoView({ behavior: "smooth" }); }} />
            <p className="text-xs text-steel-500">Dibanding kelas sebelum perhitungan ini. Kotak kuning = SKU yang pindah kelas; klik untuk melihatnya di tabel.</p>
          </CardContent>
        </Card>
      </div>

      {tips.length > 0 && <Suggestions tips={tips} onPick={(sku) => { setF({ ...NO_FILTER, q: sku }); document.getElementById("abc-table")?.scrollIntoView({ behavior: "smooth" }); }} />}

      <Simulate rows={rows} run={run} canSetLimits={canSetLimits} />

      {/* The SKUs */}
      <Card id="abc-table">
        <CardHeader><CardTitle>SKU · {fmtNum(shown.length)} dari {fmtNum(rows.length)}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1"><Label htmlFor="abc-q">Cari SKU / nama</Label><Input id="abc-q" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="550044709 atau Helix" /></div>
            <div><Label htmlFor="abc-cls">Kelas</Label><Select id="abc-cls" value={f.cls} onChange={(e) => setF({ ...f, cls: e.target.value as Filters["cls"] })}>
              <option value="">Semua</option>{CLASSES.map((c) => <option key={c}>{c}</option>)}</Select></div>
            <div><Label htmlFor="abc-chg">Perubahan</Label><Select id="abc-chg" value={f.change} onChange={(e) => setF({ ...f, change: e.target.value as Filters["change"] })}>
              <option value="">Semua</option>{(Object.keys(CHANGE_LABEL) as Change[]).map((c) => <option key={c} value={c}>{CHANGE_LABEL[c]}</option>)}</Select></div>
            <div><Label htmlFor="abc-pack">Kemasan</Label><Select id="abc-pack" value={f.pack} onChange={(e) => setF({ ...f, pack: e.target.value })}>
              <option value="">Semua</option>{packs.map((p) => <option key={p}>{p}</option>)}</Select></div>
            <div><Label htmlFor="abc-sort">Urutkan</Label><Select id="abc-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="rank">Paling sering dipick</option><option value="cartons">Karton terbanyak</option><option value="stock">Stok terbanyak</option>
              <option value="cover">Hari stok tersedikit</option><option value="racks">Paling tersebar</option></Select></div>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.stockOnly} onChange={(e) => setF({ ...f, stockOnly: e.target.checked })} />Hanya yang ada stok</label>
            {f.prev && <span className="pb-2 text-sm">Dulu kelas <b>{f.prev === "–" ? "belum ada" : f.prev}</b></span>}
            {(f.q || f.cls || f.change || f.prev || f.pack || f.stockOnly) && <Button variant="ghost" size="sm" onClick={() => setF(NO_FILTER)}>Reset</Button>}
          </div>

          {/* phone: cards */}
          <div className="space-y-2 md:hidden">
            {shown.slice(0, limit).map((r) => (
              <div key={r.item_id} className="rounded-md bg-paper p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-semibold">#{r.rank} · {r.sku}</div><div className="truncate text-xs text-steel-500">{r.description}</div></div>
                  <div className="flex items-center gap-1"><ChangeMark prev={r.prev_class} now={r.class} /><ClassBadge cls={r.class} /></div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <Fact label="Baris pick" v={fmtNum(r.pick_lines)} /><Fact label="Karton" v={fmtNum(r.cartons)} /><Fact label="Stok" v={fmtNum(r.stock)} />
                  <Fact label="Hari stok" v={coverText(r, days)} /><Fact label="Pickface" v={r.pickface ?? "–"} /><Fact label="Rak" v={fmtNum(r.racks)} />
                </div>
              </div>
            ))}
          </div>

          {/* desktop: table */}
          <div className="hidden md:block">
            <Table sticky>
              <thead><tr>
                <Th className="text-right">#</Th><Th>SKU</Th><Th>Kelas</Th><Th>Riwayat</Th>
                <Th className="text-right">Baris pick</Th><Th className="text-right">Hari dipick</Th><Th className="text-right">Karton</Th>
                <Th className="text-right">% baris<div className="font-normal">kumulatif</div></Th>
                <Th className="text-right">Stok</Th><Th className="text-right">Hari stok</Th><Th>Pickface</Th><Th className="text-right">Rak</Th>
              </tr></thead>
              <tbody>{shown.slice(0, limit).map((r) => (
                <tr key={r.item_id} className={cn(changeOf(r.prev_class, r.class) === "up" && "bg-ok/5", changeOf(r.prev_class, r.class) === "down" && "bg-warn/5")}>
                  <Td className="text-right tabular text-steel-500">{r.rank}</Td>
                  <Td><span className="font-semibold">{r.sku}</span>{r.pack && r.pack !== "Carton" && <span className="ml-1.5 rounded bg-steel-100 px-1.5 text-[11px] text-steel-700">{r.pack}</span>}
                    <div className="max-w-64 truncate text-xs text-steel-500" title={r.description ?? undefined}>{r.description}</div></Td>
                  <Td><div className="flex items-center gap-1.5"><ClassBadge cls={r.class} /><ChangeMark prev={r.prev_class} now={r.class} /></div></Td>
                  <Td><History history={r.history} /></Td>
                  <Td className="text-right tabular font-semibold">{fmtNum(r.pick_lines)}</Td>
                  <Td className="text-right tabular">{r.pick_days ? `${fmtNum(r.pick_days)}/${fmtNum(days)}` : "–"}</Td>
                  <Td className="text-right tabular">{fmtNum(r.cartons)}</Td>
                  <Td className="text-right tabular">{fmtNum(r.share * 100, 1)}%<div className="text-xs text-steel-500">{fmtNum(r.cum_share * 100, 1)}%</div></Td>
                  <Td className="text-right tabular">{r.stock ? fmtNum(r.stock) : "–"}</Td>
                  <Td className={cn("whitespace-nowrap text-right tabular", coverTone(r, days))}>{coverText(r, days)}</Td>
                  <Td>{r.pickface ? <Link className="font-cond font-semibold underline" href={`/bin/${encodeURIComponent(r.pickface)}`}>{r.pickface}</Link>
                    : r.class === "A" && r.stock > 0 ? <span className="whitespace-nowrap text-xs font-semibold text-warn">belum ada</span> : <span className="text-steel-300">–</span>}</Td>
                  <Td className={cn("text-right tabular", r.racks >= 3 && "font-semibold text-warn")}>{r.racks ? fmtNum(r.racks) : "–"}</Td>
                </tr>
              ))}</tbody>
            </Table>
          </div>
          {shown.length > limit && <Button variant="outline" onClick={() => setLimit(limit + 100)}>Tampilkan {fmtNum(Math.min(100, shown.length - limit))} lagi</Button>}
          {shown.length === 0 && <p className="text-sm text-steel-500">Tidak ada SKU yang cocok dengan filter.</p>}
          <p className="text-xs text-steel-500">Hari stok = stok sekarang dibagi rata-rata karton dipick per hari di periode ini. Rak = jumlah rak (lorong + bay) yang menyimpan SKU ini sekarang.
            Hari dipick = berapa hari dari {fmtNum(days)} hari periode ada picking SKU ini.</p>
        </CardContent>
      </Card>

      {trend.length > 0 && <TrendCard run={run} summary={summary} trend={trend} />}
      {canRun && <ManualRun today={today} policy={policy} />}
      <RunHistory runs={runs} current={run.id} inForce={inForce} />
    </div>
  );
}

function Intro({ policy }: { policy: { a: number; b: number } }) {
  return (
    <p className="flex max-w-3xl items-start gap-2 text-sm text-steel-500"><Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>SKU diurutkan dari yang paling sering dipick (jumlah baris picking). <b>A</b> = SKU yang bersama-sama membuat {fmtNum(policy.a)}% pertama dari semua baris
        picking, <b>B</b> = sampai {fmtNum(policy.b)}%, <b>C</b> = sisanya dan SKU yang tidak dipick. Bulan lalu dihitung dan diterapkan otomatis di awal bulan.</span></p>
  );
}

function Fact({ label, v }: { label: string; v: string }) {
  return <div><div className="text-steel-500">{label}</div><div className="font-semibold tabular-nums">{v}</div></div>;
}

function ChangeMark({ prev, now }: { prev: string | null; now: AbcClass }) {
  const c = changeOf(prev, now);
  if (c === "up") return <span title={`Naik dari ${prev}`} className="inline-flex items-center text-xs font-semibold text-ok"><ArrowUp className="h-3.5 w-3.5" />{prev}</span>;
  if (c === "down") return <span title={`Turun dari ${prev}`} className="inline-flex items-center text-xs font-semibold text-warn"><ArrowDown className="h-3.5 w-3.5" />{prev}</span>;
  if (c === "new") return <span title="Belum punya kelas sebelumnya" className="text-xs text-steel-500">baru</span>;
  return null;
}

/** Earlier runs, oldest left; "·" = not in that run. */
function History({ history }: { history: (AbcClass | null)[] }) {
  if (!history.length) return <span className="text-xs text-steel-300">–</span>;
  return (
    <span className="inline-flex gap-0.5" aria-label={`Kelas sebelumnya: ${[...history].reverse().map((h) => h ?? "tidak ada").join(", ")}`}>
      {[...history].reverse().map((h, i) => (
        <span key={i} className={cn("inline-flex h-4 w-4 items-center justify-center rounded-sm text-[10px] font-bold",
          h === "A" ? "bg-ckb-dark text-white" : h === "B" ? "bg-ckb text-white" : h === "C" ? "bg-ckb-tint text-steel" : "bg-steel-100 text-steel-300")}>{h ?? "·"}</span>
      ))}
    </span>
  );
}

function coverText(r: AbcRow, days: number): string {
  const c = coverDays(r.stock, r.cartons, days);
  if (c === null) return r.stock > 0 ? "tidak bergerak" : "–";
  if (r.stock <= 0) return "habis";
  return c >= 365 ? "> 1 thn" : `${fmtNum(c)} hr`;
}
function coverTone(r: AbcRow, days: number): string {
  const c = coverDays(r.stock, r.cartons, days);
  if (c === null) return r.stock > 0 ? "text-xs text-steel-500" : "";
  return c < 7 ? "font-semibold text-bad" : c < 14 ? "font-semibold text-warn" : "";
}

function Suggestions({ tips, onPick }: { tips: ReturnType<typeof suggestions>; onPick: (sku: string) => void }) {
  const [open, setOpen] = useState<string | null>(tips[0]?.key ?? null);
  return (
    <Card>
      <CardHeader><CardTitle>Perlu dilihat</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {tips.map((t) => (
          <div key={t.key} className="rounded-md bg-paper">
            <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left" aria-expanded={open === t.key}
              onClick={() => setOpen(open === t.key ? null : t.key)}>
              <span><b>{t.title}</b><span className="block text-xs text-steel-500">{t.why}</span></span>
              <span className="rounded-full bg-warn px-2 py-0.5 text-xs font-semibold text-white">{fmtNum(t.skus.length)}</span>
            </button>
            {open === t.key && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                {t.skus.map((s) => <button key={s} type="button" onClick={() => onPick(s)} className="rounded border border-steel-300 bg-white px-2 py-1 font-mono text-xs hover:border-ckb">{s}</button>)}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** What other limits would do with the same ranking, before anyone changes the policy. */
function Simulate({ rows, run, canSetLimits }: { rows: AbcRow[]; run: AbcRun; canSetLimits: boolean }) {
  const router = useRouter();
  const [a, setA] = useState(run.a_pct);
  const [b, setB] = useState(run.b_pct);
  const sim = useMemo(() => classify([...rows].sort((x, y) => x.rank - y.rank), a, b), [rows, a, b]);
  const ranked = useMemo(() => [...rows].sort((x, y) => x.rank - y.rank), [rows]);
  const s = summarize(ranked.map((r, i) => ({ class: sim[i], pick_lines: r.pick_lines, cartons: r.cartons })));
  const differ = ranked.filter((r, i) => r.class !== sim[i]).length;
  const valid = a > 0 && a < b && b < 100;
  const save = async () => {
    const { error } = await createClient().rpc("set_inventory_policy", { p_value: { abc_a_pct: a, abc_b_pct: b } });
    if (error) return error.message;
    router.refresh();
    return null;
  };
  return (
    <Card>
      <CardHeader><CardTitle>Simulasi batas</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-steel-500">Geser batas untuk melihat berapa SKU masuk A, B dan C dengan data {periodLabel(run.period_from, run.period_to)} yang sama. Tidak ada yang berubah sampai disimpan.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div><Label htmlFor="sim-a">Batas A: <b>{fmtNum(a)}%</b> baris picking</Label>
            <input id="sim-a" type="range" min={50} max={94} value={a} onChange={(e) => { const v = Number(e.target.value); setA(v); if (b <= v) setB(v + 1); }} className="w-full accent-ckb" /></div>
          <div><Label htmlFor="sim-b">Batas B: <b>{fmtNum(b)}%</b> baris picking</Label>
            <input id="sim-b" type="range" min={a + 1} max={99} value={b} onChange={(e) => setB(Number(e.target.value))} className="w-full accent-ckb" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {s.map((x) => (
            <div key={x.cls} className="rounded-md bg-paper p-3">
              <div className="flex items-center gap-2"><ClassBadge cls={x.cls} /><span className="font-cond text-xl font-semibold tabular-nums">{fmtNum(x.skus)}</span><span className="text-xs text-steel-500">SKU</span></div>
              <div className="mt-1 text-xs text-steel-500">{fmtNum(x.linesPct, 1)}% baris · {fmtNum(x.cartonsPct, 1)}% karton</div>
            </div>
          ))}
        </div>
        <p className="text-sm">{differ === 0 ? "Sama dengan perhitungan ini." : <><b>{fmtNum(differ)} SKU</b> akan berbeda kelas dari perhitungan ini.</>}</p>
        {canSetLimits && (a !== run.a_pct || b !== run.b_pct) && (
          <ConfirmButton title="Simpan batas ABC" confirmLabel="Simpan" disabled={!valid}
            summary={`Batas baru: A ${fmtNum(a)}%, B ${fmtNum(b)}%. Berlaku mulai perhitungan berikutnya (otomatis awal bulan, atau Hitung periode lain); kelas sekarang tidak berubah.`}
            onConfirm={save}>Simpan sebagai batas…</ConfirmButton>
        )}
      </CardContent>
    </Card>
  );
}

/** This run against the earlier applied ones: how the split and the volume moved. */
function TrendCard({ run, summary, trend }: { run: AbcRun; summary: ReturnType<typeof summarize>; trend: Trend[] }) {
  const all = [{ id: run.id, from: run.period_from, to: run.period_to, lines: run.total_lines,
    A: summary[0].skus, B: summary[1].skus, C: summary[2].skus, current: true }, ...trend.map((t) => ({ ...t, current: false }))];
  const max = Math.max(1, ...all.map((t) => t.lines));
  return (
    <Card>
      <CardHeader><CardTitle>Tren per periode</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <thead><tr><Th>Periode</Th><Th className="text-right">A</Th><Th className="text-right">B</Th><Th className="text-right">C</Th><Th>Baris picking</Th></tr></thead>
          <tbody>{all.map((t) => (
            <tr key={t.id} className={cn(t.current && "bg-plate/20")}>
              <Td><Link className="underline" href={`/abc?run=${t.id}`}>{periodLabel(t.from, t.to)}</Link>{t.current && <span className="ml-1 text-xs text-steel-500">(ditampilkan)</span>}</Td>
              <Td className="text-right tabular">{fmtNum(t.A)}</Td><Td className="text-right tabular">{fmtNum(t.B)}</Td><Td className="text-right tabular">{fmtNum(t.C)}</Td>
              <Td><div className="flex items-center gap-2"><div className="h-2 w-40 overflow-hidden rounded bg-steel-100"><div className="h-full rounded bg-ckb" style={{ width: `${(t.lines / max) * 100}%` }} /></div>
                <span className="tabular-nums text-sm">{fmtNum(t.lines)}</span></div></Td>
            </tr>
          ))}</tbody>
        </Table>
        <p className="mt-2 text-xs text-steel-500">Periode sebelumnya yang pernah diterapkan, terbaru di atas. Per SKU, kotak kecil di kolom Riwayat menunjukkan kelasnya di periode-periode ini.</p>
      </CardContent>
    </Card>
  );
}

