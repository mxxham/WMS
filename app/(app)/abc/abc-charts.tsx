import { CLASSES, paretoPoints, type AbcClass, type ClassSummary } from "@/lib/abc";
import { cn, fmtNum } from "@/lib/utils";

/** One colour per class, from the warehouse's blue ramp; C stays pale so A reads first. */
export const CLASS_FILL: Record<AbcClass, string> = { A: "#01497C", B: "#2A6F97", C: "#A9D6E5" };
export const CLASS_BADGE: Record<AbcClass, string> = { A: "bg-ckb-dark text-white", B: "bg-ckb text-white", C: "bg-ckb-tint text-steel" };

export function ClassBadge({ cls, className }: { cls: AbcClass; className?: string }) {
  return <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded font-cond text-sm font-bold", CLASS_BADGE[cls], className)}>{cls}</span>;
}

/**
 * The Pareto curve: SKUs in rank order along the bottom, the share of all picking lines they make up the side.
 * The bands under the curve are the classes; the dashed lines are the run's limits.
 */
export function ParetoChart({ rows, summary, aPct, bPct }: {
  rows: { pick_lines: number; class: AbcClass }[]; summary: ClassSummary[]; aPct: number; bPct: number;
}) {
  const W = 320, H = 180, L = 34, R = 8, T = 10, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const pts = paretoPoints(rows);
  const x = (v: number) => L + v * pw, y = (v: number) => T + (1 - v) * ph;
  const line = pts.map((p) => `${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  // Class bands: where each class starts and ends along the SKU axis.
  let start = 0;
  const bands = CLASSES.map((cls) => {
    const n = rows.filter((r) => r.class === cls).length, from = start / Math.max(rows.length, 1);
    start += n;
    return { cls, from, to: start / Math.max(rows.length, 1) };
  });
  const a = summary.find((s) => s.cls === "A");
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
        aria-label={`Kurva Pareto: ${fmtNum(a?.skus ?? 0)} SKU kelas A (${fmtNum(a?.skuPct ?? 0, 0)}% SKU) membuat ${fmtNum(a?.linesPct ?? 0, 0)}% baris picking`}>
        {bands.map((b) => b.to > b.from && (
          <rect key={b.cls} x={x(b.from)} y={T} width={x(b.to) - x(b.from)} height={ph} fill={CLASS_FILL[b.cls]} opacity={0.12} />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#E0E7ED" strokeWidth={0.6} />
            <text x={L - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="#546675">{v * 100}%</text>
            <text x={x(v)} y={H - B + 12} textAnchor="middle" fontSize={8} fill="#546675">{v * 100}%</text>
          </g>
        ))}
        {[aPct, bPct].map((p) => (
          <g key={p}>
            <line x1={L} x2={W - R} y1={y(p / 100)} y2={y(p / 100)} stroke="#D9941A" strokeDasharray="3 3" strokeWidth={0.9} />
            {/* Left of the curve the area above each limit is empty: the label never sits on the line. */}
            <text x={L + 3} y={y(p / 100) - 3} textAnchor="start" fontSize={8} fill="#8a5a06">batas {fmtNum(p)}%</text>
          </g>
        ))}
        <polyline points={line} fill="none" stroke="#01497C" strokeWidth={1.8} strokeLinejoin="round" />
        {bands.map((b) => b.to > b.from && (
          <text key={b.cls} x={(x(b.from) + x(b.to)) / 2} y={H - B - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={CLASS_FILL[b.cls] === "#A9D6E5" ? "#468FAF" : CLASS_FILL[b.cls]}>{b.cls}</text>
        ))}
        <text x={L + pw / 2} y={H - 2} textAnchor="middle" fontSize={8} fill="#546675">% SKU (urut paling sering dipick)</text>
      </svg>
      <figcaption className="text-sm text-steel-500">
        <b className="text-steel">{fmtNum(a?.skus ?? 0)} SKU</b> ({fmtNum(a?.skuPct ?? 0, 0)}% dari semua SKU) membuat <b className="text-steel">{fmtNum(a?.linesPct ?? 0, 1)}%</b> baris
        picking dan {fmtNum(a?.cartonsPct ?? 0, 1)}% karton.
      </figcaption>
    </figure>
  );
}

/** Previous class (rows) by new class (columns): the diagonal stayed, everything else moved. */
export function ChangeMatrix({ matrix, onPick }: { matrix: Record<string, Record<AbcClass, number>>; onPick?: (from: string, to: AbcClass) => void }) {
  const froms = ["A", "B", "C", "–"].filter((f) => f !== "–" || CLASSES.some((c) => matrix["–"][c] > 0));
  return (
    <table className="w-full border-separate border-spacing-1 text-center text-sm">
      <thead><tr><th className="text-left text-xs font-normal text-steel-500">dulu ↓ / sekarang →</th>
        {CLASSES.map((c) => <th key={c}><ClassBadge cls={c} /></th>)}</tr></thead>
      <tbody>{froms.map((f) => (
        <tr key={f}>
          <th className="text-left">{f === "–" ? <span className="text-xs font-normal text-steel-500">belum ada</span> : <ClassBadge cls={f as AbcClass} />}</th>
          {CLASSES.map((c) => {
            const n = matrix[f][c], same = f === c;
            return (
              <td key={c}>
                <button type="button" disabled={!n || !onPick} onClick={() => onPick?.(f, c)}
                  className={cn("w-full rounded-md py-2 font-semibold tabular-nums",
                    !n ? "bg-paper text-steel-300" : same ? "bg-steel-100 text-steel" : "bg-warn/15 text-steel ring-1 ring-warn/40 hover:bg-warn/25")}>
                  {fmtNum(n)}
                </button>
              </td>
            );
          })}
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Three thin bars per class: share of SKUs, of picking lines, of cartons. */
export function ShareBars({ s }: { s: ClassSummary }) {
  const bar = (label: string, pct: number) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 shrink-0 text-steel-500">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-steel-100"><div className="h-full rounded" style={{ width: `${Math.min(100, pct)}%`, background: CLASS_FILL[s.cls] }} /></div>
      <span className="w-12 shrink-0 text-right tabular-nums">{fmtNum(pct, 1)}%</span>
    </div>
  );
  return <div className="space-y-1">{bar("SKU", s.skuPct)}{bar("Baris", s.linesPct)}{bar("Karton", s.cartonsPct)}</div>;
}
