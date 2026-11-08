import { memo, useCallback, useEffect, useRef } from "react";
import { binColor } from "@/components/warehouse/colors";
import type { ColorMode } from "@/lib/warehouse-types";
import { bayKey, overlayOf, stateOf, type AisleBlock, type Bay, type FloorPlan as Plan, type RackBin } from "@/lib/racks";
import { cn, fmtNum } from "@/lib/utils";

export type PlanMode = ColorMode | "status";

/** What one pallet position (01 or 02) of a bay shows, from its bins on every level. */
type Cell = { kind: "none" | "gone" | "planned" | "blocked" | "ckb" | "fill"; color: string };

export const STATUS_COLOR = { SHELL: "#89C2D9", CKB: "#2A6F97" } as const;

function positionCell(bins: RackBin[], mode: PlanMode): Cell {
  // No bin row at all: nothing is drawn (the plan has no rack there). A pillar is a bin marked NOT_PRESENT.
  if (bins.length === 0) return { kind: "none", color: "transparent" };
  if (bins.every((b) => b.block_kind === "NOT_PRESENT")) return { kind: "gone", color: "transparent" };
  if (bins.every((b) => b.block_kind === "PLANNED")) return { kind: "planned", color: "transparent" };
  const fullest = bins.reduce((a, b) => (Number(b.total_qty) > Number(a.total_qty) ? b : a));
  if (bins.some((b) => overlayOf(b) === "BLOCKED")) return { kind: "blocked", color: binColor(fullest, mode === "status" ? "fill" : mode) };
  if (mode === "status") return { kind: bins.some((b) => b.owner === "CKB") ? "ckb" : "fill", color: bins.some((b) => b.owner === "CKB") ? STATUS_COLOR.CKB : STATUS_COLOR.SHELL };
  return { kind: bins.some((b) => b.owner === "CKB") ? "ckb" : "fill", color: binColor(fullest, mode) };
}

/** "CE32, 7 dari 10 posisi terisi, 1 tidak ada" — what a screen reader says for a bay. */
function bayLabel(bay: Bay): string {
  if (bay.bins.length === 0) return `${bay.zone}${bay.rack}, tidak ada bin`;
  const real = bay.bins.filter((b) => b.block_kind !== "NOT_PRESENT");
  const full = real.filter((b) => Number(b.total_qty) > 0).length;
  const parts = [`${bay.zone}${bay.rack}`, `${full} dari ${real.length} posisi terisi`];
  const gone = bay.bins.length - real.length;
  if (gone) parts.push(`${gone} tidak ada`);
  const blocked = real.filter((b) => stateOf(b) === "BLOCKED").length;
  if (blocked) parts.push(`${blocked} diblokir`);
  if (real.some((b) => b.block_kind === "PLANNED")) parts.push("rencana");
  if (real.some((b) => b.owner === "CKB")) parts.push("dipinjam CKB 3PL");
  return parts.join(", ");
}

const HATCH = "repeating-linear-gradient(45deg, #C0392B 0 2px, #f3c4bf 2px 4px)";
/** No rack here (a pillar): the plan's floor colour crossed by fine grey lines, never mistaken for an empty position. */
export const GONE = "repeating-linear-gradient(-45deg, #A3B2BE 0 1px, #DDE3E8 1px 4px)";

function PositionCell({ cell }: { cell: Cell }) {
  return (
    <span aria-hidden className={cn("block h-full",
      cell.kind === "none" && "bg-[#DDE3E8]",
      cell.kind === "planned" && "bg-paper outline outline-1 -outline-offset-1 outline-dotted outline-ckb")}
      style={cell.kind === "blocked" ? { background: HATCH } : cell.kind === "gone" ? { background: GONE }
        : cell.kind === "fill" || cell.kind === "ckb" ? { background: cell.color } : undefined} />
  );
}

