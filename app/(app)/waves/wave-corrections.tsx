"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import type { TaskRow } from "@/lib/allocator/picklist-from-tasks";
import { fmtNum } from "@/lib/utils";

/** A dialog with the person's name, a reason and an action; closes and refreshes on success. */
function CorrectionDialog({ trigger, title, children, confirmLabel, run, ready = true }: {
  trigger: React.ReactNode; title: string; children?: React.ReactNode; confirmLabel: string; ready?: boolean;
  run: (person: string, reason: string) => Promise<string | null>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = usePersonName();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (person.trim().length < 2) return setError("Isi nama Anda.");
    if (!reason.trim()) return setError("Isi alasannya.");
    setBusy(true); setError(null);
    const err = await run(person, reason);
    setBusy(false);
    if (err) return setError(err);
    setOpen(false); setReason(""); router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title}>
        <div className="space-y-4">
          {children}
          <div>
            <Label htmlFor="corr-reason">Alasan (wajib)</Label>
            <Input id="corr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. salah input jumlah" />
          </div>
          <PersonNameField id="corr-person" value={person} onChange={setPerson} label="Nama Anda" />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={submit} disabled={busy || !ready}>{busy ? "Memproses…" : confirmLabel}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Batalkan posting" (0034): stock goes back as the posting took it, the task opens again. */
export function UnpostButton({ task: t }: { task: TaskRow }) {
  const qty = Number(t.actual_quantity ?? t.quantity);
  const from = t.actual_from_bin ?? t.from_bin;
  const what = t.task_type === "PICK"
    ? `${fmtNum(qty)} ${t.uom ?? ""} SKU ${t.sku} kembali ke ${from} (barang fisik juga dikembalikan ke bin itu).`
    : `${fmtNum(qty)} ${t.uom ?? ""} SKU ${t.sku} kembali dari ${t.to_bin} ke ${from}.`;
  return (
    <CorrectionDialog title={`Batalkan posting #${t.seq}`} confirmLabel="Batalkan posting"
      trigger={<Button size="sm" variant="ghost" className="underline"><Undo2 className="h-4 w-4" />Batalkan posting</Button>}
      run={async (person, reason) => {
        const { error } = await createClient().rpc("unpost_task", { p_task_id: t.id, p_by_name: person, p_reason: reason });
        return error?.message ?? null;
      }}>
      <p className="rounded-md bg-plate/30 p-3 text-base">Posting dibatalkan: {what} Tugas jadi belum dikerjakan; posting lagi dengan jumlah / bin yang benar.</p>
      <p className="text-xs text-steel-500">Posting lama dan pembatalannya tetap tercatat di riwayat stok. Wave yang sudah selesai dibuka lagi.</p>
    </CorrectionDialog>
  );
}

/** "Ubah jumlah order" (0034): the real quantity of one order line; open picks follow when it goes down. */
export function OrderQtyButton({ waveId, shipment, sku, description, requested, picked }: {
  waveId: string; shipment: string; sku: string; description: string; requested: number; picked: number;
}) {
  const [qty, setQty] = useState(String(requested));
  const n = Number(qty);
  const valid = qty.trim() !== "" && Number.isFinite(n) && n >= 0 && n !== requested;
  return (
    <CorrectionDialog title={`Ubah jumlah order ${sku}`} confirmLabel="Simpan jumlah" ready={valid}
      trigger={<Button size="sm" variant="ghost" className="underline"><Pencil className="h-3.5 w-3.5" />Ubah</Button>}
      run={async (person, reason) => {
        const { error } = await createClient().rpc("set_order_quantity", {
          p_wave_id: waveId, p_shipment: shipment, p_sku: sku, p_quantity: n, p_by_name: person, p_reason: reason,
        });
        return error?.message ?? null;
      }}>
      <p className="text-sm">SH {shipment} · {description} · order sekarang <b>{fmtNum(requested)}</b>, sudah diambil {fmtNum(picked)}.</p>
      <div>
        <Label htmlFor="order-qty">Jumlah order yang benar</Label>
        <Input id="order-qty" type="number" inputMode="numeric" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="h-12 text-lg" />
      </div>
      {valid && n < requested && (
        <p className="rounded-md bg-plate/30 p-2 text-sm">Kurang {fmtNum(requested - n)}: tugas pick yang belum diposting dikurangi (mulai dari palet yang dibuka).
          Sisa palet ikut ke relokasi pickface. Pick yang sudah diposting tidak berubah: pakai Batalkan posting bila perlu.</p>
      )}
      {valid && n > requested && (
        <p className="rounded-md bg-warn/10 p-2 text-sm">Tambah {fmtNum(n - requested)}: hanya order yang dicatat; kekurangannya tampil sampai wave dihitung ulang.</p>
      )}
    </CorrectionDialog>
  );
}

/** "Batalkan posting" of a pick + its pallet move (0035): both go back in one step. */
export function UnpostPairButton({ pick: p, move: m }: { pick: TaskRow; move: TaskRow }) {
  const picked = Number(p.actual_quantity ?? p.quantity), moved = Number(m.actual_quantity ?? m.quantity);
  return (
    <CorrectionDialog title={`Batalkan posting #${p.seq}`} confirmLabel="Batalkan posting"
      trigger={<Button size="sm" variant="ghost" className="underline"><Undo2 className="h-4 w-4" />Batalkan posting</Button>}
      run={async (person, reason) => {
        const { error } = await createClient().rpc("unpost_pick_with_move", { p_pick_id: p.id, p_move_id: m.id, p_by_name: person, p_reason: reason });
        return error?.message ?? null;
      }}>
      <p className="rounded-md bg-plate/30 p-3 text-base">Posting dibatalkan: {fmtNum(moved)} dari {m.to_bin} dan {fmtNum(picked)} dari truk kembali ke {p.actual_from_bin ?? p.from_bin} (barang fisik juga dikembalikan). Baris jadi belum dikerjakan; posting lagi dengan jumlah yang benar.</p>
      <p className="text-xs text-steel-500">Posting lama dan pembatalannya tetap tercatat di riwayat stok.</p>
    </CorrectionDialog>
  );
}
