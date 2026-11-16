"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { BinScanInput } from "@/components/app/bin-scan-input";
import { movable, moveSentence, type StagingLine } from "@/lib/staging";
import { fmtNum } from "@/lib/utils";

const RACK = /^C[A-Z]\d{2}[A-E]\d{2}$/;

/**
 * Move one staging line (or part of it) into a rack. The rack field takes a hardware scanner (it types the
 * label's code, Enter goes on) or the phone camera. One confirmation with the sentence, then the move posts and the dialog
 * closes; nothing after posting. The database decides whether the rack may be used and refuses reserved stock.
 */
export function MoveDialog({ line, onClose }: { line: StagingLine | null; onClose: () => void }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [qty, setQty] = useState(0);
  const [person, setPerson] = usePersonName();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = line ? movable(line) : 0;

  useEffect(() => { setTo(""); setQty(line ? movable(line) : 0); setConfirming(false); setError(null); }, [line]);

  const problem = !RACK.test(to) ? "Scan atau ketik lokasi rak (mis. CB12A01)."
    : !(qty > 0 && qty <= max) ? `Qty 1 sampai ${fmtNum(max)}.`
    : person.trim().length < 2 ? "Isi nama Anda." : null;

  function next() { if (!problem) { setError(null); setConfirming(true); } }

  async function post() {
    if (!line || problem) return;
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("staging_to_rack", {
      p_from_bin: line.bin_code, p_sku: line.sku, p_batch: line.batch_lot, p_expiry: line.expiry_date,
      p_qty: qty, p_to_bin: to, p_by_name: person.trim(),
    });
    setBusy(false);
    if (error) { setConfirming(false); return setError(error.message); }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={!!line} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      {line && (
        <DialogContent title="Pindah ke rak" description={`${line.sku} · batch ${line.batch_lot || "–"} · ${fmtNum(line.quantity)} ${line.uom} di ${line.bin_code}`}>
          {!confirming ? (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); next(); }}>
              <div>
                <Label htmlFor="stg-to">Lokasi rak tujuan</Label>
                {/* A USB/Bluetooth scanner types the label and Enter goes on; the camera button reads it on a phone. */}
                <BinScanInput id="stg-to" autoFocus placeholder="scan label rak / ketik" value={to}
                  onChange={(v) => setTo(v.replace(/\s+/g, ""))} />
              </div>
              <div>
                <Label htmlFor="stg-qty">Qty ({line.uom}){line.reserved > 0 && <span className="font-normal text-steel-500"> · {fmtNum(line.reserved)} dipesan wave, tidak bisa dipindah</span>}</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" aria-label="Kurangi" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus className="h-4 w-4" /></Button>
                  <Input id="stg-qty" type="number" inputMode="numeric" min={1} max={max} className="w-28 text-center tabular" value={qty || ""}
                    onChange={(e) => setQty(Number(e.target.value))} />
                  <Button type="button" variant="outline" size="sm" aria-label="Tambah" disabled={qty >= max} onClick={() => setQty((q) => Math.min(max, q + 1))}><Plus className="h-4 w-4" /></Button>
                  <span className="text-sm text-steel-500">dari {fmtNum(max)}</span>
                </div>
              </div>
              <PersonNameField value={person} onChange={setPerson} label="Nama Anda" id="stg-person" />
              {error && <p className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
              {to && problem && <p className="text-sm text-steel-500">{problem}</p>}
              <Button type="submit" className="w-full" disabled={!!problem}>Lanjut</Button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-base font-semibold">{moveSentence(line, qty, to)}</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setConfirming(false)}>Kembali</Button>
                <Button className="flex-1" disabled={busy} onClick={() => void post()}>{busy ? "Memindahkan…" : "Ya, pindahkan"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
