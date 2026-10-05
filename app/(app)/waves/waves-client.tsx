"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCheck, FileText, MoreHorizontal, RefreshCw, Truck, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { ConfirmButton } from "@/components/app/confirm-button";
import { LEVEL_COLORS } from "@/config/warehouse";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import type { Role } from "@/lib/types";
import { picklistsFromTasks, restNotesFromTasks, type OutboundRow, type StockNow, type TaskRow, type WaveRow } from "@/lib/allocator/picklist-from-tasks";
import { replanRemaining } from "@/lib/allocator/browser/plan-client";
import { SHIPMENT_STATE_LABEL, SHIPMENT_STATE_TONE, type ShipmentState } from "@/lib/pick-audit";
import { TaskPostDialog } from "./task-post-dialog";
import { AddMoveButton, EditRowButton, FixButton, OrderQtyButton, SplitButton, UnpostButton, UnpostPairButton } from "./wave-corrections";
import { PairPostDialog } from "./pair-post-dialog";
import { AddItems, AddOrder } from "./add-order";
import { pairMoves } from "@/lib/allocator/pair-moves";

// jsPDF is ~380 kB: load it only when someone actually prints.
// Sisa is replayed from the stock of the touched bins right now, over all of the day's waves (allWaves).
async function printPicklists(waves: WaveRow[], allWaves: WaveRow[], tasks: TaskRow[], outbound: OutboundRow[], filename: string) {
  const { downloadPicklistPdf } = await import("@/lib/allocator/browser/downloads");
  const bins = [...new Set(tasks.flatMap((t) => [t.from_bin, t.to_bin, t.actual_from_bin]).filter((b): b is string => !!b))];
  const { data } = await createClient().from("inventory_detail").select("bin_code, sku, batch_lot, expiry_date, quantity").in("bin_code", bins);
  downloadPicklistPdf(picklistsFromTasks(waves, tasks, outbound, (data ?? []) as StockNow[], allWaves), undefined, filename);
}

/** An open task whose bin is still waiting for a relocation into it (task_waits, 0038). */
export type TaskWait = { task_id: string; have: number; wait_wave_no: string; wait_seq: number; wait_from: string; wait_to: string; wait_qty: number;
  /** the move it waits for (0053), and its wave's status: a Tunda wave's move is posted by a supervisor */
  wait_task_id: string; wait_wave_status: string };
const waitText = (w: TaskWait) => `Tunggu relokasi NO ${w.wait_wave_no} #${w.wait_seq}: ${w.wait_from} → ${w.wait_to} (${fmtNum(Number(w.wait_qty))}). Di ${w.wait_to} baru ${fmtNum(Number(w.have))}.`;

export type OutboundDetail = {
  description: string; quantity_requested: number; quantity_allocated: number; quantity_picked: number; shortage_reason: string | null; status: string;
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-steel-100 text-steel-700", PLANNED: "bg-steel-100 text-steel-700",
  COMPLETED: "bg-ok text-white", RESCHEDULED: "bg-warn text-steel", CANCELLED: "bg-bad/15 text-bad line-through",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu", PLANNED: "Rencana", COMPLETED: "Selesai", RESCHEDULED: "Dijadwal ulang", CANCELLED: "Batal",
};
const REASON: Record<string, string> = { ALREADY_STAGED: "Sudah di staging", BLOCKED_SHELF_LIFE: "Umur simpan", NO_STOCK: "Stok tidak ada" };

/** Bin code set like the yellow location plate, with the level colour strip. */
function BinChip({ code }: { code: string }) {
  const color = LEVEL_COLORS[code.charAt(4)]?.hex;
  return (
    <span className="inline-block overflow-hidden rounded-plate bg-plate font-cond text-2xl font-bold leading-none text-steel">
      {color && <span className="block h-1" style={{ background: color }} aria-hidden />}
      <span className="block px-2 py-1">{code}</span>
    </span>
  );
}

