"use client";
import { useState } from "react";
import { X, FileSpreadsheet } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WaveRow } from "@/lib/allocator/picklist-from-tasks";
import type { Rpc } from "./wave-parts";

/**
 * DoButton + dialog for recording manual DO numbers per shipment in a wave.
 * One dialog for the whole wave (designer decision), opened from the wave header
 * on both desktop and phone.
 */
export function DoButton({
  wave,
  shipments,
  dos,
  supervisor,
  rpc,
}: {
  wave: WaveRow;
  shipments: string[];
  dos: Record<string, string[]>;
  supervisor: boolean;
  rpc: Rpc;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Local input values per shipment
  const [inputs, setInputs] = useState<Record<string, string>>({});

  // Gated: supervisor only, wave not cancelled, at least one shipment
  if (!supervisor || wave.status === "CANCELLED" || shipments.length === 0) return null;

  const currentDos = (shipment: string) => dos[`${wave.id}|${shipment}`] ?? [];

  async function handleAdd(shipment: string) {
    const value = inputs[shipment]?.trim();
    if (!value) return;
    const list = currentDos(shipment);
    if (list.includes(value)) {
      // Silently ignore duplicate
      setInputs((prev) => ({ ...prev, [shipment]: "" }));
      return;
    }
    const newList = [...list, value];
    setBusy((prev) => ({ ...prev, [shipment]: true }));
    setErrors((prev) => ({ ...prev, [shipment]: "" }));
    const err = await rpc("set_shipment_dos", {
      p_wave_id: wave.id,
      p_shipment: shipment,
      p_dos: newList,
    });
    setBusy((prev) => ({ ...prev, [shipment]: false }));
    if (err) {
      setErrors((prev) => ({ ...prev, [shipment]: `Gagal menyimpan DO: ${err}` }));
    } else {
      setInputs((prev) => ({ ...prev, [shipment]: "" }));
    }
  }

  async function handleRemove(shipment: string, doNo: string) {
    const list = currentDos(shipment).filter((d) => d !== doNo);
    setBusy((prev) => ({ ...prev, [shipment]: true }));
    setErrors((prev) => ({ ...prev, [shipment]: "" }));
    const err = await rpc("set_shipment_dos", {
      p_wave_id: wave.id,
      p_shipment: shipment,
      p_dos: list,
    });
    setBusy((prev) => ({ ...prev, [shipment]: false }));
    if (err) {
      setErrors((prev) => ({ ...prev, [shipment]: `Gagal menyimpan DO: ${err}` }));
    }
  }

  const isBusy = (shipment: string) => busy[shipment];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <FileSpreadsheet className="h-4 w-4" />
          DO no
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Nomor DO · NO ${wave.wave_no}`}
        description="Catat nomor DO dari surat jalan Shell untuk tiap picklist. Bisa diubah kapan saja."
        className="max-w-md"
      >
        <div className="space-y-4">
          {shipments.map((shipment) => {
            const list = currentDos(shipment);
            const err = errors[shipment];
            const loading = isBusy(shipment);
            return (
              <div key={shipment} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular w-24 shrink-0">{shipment}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {list.map((d) => (
                      <span
                        key={d}
                        className={cn(
                          "inline-flex items-center gap-1 rounded bg-steel-100 px-2 py-0.5 text-sm",
                          loading && "opacity-50"
                        )}
                      >
                        <span className="font-mono tabular">{d}</span>
                        <button
                          type="button"
                          aria-label={`Hapus DO ${d}`}
                          disabled={loading}
                          onClick={() => handleRemove(shipment, d)}
                          className="text-steel-500 hover:text-bad"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id={`do-input-${wave.id}-${shipment}`}
                    placeholder="DO 5123456"
                    value={inputs[shipment] ?? ""}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [shipment]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && !loading && handleAdd(shipment)}
                    inputMode="text"
                    disabled={loading}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={loading || !inputs[shipment]?.trim()}
                    onClick={() => handleAdd(shipment)}
                  >
                    {loading ? "Menyimpan…" : "Tambah"}
                  </Button>
                </div>
                {err && <p className="text-xs text-bad ml-10">{err}</p>}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}