import type { ReactNode } from "react";
import type { OutboundRow, TaskRow, WaveRow } from "@/lib/allocator/picklist-from-tasks";
import type { ShipmentState } from "@/lib/pick-audit";
import type { DayStep, WaveFacts } from "@/lib/wave-next-step";
import type { LineItem, LineProps } from "./line-menu";
import type { ProblemCounts } from "./problems-summary";
import type { OutboundDetail, Rpc, TaskWait } from "./wave-parts";

/** Search: free text on SKU / bin / description, only open lines, only lines with a problem. */
export type RowFilter = { q: string; onlyOpen: boolean; onlyProblems: boolean };
export const NO_FILTER: RowFilter = { q: "", onlyOpen: false, onlyProblems: false };
export const filterActive = (f: RowFilter) => f.q.trim() !== "" || f.onlyOpen || f.onlyProblems;
export function rowMatches(it: LineItem, f: RowFilter, short: Set<string>, waits: Record<string, TaskWait>): boolean {
  const ts = it.kind === "pair" ? [it.pick, it.move] : [it.task];
  const q = f.q.trim().toUpperCase();
  if (q && !ts.some((t) => [t.sku, t.from_bin, t.to_bin ?? "", t.description ?? ""].some((v) => v.toUpperCase().includes(q)))) return false;
  if (f.onlyOpen && !ts.some((t) => t.status === "PLANNED")) return false;
  if (f.onlyProblems && !ts.some((t) => short.has(t.id) || !!waits[t.id])) return false;
  return true;
}

export const lineIds = (it: LineItem) => (it.kind === "pair" ? [it.pick, it.move] : [it.task]);
export const lineDone = (it: LineItem) => lineIds(it).every((t) => t.status === "COMPLETED");
export const lineCancelled = (it: LineItem) => lineIds(it).every((t) => t.status === "CANCELLED");

/** Everything both layouts need about the day, computed once. */
export type WaveModel = {
  date: string; prevDate: string | null; nextDate: string | null;
  waves: WaveRow[]; tasks: TaskRow[]; outbound: (OutboundRow & OutboundDetail)[];
  supervisor: boolean; rpc: Rpc; onDone: () => void;
  short: Set<string>; waits: Record<string, TaskWait>; audit: Record<string, ShipmentState>; rest: Map<string, string>;
  facts: Map<string, WaveFacts>; ordered: WaveRow[]; step: DayStep; problems: ProblemCounts;
  posted: number; total: number;
  /** the existing Perlu ditangani panels, unchanged */
  panels: (layout: "desktop" | "phone") => ReactNode;
  /** the day's menu: Tambah order, the PDFs, Hitung ulang; an icon-only trigger on the phone */
  dayMenu: (iconOnly?: boolean) => ReactNode;
  printWave: (w: WaveRow) => void;
};

/** One line's action props, the same on both layouts (the conditions PairAction / TaskAction used). */
export function lineProps(m: WaveModel, w: WaveRow, it: LineItem): LineProps {
  const head = it.kind === "pair" ? it.pick : it.task;
  const pending = w.status === "PENDING";
  return {
    item: it, label: `NO ${w.wave_no} #${head.seq}`, isShort: lineIds(it).some((t) => m.short.has(t.id)), wait: m.waits[head.id],
    canPost: pending, canUndo: w.status !== "CANCELLED", canRestore: pending || w.status === "RESCHEDULED",
    supervisor: m.supervisor, rpc: m.rpc, onDone: m.onDone,
  };
}

/** The Wave page address for a day, a wave, and the picking screen. */
export function waveHref(date: string, wave?: string | null, picking = false): string {
  return `/waves?date=${date}${wave ? `&wave=${wave}` : ""}${wave && picking ? "&pick=1" : ""}`;
}