function StatusTag({ status }: { status: string }) {
  return <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-semibold", STATUS_TONE[status])}>{STATUS_LABEL[status] ?? status}</span>;
}

/**
 * Execution view of a saved plan. Posting a task writes its ledger movement
 * (stock changes here, not when the plan was saved). Supervisors can also
 * cancel or reschedule; operators only execute.
 */
export function WavesClient({ date, role, waves, tasks, outbound, shortfalls, audit, waits = {} }: {
  date: string; role: Role; waves: WaveRow[]; tasks: TaskRow[]; outbound: (OutboundRow & OutboundDetail)[];
  /** ids of open tasks the current stock can no longer satisfy */
  shortfalls: string[];
  /** audit / loading state per `${wave_id}|${shipment}` (0024) */
  audit: Record<string, ShipmentState>;
  /** open tasks that must wait for a relocation into their bin, by task id */
  waits?: Record<string, TaskWait>;
}) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const supervisor = role === "supervisor" || role === "admin";

  async function rpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
    const { error } = await createClient().rpc(fn, args);
    if (error) return error.message;
    router.refresh();
    return null;
  }

  if (!waves.length) {
    return (
      <Card><CardContent className="space-y-2 text-sm">
        <p>Belum ada rencana untuk {fmtDate(date)}.</p>
        {supervisor && <p><Link href="/allocate" className="font-semibold underline">Jalankan alokasi →</Link></p>}
        {supervisor && <div className="pt-1"><AddOrder date={date} /></div>}
      </CardContent></Card>
    );
  }

  const done = tasks.filter((t) => t.status === "COMPLETED").length;
  const live = tasks.filter((t) => t.status !== "CANCELLED").length;
  const short = new Set(shortfalls);
  // Where an opened pallet's rest goes when its row does not move it (printed Bin To Bin note), over all of the day's waves.
  const rest = restNotesFromTasks(waves, tasks);
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

  const replanButton = (variant: "outline" | "plate") => (
    <ConfirmButton size="sm" variant={variant} title="Hitung ulang wave tersisa" confirmLabel="Hitung ulang"
      summary={`Hitung ulang ${untouched.length} wave yang belum dikerjakan (NO ${untouched.map((w) => w.wave_no).join(", ")}) dari stok saat ini. Wave yang sudah berjalan tidak diubah. Picklist wave tersebut berubah — cetak ulang setelahnya.`}
      onConfirm={replan}><RefreshCw className="h-4 w-4" />Hitung ulang wave tersisa</ConfirmButton>
  );

  return (
    <>
      {short.size > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-bad bg-white p-3 text-sm">
          <p className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-bad" />
            {short.size} tugas tidak lagi cocok dengan stok (stok dipindah manual, atau pick berbeda dari rencana).
            {!shortInUntouched && " Tugas ini ada di wave yang sudah berjalan: batalkan tugasnya atau posting dengan jumlah/bin yang benar."}
          </p>
          {supervisor && untouched.length > 0 && replanButton("plate")}
        </div>
      )}
      <PersonNameField className="max-w-xs" value={person} onChange={setPerson} label="Nama Anda (dicatat di setiap posting)" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-steel-500">{waves.length} wave · {fmtNum(done)}/{fmtNum(live)} tugas selesai · {untouched.length} wave belum dikerjakan</p>
        <div className="flex flex-wrap gap-2">
          {supervisor && <AddOrder date={date} />}
          {supervisor && untouched.length > 0 && short.size === 0 && replanButton("outline")}
          <Button variant="outline" size="sm" onClick={() => printPicklists(waves, waves, tasks, outbound, `picklist_${date}.pdf`)}>
            <FileText className="h-4 w-4" />PDF semua picklist
          </Button>
        </div>
      </div>
      {waves.map((w) => (
        <WaveCard key={w.id} wave={w} supervisor={supervisor} rpc={rpc} short={short} audit={audit} waits={waits} rest={rest} onDone={() => router.refresh()}
          print={() => printPicklists([w], waves, tasks, outbound, `picklist_NO${w.wave_no}_${w.planned_date}.pdf`)}
          tasks={tasks.filter((t) => t.wave_id === w.id)} outbound={outbound.filter((o) => o.wave_id === w.id)} />
      ))}
    </>
  );
}