type AisleProps = {
  aisle: AisleBlock; mode: PlanMode;
  /** keys of this aisle's bays that are (fully or partly) selected / found by the search / open */
  picked: string; found: string; open: string | null;
  onBay: (bay: Bay, e: React.MouseEvent | React.KeyboardEvent) => void;
  onBayEnter: (bay: Bay) => void;
  onAisle: (zone: string) => void;
};

/** One aisle block: its name, then its two back-to-back faces. Memoised: a selection elsewhere leaves it alone. */
const AisleRow = memo(function AisleRow({ aisle, mode, picked, found, open, onBay, onBayEnter, onAisle }: AisleProps) {
  const pickedSet = new Set(picked ? picked.split(",") : []);
  const foundSet = new Set(found ? found.split(",") : []);
  return (
    <div className="flex items-stretch gap-2">
      <button type="button" onClick={() => onAisle(aisle.zone)} title={`Pilih seluruh aisle ${aisle.zone}`}
        className={cn("flex w-10 shrink-0 flex-col items-center justify-center rounded-md font-cond text-lg font-bold leading-none hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb",
          aisle.planned ? "text-ckb" : "text-steel")}>
        {aisle.zone}
        {aisle.planned && <span className="mt-0.5 font-sans text-[9px] font-semibold">rencana</span>}
      </button>
      <div className={cn("flex flex-1 flex-col gap-px rounded-sm p-px", aisle.planned ? "outline outline-1 outline-dotted outline-ckb" : "bg-plate-dark")}>
        {aisle.faces.map((face, f) => (
          <div key={f} className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-px">
            {face.map((bay) => {
              const key = bayKey(bay.zone, bay.rack);
              const byPos = ["01", "02"].map((p) => positionCell(bay.bins.filter((b) => b.position === p), mode));
              const empty = bay.bins.length === 0;
              return (
                <button key={key} id={`bay-${key}`} type="button" data-bay={key} tabIndex={-1}
                  aria-label={bayLabel(bay)} aria-pressed={pickedSet.has(key)}
                  onMouseDown={(e) => { if (!empty) { e.preventDefault(); onBay(bay, e); } }}
                  onMouseEnter={() => onBayEnter(bay)}
                  onKeyDown={(e) => { if (!empty && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onBay(bay, e); } }}
                  className={cn("relative grid h-4 grid-cols-2 gap-px bg-plate-dark focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-floor sm:h-[18px]",
                    empty ? "cursor-default bg-transparent" : "cursor-pointer",
                    pickedSet.has(key) && "z-[1] ring-2 ring-floor",
                    foundSet.has(key) && "z-[2] ring-2 ring-bad",
                    open === key && "z-[3] ring-[3px] ring-floor")}>
                  {byPos.map((c, i) => <PositionCell key={i} cell={c} />)}
                  {bay.bins.some((b) => b.owner === "CKB") && mode !== "status" && (
                    <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-jeir-teal" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});

/**
 * Denah: the racks seen from above, drawn by the same rules as Gudang 3D (recompute_bin_positions):
 * aisles in layout order, each one back-to-back block (racks 01-20 in front, 21-40 behind), two pallet
 * positions per bay, the floor locations in a row in front. Mouse: click a bay to open it, drag or
 * shift-click for a range, click an aisle name for the whole aisle. Keyboard: arrows move, Enter opens,
 * Space selects, Esc clears.
 */
export function FloorPlan({ plan, mode, picked, found, open, onOpen, onRange, onToggleBay, onAisle, onClear }: {
  plan: Plan; mode: PlanMode;
  picked: Set<string>; found: Set<string>; open: string | null;
  onOpen: (bay: Bay) => void;
  onRange: (from: Bay, to: Bay) => void;
  onToggleBay: (bay: Bay) => void;
  onAisle: (zone: string) => void;
  onClear: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: Bay; moved: boolean } | null>(null);
  const anchor = useRef<Bay | null>(null);

  useEffect(() => {
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (d && !d.moved) onOpen(d.from);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [onOpen]);

  const onBay = useCallback((bay: Bay, e: React.MouseEvent | React.KeyboardEvent) => {
    if ("key" in e) {
      if (e.key === " ") onToggleBay(bay); else onOpen(bay);
      anchor.current = bay;
      return;
    }
    if (e.shiftKey && anchor.current) { onRange(anchor.current, bay); return; }
    anchor.current = bay;
    drag.current = { from: bay, moved: false };
  }, [onOpen, onRange, onToggleBay]);

  const onBayEnter = useCallback((bay: Bay) => {
    const d = drag.current;
    if (!d || (d.from.zone === bay.zone && d.from.rack === bay.rack)) return;
    d.moved = true;
    onRange(d.from, bay);
  }, [onRange]);

  // Arrow keys walk the grid: left/right along a face, up/down across faces and aisles.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClear(); return; }
    const moves: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const mv = moves[e.key];
    if (!mv) return;
    e.preventDefault();
    const rows = plan.aisles.flatMap((a) => a.faces);
    const cur = (document.activeElement as HTMLElement | null)?.dataset.bay;
    let r = 0, s = 0;
    rows.forEach((row, ri) => row.forEach((b) => { if (bayKey(b.zone, b.rack) === cur) { r = ri; s = b.slot; } }));
    if (cur) { r = Math.min(Math.max(r + mv[0], 0), rows.length - 1); s = Math.min(Math.max(s + mv[1], 0), (rows[0]?.length ?? 1) - 1); }
    const next = rows[r]?.[s];
    if (next) document.getElementById(`bay-${bayKey(next.zone, next.rack)}`)?.focus();
  }

  const perAisle = (set: Set<string>, zone: string) => [...set].filter((k) => k.startsWith(zone) && k.length === zone.length + 2).sort().join(",");
  const openKey = open;

  return (
    <div ref={host} className="select-none overflow-x-auto rounded-xl bg-[#DDE3E8] p-3 sm:p-4" onKeyDown={onKeyDown}>
      <div className="min-w-[720px] space-y-1">
        {plan.aisles.length > 0 && (
          <button type="button" className="sr-only focus:not-sr-only focus:mt-2 focus:inline-block focus:rounded focus:bg-white focus:px-2 focus:text-xs"
            onClick={() => { const f = plan.aisles[0].faces[0].find((b) => b.bins.length); if (f) document.getElementById(`bay-${bayKey(f.zone, f.rack)}`)?.focus(); }}>
            Masuk ke denah dengan keyboard
          </button>
        )}
        {plan.floor.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 pl-12">
            <span className="mr-1 text-[11px] text-steel-500">Lantai</span>
            {plan.floor.map((b) => (
              <span key={b.bin_code} className={cn("rounded border border-steel-300 bg-white px-1.5 text-[10px] font-semibold leading-5",
                Number(b.total_qty) > 0 && "border-ckb text-ckb")}
                title={`${b.bin_code}: ${Number(b.total_qty) ? `${fmtNum(Number(b.total_qty))} karton` : "kosong"}`}>{b.bin_code}</span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-px pl-12 text-center text-[9px] text-steel-500" aria-hidden>
          {Array.from({ length: plan.aisles[0]?.faces[0].length ?? 20 }, (_, i) => <span key={i}>{String(i + 1).padStart(2, "0")}</span>)}
        </div>
        {plan.aisles.map((a, i) => (
          <div key={a.zone}>
            <AisleRow aisle={a} mode={mode} picked={perAisle(picked, a.zone)} found={perAisle(found, a.zone)}
              open={openKey && openKey.startsWith(a.zone) && openKey.length === a.zone.length + 2 ? openKey : null}
              onBay={onBay} onBayEnter={onBayEnter} onAisle={onAisle} />
            {i < plan.aisles.length - 1 && <div aria-hidden className="ml-12 h-2.5 border-b border-dashed border-steel-300" />}
          </div>
        ))}
      </div>
    </div>
  );
}
