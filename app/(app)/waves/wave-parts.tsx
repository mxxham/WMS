import dynamic from "next/dynamic";
import { useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/app/confirm-button";
import { LEVEL_COLORS } from "@/config/warehouse";
import { cn, fmtNum } from "@/lib/utils";
import { binToBinRows, picklistsFromTasks, type OutboundRow, type StockNow, type TaskRow, type WaveRow } from "@/lib/allocator/picklist-from-tasks";
import { ImpactNote } from "./impact-note";
import { PostMoveEarlyButton } from "./post-move-early";

/**
 * Pieces of the Wave page shared by the desktop and the phone layout (redesign): types, the PDF
 * helpers, status tags, the bin plate, the "what really happened" line, the wait notice, and the
 * Tunda / Batal buttons. Moved here unchanged from waves-client.tsx.
 */

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<string | null>;

/** An open task whose bin is still waiting for a relocation into it (task_waits, 0038). */
export type TaskWait = { task_id: string; have: number; wait_wave_no: string; wait_seq: number; wait_from: string; wait_to: string; wait_qty: number;
  /** the move it waits for (0053), and its wave's status: a Tunda wave's move is posted by a supervisor */
  wait_task_id: string; wait_wave_status: string };
export const waitText = (w: TaskWait) => `Tunggu relokasi NO ${w.wait_wave_no} #${w.wait_seq}: ${w.wait_from} → ${w.wait_to} (${fmtNum(Number(w.wait_qty))}). Di ${w.wait_to} baru ${fmtNum(Number(w.have))}.`;

export type OutboundDetail = {
  description: string; quantity_requested: number; quantity_allocated: number; quantity_picked: number; shortage_reason: string | null; status: string;
};

// Opened on a click: their code (the allocation engine behind Tambah order / item) loads then, not with
// the Wave page. The placeholder is the same button, so nothing moves while it loads.
const Placeholder = ({ label }: { label: string }) => (
  <Button variant="outline" size="sm" disabled><Plus className="h-4 w-4" />{label}</Button>
);
export const AddOrder = dynamic(() => import("./add-order").then((m) => m.AddOrder), { ssr: false, loading: () => <Placeholder label="Tambah order" /> });
export const AddItems = dynamic(() => import("./add-order").then((m) => m.AddItems), { ssr: false, loading: () => <Placeholder label="Tambah item" /> });

// jsPDF is ~380 kB: load it only when someone actually prints.
// Sisa is replayed from the stock of the touched bins right now, over all of the day's waves (allWaves).
export async function printPicklists(waves: WaveRow[], allWaves: WaveRow[], tasks: TaskRow[], outbound: OutboundRow[], filename: string) {
  const { downloadPicklistPdf } = await import("@/lib/allocator/browser/downloads");
  const bins = [...new Set(tasks.flatMap((t) => [t.from_bin, t.to_bin, t.actual_from_bin]).filter((b): b is string => !!b))];
  const { data } = await createClient().from("inventory_detail").select("bin_code, sku, batch_lot, expiry_date, quantity").in("bin_code", bins);
  downloadPicklistPdf(picklistsFromTasks(waves, tasks, outbound, (data ?? []) as StockNow[], allWaves), undefined, filename);
}

export async function printBinToBin(waves: WaveRow[], tasks: TaskRow[], filename: string) {
  const { downloadBinToBinPdf } = await import("@/lib/allocator/browser/downloads");
  downloadBinToBinPdf(binToBinRows(waves, tasks), filename);
}

export async function printExcel(waves: WaveRow[], allWaves: WaveRow[], tasks: TaskRow[], outbound: (OutboundRow & OutboundDetail)[], filename: string) {
  const db = createClient();
  const bins = [...new Set(tasks.flatMap((t) => [t.from_bin, t.to_bin, t.actual_from_bin]).filter((b): b is string => !!b))];
  const invPromise = bins.length
    ? db.from("inventory_detail").select("bin_code, sku, batch_lot, expiry_date, quantity").in("bin_code", bins)
    : Promise.resolve({ data: [] as any });
  const pfPromise = db.from("pickface_detail").select("sku, bin_code");
  const itemsPromise = db.from("items").select("sku, description, upp");
  const [{ data: inv }, { data: pf }, { data: items }] = await Promise.all([invPromise, pfPromise, itemsPromise]);

  const { downloadAllocationWorkbook } = await import("@/lib/allocator/browser/downloads");
  const { buildMovementReport } = await import("@/lib/allocator/movement");
  const picklists = picklistsFromTasks(waves, tasks, outbound, (inv ?? []) as StockNow[], allWaves);

  const descBySku = new Map(tasks.map((t) => [t.sku, t.description]));
  const shortages = (outbound ?? [])
    .filter((o) => o.quantity_requested !== undefined && Number(o.quantity_allocated ?? 0) < Number(o.quantity_requested))
    .map((o) => ({
      shipmentNumber: o.shipment_number,
      orderNos: o.order_nos ?? [],
      sku: o.sku,
      description: descBySku.get(o.sku) ?? o.sku,
      qtyRequested: Number(o.quantity_requested),
      qtyAllocated: Number(o.quantity_allocated ?? 0),
      qtyShort: Number(o.quantity_requested) - Number(o.quantity_allocated ?? 0),
      reason: (o.shortage_reason as string) || "NO_STOCK",
      qtyRejectedByShelfLife: 0,
      qtyInStaging: 0,
    }));

  const result = {
    generatedAt: new Date(),
    picklists,
    lines: picklists.flatMap((p) => p.lines),
    shortages,
    warnings: [],
    stats: {
      demandLines: 0, cartonsRequested: 0, cartonsAllocated: 0, fillRatePct: 0,
      palletPicks: 0, casePicks: 0, palletsBroken: 0, binsTouched: 0, shipments: 0,
    },
  } as any;

  const movement = buildMovementReport(result);

  let pickfaces: Map<string, any> | undefined;
  if (pf?.length) {
    const itemMap = new Map((items ?? []).map((i: any) => [i.sku, i]));
    const m = new Map();
    for (const p of pf) {
      const it = itemMap.get(p.sku);
      m.set(p.sku, {
        sku: p.sku,
        description: it?.description ?? p.sku,
        location: p.bin_code,
        targetQtyCartons: Number(it?.upp) || 0,
        isAuto: false,
      });
    }
    pickfaces = m;
  }

  await downloadAllocationWorkbook(result, movement, pickfaces as any, filename);
}

const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-steel-100 text-steel-700", PLANNED: "bg-steel-100 text-steel-700",
  COMPLETED: "bg-ok text-white", RESCHEDULED: "bg-warn text-steel", CANCELLED: "bg-bad/15 text-bad line-through",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu", PLANNED: "Rencana", COMPLETED: "Selesai", RESCHEDULED: "Ditunda", CANCELLED: "Batal",
};
export const REASON: Record<string, string> = { ALREADY_STAGED: "Sudah di staging", BLOCKED_SHELF_LIFE: "Umur simpan", NO_STOCK: "Stok tidak ada" };

