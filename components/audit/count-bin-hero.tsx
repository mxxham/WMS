import type { ReactNode } from "react";
import { LEVEL_COLORS_WEB } from "@/config/warehouse";
import { cn } from "@/lib/utils";

/** Rack bin CA17C01 -> aisle CA · rack 17 · level C · position 01 (RACK_BIN_REGEX shape).
 *  STAGING etc. are not rack locations and render as a code-only plate. */
const RACK_PARTS = /^([A-Z]{2})(\d{2})([A-E])(\d{2})$/;

/**
 * The bin a checker is standing at, in the app's own palette (ckb-tint surface,
 * navy→teal accents) instead of the old safety-yellow plate. Bare bin code, no
 * server Bin object — the facts the count compares go into `children`.
 */
export function CountBinHero({ binCode, children, amount, progressText, compact = false }: {
  binCode: string;
  /** SKU, batch/exp, shipment … — what the checker verifies on the bin */
  children?: ReactNode;
  /** The number the count is checked against, as the second visual anchor */
  amount?: { label: string; value: string; unit?: string | null };
  /** e.g. "Bin 7 dari 23" — the walk position, composed by the caller */
  progressText?: string | null;
  compact?: boolean;
}) {
  const match = binCode.match(RACK_PARTS);
  const parts: Array<[string, string]> = match
    ? [["Aisle", match[1]!], ["Rak", match[2]!], ["Level", match[3]!], ["Posisi", match[4]!]]
    : [];
  const stop = match ? LEVEL_COLORS_WEB[match[3]!] : undefined;
  return (
    <div className="overflow-hidden rounded-plate bg-ckb-tint ring-1 ring-ckb/15">
      {stop && <div className="h-2" style={{ background: stop }} aria-hidden />}
      <div className="px-4 pb-3 pt-2">
        <div className={cn("font-cond font-bold leading-none tracking-tight text-steel", compact ? "text-3xl" : "text-5xl")}>{binCode}</div>
        {match && !compact && (
          <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            {parts.map(([k, v]) => (
              <div key={k} className="flex items-center gap-1 text-steel-700">
                {k === "Level" && stop && <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: stop }} />}
                <dt>{k}</dt><dd className="font-semibold text-steel">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {children && <div className={cn("text-sm", !compact && "mt-2 border-t border-steel/10 pt-2")}>{children}</div>}
        {amount && !compact && (
          <dl className="mt-2 flex items-end justify-between border-t border-steel/10 pt-2">
            <dt className="text-xs font-medium text-steel-700">{amount.label}</dt>
            <dd className="text-right">
              <span className="font-cond text-3xl font-bold leading-none tabular text-steel">{amount.value}</span>
              {amount.unit ? <span className="ml-1 text-sm font-semibold text-steel-700">{amount.unit}</span> : null}
            </dd>
          </dl>
        )}
        {progressText && <p className="mt-1.5 text-xs font-semibold text-steel-700">{progressText}</p>}
      </div>
    </div>
  );
}
