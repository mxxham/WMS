"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, History, MapPin, Plus, RefreshCw, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLiveTables } from "@/components/app/live-refresh";
import { BinScanInput } from "@/components/app/bin-scan-input";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PersonNameField } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { LEVEL_COLORS_WEB } from "@/config/warehouse";
import { REASON_CODES } from "@/lib/inventory-control";
import { CAUSES, gapTotal, sapTotal, signed, timingTotal, wmsTotal, type CauseCode } from "@/lib/sap-compare";
import {
  KIND_LABEL, MINUS_REASONS, PLUS_REASONS, STRONG, checkDraft, linesQty, linesText, palletHint, planSentence, reasonLabel, topSuspects,
  type DraftLine, type FixPlan, type FixRow, type StockLine, type SuspectBin,
} from "@/lib/recon-investigate";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import type { ReconLine, ReconSummary } from "./types";

const num = (v: unknown) => Number(v ?? 0) || 0;

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

/** The bin code as the yellow location plate, with the level strip. */
function Plate({ code, className }: { code: string; className?: string }) {
  const color = LEVEL_COLORS_WEB[code.charAt(4)];
  return (
    <span className={cn("inline-block overflow-hidden rounded-plate bg-plate font-cond text-lg font-bold leading-none text-steel", className)}>
      {color && <span className="block h-1" style={{ background: color }} aria-hidden />}
      <span className="block px-2 py-1">{code}</span>
    </span>
  );
}

/** Where a checked bin stands against the system. */
function CheckBadge({ b }: { b: SuspectBin }) {
  if (!b.check_id) return <span className="rounded bg-steel-100 px-1.5 py-0.5 text-xs text-steel-700">Belum dicek</span>;
  if (b.check_stale) return <span className="rounded bg-warn/20 px-1.5 py-0.5 text-xs font-semibold text-steel" title="Stok sistem bin ini berubah sesudah dicek">Cek ulang</span>;
  const d = num(b.checked_qty) - num(b.system_qty);
  if (d === 0) return <span className="inline-flex items-center gap-1 rounded bg-ok/15 px-1.5 py-0.5 text-xs font-semibold text-ok"><Check className="h-3 w-3" />Cocok {fmtNum(num(b.checked_qty))}</span>;
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", d > 0 ? "bg-ckb/15 text-ckb-dark" : "bg-bad/15 text-bad")}>
      Fisik {fmtNum(num(b.checked_qty))} · {d > 0 ? "lebih" : "kurang"} {fmtNum(Math.abs(d))}
    </span>
  );
}