export function StatusTag({ status }: { status: string }) {
  return <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-semibold", STATUS_TONE[status])}>{STATUS_LABEL[status] ?? status}</span>;
}

/** Bin code set like the yellow location plate, with the level colour strip. */
export function BinChip({ code, size = "lg" }: { code: string; size?: "lg" | "md" }) {
  const color = LEVEL_COLORS[code.charAt(4)]?.hex;
  return (
    <span className={cn("inline-block overflow-hidden rounded-plate bg-plate font-cond font-bold leading-none text-steel", size === "lg" ? "text-2xl" : "text-lg")}>
      {color && <span className="block h-1" style={{ background: color }} aria-hidden />}
      <span className="block px-2 py-1">{code}</span>
    </span>
  );
}

/** What really happened, when it differs from the plan. */
export function Actual({ task: t, label = "Aktual" }: { task: TaskRow; label?: string }) {
  if (!t.deviation_reason) return null;
  return (
    <span className="mt-1 block text-xs font-semibold text-steel-700">
      {label} {fmtNum(Number(t.actual_quantity))}{t.actual_from_bin && t.actual_from_bin !== t.from_bin ? ` dari ${t.actual_from_bin}` : ""}: {t.deviation_reason}
    </span>
  );
}

/** The wait (0038): Posting stays locked until the relocation into this bin is posted. */
export function WaitNotice({ wait, sku, supervisor, rpc }: { wait: TaskWait; sku: string; supervisor: boolean; rpc: Rpc }) {
  const parked = wait.wait_wave_status === "RESCHEDULED";
  return (
    <div className="space-y-1">
      <p className="max-w-64 rounded bg-warn/15 p-1.5 text-xs font-semibold text-steel">{waitText(wait)}{parked && " Wave itu ditunda."}</p>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled title="Posting setelah relokasinya diposting">Posting</Button>
        {(supervisor || !parked) && (
          <PostMoveEarlyButton moveId={wait.wait_task_id} sku={sku} to={wait.wait_to} rpc={rpc}
            label={`Posting Bin To Bin NO ${wait.wait_wave_no} #${wait.wait_seq}`}
            summary={`Posting Bin To Bin NO ${wait.wait_wave_no} #${wait.wait_seq} sekarang, tanpa pick-nya: ${fmtNum(Number(wait.wait_qty))} dari ${wait.wait_from} ke ${wait.wait_to}${parked ? " (wave itu ditunda; pick-nya tetap belum dikerjakan)" : ""}. Setelah itu baris ini bisa diposting.`} />
        )}
      </div>
    </div>
  );
}

