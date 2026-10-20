import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Boxes } from "lucide-react";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { pairMoves } from "@/lib/allocator/pair-moves";
import { SHIPMENT_STATE_LABEL, SHIPMENT_STATE_TONE } from "@/lib/pick-audit";
import { waveNextStep } from "@/lib/wave-next-step";
import type { OutboundRow, WaveRow } from "@/lib/allocator/picklist-from-tasks";
import { BinButton } from "../bin-panel";
import { LineMenu, LinePrimary, type LineItem } from "../line-menu";
import { OrderQtyButton } from "../wave-corrections";
import { WaveMenu } from "../wave-menu";
import { WavePrimary } from "../wave-primary";
import { Actual, BinChip, REASON, StatusTag, type OutboundDetail } from "../wave-parts";
import { filterActive, foldDone, lineCancelled, lineDone, lineProps, rowMatches, type RowFilter, type WaveModel } from "../wave-model";
import { DoButton } from "../do-dialog";

const PickingPanel = dynamic(() => import("../picking-panel").then((m) => m.PickingPanel), {
  ssr: false, loading: () => <p className="p-4 text-sm text-steel-500">Membuka layar picking…</p>,
});

const TONE = { normal: "text-steel", bad: "font-semibold text-bad", muted: "text-steel-500" } as const;

/**
 * Screen 2 on a phone (spec §2.2): one wave. A top bar with back and the wave's menu, progress and
 * the next step, the lines as cards (open first), and the one primary button pinned above the
 * bottom navigation. Mulai picking opens the picking screen full screen.
 */
