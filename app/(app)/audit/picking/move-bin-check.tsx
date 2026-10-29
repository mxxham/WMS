"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { cn, fmtNum } from "@/lib/utils";

type SaveResult = { result: "OK" | "MISMATCH"; attempt: number; system: number; counted: number; diff: number; found_sku: string | null };

type Side = "FROM" | "TO";
const RPC = { FROM: "record_move_source_audit", TO: "record_move_rack_audit" } as const;
const WORD = { FROM: "bin asal", TO: "bin tujuan" } as const;

/**
 * One bin of a Bin To Bin, counted like every other bin on the rack: the system's quantity of the SKU
 * in the bin (all batches) is shown; it matches → Sesuai, otherwise Salah and count it, with a note.
 * FROM: what is left in the source bin (0114). TO: what is in the destination bin (0115).
 */
export function MoveBinCheck({ side, taskId, seq, bin, sku, uom, binQty, state, supervisor }: {
  side: Side; taskId: string; seq: number; bin: string; sku: string; uom: string | null;
  /** what the system holds of the SKU in the bin now, all batches */
  binQty: number | null;
  state: "TODO" | "OK" | "MISMATCH" | "RESOLVED" | "AUTO_PASS";
  supervisor: boolean;
}) {
  const router = useRouter();
  const [checker] = usePersonName();
  const [open, setOpen] = useState<{ correct: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (checker.trim().length < 2) return setOpen({ correct: false });
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc(RPC[side], {
      p_task_id: taskId, p_checker_name: checker, p_counted: binQty ?? 0, p_note: null,
    });
    setBusy(false);
    if (error) return setError(error.message.startsWith("Catatan wajib") ? "Isi di sistem berubah: pakai Salah dan hitung." : error.message);
    if ((data as SaveResult).result !== "OK") setError("Tidak sesuai: pakai Salah dan hitung.");
    router.refresh();
  }

  if (state === "AUTO_PASS" || state === "RESOLVED") return null;
  return (
    <div className="space-y-1">
      {(state === "TODO" || state === "MISMATCH") && (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => setOpen({ correct: false })}>
            <ClipboardCheck className="h-4 w-4" />{state === "TODO" ? "✗ Salah" : "Hitung ulang"}
          </Button>
          {state === "TODO" && binQty !== null && (
            <Button size="sm" disabled={busy} onClick={confirm}>{busy ? "…" : "✓ Sesuai"}</Button>
          )}
        </div>
      )}
      {supervisor && state === "OK" && (
        <Button size="sm" variant="ghost" className="underline" onClick={() => setOpen({ correct: true })}>Ubah</Button>
      )}
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
      {open && <BinCountDialog side={side} taskId={taskId} title={`#${seq} · ${sku} · ${WORD[side]} ${bin}`} uom={uom}
        correct={open.correct} onClose={() => setOpen(null)} />}
    </div>
  );
}

function BinCountDialog({ side, taskId, title, uom, correct, onClose }: {
  side: Side; taskId: string; title: string; uom: string | null; correct: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [checker, setChecker] = usePersonName();
  const [counted, setCounted] = useState("");
  const [skuInput, setSkuInput] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(counted);
    if (checker.trim().length < 2 || counted.trim() === "" || !Number.isFinite(n) || n < 0) {
      return setError("Isi nama checker dan jumlah karton di bin.");
    }
    if (correct && !note.trim()) return setError("Isi alasan ubah di catatan.");
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc(RPC[side], {
      p_task_id: taskId, p_checker_name: checker, p_counted: n, p_note: note || null,
      p_found_sku: found, p_correct: correct,
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
    setSaved(data as SaveResult);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${correct ? "Ubah hitung" : "Hitung"} ${title}`} description={side === "FROM" ? "Sisa SKU ini di bin asal setelah dipindah, semua batch." : "Isi SKU ini di bin tujuan sekarang, semua batch."}>
        {saved ? (
          <div className="space-y-4">
            <p className={cn("rounded-md p-3 text-base font-semibold", saved.result === "OK" ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad")}>
              {saved.result === "OK" ? `Sesuai. ${WORD[side][0].toUpperCase()}${WORD[side].slice(1)} lolos audit.`
                : saved.found_sku ? `Barang lain di bin: ${saved.found_sku}`
                : `Selisih ${saved.diff > 0 ? "+" : ""}${fmtNum(saved.diff)} ${uom ?? ""}`}
            </p>
            <p className="text-sm">Dihitung {fmtNum(saved.counted)} · sistem {fmtNum(saved.system)} {uom ?? ""}</p>
            {saved.result === "MISMATCH" && <p className="text-sm">Cek lagi di lantai, lalu hitung ulang. Selisih yang tetap: lapor supervisor untuk hitung stok.</p>}
            <Button size="lg" variant="outline" className="w-full" onClick={onClose}>Tutup</Button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            {correct && <p className="rounded-md bg-warn/10 p-2 text-sm">Hitung sebelumnya tetap tersimpan sebagai riwayat. Isi yang benar dan alasan ubah.</p>}
            <PersonNameField value={checker} onChange={setChecker} label="Nama checker (bukan petugas pindah baris ini)" id="src-checker" />
            <div>
              <Label htmlFor="src-counted">Jumlah karton di bin (semua batch)</Label>
              <Input id="src-counted" type="number" inputMode="numeric" min={0} step="any" autoFocus value={counted}
                onChange={(e) => setCounted(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="src-found">Barang lain di bin? Scan / ketik SKU-nya (kosongkan bila benar)</Label>
              <ItemScanInput id="src-found" value={skuInput}
                onChange={(v) => { setSkuInput(v); if (!v.trim()) setFound(null); }}
                onItem={(it, code) => setFound(it ? code : null)} />
            </div>
            <div>
              <Label htmlFor="src-note">{correct ? "Alasan ubah (wajib)" : "Catatan (wajib bila tidak sesuai)"}</Label>
              <Input id="src-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. 2 karton tidak ada di bin" />
            </div>
            {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Menyimpan…" : "Simpan hitung"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
