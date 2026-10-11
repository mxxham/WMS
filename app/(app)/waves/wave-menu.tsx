import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ClipboardList, FileText, Play, RotateCcw, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { ActionMenu, MenuDanger, MenuSection } from "@/components/app/action-menu";
import { cn, fmtNum } from "@/lib/utils";
import type { TaskRow, WaveRow } from "@/lib/allocator/picklist-from-tasks";
import { AddItems, TundaButton, type Rpc } from "./wave-parts";

/**
 * A wave's actions (redesign). The wave's one next step is its primary button on the page; every
 * other action is a row of this menu, under the same conditions as the old header buttons.
 * Isi dari picklist is desktop only. Buka lagi / Pulihkan wave undo a finished / cancelled wave (0069).
 */

/** Selesaikan wave (bulk post the rest) and Tutup wave (all posted): the name is asked in the confirmation. */
export function CompleteWaveButton({ wave: w, open, rpc, variant = "outline", size = "sm", className }: {
  wave: WaveRow; open: TaskRow[]; rpc: Rpc; variant?: "outline" | "default"; size?: "sm" | "lg"; className?: string;
}) {
  const [person, setPerson] = usePersonName();
  const bulk = open.length > 0;
  return (
    <ConfirmButton size={size} variant={variant} className={className}
      title={bulk ? `Selesaikan NO ${w.wave_no}` : `Tutup NO ${w.wave_no}`} confirmLabel={bulk ? "Posting semua" : "Tutup wave"}
      summary={bulk
        ? `Posting ${open.length} tugas tersisa (${fmtNum(open.reduce((s, t) => s + Number(t.quantity), 0))} unit) sebagai sudah dikerjakan. Pakai hanya jika semua barang benar-benar sudah diambil. Jika satu bin kurang stok, tidak ada yang diposting.`
        : "Semua tugas sudah diposting. Tandai wave dan order-nya selesai."}
      extra={<PersonNameField id={`complete-name-${w.id}`} value={person} onChange={setPerson} label="Nama Anda" />}
      onConfirm={() => person.trim().length < 2 ? Promise.resolve("Isi nama Anda dulu.") : rpc("complete_wave_by", { p_wave_id: w.id, p_by_name: person })}>
      <CheckCheck className="h-4 w-4" />{bulk ? "Selesaikan wave" : "Tutup wave"}
    </ConfirmButton>
  );
}

type ReopenPreview = { wave_no: string; loaded: string[]; bulk: { task_id: string; seq: number; task_type: string; sku: string; bin: string; to_bin: string | null; quantity: number; audited: boolean; blocked: boolean }[] };

