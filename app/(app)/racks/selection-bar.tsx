import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { codeRangeText, type RackBin } from "@/lib/racks";
import { cn } from "@/lib/utils";

const LEVELS = ["A", "B", "C", "D", "E"];

/**
 * Sticky at the bottom while anything is selected: what is selected, level chips to keep only some
 * levels ("only level A of these racks"), and the actions (`children`, given by the page per role).
 */
export function SelectionBar({ bins, onKeepLevels, onClear, children }: {
  bins: RackBin[]; onKeepLevels: (levels: string[]) => void; onClear: () => void; children?: React.ReactNode;
}) {
  if (bins.length === 0) return null;
  const levels = new Set(bins.map((b) => b.level).filter((l): l is string => !!l));
  return (
    <div role="region" aria-label="Bin terpilih"
      className="sticky bottom-20 z-20 mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-jeir-navy px-4 py-3 text-white shadow-2xl lg:bottom-4">
      <div className="min-w-0">
        <div className="font-cond text-lg font-semibold leading-tight">{bins.length} bin dipilih</div>
        <div className="truncate text-xs text-white/70">{codeRangeText(bins.map((b) => b.bin_code))}</div>
      </div>
      {levels.size > 0 && (
        <div className="flex items-center gap-1" aria-label="Simpan level">
          <span className="mr-1 text-xs text-white/70">Level</span>
          {LEVELS.map((l) => {
            const on = levels.has(l);
            return (
              <button key={l} type="button" disabled={!on || levels.size === 1}
                title={on ? `Hanya level ${l}` : `Tidak ada level ${l} di pilihan`}
                onClick={() => onKeepLevels([l])}
                className={cn("h-7 w-7 rounded-md text-sm font-semibold",
                  on ? "bg-white/15 hover:bg-white/30 disabled:hover:bg-white/15" : "text-white/30")}>{l}</button>
            );
          })}
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={onClear}><X className="h-4 w-4" />Lepas pilihan</Button>
      </div>
    </div>
  );
}
