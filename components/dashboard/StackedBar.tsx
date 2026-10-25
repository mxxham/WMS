import { cn, fmtNum } from "@/lib/utils";

type BarSegment = { label: string; value: number; fill: string };

/**
 * Horizontal stacked bar with a per-segment tooltip and a visible legend
 * (numbers + labels) so it is not color-only. Zero-value segments are skipped.
 */
export function StackedBar({
  segments,
  width = 220,
  barHeight = 18,
  ariaLabel,
}: {
  segments: BarSegment[];
  width?: number;
  barHeight?: number;
  ariaLabel: string;
}) {
  const shown = segments.filter((s) => s.value > 0);
  const total = shown.reduce((s, v) => s + v.value, 0);

  return (
    <div role="img" aria-label={ariaLabel} className="flex w-full flex-col gap-2">
      <svg
        width={width}
        height={barHeight}
        viewBox={`0 0 ${width} ${barHeight}`}
        fill="none"
        className={cn("w-full max-w-[260px] shrink-0 border border-steel-200/60 rounded", total === 0 ? "opacity-40" : "")}
      >
        {shown.map((seg, i) => {
          let x = 0;
          for (let j = 0; j < i; j++) x += (shown[j]!.value / total) * width;
          const segWidth = total > 0 ? (seg.value / total) * width : 0;
          return (
            <g key={seg.label}>
              <title>{`${seg.label}: ${fmtNum(seg.value)}`}</title>
              <rect
                x={x}
                y={1}
                width={Math.max(segWidth, 1)}
                height={barHeight - 2}
                fill={seg.fill}
                rx="2"
              />
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {shown.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded" style={{ background: seg.fill }} />
            <span className="text-steel-600">{seg.label}</span>
            <span className="font-semibold tabular text-steel-800">{fmtNum(seg.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