export function Investigation({ run, line: l, lines, person, setPerson, onBack }: {
  run: ReconSummary; line: ReconLine; lines: ReconLine[]; person: string; setPerson: (v: string) => void; onBack: () => void;
}) {
  const router = useRouter();
  const [suspects, setSuspects] = useState<SuspectBin[] | null>(null);
  const [plan, setPlan] = useState<FixPlan | null>(null);
  const [fixes, setFixes] = useState<FixRow[]>([]);
  const [upp, setUpp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const editable = run.status === "OPEN";

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const [s, p, f, it] = await Promise.all([
      sb.rpc("recon_suspect_bins", { p_line_id: l.id }),
      sb.rpc("recon_fix_plan", { p_line_id: l.id }),
      sb.from("recon_fixes").select("id, applied_at, applied_name, checker_names, transfer_qty, net_adjust, adjust_abs, cause, note, plan")
        .eq("line_id", l.id).order("applied_at", { ascending: false }),
      l.item_id ? sb.from("items").select("upp").eq("id", l.item_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    setLoading(false);
    const err = s.error ?? p.error ?? f.error;
    if (err) { setError(err.message); return; }
    setError(null);
    setSuspects((s.data ?? []) as SuspectBin[]);
    setPlan(p.data as FixPlan);
    setFixes((f.data ?? []) as FixRow[]);
    setUpp((it.data as { upp: number | null } | null)?.upp ?? null);
  }, [l.id, l.item_id]);

  useEffect(() => { void load(); }, [load]);
  // Another phone checking a bin, a fix, or any stock movement of the day: reload.
  useLiveTables(["recon_checks", "recon_fixes", "movements"], () => { void load(); }, 4000);

  const dayGap = gapTotal(l);
  const fixed = num(l.wms_fix);
  const gap = dayGap + fixed;
  const pallet = palletHint(gap, upp);
  // Another SKU of this reconciliation off by the same cartons the other way: maybe swapped.
  const partners = useMemo(() => lines.filter((o) => o.sku !== l.sku && gap !== 0 && gapTotal(o) + num(o.wms_fix) === -gap), [lines, l.sku, gap]);
  const staleDays = Math.round((Date.now() - new Date(`${run.as_of}T00:00:00+07:00`).getTime()) / 86_400_000);
  const checkedCount = (suspects ?? []).filter((b) => b.check_id && !b.check_stale).length;

  async function onChecked() { await load(); }
  async function onApplied() { await load(); router.refresh(); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm underline"><ArrowLeft className="h-4 w-4" />Kembali ke perbandingan</button>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Muat ulang</Button>
      </div>

      <div>
        <h2 className="font-cond text-2xl font-semibold">Investigasi selisih · SKU {l.sku}</h2>
        <p className="text-sm text-steel-700">{l.description}</p>
        <p className="text-xs text-steel-500">Rekonsiliasi per {fmtDate(run.as_of)} · {run.file_name}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {([
          ["SAP", fmtNum(sapTotal(l)), undefined],
          ["WMS hari itu", fmtNum(wmsTotal(l)), undefined],
          ["Koreksi timing", timingTotal(l) ? signed(timingTotal(l)) : "–", undefined],
          ["Selisih hari itu", signed(dayGap), dayGap > 0 ? "text-ckb-dark" : dayGap < 0 ? "text-bad" : "text-ok"],
          ["Sudah dikoreksi", fixed ? signed(fixed) : "–", undefined],
          ["Sisa selisih", signed(gap), gap > 0 ? "text-ckb-dark" : gap < 0 ? "text-bad" : "text-ok"],
        ] as const).map(([k, v, tone]) => (
          <div key={k} className="rounded-lg bg-white p-3">
            <div className="text-xs text-steel-500">{k}</div>
            <div className={cn("font-cond text-2xl font-semibold tabular", tone)}>{v}</div>
          </div>
        ))}
      </div>

      <div className="space-y-1 rounded-md bg-plate/30 p-3 text-sm">
        {gap < 0 && <p><b>WMS kurang {fmtNum(-gap)} dari SAP.</b> Cari barang yang ada di rak tetapi tidak tercatat: bin yang di sistem kosong padahal pernah berisi, bin sebelahnya, staging.</p>}
        {gap > 0 && <p><b>WMS lebih {fmtNum(gap)} dari SAP.</b> Cari bin yang tercatat berisi tetapi barangnya tidak ada (sudah diambil, salah posting, salah bin).</p>}
        {gap === 0 && <p><b>Tidak ada sisa selisih.</b> Cek bin tetap bisa dipakai untuk merapikan lokasi (Bin To Bin yang tidak tercatat).</p>}
        {pallet && <p>{pallet} Bin yang terakhir berisi satu palet penuh SKU ini paling dicurigai.</p>}
        {partners.length > 0 && (
          <p className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <span>SKU lain selisih sama besar, arah berlawanan: {partners.map((o) => `${o.sku} (${signed(gapTotal(o) + num(o.wms_fix))})`).join(", ")}. Mungkin tertukar: cek juga bin SKU itu.</span></p>
        )}
        {staleDays > 2 && <p className="text-steel-700">Rekonsiliasi ini {staleDays} hari lalu. Cek bin dan koreksi memakai stok WMS <b>sekarang</b>, bukan stok hari itu.</p>}
        {(timingTotal(l) !== 0 || l.cause === "PENDING_GI" || l.cause === "PENDING_GR") && (
          <p className="text-steel-700">Sebagian selisih sudah dijelaskan timing (GI/GR belum diposting SAP): itu bukan barang hilang, jangan dikoreksi di WMS.</p>
        )}
      </div>

      {!editable && <p className="rounded-md bg-steel-100 p-3 text-sm">Rekonsiliasi ini sudah ditutup: hasil cek bisa dilihat, tidak bisa menambah cek atau koreksi.</p>}
      {editable && <div className="max-w-sm"><PersonNameField id="inv-person" value={person} onChange={setPerson} label="Nama Anda (pengecek / yang menerapkan)" /></div>}
      {error && <p role="alert" className="rounded-md bg-bad/10 p-3 text-sm text-bad">{error}</p>}
      {!suspects && !error && <p className="text-sm text-steel-500">Menyusun daftar bin…</p>}

      {suspects && (
        <>
          <Step n={1} title="Cek bin yang paling dicurigai" sub="Diurutkan dari petunjuk terkuat. Datangi bin, lihat label karton, catat yang benar-benar ada.">
            <TopList rows={topSuspects(suspects)} run={run} line={l} gap={gap} person={person} editable={editable} onChecked={onChecked} />
          </Step>

          <Step n={2} title="Belum ketemu? Cek semua bin SKU ini" sub={`Setiap bin yang pernah berisi SKU ini, pickface, staging, dan bin sebelahnya. ${fmtNum(checkedCount)} dari ${fmtNum(suspects.length)} bin sudah dicek.`}>
            <AllBins rows={suspects} run={run} line={l} gap={gap} person={person} editable={editable} onChecked={onChecked} />
          </Step>

          <Step n={3} title="Hasil cek dan koreksi stok" sub="Barang yang salah bin dipindah (Bin To Bin, total tidak berubah). Hanya sisanya yang jadi adjustment.">
            {plan && <FixPanel plan={plan} line={l} person={person} editable={editable} onApplied={onApplied} />}
            {fixes.length > 0 && <FixHistory fixes={fixes} />}
          </Step>
        </>
      )}
    </div>
  );
}

function Step({ n, title, sub, children }: { n: number; title: string; sub: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-steel text-xs text-white">{n}</span>{title}
        </CardTitle>
        <p className="text-sm text-steel-500">{sub}</p>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

type RowProps = { run: ReconSummary; line: ReconLine; gap: number; person: string; editable: boolean; onChecked: () => Promise<void> };

function ReasonChips({ b, gap, asOf }: { b: SuspectBin; gap: number; asOf: string }) {
  if (!b.reasons.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {b.reasons.map((r) => (
        <span key={r} className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium",
          STRONG.includes(r) ? "bg-bad/15 text-bad" : r === "CURRENT" || r === "WMS_MORE" ? "bg-ckb/10 text-ckb-dark" : "bg-steel-100 text-steel-700")}>
          {reasonLabel(r, b, gap, asOf)}
        </span>
      ))}
    </div>
  );
}

function TopList({ rows, ...p }: { rows: SuspectBin[] } & RowProps) {
  if (!rows.length) return <p className="text-sm text-steel-500">Tidak ada bin dengan petunjuk kuat. Lanjut ke langkah 2.</p>;
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {rows.map((b, i) => <SuspectCard key={b.bin_id} b={b} rank={i + 1} {...p} />)}
    </div>
  );
}

function SuspectCard({ b, rank, run, line, gap, person, editable, onChecked }: { b: SuspectBin; rank?: number } & RowProps) {
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState(false);
  return (
    <div className={cn("rounded-lg border bg-white p-3", b.check_id && !b.check_stale ? "border-steel-200" : b.reasons.some((r) => STRONG.includes(r)) ? "border-bad/50" : "border-steel-200")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {rank && <span className="font-cond text-lg font-semibold text-steel-500">#{rank}</span>}
          <Link href={`/bin/${encodeURIComponent(b.bin_code)}`} className="hover:opacity-80"><Plate code={b.bin_code} /></Link>
          <span className="text-xs text-steel-500">{KIND_LABEL[b.kind]}{b.bin_status === "blocked" ? " · diblokir" : ""}</span>
        </div>
        <CheckBadge b={b} />
      </div>
      <div className="mt-2"><ReasonChips b={b} gap={gap} asOf={run.as_of} /></div>
      <p className="mt-2 text-xs text-steel-700">
        Sistem sekarang: <b>{linesText(b.system_lines)}</b>
        {b.last_move_at && <> · mutasi terakhir {fmtDateTime(b.last_move_at)} ({b.last_move_type} {signed(num(b.last_move_qty))})</>}
      </p>
      {b.check_id && <p className="text-xs text-steel-700">Dicek {b.checked_name} {fmtDateTime(b.checked_at)}: <b>{linesText(b.check_lines)}</b></p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {editable && <Button size="sm" variant={b.check_id && !b.check_stale ? "outline" : "default"} onClick={() => setOpen((o) => !o)}>
          {open ? "Tutup" : b.check_id ? "Cek lagi" : "Cek bin ini"}</Button>}
        <Button size="sm" variant="ghost" onClick={() => setHist((h) => !h)}><History className="h-4 w-4" />Riwayat ({fmtNum(b.moves)})</Button>
      </div>
      {open && <div className="mt-3 border-t border-steel-100 pt-3">
        <CheckForm lineId={line.id} itemId={line.item_id} binCode={b.bin_code} binId={b.bin_id} known={b.system_lines} person={person}
          onDone={async () => { setOpen(false); await onChecked(); }} />
      </div>}
      {hist && <div className="mt-3 border-t border-steel-100 pt-3"><BinHistory binId={b.bin_id} itemId={line.item_id} /></div>}
    </div>
  );
}

const FILTERS = {
  all: { label: "Semua", test: (_b: SuspectBin) => true },
  todo: { label: "Belum dicek", test: (b: SuspectBin) => !b.check_id || b.check_stale },
  diff: { label: "Ada beda", test: (b: SuspectBin) => !!b.check_id && !b.check_stale && num(b.checked_qty) !== num(b.system_qty) },
  current: { label: "Ada di WMS", test: (b: SuspectBin) => b.kind === "CURRENT" },
  history: { label: "Pernah berisi", test: (b: SuspectBin) => b.kind === "HISTORY" },
  near: { label: "Sebelah / staging", test: (b: SuspectBin) => b.kind === "NEIGHBOUR" || b.kind === "STAGING" || b.kind === "PICKFACE" },
} as const;
type FilterKey = keyof typeof FILTERS;

function AllBins({ rows, ...p }: { rows: SuspectBin[] } & RowProps) {
  const desktop = useDesktop();
  const [filter, setFilter] = useState<FilterKey>("todo");
  const [sort, setSort] = useState<"score" | "route">("score");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toUpperCase();
    return rows.filter(FILTERS[filter].test).filter((b) => !s || b.bin_code.includes(s))
      .sort((a, b) => sort === "route" ? a.bin_code.localeCompare(b.bin_code) : b.score - a.score || a.bin_code.localeCompare(b.bin_code));
  }, [rows, filter, sort, q]);
  const done = rows.filter((b) => b.check_id && !b.check_stale).length;
  const otherKnown = rows.find((b) => b.bin_code === other.trim().toUpperCase());

  return (
    <div className="space-y-3">
      <div className="h-2 overflow-hidden rounded bg-steel-100" aria-hidden><div className="h-full bg-ok" style={{ width: `${rows.length ? (100 * done) / rows.length : 0}%` }} /></div>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={cn("rounded-md border px-3 py-1.5 text-sm", filter === k ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white hover:bg-steel-100")}>
            {FILTERS[k].label} <span className="tabular opacity-80">{fmtNum(rows.filter(FILTERS[k].test).length)}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-steel-400" />
          <Input aria-label="Cari bin" className="pl-8 uppercase" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari bin" />
        </div>
        <Select aria-label="Urutan" value={sort} onChange={(e) => setSort(e.target.value as "score" | "route")} className="w-52">
          <option value="score">Paling dicurigai dulu</option>
          <option value="route">Urut rak (jalan keliling)</option>
        </Select>
      </div>

      {shown.length === 0 ? <p className="rounded-md bg-paper p-3 text-sm text-steel-500">Tidak ada bin untuk filter ini.</p> : desktop ? (
        <div className="max-h-[32rem] overflow-auto rounded border border-steel-100">
          <Table>
            <thead className="sticky top-0 z-10 bg-white"><tr><Th className="w-6" /><Th>Bin</Th><Th>Petunjuk</Th><Th className="text-right">Sistem</Th><Th>Mutasi terakhir</Th><Th>Hasil cek</Th></tr></thead>
            <tbody>{shown.map((b) => {
              const isOpen = open === b.bin_id;
              return (
                <FragmentRow key={b.bin_id} open={isOpen} cols={6}
                  row={<tr className={cn("cursor-pointer hover:bg-paper", isOpen && "bg-paper")} onClick={() => setOpen(isOpen ? null : b.bin_id)}>
                    <Td>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Td>
                    <Td><Plate code={b.bin_code} className="text-base" /><div className="text-xs text-steel-500">{KIND_LABEL[b.kind]} · skor {b.score}</div></Td>
                    <Td className="max-w-md"><ReasonChips b={b} gap={p.gap} asOf={p.run.as_of} /></Td>
                    <Td className="text-right tabular">{fmtNum(num(b.system_qty))}</Td>
                    <Td className="text-xs">{b.last_move_at ? <>{fmtDateTime(b.last_move_at)}<div className="text-steel-500">{b.last_move_type} {signed(num(b.last_move_qty))}</div></> : "–"}</Td>
                    <Td><CheckBadge b={b} />{b.checked_name && <div className="text-xs text-steel-500">{b.checked_name}</div>}</Td>
                  </tr>}>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {p.editable ? <CheckForm lineId={p.line.id} itemId={p.line.item_id} binCode={b.bin_code} binId={b.bin_id} known={b.system_lines} person={p.person}
                      onDone={async () => { setOpen(null); await p.onChecked(); }} /> : <p className="text-sm text-steel-500">Rekonsiliasi ditutup.</p>}
                    <BinHistory binId={b.bin_id} itemId={p.line.item_id} />
                  </div>
                </FragmentRow>
              );
            })}</tbody>
          </Table>
        </div>
      ) : (
        <div className="space-y-2">{shown.map((b) => <SuspectCard key={b.bin_id} b={b} {...p} />)}</div>
      )}

      {p.editable && (
        <div className="rounded-md border border-dashed border-steel-300 p-3">
          <div className="mb-2 flex items-center gap-1 font-semibold"><MapPin className="h-4 w-4" />Cek bin lain</div>
          <p className="mb-2 text-xs text-steel-500">Barang ketemu di bin yang tidak ada di daftar? Scan label bin atau ketik kodenya.</p>
          <BinScanInput id="inv-other-bin" value={other} onChange={setOther} />
          {other.trim().length >= 4 && (
            <div className="mt-3">
              {otherKnown && <p className="mb-2 text-xs text-steel-500">Bin ini sudah ada di daftar ({KIND_LABEL[otherKnown.kind]}).</p>}
              <CheckForm key={other} lineId={p.line.id} itemId={p.line.item_id} binCode={other.trim().toUpperCase()} binId={otherKnown?.bin_id ?? null}
                known={otherKnown?.system_lines ?? []} person={p.person} onDone={async () => { setOther(""); await p.onChecked(); }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FragmentRow({ row, open, cols, children }: { row: React.ReactNode; open: boolean; cols: number; children: React.ReactNode }) {
  return (
    <>
      {row}
      {open && <tr><td colSpan={cols} className="border-b border-steel-200 bg-paper p-3">{children}</td></tr>}
    </>
  );
}

/**
 * What is in one bin for this SKU. Batch and expiry come pre-filled from what
 * the bin holds or last held, so usually only the cartons are typed.
 */
function CheckForm({ lineId, itemId, binCode, binId, known, person, onDone }: {
  lineId: string; itemId: string | null; binCode: string; binId: string | null; known: StockLine[]; person: string; onDone: () => Promise<void>;
}) {
  const [rows, setRows] = useState<DraftLine[]>(() => known.length
    ? known.map((k) => ({ batch_lot: k.batch_lot, expiry_date: k.expiry_date ?? "", quantity: "" }))
    : [{ batch_lot: "", expiry_date: "", quantity: "" }]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hints, setHints] = useState<StockLine[]>([]);

  // Batches this SKU had in this bin, or holds elsewhere: a tap fills batch + expiry.
  useEffect(() => {
    if (!itemId) return;
    let live = true;
    void (async () => {
      const sb = createClient();
      const [mv, inv] = await Promise.all([
        binId ? sb.from("movements").select("batch_lot, expiry_date").eq("item_id", itemId).eq("to_bin_id", binId)
          .order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] as { batch_lot: string; expiry_date: string | null }[] }),
        sb.from("inventory").select("batch_lot, expiry_date, quantity").eq("item_id", itemId).gt("quantity", 0).limit(50),
      ]);
      if (!live) return;
      const seen = new Map<string, StockLine>();
      for (const r of [...((mv.data ?? []) as StockLine[]), ...((inv.data ?? []) as StockLine[])]) {
        if (!r.expiry_date) continue;
        const k = `${r.batch_lot}|${r.expiry_date}`;
        if (!seen.has(k)) seen.set(k, { batch_lot: r.batch_lot, expiry_date: r.expiry_date, quantity: 0 });
      }
      setHints([...seen.values()].slice(0, 6));
    })();
    return () => { live = false; };
  }, [itemId, binId]);

  const ready = person.trim().length >= 2 && !busy;
  const parsed = checkDraft(rows, known);
  const total = "lines" in parsed ? linesQty(parsed.lines) : null;

  async function send(lines: StockLine[]) {
    setBusy(true); setMsg(null);
    const { error } = await createClient().rpc("recon_check_bin", { p_line_id: lineId, p_bin_code: binCode, p_lines: lines, p_note: note, p_by_name: person });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    await onDone();
  }
  function save() {
    if ("error" in parsed) { setMsg(parsed.error); return; }
    void send(parsed.lines);
  }
  const set = (i: number, k: keyof DraftLine, v: string) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));

  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">Isi bin {binCode} untuk SKU ini</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_5.5rem_auto] items-end gap-2">
          <div><Label htmlFor={`b-${binCode}-${i}`}>Batch</Label>
            <Input id={`b-${binCode}-${i}`} className="uppercase" value={r.batch_lot} onChange={(e) => set(i, "batch_lot", e.target.value)} /></div>
          <div><Label htmlFor={`e-${binCode}-${i}`}>Expired</Label>
            <Input id={`e-${binCode}-${i}`} type="date" value={r.expiry_date} onChange={(e) => set(i, "expiry_date", e.target.value)} /></div>
          <div><Label htmlFor={`q-${binCode}-${i}`}>Karton</Label>
            <Input id={`q-${binCode}-${i}`} type="number" inputMode="numeric" min={0} className="tabular" value={r.quantity}
              onChange={(e) => set(i, "quantity", e.target.value)} /></div>
          <Button type="button" variant="ghost" size="icon" aria-label="Hapus baris" disabled={rows.length === 1}
            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
        </div>
      ))}
      {hints.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-steel-500">Batch SKU ini:</span>
          {hints.map((h) => (
            <button key={`${h.batch_lot}|${h.expiry_date}`} type="button" className="rounded border border-steel-300 px-1.5 py-0.5 hover:bg-steel-100"
              onClick={() => setRows((rs) => {
                const empty = rs.findIndex((r) => !r.batch_lot && !r.expiry_date);
                const row = { batch_lot: h.batch_lot, expiry_date: h.expiry_date ?? "", quantity: empty >= 0 ? rs[empty].quantity : "" };
                return empty >= 0 ? rs.map((r, j) => j === empty ? row : r) : [...rs, row];
              })}>
              {h.batch_lot || "–"} · {fmtDate(h.expiry_date)}
            </button>
          ))}
        </div>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, { batch_lot: "", expiry_date: "", quantity: "" }])}><Plus className="h-4 w-4" />Batch lain</Button>
      <Input aria-label="Catatan" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional), mis. palet utuh di belakang" />
      {msg && <p role="alert" className="text-xs text-bad">{msg}</p>}
      {person.trim().length < 2 && <p className="text-xs text-warn">Isi nama Anda di atas dulu.</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={!ready} onClick={() => void send([])}>Kosong: tidak ada SKU ini</Button>
        <Button disabled={!ready || total === null || total === 0} onClick={save}>
          {busy ? "Menyimpan…" : total ? `Simpan: ${binCode} berisi ${fmtNum(total)}` : "Isi jumlah karton"}
        </Button>
      </div>
    </div>
  );
}

