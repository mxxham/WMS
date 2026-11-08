"use client";
import { useState } from "react";
import { ListOrdered } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WaveRow } from "@/lib/allocator/picklist-from-tasks";
import type { Rpc } from "./wave-parts";

/**
 * Urutan muat (0128): a loading number typed by hand per shipment of the day. A label only:
 * picking, Sisa and the print order never read it. Keyed on day + shipment, so `loadNos` is
 * keyed by shipment number. Its row lives in the wave's Lainnya menu.
 */
export function LoadNoButton({ wave, loadNos, supervisor, rpc }: {
  wave: WaveRow; loadNos: Record<string, number>; supervisor: boolean; rpc: Rpc;
}) {
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!supervisor || wave.status === "CANCELLED" || wave.shipment_numbers.length === 0) return null;

  const shown = (sh: string) => inputs[sh] ?? (loadNos[sh] ? String(loadNos[sh]) : "");
  // Numbers used by other shipments of the day, to warn about a duplicate.
  const usedBy = (n: number, self: string) => Object.entries(loadNos).filter(([sh, v]) => v === n && sh !== self).map(([sh]) => sh);

  async function save(sh: string) {
    const raw = shown(sh).trim();
    const n = raw === "" ? null : Number(raw);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 999)) {
      return setErrors((e) => ({ ...e, [sh]: "Isi angka 1 sampai 999, atau kosongkan untuk menghapus." }));
    }
    if (n === (loadNos[sh] ?? null)) return;
    setBusy(sh); setErrors((e) => ({ ...e, [sh]: "" }));
    const err = await rpc("set_shipment_load_no", { p_date: wave.planned_date, p_shipment: sh, p_load_no: n });
    setBusy(null);
    if (err) setErrors((e) => ({ ...e, [sh]: `Gagal menyimpan: ${err}` }));
    else setInputs((p) => { const { [sh]: _, ...rest } = p; return rest; });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setInputs({}); setErrors({}); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1"><ListOrdered className="h-4 w-4" />Urutan muat</Button>
      </DialogTrigger>
      <DialogContent title={`Urutan muat · NO ${wave.wave_no}`} className="max-w-md"
        description="Nomor urut muat tiap shipment hari ini. Hanya label: urutan picking dan picklist tidak berubah. Kosongkan untuk menghapus.">
        <div className="space-y-3">
          {wave.shipment_numbers.map((sh) => {
            const value = shown(sh);
            const n = Number(value);
            const dup = value !== "" && Number.isInteger(n) ? usedBy(n, sh) : [];
            const changed = value.trim() !== (loadNos[sh] ? String(loadNos[sh]) : "");
            return (
              <div key={sh} className="space-y-1">
                <div className="flex items-center gap-2">
                  <label htmlFor={`load-${wave.id}-${sh}`} className="w-28 shrink-0 font-semibold tabular">{sh}</label>
                  <Input id={`load-${wave.id}-${sh}`} type="number" inputMode="numeric" min={1} max={999} placeholder="–"
                    value={value} disabled={busy === sh} className="w-24 tabular"
                    onChange={(e) => setInputs((p) => ({ ...p, [sh]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && void save(sh)} />
                  <Button size="sm" disabled={busy === sh || !changed} onClick={() => void save(sh)}>
                    {busy === sh ? "Menyimpan…" : "Simpan"}
                  </Button>
                </div>
                {dup.length > 0 && <p className="text-xs text-warn">Nomor {n} juga dipakai shipment {dup.join(", ")}.</p>}
                {errors[sh] && <p role="alert" className="text-xs text-bad">{errors[sh]}</p>}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The "Muat N" tag shown before a shipment number. */
export function LoadNoTag({ n }: { n: number | undefined }) {
  if (!n) return null;
  return <span className="mr-1 rounded bg-steel px-1.5 text-xs font-semibold text-white tabular">Muat {n}</span>;
}
