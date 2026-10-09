"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { usePersonName } from "@/components/app/person-name";
import { ImpactNote } from "./impact-note";

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<string | null>;

/**
 * "Posting Bin To Bin saja" (0053): one open move posted by itself — the pallet's rest goes to the
 * pickface now, its pick stays open — so a later wave waiting on that pickface can go on, also
 * while the move's own wave is on Tunda.
 */
export function PostMoveEarlyButton({ moveId, sku, to, label, summary, rpc }: { moveId: string; sku: string; to: string; label: string; summary: string; rpc: Rpc }) {
  const [person] = usePersonName();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    if (person.trim().length < 2) return setError("Isi nama Anda di atas daftar wave dulu.");
    setBusy(true); setError(null);
    const e = await rpc("post_move_early", { p_move_id: moveId, p_by_name: person });
    setBusy(false);
    if (e) return setError(e);
    setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setDone(false); setError(null); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><ArrowRight className="h-4 w-4" />{label}</Button></DialogTrigger>
      <DialogContent title={label}>
        <div className="space-y-4">
          <p className="rounded-md bg-plate/30 p-3 text-base">{summary}</p>
          {/* 5 Oct: pressed to unblock a wave while the pallet stayed put, the system and the floor disagreed for hours. */}
          <label className="flex items-start gap-2 rounded-md border border-steel-300 p-3 text-sm">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="mt-1" />
            <span>Sisa palet <b>sudah dipindah fisik</b> ke <b>{to}</b> (forklift sudah selesai). Jangan posting hanya untuk membuka wave lain.</span>
          </label>
          <ImpactNote skus={[sku]} build={() => ({ change: { kind: "postMove", moveId }, own: [moveId] })} />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
            <Button size="lg" onClick={confirm} disabled={busy || !done}>{busy ? "Memproses…" : "Posting Bin To Bin"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

