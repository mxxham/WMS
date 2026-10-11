import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { cn, fmtNum } from "@/lib/utils";

export type ProblemCounts = { short: number; waiting: number; counts: number; requests: number; corrections: number };

/** "2 stok kurang · 1 menunggu Bin To Bin · 9 hitung · 1 minta supervisor" — only what is there. */
export function problemParts(c: ProblemCounts): string[] {
  return [
    c.short > 0 && `${fmtNum(c.short)} stok kurang`,
    c.waiting > 0 && `${fmtNum(c.waiting)} menunggu Bin To Bin`,
    c.counts > 0 && `${fmtNum(c.counts)} hitung`,
    c.requests > 0 && `${fmtNum(c.requests)} minta supervisor`,
    c.corrections > 0 && `${fmtNum(c.corrections)} koreksi picklist`,
  ].filter((x): x is string => !!x);
}

/**
 * Perlu ditangani, collapsed to one line (redesign). Red when something blocks posting;
 * opening it shows the existing panels unchanged. Hidden when there is nothing.
 */
export function ProblemsSummary({ counts, open, onOpenChange, children }: {
  counts: ProblemCounts; open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode;
}) {
  const parts = problemParts(counts);
  if (parts.length === 0) return null;
  const blocking = counts.short > 0 || counts.waiting > 0;
  return (
    <section id="perlu-ditangani" className="rounded-lg bg-white">
      <button type="button" aria-expanded={open} onClick={() => onOpenChange(!open)}
        className={cn("flex min-h-12 w-full items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-steel-100", open && "rounded-b-none")}>
        <AlertTriangle className={cn("h-5 w-5 shrink-0", blocking ? "text-bad" : "text-steel-500")} />
        <span className="flex-1">
          <span className="block font-cond text-lg font-semibold">Perlu ditangani</span>
          <span className={cn("block text-sm", blocking ? "text-bad" : "text-steel-500")}>{parts.join(" · ")}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-steel-700">{open ? "Tutup" : "Lihat"}{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {open && <div className="space-y-4 border-t border-steel-100 p-4">{children}</div>}
    </section>
  );
}