type BinMove = { created_at: string; type: string; quantity: number; batch_lot: string; expiry_date: string | null; note: string | null; by_name: string | null;
  from_bin: { bin_code: string } | null; to_bin: { bin_code: string } | null };

/** Every movement of this SKU in and out of one bin, newest first. */
function BinHistory({ binId, itemId }: { binId: string; itemId: string | null }) {
  const [rows, setRows] = useState<BinMove[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!itemId) return;
    let live = true;
    void createClient().from("movements")
      .select("created_at, type, quantity, batch_lot, expiry_date, note, by_name, from_bin:bins!movements_from_bin_id_fkey(bin_code), to_bin:bins!movements_to_bin_id_fkey(bin_code)")
      .eq("item_id", itemId).or(`from_bin_id.eq.${binId},to_bin_id.eq.${binId}`).order("created_at", { ascending: false }).limit(30)
      .then(({ data, error }) => { if (!live) return; if (error) setErr(error.message); else setRows((data ?? []) as unknown as BinMove[]); });
    return () => { live = false; };
  }, [binId, itemId]);
  if (err) return <p className="text-xs text-bad">{err}</p>;
  if (!rows) return <p className="text-xs text-steel-500">Memuat riwayat…</p>;
  if (!rows.length) return <p className="text-xs text-steel-500">SKU ini tidak pernah tercatat di bin ini.</p>;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold">Riwayat SKU ini di bin ini ({rows.length}{rows.length === 30 ? "+" : ""})</p>
      <div className="max-h-56 overflow-auto rounded bg-white">
        <table className="w-full text-xs"><tbody>{rows.map((m, i) => (
          <tr key={i} className="border-t border-steel-100 first:border-0 align-top">
            <td className="whitespace-nowrap p-1">{fmtDateTime(m.created_at)}</td>
            <td className="p-1">{m.type}</td>
            <td className="whitespace-nowrap p-1">{m.from_bin?.bin_code ?? ""}{m.from_bin && m.to_bin ? " → " : ""}{m.to_bin?.bin_code ?? ""}</td>
            <td className="p-1 text-right tabular">{m.type === "adjustment" ? signed(num(m.quantity)) : fmtNum(num(m.quantity))}</td>
            <td className="p-1">{m.batch_lot || "–"}</td>
            <td className="p-1 text-steel-500">{m.by_name}{m.note && ` · ${m.note}`}</td>
          </tr>
        ))}</tbody></table>
      </div>
    </div>
  );
}