function WaveCard({ wave: w, tasks, outbound, supervisor, rpc, short, audit, waits, rest, onDone, print }: {
  wave: WaveRow; tasks: TaskRow[]; outbound: (OutboundRow & OutboundDetail)[]; supervisor: boolean; print: () => void;
  /** Opened pallets without their own move: where the rest goes (same text as the printed Bin To Bin). */
  rest: Map<string, string>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<string | null>;
  short: Set<string>; audit: Record<string, ShipmentState>; waits: Record<string, TaskWait>; onDone: () => void;
}) {
  const [showOrders, setShowOrders] = useState(false);
  const [person] = usePersonName();
  const complete = () => person.trim().length < 2
    ? Promise.resolve("Isi nama Anda di atas daftar wave dulu.")
    : rpc("complete_wave_by", { p_wave_id: w.id, p_by_name: person });
  const open = tasks.filter((t) => t.status === "PLANNED");
  const done = tasks.filter((t) => t.status === "COMPLETED").length;
  const live = tasks.filter((t) => t.status !== "CANCELLED").length;
  const pending = w.status === "PENDING";
  const shortOrders = outbound.filter((o) => Number(o.quantity_allocated) < Number(o.quantity_requested));
  // A broken pallet's pick and its leftover move are one picklist line: one row, posted together (0035).
  const allRows = pairMoves(tasks);
  // Cancelled rows (leftovers of corrections) are hidden behind a toggle; a cancelled wave shows them all.
  const [showCancelled, setShowCancelled] = useState(false);
  const isCancelled = (it: (typeof allRows)[number]) => it.kind === "pair"
    ? it.pick.status === "CANCELLED" && it.move.status === "CANCELLED" : it.task.status === "CANCELLED";
  const cancelledCount = allRows.filter(isCancelled).length;
  const rows = showCancelled || w.status === "CANCELLED" ? allRows : allRows.filter((it) => !isCancelled(it));

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-cond text-xl font-semibold">NO {w.wave_no}</h2>
            <StatusTag status={w.status} />
            {w.planned_slot && <span className="text-sm font-semibold">{w.planned_slot}</span>}
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-steel-500">
            <Truck className="h-4 w-4" />{w.truck ?? "–"} · {w.destination || "–"} · shipment {w.shipment_numbers.map((sh, i) => {
              const st = audit[`${w.id}|${sh}`];
              return (
                <span key={sh}>{i > 0 && ", "}{sh}
                  {st && <Link href={`/audit/picking/${w.id}/${encodeURIComponent(sh)}`}
                    className={cn("ml-1 rounded px-1.5 text-xs font-semibold", SHIPMENT_STATE_TONE[st])}>{SHIPMENT_STATE_LABEL[st]}</Link>}
                </span>
              );
            })}
          </p>
          <div className="h-1.5 w-48 overflow-hidden rounded bg-steel-100" aria-label={`${done} dari ${live} tugas selesai`}>
            <div className="h-full bg-ok" style={{ width: `${live ? (done / live) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm"
            onClick={print}>
            <FileText className="h-4 w-4" />Picklist
          </Button>
          {pending && open.length > 0 && (
            <ConfirmButton size="sm" title={`Selesaikan NO ${w.wave_no}`} confirmLabel="Posting semua"
              summary={`Posting ${open.length} tugas tersisa (${fmtNum(open.reduce((s, t) => s + Number(t.quantity), 0))} unit) sebagai sudah dikerjakan. Jika satu bin kurang stok, tidak ada yang diposting.`}
              onConfirm={complete}>
              <CheckCheck className="h-4 w-4" />Selesaikan wave
            </ConfirmButton>
          )}
          {pending && open.length === 0 && (
            <ConfirmButton size="sm" title={`Tutup NO ${w.wave_no}`} summary="Semua tugas sudah diposting. Tandai wave dan order-nya selesai."
              onConfirm={complete}>
              <CheckCheck className="h-4 w-4" />Tutup wave
            </ConfirmButton>
          )}
          {supervisor && (pending || w.status === "RESCHEDULED") && <AddItems date={w.planned_date} wave={w} />}
          {supervisor && pending && (
            <ConfirmButton size="sm" variant="outline" title={`Jadwal ulang NO ${w.wave_no}`}
              summary="Wave ditahan (tidak bisa dikerjakan) sampai diaktifkan lagi. Tugas yang sudah diposting tetap tercatat."
              onConfirm={() => rpc("set_wave_status", { p_wave_id: w.id, p_status: "RESCHEDULED" })}>Tunda</ConfirmButton>
          )}
          {supervisor && w.status === "RESCHEDULED" && (
            <ConfirmButton size="sm" variant="outline" title={`Aktifkan NO ${w.wave_no}`} summary="Wave kembali bisa dikerjakan."
              onConfirm={() => rpc("set_wave_status", { p_wave_id: w.id, p_status: "PENDING" })}>Aktifkan</ConfirmButton>
          )}
          {supervisor && (pending || w.status === "RESCHEDULED") && (
            <ConfirmButton size="sm" variant="danger" title={`Batalkan NO ${w.wave_no}`} confirmLabel="Batalkan wave"
              summary={`Batalkan wave dan ${open.length} tugas yang belum dikerjakan. Stok yang sudah dipindah tidak dikembalikan otomatis.`}
              onConfirm={() => rpc("set_wave_status", { p_wave_id: w.id, p_status: "CANCELLED" })}>Batalkan</ConfirmButton>
          )}
        </div>
      </CardHeader>

      {/* Mobile: one card per task, big tap target. Desktop: table. */}
      <ul className="divide-y divide-steel-100 lg:hidden">
        {rows.map((it) => it.kind === "pair" ? (
          <li key={it.pick.id} className={cn("space-y-2 p-4", it.pick.status !== "PLANNED" && "opacity-60", (short.has(it.pick.id) || short.has(it.move.id)) && "bg-bad/10")}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-steel-500">#{it.pick.seq} · Pick {it.pick.shipment_number} + pindah sisa palet</span>
              <StatusTag status={it.pick.status} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/bin/${it.pick.from_bin}`}><BinChip code={it.pick.from_bin} /></Link>
              <ArrowRight className="h-4 w-4" /><span className="text-sm font-semibold">Truk {fmtNum(Number(it.pick.quantity))}</span>
              <span className="text-sm">· sisa {fmtNum(Number(it.move.quantity))} →</span><Link href={`/bin/${it.move.to_bin}`}><BinChip code={it.move.to_bin ?? ""} /></Link>
            </div>
            <p className="text-sm"><b>{fmtNum(Number(it.pick.quantity))} {it.pick.uom}</b> · {it.pick.sku} {it.pick.description}</p>
            <p className="text-xs text-steel-500">Batch {it.pick.batch_lot || "–"} · exp {fmtDate(it.pick.expiry_date)} · CASE* (buka palet)</p>
            <Actual task={it.pick} /><Actual task={it.move} label="Sisa dipindah" />
            <PairAction pick={it.pick} move={it.move} isShort={short.has(it.pick.id) || short.has(it.move.id)} wait={waits[it.pick.id]} canPost={pending} canUndo={w.status !== "CANCELLED"} canRestore={pending || w.status === "RESCHEDULED"} supervisor={supervisor} rpc={rpc} onDone={onDone} />
          </li>
        ) : ((t) => (
          <li key={t.id} className={cn("space-y-2 p-4", t.status !== "PLANNED" && "opacity-60", short.has(t.id) && "bg-bad/10")}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-steel-500">#{t.seq} · {t.task_type === "PICK" ? `Pick ${t.shipment_number}` : "Relokasi ke pickface"}</span>
              <StatusTag status={t.status} />
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/bin/${t.from_bin}`}><BinChip code={t.from_bin} /></Link>
              {t.to_bin && <><ArrowRight className="h-4 w-4" /><Link href={`/bin/${t.to_bin}`}><BinChip code={t.to_bin} /></Link></>}
            </div>
            {rest.has(t.id) && <p className="text-sm">Sisa palet: <b>{rest.get(t.id)}</b></p>}
            <p className="text-sm"><b>{fmtNum(Number(t.quantity))} {t.uom}</b> · {t.sku} {t.description}</p>
            <p className="text-xs text-steel-500">Batch {t.batch_lot || "–"} · exp {fmtDate(t.expiry_date)} · {t.breaks_pallet ? "CASE* (buka palet)" : t.pick_type}</p>
            {short.has(t.id) && <p className="text-xs font-semibold text-bad">Stok bin ini tidak cukup lagi untuk tugas ini</p>}
            <Actual task={t} />
            <TaskAction task={t} isShort={short.has(t.id)} wait={waits[t.id]} canPost={pending} canUndo={w.status !== "CANCELLED"} canRestore={pending || w.status === "RESCHEDULED"} supervisor={supervisor} rpc={rpc} onDone={onDone} />
          </li>
        ))(it.task))}
      </ul>
      <div className="hidden lg:block">
        <Table>
          <thead><tr>{["#", "Jenis", "Dari", "Ke", "SKU", "Batch", "Exp", "Qty", "Status", ""].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>{rows.map((it) => it.kind === "pair" ? (
            <tr key={it.pick.id} className={cn(it.pick.status !== "PLANNED" && "text-steel-500", (short.has(it.pick.id) || short.has(it.move.id)) && "bg-bad/10")}>
              <Td>{it.pick.seq}</Td>
              <Td>Pick {it.pick.shipment_number}<span className="block text-xs">+ pindah sisa palet</span></Td>
              <Td><Link href={`/bin/${it.pick.from_bin}`} className="font-semibold underline-offset-2 hover:underline">{it.pick.from_bin}</Link></Td>
              <Td>Truk<span className="block text-xs">sisa → <Link href={`/bin/${it.move.to_bin}`} className="font-semibold underline-offset-2 hover:underline">{it.move.to_bin}</Link></span></Td>
              <Td title={it.pick.description}>{it.pick.sku}</Td>
              <Td>{it.pick.batch_lot || "–"}</Td>
              <Td className="whitespace-nowrap">{fmtDate(it.pick.expiry_date)}</Td>
              <Td className="whitespace-nowrap text-right">{fmtNum(Number(it.pick.quantity))} {it.pick.uom} *<span className="block text-xs">sisa {fmtNum(Number(it.move.quantity))}</span></Td>
              <Td>
                <StatusTag status={it.pick.status} />{(short.has(it.pick.id) || short.has(it.move.id)) && <span className="ml-1 text-xs font-semibold text-bad">stok kurang</span>}
                {it.pick.completed_at && <span className="block text-xs">{it.pick.completed_by_name} · {fmtDateTime(it.pick.completed_at)}</span>}
                <Actual task={it.pick} /><Actual task={it.move} label="Sisa dipindah" />
              </Td>
              <Td><PairAction pick={it.pick} move={it.move} isShort={short.has(it.pick.id) || short.has(it.move.id)} wait={waits[it.pick.id]} canPost={pending} canUndo={w.status !== "CANCELLED"} canRestore={pending || w.status === "RESCHEDULED"} supervisor={supervisor} rpc={rpc} onDone={onDone} /></Td>
            </tr>
          ) : ((t) => (
            <tr key={t.id} className={cn(t.status !== "PLANNED" && "text-steel-500", short.has(t.id) && "bg-bad/10")}>
              <Td>{t.seq}</Td>
              <Td>{t.task_type === "PICK" ? `Pick ${t.shipment_number}` : "Relokasi"}</Td>
              <Td><Link href={`/bin/${t.from_bin}`} className="font-semibold underline-offset-2 hover:underline">{t.from_bin}</Link></Td>
              <Td>{t.to_bin ? <Link href={`/bin/${t.to_bin}`} className="font-semibold underline-offset-2 hover:underline">{t.to_bin}</Link> : "Truk"}
                {rest.has(t.id) && <span className="block text-xs">sisa: <b>{rest.get(t.id)}</b></span>}</Td>
              <Td title={t.description}>{t.sku}</Td>
              <Td>{t.batch_lot || "–"}</Td>
              <Td className="whitespace-nowrap">{fmtDate(t.expiry_date)}</Td>
              <Td className="whitespace-nowrap text-right">{fmtNum(Number(t.quantity))} {t.uom} {t.breaks_pallet && <span title="Membuka palet utuh">*</span>}</Td>
              <Td>
                <StatusTag status={t.status} />{short.has(t.id) && <span className="ml-1 text-xs font-semibold text-bad">stok kurang</span>}
                {t.completed_at && <span className="block text-xs">{t.completed_by_name} · {fmtDateTime(t.completed_at)}</span>}
                <Actual task={t} />
              </Td>
              <Td><TaskAction task={t} isShort={short.has(t.id)} wait={waits[t.id]} canPost={pending} canUndo={w.status !== "CANCELLED"} canRestore={pending || w.status === "RESCHEDULED"} supervisor={supervisor} rpc={rpc} onDone={onDone} /></Td>
            </tr>
          ))(it.task))}</tbody>
        </Table>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-steel-100 px-4 py-2">
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
                <Td>{supervisor && w.status !== "CANCELLED" && (
                  <OrderQtyButton waveId={w.id} shipment={o.shipment_number} sku={o.sku} description={o.description}
                    requested={Number(o.quantity_requested)} picked={Number(o.quantity_picked)} />
                )}</Td>
              </tr>
            );
          })}</tbody>
        </Table>
      )}
    </Card>
  );
}

/** What really happened, when it differs from the plan. */
function Actual({ task: t, label = "Aktual" }: { task: TaskRow; label?: string }) {
  if (!t.deviation_reason) return null;
  return (
    <span className="mt-1 block text-xs font-semibold text-steel-700">
      {label} {fmtNum(Number(t.actual_quantity))}{t.actual_from_bin && t.actual_from_bin !== t.from_bin ? ` dari ${t.actual_from_bin}` : ""}: {t.deviation_reason}
    </span>
  );
}

/** The wait (0038): Posting stays locked until the relocation into this bin is posted. */
function WaitNotice({ wait, supervisor, rpc }: { wait: TaskWait; supervisor: boolean; rpc: Rpc }) {
  const parked = wait.wait_wave_status === "RESCHEDULED";
  return (
    <div className="space-y-1">
      <p className="max-w-64 rounded bg-warn/15 p-1.5 text-xs font-semibold text-steel">{waitText(wait)}{parked && " Wave itu ditunda."}</p>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled title="Posting setelah relokasinya diposting">Posting</Button>
        {(supervisor || !parked) && (
          <PostMoveEarlyButton moveId={wait.wait_task_id} rpc={rpc}
            label={`Posting Bin To Bin NO ${wait.wait_wave_no} #${wait.wait_seq}`}
            summary={`Posting Bin To Bin NO ${wait.wait_wave_no} #${wait.wait_seq} sekarang, tanpa pick-nya: ${fmtNum(Number(wait.wait_qty))} dari ${wait.wait_from} ke ${wait.wait_to}${parked ? " (wave itu ditunda; pick-nya tetap belum dikerjakan)" : ""}. Setelah itu baris ini bisa diposting.`} />
        )}
      </div>
    </div>
  );
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<string | null>;