export function WaveScreen({ model: m, wave: w, filter, onClearFilter, onBack, picking, onStartPicking, onClosePicking, onShowProblems }: {
  model: WaveModel; wave: WaveRow; filter: RowFilter; onClearFilter: () => void; onBack: () => void;
  picking: boolean; onStartPicking: () => void; onClosePicking: () => void; onShowProblems: () => void;
}) {
  const tasks = useMemo(() => m.tasks.filter((t) => t.wave_id === w.id), [m.tasks, w.id]);
  const outbound = m.outbound.filter((o) => o.wave_id === w.id);
  const f = m.facts.get(w.id)!;
  const next = waveNextStep(f);
  const done = f.total - f.open;
  const [showDone, setShowDone] = useState(w.status === "COMPLETED");
  const [showCancelled, setShowCancelled] = useState(false);
  const [showOrders, setShowOrders] = useState(false);

  if (picking) {
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-paper p-3 pb-8">
        <PickingPanel wave={w} tasks={tasks}
          orders={outbound.map((o) => ({ shipment_number: o.shipment_number, sku: o.sku, description: o.description, quantity_requested: Number(o.quantity_requested), shortage_reason: o.shortage_reason }))}
          onClose={onClosePicking} />
      </div>
    );
  }

  const active = filterActive(filter);
  const all = pairMoves(tasks);
  const rows = active ? all.filter((it) => rowMatches(it, filter, m.short, m.waits)) : all;
  const cancelledCount = rows.filter(lineCancelled).length;
  const visible = showCancelled || w.status === "CANCELLED" ? rows : rows.filter((it) => !lineCancelled(it));
  const openRows = foldDone(visible, false).listed;
  const doneRows = visible.filter(lineDone);
  const shortOrders = outbound.filter((o) => Number(o.quantity_allocated) < Number(o.quantity_requested));
  const primary = <WavePrimary model={m} wave={w} primary={next.primary} layout="phone" onStart={onStartPicking} onShowProblems={onShowProblems} />;
  const hasPrimary = next.primary === "mulai" || next.primary === "lihat" || next.primary === "tutup" || (next.primary === "aktifkan" && m.supervisor);

  return (
    <div className="-mx-4 -mt-4">
      <div className="sticky top-0 z-20 flex items-center gap-1 border-b border-steel-100 bg-white/95 px-1 backdrop-blur">
        <button type="button" aria-label="Kembali ke daftar wave" onClick={onBack}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-steel-700 hover:bg-steel-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 py-1">
          <h1 className="font-cond text-xl font-semibold leading-tight">{/^\d{8,}$/.test(w.wave_no) ? w.wave_no : `NO ${w.wave_no}`}{w.planned_slot ? ` · ${w.planned_slot}` : ""}</h1>
          <p className="truncate text-xs text-steel-500 tabular">{w.shipment_numbers.join(", ")}</p>
        </div>
        <WaveMenu wave={w} tasks={tasks} supervisor={m.supervisor} rpc={m.rpc} layout="phone" onStartPicking={onStartPicking} onPrint={() => m.printWave(w)} />
        <DoButton wave={w} shipments={w.shipment_numbers} dos={m.dos} supervisor={m.supervisor} rpc={m.rpc} />
      </div>

      <div className={cn("space-y-3 px-4 pt-3", hasPrimary ? "pb-28" : "pb-4")}>
        <div className="space-y-2 rounded-lg bg-white p-3">
          <div className="flex items-center gap-2 text-sm tabular">
            {w.status !== "PENDING" && <StatusTag status={w.status} />}
            <span className="ml-auto">{fmtNum(done)}/{fmtNum(f.total)} baris{f.qtyTotal ? ` · ${fmtNum(f.qtyDone ?? 0)}/${fmtNum(f.qtyTotal)} karton` : ""}</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-steel-100" aria-hidden>
            <div className="h-full bg-ok" style={{ width: `${f.qtyTotal ? (((f.qtyDone ?? 0) / (f.qtyTotal ?? 1)) * 100) : (f.total ? (done / f.total) * 100 : 0)}%` }} />
          </div>
          <p className={cn("text-sm", TONE[next.tone])}>{next.text}</p>
          {w.shipment_numbers.some((sh) => m.audit[`${w.id}|${sh}`]) && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {w.shipment_numbers.map((sh) => {
                const st = m.audit[`${w.id}|${sh}`];
                const key = `${w.id}|${sh}`;
                const shipmentDos = m.dos[key] ?? [];
                return (
                  <span key={sh} className="tabular">
                    {sh}
                    {st && <span className={cn("ml-1 rounded px-1.5 text-xs font-semibold", SHIPMENT_STATE_TONE[st])}>{SHIPMENT_STATE_LABEL[st]}</span>}
                    {shipmentDos.length > 0 && (
                      <span className="ml-1.5 text-xs text-steel-400 tabular">
                        DO: {shipmentDos.slice(0, 2).join(", ")}{shipmentDos.length > 2 ? ` +${shipmentDos.length - 2}` : ""}
                      </span>
                    )}
                  </span>
                );
              })}
            </p>
          )}
          {(w.truck || w.destination) && <p className="text-sm text-steel-500">{[w.truck, w.destination].filter(Boolean).join(" · ")}</p>}
        </div>

        {active && (
          <p className="flex items-center justify-between rounded-md bg-ckb-tint/60 px-3 py-2 text-sm">
            <span>Hanya baris yang cocok dengan &quot;{filter.q}&quot;</span>
            <button type="button" className="h-11 px-2 font-semibold underline" onClick={onClearFilter}>Hapus</button>
          </p>
        )}

        {openRows.map((it) => <LineCard key={head(it).id} model={m} wave={w} item={it} />)}
        {openRows.length === 0 && doneRows.length > 0 && !showDone && <p className="px-1 text-sm text-steel-500">Tidak ada baris yang belum diposting.</p>}

        {doneRows.length > 0 && (
          <button type="button" className="h-11 w-full rounded-md text-sm font-medium text-steel-700 underline" onClick={() => setShowDone((v) => !v)}>
            {showDone ? `${fmtNum(doneRows.length)} selesai — sembunyikan` : `${fmtNum(doneRows.length)} selesai — tampilkan`}
          </button>
        )}
        {showDone && doneRows.map((it) => <LineCard key={head(it).id} model={m} wave={w} item={it} />)}

        {cancelledCount > 0 && w.status !== "CANCELLED" && (
          <button type="button" className="h-11 w-full rounded-md text-sm text-steel-500 underline" onClick={() => setShowCancelled((v) => !v)}>
            {showCancelled ? "Sembunyikan" : "Tampilkan"} dibatalkan ({cancelledCount})
          </button>
        )}

        <button type="button" className="h-11 w-full rounded-md text-sm font-medium text-steel-700 underline" onClick={() => setShowOrders((v) => !v)}>
          {showOrders ? "Sembunyikan" : "Tampilkan"} order ({outbound.length}){shortOrders.length > 0 && `, ${shortOrders.length} kurang`}
        </button>
        {showOrders && outbound.map((o, i) => <OrderCard key={i} model={m} wave={w} order={o} />)}
      </div>

      {hasPrimary && (
        <div data-pinned-bar className="fixed inset-x-0 z-30 border-t border-steel-100 bg-white/95 p-3 backdrop-blur" style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}>
          {primary}
        </div>
      )}
    </div>
  );
}

const head = (it: LineItem) => (it.kind === "pair" ? it.pick : it.task);

/**
 * One line as a card: the yellow plate, what to take and where it goes, its state. Tapping the card
 * opens the line's menu (a bottom sheet); an open line's Posting stays on the card.
 */