const reasonText = (c: string) => (REASON_CODES as Record<string, string>)[c] ?? c;

function FixPanel({ plan: p, line, person, editable, onApplied }: {
  plan: FixPlan; line: ReconLine; person: string; editable: boolean; onApplied: () => Promise<void>;
}) {
  const hasWork = p.transfers.length + p.adjustments.length > 0;
  const plus = p.adjustments.some((a) => num(a.quantity) > 0), minus = p.adjustments.some((a) => num(a.quantity) < 0);
  const [reasonPlus, setReasonPlus] = useState<string>("FOUND");
  const [reasonMinus, setReasonMinus] = useState<string>("LOST");
  const [cause, setCause] = useState<CauseCode | "">("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const autoCause: CauseCode = p.adjustments.length === 0 ? "MISPLACED" : "COUNT";
  const samePerson = p.needs_other_person && p.checkers.some((c) => c.trim().toLowerCase() === person.trim().toLowerCase());

  async function apply(): Promise<string | null> {
    const { data, error } = await createClient().rpc("recon_apply_fix", {
      p_line_id: line.id, p_cause: cause || autoCause, p_reason_plus: reasonPlus, p_reason_minus: reasonMinus, p_note: note, p_by_name: person,
    });
    if (error) return error.message;
    const r = data as { transfers: number; adjustments: number; gap_after: number };
    setDone(`Diterapkan: ${r.transfers} Bin To Bin, ${r.adjustments} adjustment. Sisa selisih ${signed(num(r.gap_after))}. Stok WMS hari ini sudah berubah; SAP berubah setelah Shell memposting koreksinya.`);
    setNote(""); setCause("");
    await onApplied();
    return null;
  }

  return (
    <div className="space-y-3 text-sm">
      {p.checks.length === 0 && p.stale.length === 0 && <p className="text-steel-500">Belum ada bin yang dicek{p.last_fix_at ? " sejak koreksi terakhir" : ""}. Cek bin di langkah 1 atau 2.</p>}
      {p.stale.length > 0 && (
        <p className="rounded-md bg-warn/15 p-2"><AlertTriangle className="mr-1 inline h-4 w-4 text-warn" />
          Stok sistem berubah sesudah dicek, cek ulang: {p.stale.map((s) => s.bin_code).join(", ")}. Cek yang lama tidak dipakai.</p>
      )}

      {p.checks.length > 0 && (
        <div className="overflow-auto rounded border border-steel-100">
          <Table>
            <thead><tr><Th>Bin</Th><Th className="text-right">Sistem</Th><Th className="text-right">Fisik</Th><Th className="text-right">Beda</Th><Th>Dicek</Th></tr></thead>
            <tbody>{p.checks.map((c) => {
              const d = num(c.counted) - num(c.system);
              return (
                <tr key={c.check_id}>
                  <Td><Plate code={c.bin_code} className="text-base" /></Td>
                  <Td className="text-right tabular">{fmtNum(num(c.system))}<div className="text-xs text-steel-500">{linesText(c.system_lines)}</div></Td>
                  <Td className="text-right tabular">{fmtNum(num(c.counted))}<div className="text-xs text-steel-500">{linesText(c.lines)}</div></Td>
                  <Td className={cn("text-right font-semibold tabular", d > 0 ? "text-ckb-dark" : d < 0 ? "text-bad" : "text-ok")}>{d ? signed(d) : "cocok"}</Td>
                  <Td className="text-xs">{c.checked_name}<div className="text-steel-500">{fmtDateTime(c.checked_at)}</div></Td>
                </tr>
              );
            })}</tbody>
          </Table>
        </div>
      )}

      {hasWork && (
        <div className="space-y-2 rounded-md border border-steel-200 p-3">
          <p className="font-semibold">Koreksi yang akan diposting</p>
          {p.transfers.length > 0 && (
            <div>
              <p className="text-xs text-steel-500">Bin To Bin (salah lokasi, total SKU tidak berubah, tidak perlu ke SAP)</p>
              <ul className="space-y-1">{p.transfers.map((t, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2"><Plate code={t.from_bin} className="text-sm" /><ArrowRight className="h-4 w-4" /><Plate code={t.to_bin} className="text-sm" />
                  <b className="tabular">{fmtNum(num(t.quantity))} karton</b><span className="text-xs text-steel-500">{t.batch_lot || "–"} · exp {fmtDate(t.expiry_date)}</span></li>
              ))}</ul>
            </div>
          )}
          {p.adjustments.length > 0 && (
            <div>
              <p className="text-xs text-steel-500">Adjustment (mengubah total stok WMS)</p>
              <ul className="space-y-1">{p.adjustments.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2"><Plate code={a.bin_code} className="text-sm" />
                  <b className={cn("tabular", num(a.quantity) > 0 ? "text-ckb-dark" : "text-bad")}>{signed(num(a.quantity))} karton</b>
                  <span className="text-xs text-steel-500">{a.batch_lot || "–"} · exp {fmtDate(a.expiry_date)} · dicek {a.checked_name}</span></li>
              ))}</ul>
            </div>
          )}
          <p>Selisih dengan SAP: <b className="tabular">{signed(num(p.gap_before))}</b> → <b className={cn("tabular", num(p.gap_after) === 0 ? "text-ok" : "text-bad")}>{signed(num(p.gap_after))}</b>
            {num(p.gap_after) !== 0 && <span className="text-steel-500"> · belum habis: cek bin lain, atau terapkan ini dulu</span>}</p>
          {p.blockers.map((b, i) => <p key={i} role="alert" className="rounded bg-bad/10 p-2 text-bad">{b}</p>)}
          {p.needs_other_person && (
            <p className={cn("rounded p-2", samePerson ? "bg-bad/10 text-bad" : "bg-steel-100")}>
              Adjustment {fmtNum(num(p.adjust_abs))} karton di atas batas {fmtNum(num(p.limit))} karton: harus diterapkan orang lain dari pengecek ({p.checkers.join(", ")}).
            </p>
          )}

          {editable && (
            <div className="grid gap-2 md:grid-cols-3">
              {plus && <div><Label htmlFor="r-plus">Alasan stok ditambah</Label>
                <Select id="r-plus" value={reasonPlus} onChange={(e) => setReasonPlus(e.target.value)}>{PLUS_REASONS.map((r) => <option key={r} value={r}>{reasonText(r)}</option>)}</Select></div>}
              {minus && <div><Label htmlFor="r-minus">Alasan stok dikurangi</Label>
                <Select id="r-minus" value={reasonMinus} onChange={(e) => setReasonMinus(e.target.value)}>{MINUS_REASONS.map((r) => <option key={r} value={r}>{reasonText(r)}</option>)}</Select></div>}
              <div><Label htmlFor="r-cause">Penyebab selisih</Label>
                <Select id="r-cause" value={cause || autoCause} onChange={(e) => setCause(e.target.value as CauseCode)}>
                  {Object.entries(CAUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
              <div className="md:col-span-3"><Label htmlFor="r-note">Keterangan</Label>
                <Input id="r-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. palet di CC27D02 dinolkan impor, fisik masih ada" /></div>
            </div>
          )}
          {editable && (
            <ConfirmButton title={`Terapkan koreksi SKU ${line.sku}`} confirmLabel="Terapkan koreksi" summary={planSentence(p, line.sku)}
              extra={<p className="text-xs text-steel-500">Semua baris diposting sekaligus atau tidak sama sekali. Baris rekonsiliasi ini jadi &quot;Selesai&quot;, angka hari itu tetap tersimpan.</p>}
              onConfirm={apply} disabled={person.trim().length < 2 || p.blockers.length > 0 || samePerson}>
              Terapkan koreksi
            </ConfirmButton>
          )}
        </div>
      )}
      {!hasWork && p.checks.length > 0 && (
        <p className="rounded-md bg-ok/10 p-2 text-ok">Semua bin yang dicek cocok dengan sistem.{num(p.gap_before) !== 0 && " Selisih belum ketemu: cek bin lain di langkah 2."}</p>
      )}
      {done && <p className="rounded-md bg-ok/10 p-2 text-ok">{done}</p>}
    </div>
  );
}

function FixHistory({ fixes }: { fixes: FixRow[] }) {
  return (
    <div className="space-y-1 border-t border-steel-100 pt-3 text-sm">
      <p className="font-semibold">Koreksi yang sudah diterapkan</p>
      {fixes.map((f) => (
        <div key={f.id} className="rounded bg-paper p-2 text-xs">
          <b>{fmtDateTime(f.applied_at)}</b> · {f.applied_name}{f.checker_names.length > 0 && ` (dicek ${f.checker_names.join(", ")})`}
          {num(f.transfer_qty) > 0 && ` · Bin To Bin ${fmtNum(num(f.transfer_qty))}`}
          {num(f.adjust_abs) > 0 && ` · adjustment ${signed(num(f.net_adjust))}`}
          {f.cause && ` · ${(CAUSES as Record<string, string>)[f.cause] ?? f.cause}`}
          {f.note && <div className="text-steel-500">{f.note}</div>}
          <div className="text-steel-500">
            {f.plan.transfers.map((t) => `${t.from_bin}→${t.to_bin} ${fmtNum(num(t.quantity))}`).concat(f.plan.adjustments.map((a) => `${a.bin_code} ${signed(num(a.quantity))}`)).join(" · ")}
          </div>
        </div>
      ))}
    </div>
  );
}