/**
 * "Posting Bin To Bin saja" (0053): one open move posted by itself — the pallet's rest goes to the
 * pickface now, its pick stays open — so a later wave waiting on that pickface can go on, also
 * while the move's own wave is on Tunda.
 */
function PostMoveEarlyButton({ moveId, label, summary, rpc }: { moveId: string; label: string; summary: string; rpc: Rpc }) {
  const [person] = usePersonName();
  return (
    <ConfirmButton size="sm" variant="outline" title={label} confirmLabel="Posting Bin To Bin" summary={summary}
      onConfirm={() => person.trim().length < 2
        ? Promise.resolve("Isi nama Anda di atas daftar wave dulu.")
        : rpc("post_move_early", { p_move_id: moveId, p_by_name: person })}>
      <ArrowRight className="h-4 w-4" />{label}
    </ConfirmButton>
  );
}

function PairAction({ pick, move, isShort, wait, canPost, canUndo, canRestore, supervisor, rpc, onDone }: {
  pick: TaskRow; move: TaskRow; isShort: boolean; wait?: TaskWait; canPost: boolean; canUndo: boolean; canRestore: boolean; supervisor: boolean;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<string | null>; onDone: () => void;
}) {
  if (pick.status === "COMPLETED") return supervisor && canUndo ? <UnpostPairButton pick={pick} move={move} /> : null;
  const moveOnly = (
    <PostMoveEarlyButton moveId={move.id} rpc={rpc} label="Posting Bin To Bin saja"
      summary={`Posting hanya Bin To Bin #${pick.seq}: ${fmtNum(Number(move.quantity))} dari ${move.from_bin} ke ${move.to_bin} sekarang. Pick ${fmtNum(Number(pick.quantity))} untuk truk tetap belum dikerjakan dan diposting nanti.`} />
  );
  // Stok kurang: the proposal that makes this row doable again (lib/wave-fix.ts), also on a Tunda wave.
  const fix = isShort && supervisor && canRestore && pick.status === "PLANNED" && move.status === "PLANNED" ? <FixButton pick={pick} move={move} /> : null;
  // A Tunda wave cannot be worked on, but its pallet rest may still go to the pickface for the waves that need it (0053).
  if (pick.status === "PLANNED" && !canPost && canRestore && supervisor && move.status === "PLANNED") return <div className="flex flex-wrap gap-2">{fix}{moveOnly}</div>;
  if (pick.status !== "PLANNED" || !canPost) return null;
  // A pair is one picklist line: cancelling takes the pick and its leftover move together,
  // so the move is never orphaned. Retrying is safe (cancelling an already-cancelled task is a no-op).
  const cancelPair = async (): Promise<string | null> => {
    const e1 = await rpc("set_task_status", { p_task_id: pick.id, p_status: "CANCELLED" });
    if (e1) return e1;
    if (move.status !== "COMPLETED") {
      const e2 = await rpc("set_task_status", { p_task_id: move.id, p_status: "CANCELLED" });
      if (e2) return `Pick dibatalkan, pindahan sisa gagal: ${e2}`;
    }
    return null;
  };
  return (
    <div className="flex flex-wrap gap-2">
      {fix}
      {wait ? <WaitNotice wait={wait} supervisor={supervisor} rpc={rpc} /> : <PairPostDialog pick={pick} move={move} onDone={onDone} />}
      {supervisor && (
        <MoreActions>
          {/* Source and Bin To Bin in one dialog (0052), e.g. the planned pickface is full. */}
          <EditRowButton pick={pick} move={move} />
          {move.status === "PLANNED" && moveOnly}
          {canRestore && <CancelButton run={cancelPair} />}
        </MoreActions>
      )}
    </div>
  );
}

