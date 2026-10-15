"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, FileSpreadsheet, FileText, MoreHorizontal, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { ConfirmButton } from "@/components/app/confirm-button";
import { ActionMenu, MenuSection } from "@/components/app/action-menu";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import type { Role } from "@/lib/types";
import { restNotesFromTasks, type OutboundRow, type TaskRow, type WaveRow } from "@/lib/allocator/picklist-from-tasks";
import { replanRemaining } from "@/lib/allocator/browser/plan-client";
import { SHIPMENT_STATE_LABEL, SHIPMENT_STATE_TONE, type ShipmentState } from "@/lib/pick-audit";
import { dayNextStep, waveNextStep, waveOrder, type DayStep, type WaveFacts } from "@/lib/wave-next-step";
import { movesOfPicks, pairMoves } from "@/lib/allocator/pair-moves";
import { OrderQtyButton } from "./wave-corrections";
import { BinButton } from "./bin-panel";
import { CorrectionsPanel, type PicklistCorrection } from "./corrections-panel";
import { EscalationsPanel, type LineRequest } from "./escalations-panel";
import { ProblemsPanel, type OpenCount } from "./problems-panel";
import { Actual, AddOrder, REASON, StatusTag, printBinToBin, printExcel, printPicklists, type OutboundDetail, type Rpc, type TaskWait } from "./wave-parts";
import { LineMenu, LinePrimary, type LineItem } from "./line-menu";
import { WaveMenu } from "./wave-menu";
import { DayBar } from "./day-bar";
import { ProblemsSummary, type ProblemCounts } from "./problems-summary";
import { useIsPhone } from "./use-is-phone";
import { NO_FILTER, filterActive, foldDone, lineCancelled, lineProps, rowMatches, waveHref, type RowFilter, type WaveModel } from "./wave-model";
import { WavePrimary } from "./wave-primary";

export type { OutboundDetail, TaskWait } from "./wave-parts";
export { rowMatches, lineIds, lineDone, lineCancelled, type RowFilter, type WaveModel } from "./wave-model";

const PickingPanel = dynamic(() => import("./picking-panel").then((m) => m.PickingPanel), {
  ssr: false, loading: () => <p className="border-t border-steel-100 p-4 text-sm text-steel-500">Membuka layar picking…</p>,
});
const WavesPhone = dynamic(() => import("./mobile/phone-layout").then((m) => m.WavesPhone), {
  ssr: false, loading: () => <p className="p-4 text-sm text-steel-500">Membuka…</p>,
});
const WaveSheetPanel = dynamic(() => import("./wave-sheet").then((m) => m.WaveSheetPanel), {
  ssr: false, loading: () => <p className="border-t border-steel-100 p-4 text-sm text-steel-500">Membuka lembar picklist…</p>,
});

/**
 * The Wave page: one address, two layouts — the desktop layout below and a dedicated phone layout
 * (mobile/phone-layout.tsx) under 768 px. Same data, same actions; only the arrangement differs.
 */