/** Tunda with the rows of other waves it would hold up listed first (their Bin To Bin comes from this wave). */
export function TundaButton({ wave: w, tasks, rpc }: { wave: WaveRow; tasks: TaskRow[]; rpc: Rpc }) {
  const moves = tasks.filter((t) => t.task_type === "REPLENISH" && t.status === "PLANNED");
  return (
    <ConfirmButton size="sm" variant="outline" title={`Tunda NO ${w.wave_no}`}
      summary={`Wave ditahan (tidak bisa dikerjakan) sampai diaktifkan lagi. Tugas yang sudah diposting tetap tercatat.${moves.length ? ` Wave ini masih punya ${moves.length} Bin To Bin terbuka: wave lain yang menunggunya ikut tertahan, kecuali Bin To Bin-nya diposting setelah benar-benar dipindah.` : ""}`}
      extra={moves.length ? <ImpactNote skus={[...new Set(moves.map((m) => m.sku))]} build={() => ({ change: { kind: "park", wave: w.id }, own: [] })} /> : undefined}
      onConfirm={() => rpc("set_wave_status", { p_wave_id: w.id, p_status: "RESCHEDULED" })}>Tunda</ConfirmButton>
  );
}

/**
 * Batal without a confirmation step: cancelling is undone with one tap on
 * Pulihkan on the cancelled row, so a dialog here only slowed the floor down.
 */
export function CancelButton({ run, title, summary }: { run: () => Promise<string | null>; title?: string; summary?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = (
    <Button size="sm" variant="ghost" disabled={busy}
      onClick={async () => { setBusy(true); setError(null); const e = await run(); setBusy(false); setError(e); }}>
      {busy ? "Membatalkan…" : "Batal"}
    </Button>
  );
  if (!title) return <span className="inline-flex flex-col">{button}{error && <span role="alert" className="text-xs text-bad">{error}</span>}</span>;
  return (
    <span className="inline-flex flex-col">
      <ConfirmButton size="sm" variant="danger" title={title} confirmLabel="Batal" summary={summary ?? ""} onConfirm={run}>
        Batal
      </ConfirmButton>
      {error && <span role="alert" className="text-xs text-bad">{error}</span>}
    </span>
  );
}
