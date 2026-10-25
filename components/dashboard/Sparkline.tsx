import { cn } from "@/lib/utils";

/**
 * Inline SVG polyline sparkline (~80x24) of weekly values over the last 30 days.
 * `values` holds 4-5 buckets (newest last); `null` = no data that week -> a gap,
 * never a zero. The last point is emphasized with a larger dot.
 * Values are percentages on a fixed 0-100 scale so sparklines stay comparable.
 */
export function Sparkline({
  values,
  width = 80,
  height = 24,
  highlight = true,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  highlight?: boolean;
}) {
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const y = v == null ? null : Math.round(height * (1 - v / 100));
    return { x, y };
  });

  // Contiguous non-null runs become separate polylines so null weeks render as gaps.
  const segments: number[][] = [];
  let cur: number[] = [];
  const pushPoint = (p: { x: number; y: number | null }) => {
    if (p.y == null) {
      if (cur.length) { segments.push(cur); cur = []; }
      return;
    }
    cur.push(p.x, p.y);
  };
  pts.forEach(pushPoint);
  if (cur.length) segments.push(cur);

  const last = pts[pts.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", highlight ? "opacity-100" : "opacity-60")}
    >
      {segments.map((seg, si) => (
        <polyline
          key={si}
          points={seg.join(" ")}
          stroke="#2A6F97"
          strokeWidth="1.5"
          fill="none"
        />
      ))}
      {/* Dots for each known point; last one emphasized. */}
      {pts.map((p, i) => {
        if (p.y == null) return null;
        const isLast = i === n - 1;
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={isLast && highlight ? 2.2 : 1.6}
            fill="#2A6F97"
            stroke="#ffffff"
            strokeWidth="0.6"
          />
        );
      })}
    </svg>
  );
}