export function WavesClient({ date, prevDate, nextDate, role, waves, tasks, outbound, shortfalls, audit, waits = {}, counts = [], lastImport = null, corrections = [], requests = [] }: {
  date: string; prevDate: string | null; nextDate: string | null;
  role: Role; waves: WaveRow[]; tasks: TaskRow[]; outbound: (OutboundRow & OutboundDetail)[];
  /** ids of open tasks the current stock can no longer satisfy */
  shortfalls: string[];
  /** audit / loading state per `${wave_id}|${shipment}` (0024) */
  audit: Record<string, ShipmentState>;
  /** open tasks that must wait for a relocation into their bin, by task id */
  waits?: Record<string, TaskWait>;
  /** counts opened by a short pick, still to be done */
  counts?: OpenCount[];
  /** when the last full WMS import replaced the stock */
  lastImport?: string | null;
  /** koreksi picklist booked for this date's waves (0057) */
  corrections?: PicklistCorrection[];
  /** Minta supervisor (0067): picker lines the picking screen could not post */
  requests?: LineRequest[];
}) {
  const router = useRouter();
  const phone = useIsPhone();
  // The open wave lives in the address (?wave=), written with history.pushState / replaceState so
  // opening a wave needs no server round trip, browser back closes it, and both layouts agree.
  const params = useSearchParams();
  const openWave = params.get("wave");
  const [person, setPerson] = usePersonName();
  const supervisor = role === "supervisor" || role === "admin";
  // The request whose line the sheet opens at (Isi dari picklist, desktop only).
  const [sheetAt, setSheetAt] = useState<LineRequest | null>(null);

  async function rpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
    const { error } = await createClient().rpc(fn, args);
    if (error) return error.message;
    router.refresh();
    return null;
  }

  const short = useMemo(() => new Set(shortfalls), [shortfalls]);
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  // Same rule as replaceable_waves(): pending and nothing posted/cancelled yet.
  const untouched = waves.filter((w) => w.status === "PENDING" && tasks.every((t) => t.wave_id !== w.id || t.status === "PLANNED"));
  const shortInUntouched = untouched.some((w) => tasks.some((t) => t.wave_id === w.id && short.has(t.id)));

  async function replan(): Promise<string | null> {
    try {
      const r = await replanRemaining(createClient(), date);
      if (!r) return "Tidak ada wave yang belum dikerjakan.";
      router.refresh();
      return null;
    } catch (e) { return (e as Error).message; }
  }
  const replanButton = (variant: "outline" | "accent") => (
    <ConfirmButton size="sm" variant={variant} title="Hitung ulang wave tersisa" confirmLabel="Hitung ulang"
      summary={`Hitung ulang ${untouched.length} wave yang belum dikerjakan (NO ${untouched.map((w) => w.wave_no).join(", ")}) dari stok saat ini. Wave yang sudah berjalan tidak diubah. Picklist wave tersebut berubah — cetak ulang setelahnya.`}
      onConfirm={replan}><RefreshCw className="h-4 w-4" />Hitung ulang wave tersisa</ConfirmButton>
  );

  const facts = new Map<string, WaveFacts>(waves.map((w) => {
    const mine = live.filter((t) => t.wave_id === w.id);
    const open = mine.filter((t) => t.status === "PLANNED");
    const states = w.shipment_numbers.map((sh) => audit[`${w.id}|${sh}`]).filter(Boolean);
    const finished = mine.map((t) => t.completed_at).filter((x): x is string => !!x).sort().pop() ?? null;
    const qtyTotal = mine.reduce((s, t) => s + Number(t.quantity), 0);
    const qtyDone = mine
      .filter((t) => t.status === "COMPLETED")
      .reduce((s, t) => s + Number(t.actual_quantity ?? t.quantity), 0);
    return [w.id, {
      id: w.id, wave_no: w.wave_no, planned_slot: w.planned_slot, status: w.status,
      open: open.length, total: mine.length, qtyTotal, qtyDone, blocked: open.filter((t) => short.has(t.id) || !!waits[t.id]).length,
      finishedAt: w.status === "COMPLETED" ? finished : null, cancelledAt: null,
      audit: w.status === "COMPLETED" && states.length > 0 ? { done: states.filter((s) => s === "READY_LOAD" || s === "LOADED").length, total: w.shipment_numbers.length } : null,
    }];
  }));
  const waveNoOf = (id: string) => waves.find((w) => w.id === id)?.wave_no ?? "?";
  const step = dayNextStep([...facts.values()], {
    short: live.filter((t) => short.has(t.id)).map((t) => ({ wave_no: waveNoOf(t.wave_id) })),
    requests: requests.length,
    waiting: live.filter((t) => t.status === "PLANNED" && !!waits[t.id]).map((t) => ({ wave_no: waveNoOf(t.wave_id) })),
  });
  const problems: ProblemCounts = {
    short: short.size, waiting: Object.keys(waits).length, counts: counts.length, requests: requests.length, corrections: corrections.length,
  };

  const model: WaveModel = {
    date, prevDate, nextDate, waves, tasks, outbound, supervisor, rpc, onDone: () => router.refresh(),
    short, waits, audit, rest: restNotesFromTasks(waves, tasks),
    // 0073: picks whose pallet's relokasi is already posted (posted alone to unblock another
    // wave) may not be cancelled: the moved cartons stay moved and the pickface keeps the rest.
    postedMoveOf: new Map([...movesOfPicks([...tasks].sort((a, b) => a.seq - b.seq), { anyState: true })]
      .filter(([, m]) => m.status === "COMPLETED")),
    facts, ordered: waveOrder([...facts.values()]).map((f) => waves.find((w) => w.id === f.id)!),
    step, problems,
    posted: live.filter((t) => t.status === "COMPLETED").length, total: live.length,
    postedQty: live.filter((t) => t.status === "COMPLETED").reduce((s, t) => s + Number(t.actual_quantity ?? t.quantity), 0),
    totalQty: live.reduce((s, t) => s + Number(t.quantity), 0),
    panels: (layout) => (
      <>
        <PersonNameField className="max-w-xs" value={person} onChange={setPerson} label="Nama Anda (untuk Tutup, Perbaiki)" />
        <ProblemsPanel waves={waves} tasks={tasks} short={short} waits={waits} counts={counts} lastImport={lastImport} supervisor={supervisor} rpc={rpc}
          extra={supervisor && untouched.length > 0 && shortInUntouched ? replanButton("accent") : undefined} />
        <EscalationsPanel rows={requests} supervisor={supervisor} person={person} layout={layout} onOpenSheet={setSheetAt} />
        <CorrectionsPanel date={date} rows={corrections} canAdjust={supervisor} />
      </>
    ),
    dayMenu: (iconOnly) => (
      <ActionMenu title="Hari ini" trigger={iconOnly
        ? <Button variant="ghost" size="icon" className="h-11 w-11 text-steel-700" aria-label="Menu hari ini"><MoreHorizontal className="h-5 w-5" /></Button>
        : undefined}>
        <MenuSection>
          {supervisor && <div><AddOrder date={date} /></div>}
          {supervisor && untouched.length > 0 && short.size === 0 && <div>{replanButton("outline")}</div>}
          <div><Button variant="outline" size="sm" onClick={() => printPicklists(waves, waves, tasks, outbound, `picklist_${date}.pdf`)}>
            <FileText className="h-4 w-4" />PDF semua picklist</Button></div>
          <div><Button variant="outline" size="sm" onClick={() => printBinToBin(waves, tasks, `bintobin_${date}.pdf`)}>
            <FileText className="h-4 w-4" />PDF Bin To Bin</Button></div>
          <div><Button variant="outline" size="sm" onClick={() => printExcel(waves, waves, tasks, outbound, `picklist_${date}.xlsx`)}>
            <FileSpreadsheet className="h-4 w-4" />Excel picklist</Button></div>
        </MenuSection>
      </ActionMenu>
    ),
    printWave: (w) => printPicklists([w], waves, tasks, outbound, `picklist_NO${w.wave_no}_${w.planned_date}.pdf`),
  };

  if (phone) return <WavesPhone model={model} openWave={openWave} picking={params.get("pick") === "1"} />;
  return <WavesDesktop model={model} openWave={openWave} sheetAt={sheetAt} onSheetAtDone={() => setSheetAt(null)} />;
}

