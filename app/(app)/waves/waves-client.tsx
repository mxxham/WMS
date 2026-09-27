"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCheck, FileText, RefreshCw, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { ConfirmButton } from "@/components/app/confirm-button";
import { LEVEL_COLORS } from "@/config/warehouse";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import type { Role } from "@/lib/types";
import { picklistsFromTasks, type OutboundRow, type StockNow, type TaskRow, type WaveRow } from "@/lib/allocator/picklist-from-tasks";
import { replanRemaining } from "@/lib/allocator/browser/plan-client";
import { TaskPostDialog } from "./task-post-dialog";

// jsPDF is ~380 kB: load it only when someone actually prints.
// Sisa is replayed from the stock of the touched bins right now, over all of the day's waves (allWaves).
async function printPicklists(waves: WaveRow[], allWaves: WaveRow[], tasks: TaskRow[], outbound: OutboundRow[], filename: string) {
  const { downloadPicklistPdf } = await import("@/lib/allocator/browser/downloads");
  const bins = [...new Set(tasks.flatMap((t) => [t.from_bin, t.to_bin, t.actual_from_bin]).filter((b): b is string => !!b))];
  const { data } = await createClient().from("inventory_detail").select("bin_code, sku, batch_lot, expiry_date, quantity").in("bin_code", bins);
  downloadPicklistPdf(picklistsFromTasks(waves, tasks, outbound, (data ?? []) as StockNow[], allWaves), undefined, filename);
}

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
export function WavesClient({ date, role, waves, tasks, outbound, shortfalls }: {
  date: string; role: Role; waves: WaveRow[]; tasks: TaskRow[]; outbound: (OutboundRow & OutboundDetail)[];
  /** ids of open tasks the current stock can no longer satisfy */
  shortfalls: string[];
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
      </CardContent></Card>
    );
  }

  const done = tasks.filter((t) => t.status === "COMPLETED").length;
  const live = tasks.filter((t) => t.status !== "CANCELLED").length;
  const short = new Set(shortfalls);
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
          {supervisor && untouched.length > 0 && short.size === 0 && replanButton("outline")}
          <Button variant="outline" size="sm" onClick={() => printPicklists(waves, waves, tasks, outbound, `picklist_${date}.pdf`)}>
            <FileText className="h-4 w-4" />PDF semua picklist
          </Button>
        </div>
      </div>
      {waves.map((w) => (
        <WaveCard key={w.id} wave={w} supervisor={supervisor} rpc={rpc} short={short} onDone={() => router.refresh()}
          print={() => printPicklists([w], waves, tasks, outbound, `picklist_NO${w.wave_no}_${w.planned_date}.pdf`)}
          tasks={tasks.filter((t) => t.wave_id === w.id)} outbound={outbound.filter((o) => o.wave_id === w.id)} />
      ))}
    </>
  );
}

