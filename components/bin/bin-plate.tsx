import { LEVEL_COLORS } from "@/config/warehouse";
import type { Bin } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The signature element: the bin code set like the physical safety-yellow
 * location plate, split into the parts an operator reads on the rack.
 */
export function BinPlate({ bin, compact = false }: { bin: Bin; compact?: boolean }) {
  const parts = bin.rack
    ? [["Aisle", bin.zone], ["Rak", bin.rack], ["Level", bin.level], ["Posisi", bin.position]]
    : [["Area", bin.zone], ["Lajur", bin.position ?? "–"]];
  const levelColor = bin.level ? LEVEL_COLORS[bin.level]?.hex : undefined;
  return (
    <div className="overflow-hidden rounded-plate bg-plate text-steel">
      {levelColor && <div className="h-2" style={{ background: levelColor }} aria-hidden />}
      <div className={cn("px-4", compact ? "py-2" : "py-3")}>
        <div className={cn("font-cond font-bold leading-none tracking-tight", compact ? "text-4xl" : "text-6xl sm:text-7xl")}>{bin.bin_code}</div>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {parts.map(([k, v]) => (
            <div key={k} className="flex gap-1.5"><dt className="text-steel-700">{k}</dt><dd className="font-semibold">{v}</dd></div>
          ))}
          {bin.status === "blocked" && <div className="rounded bg-bad px-1.5 text-xs font-semibold leading-5 text-white">Diblokir</div>}
        </dl>
      </div>
    </div>
  );
}
