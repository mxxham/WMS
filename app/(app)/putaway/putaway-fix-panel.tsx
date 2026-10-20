import { Input, Select } from "@/components/ui/input";
import { FIX_LABELS, fixDelta, fixProblem, type FixChoice, type FixLine } from "@/lib/putaway-sheet";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

/**
 * "Sheet benar: betulkan isi bin": one decision per line the system holds in the bin.
 * The sheet's pallet is put away after these; nothing is posted until Posting is confirmed.
 */
export function PutawayFixPanel({ bin, lines, limit, error, onChange }: {
  bin: string; lines: FixLine[]; limit: number; error?: string | null; onChange: (lines: FixLine[]) => void;
}) {
  const set = (i: number, patch: Partial<FixLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const problem = fixProblem(bin, lines);
  return (
    <div className="mt-2 space-y-2 rounded-md border border-warn/50 bg-white p-2 text-xs">
      <p className="font-semibold">Isi {bin} di sistem: apa yang sebenarnya ada?</p>
      {lines.length === 0 && <p className="text-steel-500">Sistem tidak mencatat stok lain di bin ini.</p>}
      {lines.map((l, i) => {
        const d = fixDelta(l);
        return (
          <div key={`${l.sku}|${l.batch_lot}|${l.expiry_date}`} className="space-y-1 border-t border-steel-100 pt-2 first:border-0 first:pt-0">
            <div>{l.sku} · {l.batch_lot || "–"} · {fmtDate(l.expiry_date)} · <b>{fmtNum(l.quantity)}</b></div>
            <div className="flex flex-wrap items-center gap-1">
              <Select aria-label={`Keputusan ${l.sku} ${l.batch_lot} di ${bin}`} className="h-8 w-44" value={l.choice}
                onChange={(e) => set(i, { choice: e.target.value as FixChoice | "" })}>
                <option value="">Pilih…</option>
                {(Object.keys(FIX_LABELS) as FixChoice[]).map((c) => <option key={c} value={c}>{FIX_LABELS[c]}</option>)}
              </Select>
              {l.choice === "count" && (
                <Input aria-label={`Jumlah sebenarnya ${l.sku} di ${bin}`} inputMode="numeric" className="h-8 w-20" placeholder="qty"
                  value={l.counted ?? ""} onChange={(e) => set(i, { counted: e.target.value })} />
              )}
              {l.choice === "move" && (
                <Input aria-label={`Bin tujuan ${l.sku} dari ${bin}`} className="h-8 w-28" placeholder="bin tujuan"
                  value={l.move_to ?? ""} onChange={(e) => set(i, { move_to: e.target.value.toUpperCase() })} />
              )}
              {d !== 0 && (
                <span className={cn("font-semibold", Math.abs(d) > limit ? "text-warn" : "text-steel-500")}>
                  {d > 0 ? "+" : ""}{fmtNum(d)}{Math.abs(d) > limit && " · perlu persetujuan di Adjust stok"}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {(error || problem) && <p role="alert" className="text-bad">{error ?? problem}</p>}
    </div>
  );
}
