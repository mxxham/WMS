"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { callRpc } from "@/components/ckb/rpc-button";
import { listOrder, progress } from "@/lib/ckb/count-rules";
import { countOpen, type StocktakeStatus } from "@/lib/ckb/stocktake";
import type { TaskEvidence, TaskRow } from "@/lib/ckb/stocktake-data";
import { cn } from "@/lib/utils";
import { CountList } from "./count-list";
import { CountScreen } from "./count-screen";

/**
 * The counting page (0133): my list → tap a line → count it → the next line opens. On a phone one screen at
 * a time; on a desktop the list and the open line side by side. Counters never see an SAP number (the
 * database does not send it); leads do.
 */
export function CountClient({ sessionId, sessionStatus, tasks, evidence, lead, canCount, rules, title, subtitle }: {
  sessionId: string; sessionStatus: StocktakeStatus; tasks: TaskRow[]; evidence: TaskEvidence[];
  lead: boolean; canCount: boolean; rules: { photoRules: boolean; customerAlways: boolean };
  title: string; subtitle: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const p = progress(tasks);
  const open = tasks.find((t) => t.id === openId) ?? null;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const order = useMemo(() => listOrder(tasks).filter((t) => t.status === "OPEN" || t.status === "RECOUNT_REQUESTED"), [tasks]);

  /** After sending: the next line still waiting, in list order, else back to the list. */
  function next() {
    const rest = order.filter((t) => t.id !== openId);
    setOpenId(rest[0]?.id ?? null);
  }

  return (
    <div className="space-y-3">
      <header className={cn("rounded-2xl bg-jeir-navy px-4 py-3 text-white", open && "hidden md:block")}>
        <p className="font-cond text-xl font-semibold leading-tight">{title}</p>
        <p className="text-xs text-ckb-tint">{subtitle}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done}>
          <div className="h-full rounded-full bg-jeir-teal transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-ckb-tint tabular">{p.done} dari {p.total} selesai</p>
      </header>

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-start md:gap-4">
        <div className={cn(open && "hidden md:block")}>
          <CountList tasks={tasks} openId={openId} onOpen={setOpenId} lead={lead}
            found={canCount && sessionStatus === "COUNTING" ? <FoundLine sessionId={sessionId} onCreated={setOpenId} /> : undefined} />
        </div>
        <div className={cn(!open && "hidden md:block", "md:sticky md:top-4")}>
          {open ? (
            <CountScreen key={open.id} t={open} photos={evidence.filter((e) => e.entity_id === open.id)} rules={rules}
              canCount={canCount && countOpen(sessionStatus, open.status)} lead={lead}
              onSent={next} onBack={() => setOpenId(null)} progressText={`${p.done} dari ${p.total} selesai`} />
          ) : (
            <p className="hidden rounded-2xl border-2 border-dashed border-steel-300 p-8 text-center text-sm text-steel-500 md:block">Pilih baris di daftar untuk mulai menghitung.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Stock on the floor that is not on the list: the line first (ckb_add_found_line), then it opens to be counted with its photo. */
function FoundLine({ sessionId, onCreated }: { sessionId: string; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(fd: FormData) {
    const s = (k: string) => String(fd.get(k) ?? "").trim();
    if (!s("bin") || !s("material") || !s("uom")) return setError("Lokasi, material dan satuan wajib diisi.");
    setBusy(true); setError(null);
    const [id, err] = await callRpc<string>("ckb_add_found_line", {
      p_stocktake: sessionId, p_material: s("material"), p_description: s("description"), p_bin: s("bin"),
      p_batch: s("batch"), p_expiry: s("expiry") || null, p_uom: s("uom"), p_note: s("note"),
    });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    router.refresh();
    if (id) onCreated(id);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>
        <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ckb/40 bg-white py-3 text-sm font-semibold text-ckb">
          <PackagePlus className="h-4 w-4" aria-hidden />Barang tidak ada di daftar
        </button>
      </DialogTrigger>
      <DialogContent title="Barang temuan" description="Barang ini dicatat sebagai baris baru, lalu Anda hitung seperti biasa (foto wajib).">
        <form action={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="f-bin">Lokasi</Label><Input id="f-bin" name="bin" autoCapitalize="characters" /></div>
            <div><Label htmlFor="f-uom">Satuan</Label><Input id="f-uom" name="uom" placeholder="DR" autoCapitalize="characters" /></div>
          </div>
          <div><Label htmlFor="f-mat">Material</Label><Input id="f-mat" name="material" autoCapitalize="characters" /></div>
          <div><Label htmlFor="f-desc">Deskripsi</Label><Input id="f-desc" name="description" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="f-batch">Batch</Label><Input id="f-batch" name="batch" /></div>
            <div><Label htmlFor="f-exp">Expired</Label><Input id="f-exp" name="expiry" type="date" /></div>
          </div>
          <div><Label htmlFor="f-note">Catatan</Label><Input id="f-note" name="note" /></div>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Menyimpan…" : "Catat lalu hitung"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
