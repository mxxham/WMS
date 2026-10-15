import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import { pairMoves } from "@/lib/allocator/pair-moves";
import { SHIPMENT_STATE_LABEL, SHIPMENT_STATE_TONE } from "@/lib/pick-audit";
import { waveNextStep } from "@/lib/wave-next-step";
import type { WaveRow } from "@/lib/allocator/picklist-from-tasks";
import { DayNav, StepLine } from "../day-bar";
import { WaveGuide } from "../guide";
import { ProblemsSummary } from "../problems-summary";
import { StatusTag } from "../wave-parts";
import { filterActive, rowMatches, waveHref, type RowFilter, type WaveModel } from "../wave-model";

const TONE = { normal: "text-steel", bad: "font-semibold text-bad", muted: "text-steel-500" } as const;

/**
 * Screen 1 on a phone (spec §2.1): the day. A top bar, how far the day is, the one most urgent
 * thing, what needs handling, then every wave as one tappable block — no buttons in the list.
 */
export function DayScreen({ model: m, filter, onFilter, onOpenWave, onShowProblems, onMount }: {
  model: WaveModel; filter: RowFilter; onFilter: (f: RowFilter) => void;
  onOpenWave: (id: string) => void; onShowProblems: () => void; onMount: () => void;
}) {
  const [search, setSearch] = useState(filter.q !== "");
  useEffect(() => { onMount(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const active = filterActive(filter);

  function onStep() {
    const t = m.step.target;
    if (t?.kind === "problems") onShowProblems();
    else if (t?.kind === "wave") onOpenWave(t.id);
  }

  return (
    <div className="-mx-4 -mt-4">
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-steel-100 bg-white/95 px-1 backdrop-blur">
        <DayNav date={m.date} prevDate={m.prevDate} nextDate={m.nextDate} compact />
        <div className="flex items-center">
          <button type="button" aria-label="Cari SKU, bin, shipment" aria-expanded={search}
            className={cn("inline-flex h-11 w-11 items-center justify-center rounded-md text-steel-700 hover:bg-steel-100", search && "bg-steel-100")}
            onClick={() => { if (search) onFilter({ ...filter, q: "" }); setSearch(!search); }}>
            {search ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
          <WaveGuide variant="phone" />
          {m.dayMenu(true)}
        </div>
      </div>

      <div className="space-y-3 px-4 pt-3">
        {search && (
          <Input autoFocus aria-label="Cari SKU, bin, shipment" placeholder="Cari SKU, bin, shipment di semua wave" value={filter.q}
            onChange={(e) => onFilter({ ...filter, q: e.target.value })} />
        )}
        <p className="text-sm text-steel-500 tabular">{fmtNum(m.posted)}/{fmtNum(m.total)} baris diposting{m.totalQty ? ` · ${fmtNum(m.postedQty ?? 0)}/${fmtNum(m.totalQty)} karton` : ""}</p>
        <StepLine step={m.step} onStep={onStep} />
        <ProblemsSummary counts={m.problems} open={false} onOpenChange={onShowProblems}>{null}</ProblemsSummary>

        {m.waves.length === 0 ? (
          <div className="space-y-2 rounded-lg bg-white p-4 text-sm">
            <p>Belum ada rencana untuk {fmtDate(m.date)}.</p>
            {m.supervisor && <p><Link href="/allocate" className="font-semibold underline">Jalankan alokasi</Link></p>}
          </div>
        ) : (
          <ul className="space-y-2">
            {m.ordered.map((w) => {
              const hits = active ? pairMoves(m.tasks.filter((t) => t.wave_id === w.id)).filter((it) => rowMatches(it, filter, m.short, m.waits)).length : null;
              if (hits === 0) return null;
              return <li key={w.id}><WaveTile model={m} wave={w} hits={hits} onOpen={() => onOpenWave(w.id)} /></li>;
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One wave in the day list: number, slot, shipments, progress and the next step. Tapping opens it. */
function WaveTile({ model: m, wave: w, hits, onOpen }: { model: WaveModel; wave: WaveRow; hits: number | null; onOpen: () => void }) {
  const f = m.facts.get(w.id)!;
  const next = waveNextStep(f);
  const done = f.total - f.open;
  const running = w.status === "PENDING" || w.status === "RESCHEDULED";
  return (
    <a href={waveHref(m.date, w.id)} onClick={(e) => { e.preventDefault(); onOpen(); }}
      className={cn("block min-h-16 rounded-lg bg-white p-3 active:bg-steel-100", next.tone === "bad" && "ring-1 ring-bad/50", !running && "text-steel-500")}>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn("whitespace-nowrap font-cond text-lg font-semibold tabular-nums", running && "text-steel")}>{/^\d{8,}$/.test(w.wave_no) ? w.wave_no : `NO ${w.wave_no}`}</span>
        <span className="text-sm tabular">{w.planned_slot ?? "–"}</span>
        {w.status !== "PENDING" && <StatusTag status={w.status} />}
        <span className="ml-auto text-right text-sm tabular">{fmtNum(done)}/{fmtNum(f.total)} baris{f.qtyTotal ? <span className="block text-xs text-steel-500">{fmtNum(f.qtyDone ?? 0)}/{fmtNum(f.qtyTotal)} karton</span> : null}</span>
      </span>
      <span className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-steel-500">
        {w.shipment_numbers.map((sh) => {
          const st = m.audit[`${w.id}|${sh}`];
          return <span key={sh} className="tabular">{sh}{st && <span className={cn("ml-1 rounded px-1.5 text-xs font-semibold", SHIPMENT_STATE_TONE[st])}>{SHIPMENT_STATE_LABEL[st]}</span>}</span>;
        })}
      </span>
      <span className="mt-2 block h-1.5 overflow-hidden rounded bg-steel-100" aria-hidden>
        <span className="block h-full bg-ok" style={{ width: `${f.qtyTotal ? (((f.qtyDone ?? 0) / (f.qtyTotal ?? 1)) * 100) : (f.total ? (done / f.total) * 100 : 0)}%` }} />
      </span>
      <span className={cn("mt-2 block text-sm", TONE[next.tone])}>{next.text}</span>
      {hits !== null && <span className="mt-1 block text-xs font-semibold text-ckb">{fmtNum(hits)} baris cocok</span>}
    </a>
  );
}