/**
 * The supervisor's corrections behind one button, so an open row shows only
 * Posting and ⋯ on a phone. The panel opens in place (not a popover): a
 * dialog opened from it stays mounted while the panel is open.
 */
function MoreActions({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" aria-label="Koreksi" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && <div className="flex basis-full flex-wrap gap-1 rounded-md border border-steel-200 bg-steel-100/40 p-1">{children}</div>}
    </>
  );
}

/**
 * Batal without a confirmation step: cancelling is undone with one tap on
 * Pulihkan on the cancelled row, so a dialog here only slowed the floor down.
 */
function CancelButton({ run }: { run: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <Button size="sm" variant="ghost" disabled={busy}
        onClick={async () => { setBusy(true); setError(null); const e = await run(); setBusy(false); setError(e); }}>
        {busy ? "Membatalkan…" : "Batal"}
      </Button>
      {error && <span role="alert" className="text-xs text-bad">{error}</span>}
    </span>
  );
}

function TaskAction({ task: t, isShort, wait, canPost, canUndo, canRestore, supervisor, rpc, onDone }: {
  task: TaskRow; isShort: boolean; wait?: TaskWait; canPost: boolean; canUndo: boolean; canRestore: boolean; supervisor: boolean;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<string | null>; onDone: () => void;
}) {
  // A task cancelled by mistake goes back to the plan (set_task_status allows CANCELLED -> PLANNED).
  if (t.status === "CANCELLED") return supervisor && canRestore ? (
    <ConfirmButton size="sm" variant="ghost" className="underline" title={`Pulihkan tugas #${t.seq}`} confirmLabel="Pulihkan"
      summary={`Tugas #${t.seq} (${fmtNum(Number(t.quantity))} ${t.uom ?? ""} SKU ${t.sku} dari ${t.from_bin}) kembali ke rencana dan bisa diposting lagi. Pakai hanya bila dibatalkan tidak sengaja: jika jumlah order sudah diubah, tugas ini bisa membuat pick lebih.`}
      onConfirm={() => rpc("set_task_status", { p_task_id: t.id, p_status: "PLANNED", p_reason: "dipulihkan: dibatalkan tidak sengaja" })}>
      <Undo2 className="h-4 w-4" />Pulihkan</ConfirmButton>
  ) : null;
  // A pick without a Bin To Bin can get one (0045); it then pairs with the pick.
  const addMove = supervisor && t.task_type === "PICK" && canRestore && <AddMoveButton task={t} />;
  // A posted task can be undone and posted again (0034).
  if (t.status === "COMPLETED") return supervisor && canUndo ? <div className="flex flex-wrap gap-1"><UnpostButton task={t} />{addMove}</div> : null;
  // Stok kurang: the proposal that makes this row doable again (lib/wave-fix.ts), also on a Tunda wave.
  const fix = isShort && supervisor && canRestore && t.task_type === "PICK" && t.status === "PLANNED" ? <FixButton pick={t} /> : null;
  if (t.status !== "PLANNED" || !canPost) return fix;
  return (
    <div className="flex flex-wrap gap-2">
      {fix}
      {wait ? <WaitNotice wait={wait} supervisor={supervisor} rpc={rpc} /> : <TaskPostDialog task={t} onDone={onDone} />}
      {supervisor && (
        <MoreActions>
          {/* Source, and a Bin To Bin the plan did not make (0052). */}
          {t.task_type === "PICK" && <EditRowButton pick={t} />}
          {t.task_type === "PICK" && Number(t.quantity) > 1 && <SplitButton task={t} />}
          <CancelButton run={() => rpc("set_task_status", { p_task_id: t.id, p_status: "CANCELLED" })} />
        </MoreActions>
      )}
    </div>
  );
}