function WavesDesktop({ model: m, openWave, sheetAt, onSheetAtDone }: {
  model: WaveModel; openWave: string | null; sheetAt: LineRequest | null; onSheetAtDone: () => void;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(openWave);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [filter, setFilter] = useState<RowFilter>(NO_FILTER);
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => { setOpenId(openWave); }, [openWave]);
  // A request opened in Isi dari picklist opens its wave.
  useEffect(() => { if (sheetAt) setOpenId(sheetAt.wave_id); }, [sheetAt]);

  function open(id: string | null) {
    setOpenId(id);
    window.history.replaceState(null, "", waveHref(m.date, id));
  }
  function goStep() {
    const t = m.step.target;
    if (!t) return;
    if (t.kind === "problems") {
      setProblemsOpen(true);
      setTimeout(() => document.getElementById("perlu-ditangani")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } else {
      open(t.id);
      setTimeout(() => document.getElementById(`wave-${t.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  const active = filterActive(filter);
  return (
    <>
      <DayBar date={m.date} prevDate={m.prevDate} nextDate={m.nextDate} posted={m.posted} total={m.total} postedQty={m.postedQty} totalQty={m.totalQty} step={m.step} onStep={goStep} dayMenu={m.dayMenu()} />
      <ProblemsSummary counts={m.problems} open={problemsOpen} onOpenChange={setProblemsOpen}>{m.panels("desktop")}</ProblemsSummary>

      {m.waves.length === 0 ? (
        <Card><CardContent className="space-y-2 text-sm">
          <p>Belum ada rencana untuk {fmtDate(m.date)}.</p>
          {m.supervisor && <p><Link href="/allocate" className="font-semibold underline">Jalankan alokasi</Link></p>}
        </CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-80 max-w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-500" />
              <Input aria-label="Cari SKU, bin, shipment" placeholder="Cari SKU, bin, shipment" value={filter.q} className="pl-9"
                onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
            </div>
            <Button variant="ghost" size="sm" className="h-10" aria-expanded={showFilter} onClick={() => setShowFilter((v) => !v)}>
              <SlidersHorizontal className="h-4 w-4" />Filter{filter.onlyOpen || filter.onlyProblems ? " (aktif)" : ""}
            </Button>
            {showFilter && (
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={filter.onlyOpen} onChange={(e) => setFilter({ ...filter, onlyOpen: e.target.checked })} />Hanya yang belum diposting</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={filter.onlyProblems} onChange={(e) => setFilter({ ...filter, onlyProblems: e.target.checked })} />Hanya yang bermasalah</label>
              </div>
            )}
            {active && <button className="text-sm underline" onClick={() => setFilter(NO_FILTER)}>Hapus filter</button>}
          </div>
          <div className="space-y-2">
            {m.ordered.map((w) => (
              <WaveBlock key={w.id} model={m} wave={w} open={openId === w.id || (active && openId === null)} onToggle={() => open(openId === w.id ? null : w.id)}
                filter={filter} onShowProblems={() => { setProblemsOpen(true); setTimeout(() => document.getElementById("perlu-ditangani")?.scrollIntoView({ behavior: "smooth" }), 50); }}
                sheetAt={sheetAt?.wave_id === w.id ? sheetAt : null} onSheetAtDone={onSheetAtDone} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

const TONE = { normal: "text-steel", bad: "font-semibold text-bad", muted: "text-steel-500" } as const;

/** One wave on the desktop: a compact header (next step, one button, menu), its lines when opened. */
function WaveBlock({ model: m, wave: w, open, onToggle, filter, onShowProblems, sheetAt, onSheetAtDone }: {
  model: WaveModel; wave: WaveRow; open: boolean; onToggle: () => void; filter: RowFilter; onShowProblems: () => void;
  sheetAt: LineRequest | null; onSheetAtDone: () => void;
}) {
  const tasks = useMemo(() => m.tasks.filter((t) => t.wave_id === w.id), [m.tasks, w.id]);
  const outbound = m.outbound.filter((o) => o.wave_id === w.id);
  const f = m.facts.get(w.id)!;
  const next = waveNextStep(f);
  // Isi dari picklist (0057) and Mulai picking (0067) open in place of the lines, for this wave only.
  const [sheet, setSheet] = useState(false);
  const [sheetFromRequest, setSheetFromRequest] = useState(false);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (sheetAt) { setSheet(true); setSheetFromRequest(true); }
    else if (sheetFromRequest) { setSheet(false); setSheetFromRequest(false); }
  }, [sheetAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const allRows = pairMoves(tasks);
  const active = filterActive(filter);
  const matching = active ? allRows.filter((it) => rowMatches(it, filter, m.short, m.waits)) : allRows;
  if (active && matching.length === 0 && !sheet && !picking) return null;
  const expanded = open || sheet || picking;

  const primary = <WavePrimary model={m} wave={w} primary={next.primary} layout="desktop"
    onStart={() => { setPicking(true); if (!open) onToggle(); }} onShowProblems={onShowProblems} />;

  return (
    <Card id={`wave-${w.id}`} className={cn(expanded && "ring-1 ring-steel-300")}>
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 p-4", expanded && "border-b border-steel-100")}>
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-4 text-left">
          <span className="shrink-0 leading-tight">
            <span className="block font-cond text-lg font-semibold tabular-nums whitespace-nowrap">{/^\d{8,}$/.test(w.wave_no) ? w.wave_no : `NO ${w.wave_no}`}</span>
            <span className="block text-xs text-steel-500 tabular">{w.planned_slot ?? "–"}</span>
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {w.status !== "PENDING" && <StatusTag status={w.status} />}
              {w.shipment_numbers.map((sh) => {
                const st = m.audit[`${w.id}|${sh}`];
                return <span key={sh} className="tabular">{sh}{st && <span className={cn("ml-1 rounded px-1.5 text-xs font-semibold", SHIPMENT_STATE_TONE[st])}>{SHIPMENT_STATE_LABEL[st]}</span>}</span>;
              })}
              {(w.truck || w.destination) && <span className="text-steel-500">{[w.truck, w.destination].filter(Boolean).join(" · ")}</span>}
            </span>
            <span className={cn("block text-sm", TONE[next.tone])}>{next.text}</span>
          </span>
          <span className="w-32 shrink-0 text-right">
            <span className="block text-sm tabular">{fmtNum(f.total - f.open)}/{fmtNum(f.total)} baris</span>
            {f.qtyTotal ? <span className="block text-xs tabular text-steel-500">{fmtNum((f.qtyTotal ?? 0) - (f.qtyDone ?? 0))}/{fmtNum(f.qtyTotal)} karton</span> : null}
            <span className="mt-1 block h-1.5 overflow-hidden rounded bg-steel-100" aria-hidden>
              <span className="block h-full bg-ok" style={{ width: `${f.qtyTotal ? ((f.qtyDone ?? 0) / (f.qtyTotal ?? 1)) * 100 : (f.total ? ((f.total - f.open) / f.total) * 100 : 0)}%` }} />
            </span>
          </span>
          {expanded ? <ChevronUp className="h-5 w-5 shrink-0 text-steel-500" /> : <ChevronDown className="h-5 w-5 shrink-0 text-steel-500" />}
        </button>
        <div className="flex items-center gap-1">
          {primary}
          <WaveMenu wave={w} tasks={tasks} supervisor={m.supervisor} rpc={m.rpc} layout="desktop"
            onStartPicking={() => { setSheet(false); setPicking(true); if (!open) onToggle(); }}
            onPrint={() => m.printWave(w)} onOpenSheet={() => { setSheet(true); setSheetFromRequest(false); if (!open) onToggle(); }} />
        </div>
      </div>

      {sheet && <WaveSheetPanel key={sheetAt?.id ?? "plain"} wave={w} tasks={tasks} prefill={sheetAt?.row}
        onClose={() => { setSheet(false); setSheetFromRequest(false); if (sheetAt) onSheetAtDone(); }} />}
      {picking && <PickingPanel wave={w} tasks={tasks}
        orders={outbound.map((o) => ({ shipment_number: o.shipment_number, sku: o.sku, description: o.description, quantity_requested: Number(o.quantity_requested), shortage_reason: o.shortage_reason }))}
        onClose={() => setPicking(false)} />}
      {expanded && !sheet && !picking && <DesktopLines model={m} wave={w} rows={matching} outbound={outbound} />}
    </Card>
  );
}

/** The open wave's lines: the table as before, with only the line's next action and its menu. */
function DesktopLines({ model: m, wave: w, rows, outbound }: { model: WaveModel; wave: WaveRow; rows: LineItem[]; outbound: (OutboundRow & OutboundDetail)[] }) {
  const [showDone, setShowDone] = useState(w.status === "COMPLETED");
  const [showCancelled, setShowCancelled] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const cancelledCount = rows.filter(lineCancelled).length;
  const visible = showCancelled || w.status === "CANCELLED" ? rows : rows.filter((it) => !lineCancelled(it));
  const { listed, doneCount, toggle } = foldDone(visible, showDone);
  const shortOrders = outbound.filter((o) => Number(o.quantity_allocated) < Number(o.quantity_requested));
  const binLink = (code: string) => <BinButton code={code} className="font-semibold underline-offset-2 hover:underline">{code}</BinButton>;

  return (
    <>
      <Table>
        <thead><tr>{["#", "Jenis", "Dari", "Ke", "SKU", "Batch", "Exp", "Qty", "Status", ""].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
        <tbody>{listed.map((it) => {
          const p = lineProps(m, w, it);
          const t = it.kind === "pair" ? it.pick : it.task;
          return (
            <tr key={t.id} className={cn(t.status !== "PLANNED" && "text-steel-500", p.isShort && "bg-bad/10")}>
              <Td>{t.seq}</Td>
              <Td>{it.kind === "pair" ? <>Pick {t.shipment_number}<span className="block text-xs">+ pindah sisa palet</span></> : t.task_type === "PICK" ? `Pick ${t.shipment_number}` : "Relokasi"}</Td>
              <Td>{binLink(t.from_bin)}</Td>
              <Td>{it.kind === "pair"
                ? <>Truk<span className="block text-xs">sisa → {binLink(it.move.to_bin ?? "")}</span></>
                : <>{t.to_bin ? binLink(t.to_bin) : "Truk"}{m.rest.has(t.id) && <span className="block text-xs">sisa: <b>{m.rest.get(t.id)}</b></span>}</>}</Td>
              <Td title={t.description}>{t.sku}</Td>
              <Td>{t.batch_lot || "–"}</Td>
              <Td className="whitespace-nowrap">{fmtDate(t.expiry_date)}</Td>
              <Td className="whitespace-nowrap text-right">{fmtNum(Number(t.quantity))} {t.uom}{t.breaks_pallet && " *"}
                {it.kind === "pair" && <span className="block text-xs">sisa {fmtNum(Number(it.move.quantity))}</span>}</Td>
              <Td>
                <StatusTag status={t.status} />{p.isShort && <span className="ml-1 text-xs font-semibold text-bad">stok kurang</span>}
                {t.completed_at && <span className="block text-xs">{t.picked_by_name ?? t.completed_by_name} · {fmtDateTime(t.completed_at)}</span>}
                <Actual task={t} />{it.kind === "pair" && <Actual task={it.move} label="Sisa dipindah" />}
              </Td>
              <Td><div className="flex items-start justify-end gap-1"><LinePrimary {...p} /><LineMenu {...p} /></div></Td>
            </tr>
          );
        })}</tbody>
      </Table>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2">
        {toggle && (
          <button className="text-sm underline" onClick={() => setShowDone((v) => !v)}>
            {showDone ? `${fmtNum(doneCount)} selesai — sembunyikan` : `${fmtNum(doneCount)} selesai — tampilkan`}
          </button>
        )}
        <button className="text-sm underline" onClick={() => setShowOrders((v) => !v)}>
          {showOrders ? "Sembunyikan" : "Tampilkan"} order ({outbound.length}){shortOrders.length > 0 && `, ${shortOrders.length} kurang`}
        </button>
        {cancelledCount > 0 && w.status !== "CANCELLED" && (
          <button className="text-sm text-steel-500 underline" onClick={() => setShowCancelled((v) => !v)}>
            {showCancelled ? "Sembunyikan" : "Tampilkan"} dibatalkan ({cancelledCount})
          </button>
        )}
      </div>
      {showOrders && (
        <Table>
          <thead><tr>{["Shipment", "SKU", "Deskripsi", "Diminta", "Teralokasi", "Terambil", "Kekurangan", "Status", ""].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>{outbound.map((o, i) => {
            const gap = Number(o.quantity_requested) - Number(o.quantity_allocated);
            return (
              <tr key={i}>
                <Td>{o.shipment_number}</Td><Td>{o.sku}</Td><Td>{o.description}</Td>
                <Td className="text-right">{fmtNum(Number(o.quantity_requested))}</Td>
                <Td className="text-right">{fmtNum(Number(o.quantity_allocated))}</Td>
                <Td className={cn("text-right", o.status === "COMPLETED" && Number(o.quantity_picked) < Number(o.quantity_allocated) && "font-semibold text-bad")}>{fmtNum(Number(o.quantity_picked))}</Td>
                <Td className={cn(gap > 0 && "font-semibold text-bad")}>{gap > 0 ? `${fmtNum(gap)} · ${REASON[o.shortage_reason ?? ""] ?? o.shortage_reason ?? ""}` : "–"}</Td>
                <Td><StatusTag status={o.status} /></Td>
                <Td>{m.supervisor && w.status !== "CANCELLED" && (
                  <OrderQtyButton waveId={w.id} shipment={o.shipment_number} sku={o.sku} description={o.description}
                    requested={Number(o.quantity_requested)} picked={Number(o.quantity_picked)} />
                )}</Td>
              </tr>
            );
          })}</tbody>
        </Table>
      )}
    </>
  );
}

