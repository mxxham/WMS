import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stateOf, type Bay, type RackBin } from "@/lib/racks";
import { cn, fmtNum } from "@/lib/utils";
import { OwnerBadge, StateBadge } from "./badges";

const LEVELS = ["E", "D", "C", "B", "A"];

/**
 * One rack, seen from the front: level E on top, two pallet positions per level, each as its location
 * plate with what it holds. Plates toggle the selection; the selection bar below acts on them.
 */
export function RackPanel({ bay, behind, selected, onToggle, onClose }: {
  bay: Bay; behind: Bay | null; selected: Set<string>;
  onToggle: (codes: string[], on: boolean) => void; onClose: () => void;
}) {
  const at = (level: string, pos: string): RackBin | undefined => bay.bins.find((b) => b.level === level && b.position === pos);
  const codes = bay.bins.map((b) => b.bin_code);
  const all = codes.length > 0 && codes.every((c) => selected.has(c));
  const ckb = bay.bins.some((b) => b.owner === "CKB");
  return (
    <aside aria-label={`Rak ${bay.zone}${bay.rack}`} className="rounded-xl border-l-4 border-floor bg-white p-4 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-cond text-2xl font-bold leading-none">Rak {bay.zone}{bay.rack}</h2>
          <p className="mt-1 text-xs text-steel-500">
            {bay.face === 0 ? "Sisi depan" : "Sisi belakang"}
            {behind ? `, punggung dengan ${behind.zone}${behind.rack}` : ""}
            {ckb ? ", dipinjam CKB 3PL" : ""}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Tutup rak" onClick={onClose}><X className="h-5 w-5" /></Button>
      </div>

      <div className="mt-3 grid grid-cols-[1.25rem_1fr_1fr] gap-1.5">
        {LEVELS.map((lv) => (
          <div key={lv} className="contents">
            <span className="flex items-center justify-center text-xs font-semibold text-steel-500">{lv}</span>
            {["01", "02"].map((p) => {
              const b = at(lv, p);
              if (!b) return <span key={p} className="rounded-plate border border-dashed border-steel-100" aria-hidden />;
              const on = selected.has(b.bin_code);
              const s = stateOf(b);
              return (
                <button key={p} type="button" aria-pressed={on} onClick={() => onToggle([b.bin_code], !on)}
                  className={cn("rounded-plate px-1.5 py-1.5 text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb",
                    s === "NOT_PRESENT" ? "border border-dashed border-steel-300 bg-transparent text-steel-500"
                      : s === "PLANNED" ? "border border-dotted border-ckb bg-paper text-ckb"
                      : Number(b.total_qty) > 0 ? "bg-plate text-steel" : "border border-steel-300 bg-white text-steel",
                    on && "ring-2 ring-floor ring-offset-1")}>
                  <span className="block font-cond text-base font-bold leading-tight tracking-tight">{b.bin_code}</span>
                  <span className="block text-[11px] leading-tight">
                    {s === "NOT_PRESENT" ? "tidak ada" : s === "PLANNED" ? "rencana" : Number(b.total_qty) > 0 ? `${fmtNum(Number(b.total_qty))} karton` : "kosong"}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-1">{s === "BLOCKED" && <StateBadge bin={b} />}{b.owner === "CKB" && <OwnerBadge owner={b.owner} />}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {bay.bins.some((b) => b.block_reason) && (
        <ul className="mt-3 space-y-0.5 text-xs text-steel-500">
          {[...new Set(bay.bins.map((b) => b.block_reason).filter(Boolean))].map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => onToggle(codes, !all)}>
        {all ? "Lepas seluruh rak" : `Pilih seluruh rak (${codes.length} bin)`}
      </Button>
    </aside>
  );
}
