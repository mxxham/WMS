import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/app/confirm-button";
import { cn } from "@/lib/utils";
import type { WaveRow } from "@/lib/allocator/picklist-from-tasks";
import type { Primary } from "@/lib/wave-next-step";
import { CompleteWaveButton } from "./wave-menu";
import type { WaveModel } from "./wave-model";

/**
 * The wave's one primary button, chosen by its next step (lib/wave-next-step.ts): Mulai picking,
 * Lihat (what blocks it), Tutup wave, or Aktifkan. Nothing when the wave needs nothing.
 */
export function WavePrimary({ model: m, wave: w, primary, onStart, onShowProblems, layout }: {
  model: WaveModel; wave: WaveRow; primary: Primary; onStart: () => void; onShowProblems: () => void;
  layout: "desktop" | "phone";
}) {
  const phone = layout === "phone";
  const big = phone ? "h-14 w-full text-base" : undefined;
  switch (primary) {
    case "mulai":
      return <Button className={big} onClick={onStart}><ClipboardList className="h-5 w-5" />Mulai picking</Button>;
    case "lihat":
      return <Button variant="outline" className={cn("border-bad text-bad", big)} onClick={onShowProblems}>{phone ? "Lihat yang tertahan" : "Lihat"}</Button>;
    case "tutup": {
      const open = m.tasks.filter((t) => t.wave_id === w.id && t.status === "PLANNED");
      return <CompleteWaveButton wave={w} open={open} rpc={m.rpc} variant="default" size="sm" className={phone ? big : "h-10 px-4 text-sm"} />;
    }
    case "aktifkan":
      return m.supervisor ? (
        <ConfirmButton className={big} title={`Aktifkan NO ${w.wave_no}`} summary="Wave kembali bisa dikerjakan."
          onConfirm={() => m.rpc("set_wave_status", { p_wave_id: w.id, p_status: "PENDING" })}>Aktifkan</ConfirmButton>
      ) : null;
    default:
      return null;
  }
}
