import { fmtNum, cn } from "@/lib/utils";
import type { RackTiles } from "@/lib/racks";

/**
 * The six numbers of the page. Occupancy is over Shell's usable positions only, the same rule as the
 * Dashboard (0132): CKB 3PL, blocked, missing and planned bins are counted beside it, never inside it.
 */
export function Tiles({ tiles: t }: { tiles: RackTiles }) {
  const items: { label: string; value: string; note?: string; tone?: string }[] = [
    { label: "Posisi Shell bisa dipakai", value: fmtNum(t.usable) },
    { label: "Terisi", value: `${Math.round(t.pct * 100)}%`, note: `${fmtNum(t.occupied)} dari ${fmtNum(t.usable)} posisi` },
    { label: "Dipinjam CKB 3PL", value: fmtNum(t.ckb), tone: "text-jeir-navy" },
    { label: "Diblokir", value: fmtNum(t.blocked), tone: t.blocked ? "text-bad" : undefined },
    { label: "Tidak ada", value: fmtNum(t.notPresent), note: "tiang, tanpa rak", tone: "text-steel-500" },
    { label: "Rencana", value: fmtNum(t.planned), note: t.planned ? "belum dibangun" : undefined, tone: "text-ckb" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg bg-white px-3 py-2.5">
          <dt className="text-xs text-steel-500">{i.label}</dt>
          <dd className={cn("font-cond text-3xl font-semibold leading-tight tabular", i.tone)}>{i.value}</dd>
          {i.note && <dd className="text-[11px] text-steel-500">{i.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