function WaveCard({ wave: w, tasks, outbound, supervisor, rpc, short, onDone, print }: {
  wave: WaveRow; tasks: TaskRow[]; outbound: (OutboundRow & OutboundDetail)[]; supervisor: boolean; print: () => void;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<string | null>;
  short: Set<string>; onDone: () => void;
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
            <Truck className="h-4 w-4" />{w.truck ?? "–"} · {w.destination || "–"} · shipment {w.shipment_numbers.join(", ")}
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
        {tasks.map((t) => (
          <li key={t.id} className={cn("space-y-2 p-4", t.status !== "PLANNED" && "opacity-60", short.has(t.id) && "bg-bad/10")}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-steel-500">#{t.seq} · {t.task_type === "PICK" ? `Pick ${t.shipment_number}` : "Relokasi ke pickface"}</span>
              <StatusTag status={t.status} />
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/bin/${t.from_bin}`}><BinChip code={t.from_bin} /></Link>
              {t.to_bin && <><ArrowRight className="h-4 w-4" /><Link href={`/bin/${t.to_bin}`}><BinChip code={t.to_bin} /></Link></>}
            </div>
            <p className="text-sm"><b>{fmtNum(Number(t.quantity))} {t.uom}</b> · {t.sku} {t.description}</p>
            <p className="text-xs text-steel-500">Batch {t.batch_lot || "–"} · exp {fmtDate(t.expiry_date)} · {t.breaks_pallet ? "CASE* (buka palet)" : t.pick_type}</p>
            {short.has(t.id) && <p className="text-xs font-semibold text-bad">Stok bin ini tidak cukup lagi untuk tugas ini</p>}
            <Actual task={t} />
            <TaskAction task={t} canPost={pending} supervisor={supervisor} rpc={rpc} onDone={onDone} />
          </li>
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table>
          <thead><tr>{["#", "Jenis", "Dari", "Ke", "SKU", "Batch", "Exp", "Qty", "Status", ""].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>{tasks.map((t) => (
            <tr key={t.id} className={cn(t.status !== "PLANNED" && "text-steel-500", short.has(t.id) && "bg-bad/10")}>
              <Td>{t.seq}</Td>
              <Td>{t.task_type === "PICK" ? `Pick ${t.shipment_number}` : "Relokasi"}</Td>
              <Td><Link href={`/bin/${t.from_bin}`} className="font-semibold underline-offset-2 hover:underline">{t.from_bin}</Link></Td>
              <Td>{t.to_bin ? <Link href={`/bin/${t.to_bin}`} className="font-semibold underline-offset-2 hover:underline">{t.to_bin}</Link> : "Truk"}</Td>
              <Td title={t.description}>{t.sku}</Td>
              <Td>{t.batch_lot || "–"}</Td>
              <Td className="whitespace-nowrap">{fmtDate(t.expiry_date)}</Td>
              <Td className="whitespace-nowrap text-right">{fmtNum(Number(t.quantity))} {t.uom} {t.breaks_pallet && <span title="Membuka palet utuh">*</span>}</Td>
              <Td>
                <StatusTag status={t.status} />{short.has(t.id) && <span className="ml-1 text-xs font-semibold text-bad">stok kurang</span>}
                {t.completed_at && <span className="block text-xs">{t.completed_by_name} · {fmtDateTime(t.completed_at)}</span>}
                <Actual task={t} />
              </Td>
              <Td><TaskAction task={t} canPost={pending} supervisor={supervisor} rpc={rpc} onDone={onDone} /></Td>
            </tr>
          ))}</tbody>
        </Table>
      </div>

      <div className="border-t border-steel-100 px-4 py-2">
        <button className="text-sm underline" onClick={() => setShowOrders((v) => !v)}>
          {showOrders ? "Sembunyikan" : "Tampilkan"} order ({outbound.length}){shortOrders.length > 0 && `, ${shortOrders.length} kurang`}
        </button>
      </div>
      {showOrders && (
        <Table>
          <thead><tr>{["Shipment", "SKU", "Deskripsi", "Diminta", "Teralokasi", "Terambil", "Kekurangan", "Status"].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
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
              </tr>
            );
          })}</tbody>
        </Table>
      )}
    </Card>
  );
}

/** What really happened, when it differs from the plan. */
function Actual({ task: t }: { task: TaskRow }) {
  if (!t.deviation_reason) return null;
  return (
    <span className="mt-1 block text-xs font-semibold text-steel-700">
      Aktual {fmtNum(Number(t.actual_quantity))}{t.actual_from_bin && t.actual_from_bin !== t.from_bin ? ` dari ${t.actual_from_bin}` : ""}: {t.deviation_reason}
    </span>
  );
}

function TaskAction({ task: t, canPost, supervisor, rpc, onDone }: {
  task: TaskRow; canPost: boolean; supervisor: boolean;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<string | null>; onDone: () => void;
}) {
  if (t.status !== "PLANNED" || !canPost) return null;
  return (
    <div className="flex gap-2">
      <TaskPostDialog task={t} onDone={onDone} />
      {supervisor && (
        <ConfirmButton size="sm" variant="ghost" title="Batalkan tugas" confirmLabel="Batalkan tugas"
          summary={`Batalkan tugas #${t.seq}: ${fmtNum(Number(t.quantity))} ${t.uom ?? ""} SKU ${t.sku} dari ${t.from_bin}.`}
          onConfirm={() => rpc("set_task_status", { p_task_id: t.id, p_status: "CANCELLED" })}>Batal</ConfirmButton>
      )}
    </div>
  );
}