/** Buka lagi (0069): a finished wave runs again; Selesaikan wave's bulk lines can be undone with it. */
export function ReopenWaveButton({ wave: w }: { wave: WaveRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pv, setPv] = useState<ReopenPreview | null>(null);
  const [undo, setUndo] = useState(true);
  const [person, setPerson] = usePersonName();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPv(null); setError(null); setReason(""); setUndo(true);
    const { data, error } = await createClient().rpc("reopen_wave_preview", { p_wave_id: w.id });
    if (error) return setError(error.message);
    const p = data as ReopenPreview;
    setPv(p); setUndo(p.bulk.length > 0 && !p.bulk.some((b) => b.audited || b.blocked));
  }
  async function run() {
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("reopen_wave", { p_wave_id: w.id, p_by_name: person, p_reason: reason, p_undo_bulk: undo });
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false); router.refresh();
  }
  const audited = pv?.bulk.some((b) => b.audited) ?? false;
  const blocked = pv?.bulk.filter((b) => b.blocked) ?? [];
  const loaded = (pv?.loaded.length ?? 0) > 0;
  const ready = !!pv && !loaded && person.trim().length >= 2 && reason.trim().length > 0 && !busy;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) void load(); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><RotateCcw className="h-4 w-4" />Buka lagi</Button></DialogTrigger>
      <DialogContent title={`Buka lagi NO ${w.wave_no}`} description="Wave selesai berjalan lagi. Stok tidak berubah, kecuali baris massal yang ikut dibatalkan.">
        {!pv && !error && <p className="text-sm text-steel-500">Memeriksa wave…</p>}
        {pv && (
          <div className="space-y-3 text-sm">
            {loaded && <p role="alert" className="text-bad">Shipment {pv.loaded.join(", ")} sudah dimuat ke truk: wave ini tidak bisa dibuka lagi.</p>}
            {!loaded && pv.bulk.length === 0 && <p>Tidak ada baris yang diposting massal oleh Selesaikan wave. Hanya status wave yang berubah.</p>}
            {!loaded && pv.bulk.length > 0 && (
              <>
                <p>{pv.bulk.length} baris diposting sekaligus oleh Selesaikan wave:</p>
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md bg-paper p-2 text-xs tabular">
                  {pv.bulk.map((b) => (
                    <li key={b.task_id} className={cn((b.audited || b.blocked) && "text-bad")}>
                      #{b.seq} · {b.task_type === "PICK" ? "Pick" : "Bin To Bin"} {fmtNum(Number(b.quantity))} SKU {b.sku} dari {b.bin}{b.to_bin ? ` ke ${b.to_bin}` : ""}{b.audited && " · sudah diaudit"}{b.blocked && ` · ${b.to_bin} sudah tidak berisi barang ini`}
                    </li>
                  ))}
                </ul>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={undo} disabled={audited || blocked.length > 0} onChange={(e) => setUndo(e.target.checked)} />
                  <span>Batalkan juga {pv.bulk.length} baris yang diposting massal. Stoknya kembali tepat ke bin asalnya dan barisnya bisa dikerjakan lagi. Baris yang diambil satu per satu tetap diposting.</span>
                </label>
                {audited && <p className="text-xs text-bad">Ada baris yang sudah diaudit: batalkan lewat audit dulu, atau buka lagi tanpa membatalkan baris.</p>}
                {blocked.length > 0 && <p className="text-xs text-bad">Bin To Bin {blocked.map((b) => `#${b.seq}`).join(", ")} tidak bisa dikembalikan: barangnya sudah diambil dari {blocked.map((b) => b.to_bin).join(", ")}. Buka lagi tanpa membatalkan baris massal, lalu betulkan baris itu sendiri.</p>}
              </>
            )}
            {!loaded && (
              <>
                <PersonNameField id={`reopen-name-${w.id}`} value={person} onChange={setPerson} label="Nama Anda" />
                <div><Label htmlFor={`reopen-${w.id}`}>Alasan</Label>
                  <Input id={`reopen-${w.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. salah tutup" /></div>
                <p className="rounded-md bg-ckb-tint/60 p-2">
                  NO {w.wave_no} dibuka lagi{undo && pv.bulk.length > 0 ? ` dan ${pv.bulk.length} baris massal dibatalkan (stok kembali ke bin asal)` : "; stok tidak berubah"}.
                </p>
                <Button className="w-full" disabled={!ready} onClick={() => void run()}>{busy ? "Membuka…" : "Buka lagi"}</Button>
              </>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

type RestorePreview = { wave_no: string; lines: { task_id: string; seq: number; task_type: string; sku: string; bin: string; quantity: number; free: number; covered: boolean }[] };

/** Pulihkan wave (0069): the lines the wave cancel cancelled go back to the plan; no stock moves. */
export function RestoreWaveButton({ wave: w }: { wave: WaveRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pv, setPv] = useState<RestorePreview | null>(null);
  const [person, setPerson] = usePersonName();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setPv(null); setError(null); setReason("");
    const { data, error } = await createClient().rpc("restore_wave_preview", { p_wave_id: w.id });
    if (error) return setError(error.message);
    setPv(data as RestorePreview);
  }
  async function run() {
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("restore_wave", { p_wave_id: w.id, p_by_name: person, p_reason: reason });
    setBusy(false);
    if (error) return setError(error.message);
    // The restored wave is no longer cancelled, so this dialog leaves the menu on refresh: close it.
    // A line the bins no longer cover shows as stok kurang under Perlu ditangani, with Perbaiki and
    // Hitung ulang wave tersisa (each with its own confirmation).
    setOpen(false); router.refresh();
  }
  const short = pv?.lines.filter((l) => !l.covered) ?? [];
  const ready = !!pv && pv.lines.length > 0 && person.trim().length >= 2 && reason.trim().length > 0 && !busy;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) void load(); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Undo2 className="h-4 w-4" />Pulihkan wave</Button></DialogTrigger>
      <DialogContent title={`Pulihkan NO ${w.wave_no}`} description="Baris yang ikut dibatalkan kembali ke rencana. Stok tidak berubah.">
        {!pv && !error && <p className="text-sm text-steel-500">Memeriksa wave…</p>}
        {pv && (
          <div className="space-y-3 text-sm">
            {pv.lines.length === 0 && <p>Tidak ada baris yang dibatalkan bersama wave ini.</p>}
            {pv.lines.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md bg-paper p-2 text-xs tabular">
                {pv.lines.map((l) => (
                  <li key={l.task_id} className={cn(!l.covered && "font-semibold text-bad")}>
                    #{l.seq} · {fmtNum(Number(l.quantity))} SKU {l.sku} dari {l.bin}{!l.covered && ` · stok tidak cukup lagi: ${fmtNum(Math.max(Number(l.free), 0))} tersedia`}
                  </li>
                ))}
              </ul>
            )}
            {short.length > 0 && <p className="text-bad">{short.length} baris tidak tertutup stok sekarang: setelah dipulihkan baris itu tampil stok kurang di Perlu ditangani. Perbaiki di sana, atau pakai Hitung ulang wave tersisa.</p>}
            {pv.lines.length > 0 && (
              <>
                <PersonNameField id={`restore-name-${w.id}`} value={person} onChange={setPerson} label="Nama Anda" />
                <div><Label htmlFor={`restore-${w.id}`}>Alasan</Label>
                  <Input id={`restore-${w.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. salah batal" /></div>
                <p className="rounded-md bg-ckb-tint/60 p-2">{pv.lines.length} baris NO {w.wave_no} kembali ke rencana; stok tidak berubah.</p>
                <Button className="w-full" disabled={!ready} onClick={() => void run()}>{busy ? "Memulihkan…" : "Pulihkan wave"}</Button>
              </>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

export function WaveMenu({ wave: w, tasks, supervisor, rpc, layout, onPrint, onOpenSheet, onStartPicking }: {
  wave: WaveRow; tasks: TaskRow[]; supervisor: boolean; rpc: Rpc; layout: "desktop" | "phone";
  onPrint: () => void; onOpenSheet?: () => void;
  /** Mulai picking, also while a line is blocked or every line is posted (the primary is then another button) */
  onStartPicking?: () => void;
}) {
  const open = tasks.filter((t) => t.status === "PLANNED");
  const live = tasks.filter((t) => t.status !== "CANCELLED").length;
  const pending = w.status === "PENDING";
  const canSheet = layout === "desktop" && supervisor && w.status !== "CANCELLED" && live > 0 && !!onOpenSheet;
  return (
    <ActionMenu title={`NO ${w.wave_no}`}>
      <MenuSection>
        {pending && live > 0 && onStartPicking && (
          <div><DialogClose asChild><Button size="sm" variant="outline" onClick={onStartPicking}><Play className="h-4 w-4" />Mulai picking</Button></DialogClose></div>
        )}
        <div><Button variant="outline" size="sm" onClick={onPrint}><FileText className="h-4 w-4" />Picklist</Button></div>
        {canSheet && <div><DialogClose asChild><Button size="sm" variant="outline" onClick={onOpenSheet}><ClipboardList className="h-4 w-4" />Isi dari picklist</Button></DialogClose></div>}
        {supervisor && (pending || w.status === "RESCHEDULED") && <div><AddItems date={w.planned_date} wave={w} /></div>}
        {pending && open.length > 0 && <div><CompleteWaveButton wave={w} open={open} rpc={rpc} /></div>}
        {supervisor && pending && <div><TundaButton wave={w} tasks={tasks} rpc={rpc} /></div>}
        {supervisor && w.status === "RESCHEDULED" && (
          <div><ConfirmButton size="sm" variant="outline" title={`Aktifkan NO ${w.wave_no}`} summary="Wave kembali bisa dikerjakan."
            onConfirm={() => rpc("set_wave_status", { p_wave_id: w.id, p_status: "PENDING" })}>Aktifkan</ConfirmButton></div>
        )}
        {supervisor && w.status === "COMPLETED" && <div><ReopenWaveButton wave={w} /></div>}
        {supervisor && w.status === "CANCELLED" && <div><RestoreWaveButton wave={w} /></div>}
      </MenuSection>
      {supervisor && (pending || w.status === "RESCHEDULED") && (
        <MenuDanger>
          <div><ConfirmButton size="sm" variant="danger" title={`Batalkan NO ${w.wave_no}`} confirmLabel="Batalkan wave"
            summary={`Batalkan wave dan ${open.length} tugas yang belum dikerjakan. Stok yang sudah dipindah tidak dikembalikan otomatis. Bisa dipulihkan lagi lewat Pulihkan wave.`}
            onConfirm={() => rpc("set_wave_status", { p_wave_id: w.id, p_status: "CANCELLED" })}>Batalkan wave</ConfirmButton></div>
        </MenuDanger>
      )}
    </ActionMenu>
  );
}