function LineCard({ model: m, wave: w, item: it }: { model: WaveModel; wave: WaveRow; item: LineItem }) {
  const [menu, setMenu] = useState(false);
  const p = lineProps(m, w, it);
  const t = head(it);
  const postable = t.status === "PLANNED" && p.canPost;
  const kind = it.kind === "pair" ? `Pick ${t.shipment_number}` : t.task_type === "PICK" ? `Pick ${t.shipment_number}` : "Relokasi";
  const to = it.kind === "pair"
    ? <>Truk, sisa {fmtNum(Number(it.move.quantity))} ke <b>{it.move.to_bin}</b></>
    : <>{t.to_bin ? <b>{t.to_bin}</b> : "Truk"}{m.rest.has(t.id) && <>, sisa: <b>{m.rest.get(t.id)}</b></>}</>;
  const bins = [...new Set([t.from_bin, it.kind === "pair" ? it.move.to_bin : t.to_bin].filter((b): b is string => !!b))];

  return (
    <div className={cn("rounded-lg bg-white", p.isShort && "ring-2 ring-bad/60", t.status === "CANCELLED" && "opacity-60")}>
      <button type="button" aria-haspopup="dialog" aria-label={`${p.label}: ${t.from_bin}, ${t.sku}. Buka menu baris`}
        onClick={() => setMenu(true)} className="block w-full p-3 text-left active:bg-steel-100">
        <span className="flex items-start justify-between gap-2">
          <BinChip code={t.from_bin} size="md" />
          <span className="text-right">
            <span className="block font-cond text-2xl font-semibold leading-none tabular">{fmtNum(Number(t.quantity))} <span className="text-base">{t.uom}</span>{t.breaks_pallet && " *"}</span>
            <span className="mt-1 block text-xs text-steel-500">#{t.seq} · {kind}</span>
          </span>
        </span>
        <span className="mt-2 block text-sm"><b className="tabular">{t.sku}</b> <span className="text-steel-700">{t.description}</span></span>
        <span className="block text-xs text-steel-500">Batch {t.batch_lot || "–"} · Exp {fmtDate(t.expiry_date)}</span>
        <span className="block text-sm">Ke: {to}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <StatusTag status={t.status} />
          {p.isShort && <span className="font-semibold text-bad">stok kurang</span>}
          {t.completed_at && <span className="text-steel-500">{t.picked_by_name ?? t.completed_by_name} · {fmtDateTime(t.completed_at)}</span>}
        </span>
        <Actual task={t} />{it.kind === "pair" && <Actual task={it.move} label="Sisa dipindah" />}
      </button>
      {postable && <div className="flex justify-end border-t border-steel-100 px-3 py-2"><LinePrimary {...p} /></div>}
      <LineMenu {...p} trigger={null} open={menu} onOpenChange={setMenu}
        extra={bins.map((b) => <div key={b}><BinButton code={b}><Boxes className="h-4 w-4" />Isi bin {b}</BinButton></div>)} />
    </div>
  );
}

/** One order line: requested, allocated, picked, and the shortage with its reason. */
function OrderCard({ model: m, wave: w, order: o }: { model: WaveModel; wave: WaveRow; order: OutboundRow & OutboundDetail }) {
  const gap = Number(o.quantity_requested) - Number(o.quantity_allocated);
  const pickedShort = o.status === "COMPLETED" && Number(o.quantity_picked) < Number(o.quantity_allocated);
  const key = `${w.id}|${o.shipment_number}`;
  const shipmentDos = m.dos[key] ?? [];
  return (
    <div className="space-y-1 rounded-lg bg-white p-3 text-sm">
      <p className="flex items-baseline justify-between gap-2"><b className="tabular">{o.sku}</b><span className="text-xs text-steel-500 tabular">{o.shipment_number}</span></p>
      <p className="text-steel-700">{o.description}</p>
      <p className="grid grid-cols-3 gap-2 tabular">
        <span><span className="block text-xs text-steel-500">Diminta</span>{fmtNum(Number(o.quantity_requested))}</span>
        <span><span className="block text-xs text-steel-500">Teralokasi</span>{fmtNum(Number(o.quantity_allocated))}</span>
        <span className={cn(pickedShort && "font-semibold text-bad")}><span className="block text-xs text-steel-500">Terambil</span>{fmtNum(Number(o.quantity_picked))}</span>
      </p>
      {gap > 0 && <p className="font-semibold text-bad">Kurang {fmtNum(gap)} · {REASON[o.shortage_reason ?? ""] ?? o.shortage_reason ?? ""}</p>}
      {shipmentDos.length > 0 && <p className="text-xs text-steel-400 tabular">DO: {shipmentDos.join(", ")}</p>}
      <div className="flex items-center justify-between gap-2">
        <StatusTag status={o.status} />
        {m.supervisor && w.status !== "CANCELLED" && (
          <OrderQtyButton waveId={w.id} shipment={o.shipment_number} sku={o.sku} description={o.description}
            requested={Number(o.quantity_requested)} picked={Number(o.quantity_picked)} />
        )}
      </div>
    </div>
  );
}
