import { replaySteps, stockIdentityKey, type ReplayStep } from './ledger';
import type { AllocationLine, AllocationResult, Picklist, PickType } from './types';
import { expiryText, withConfig } from './config';
import { lookupUom } from './uom-master';
import { restNoteAt, type RestStep } from './picklist';

/** One row of the `pick_task_detail` view. */
export interface TaskRow {
  id: string;
  wave_id: string;
  wave_no: string;
  planned_slot: string | null;
  shipment_number: string | null;
  task_type: 'PICK' | 'REPLENISH';
  seq: number;
  status: 'PLANNED' | 'COMPLETED' | 'RESCHEDULED' | 'CANCELLED';
  sku: string;
  description: string;
  uom: string | null;
  upp: number | null;
  from_bin: string;
  to_bin: string | null;
  batch_lot: string;
  expiry_date: string;
  quantity: number;
  pick_type: PickType | null;
  breaks_pallet: boolean;
  completed_at: string | null;
  completed_by_name: string | null;
  actual_quantity: number | null;
  actual_from_bin: string | null;
  actual_batch_lot: string | null;
  actual_expiry_date: string | null;
  deviation_reason: string | null;
}

export interface WaveRow {
  id: string;
  wave_no: string;
  planned_date: string;
  shipment_numbers: string[];
  truck: string | null;
  destination: string;
  planned_slot: string | null;
  status: 'PENDING' | 'COMPLETED' | 'RESCHEDULED' | 'CANCELLED';
}

export interface OutboundRow {
  wave_id: string;
  shipment_number: string;
  sku: string;
  order_nos: string[];
  /** when given, a line allocated below its order is printed as a shortage in the header */
  quantity_requested?: number;
  quantity_allocated?: number;
}

/** Physical stock of one identity now (a row of inventory_detail). */
export interface StockNow { bin_code: string; sku: string; batch_lot: string; expiry_date: string | null; quantity: number }

const idKey = (bin: string, sku: string, batch: string | null, exp: string | null) =>
  stockIdentityKey(bin, sku, batch || null, new Date(`${exp ?? '9999-12-31'}T00:00:00Z`));

/**
 * Sisa per PICK task, replaying the date's tasks in execution order (waves by
 * slot then NO, tasks by seq) from the stock the plan started with. That start
 * is today's physical stock with every COMPLETED task undone at what the picker
 * actually did; completed tasks then replay with their actuals, planned ones as
 * planned. A pick's move (the REPLENISH next to it, from the same bin/batch) is
 * shown on the pick, and its Sisa is what stays after both.
 */
/** The day's live tasks in execution order: waves by slot then NO, tasks by seq (the Sisa replay order). */
function executionOrder(waves: WaveRow[], tasks: TaskRow[]): TaskRow[] {
  const slot = new Map(waves.map((w) => [w.id, w.planned_slot ?? '99:99']));
  const waveNo = new Map(waves.map((w) => [w.id, Number(w.wave_no) || Number.MAX_SAFE_INTEGER]));
  return tasks.filter((t) => t.status !== 'CANCELLED' && slot.has(t.wave_id)).sort((a, b) =>
    slot.get(a.wave_id)!.localeCompare(slot.get(b.wave_id)!) || waveNo.get(a.wave_id)! - waveNo.get(b.wave_id)! || a.seq - b.seq);
}

/**
 * The Wave page's version of the printed Bin To Bin note for an opened pallet
 * without its own move ("CC14A01 (dipindah NO 7)"), from the plan alone (the
 * page has no stock replay): a move counts when it carries cartons in the
 * plan, or carried them when posted. Same order and wording as the reprint.
 */
export function restNotesFromTasks(waves: WaveRow[], tasks: TaskRow[]): Map<string, string> {
  const live = executionOrder(waves, tasks);
  const no = new Map(waves.map((w) => [w.id, w.wave_no]));
  const done = (t: TaskRow) => t.status === 'COMPLETED';
  const key = (t: TaskRow) => done(t)
    ? idKey(t.actual_from_bin ?? t.from_bin, t.sku, t.actual_batch_lot ?? t.batch_lot, t.actual_expiry_date ?? t.expiry_date)
    : idKey(t.from_bin, t.sku, t.batch_lot, t.expiry_date);
  const carried = (t: TaskRow) => Number(done(t) ? t.actual_quantity ?? t.quantity : t.quantity) > 0;
  const steps: RestStep[] = live.map((t) => ({ key: key(t), waveNo: no.get(t.wave_id) ?? '', picks: t.task_type === 'PICK',
    moveTo: t.task_type === 'REPLENISH' && carried(t) ? t.to_bin : null }));
  const out = new Map<string, string>();
  live.forEach((t, i) => {
    if (t.task_type !== 'PICK' || !t.breaks_pallet) return;
    // Its own move (right after, or right before in older plans) means it is not "tetap".
    const own = [live[i + 1], live[i - 1]].some((x) => x && x.task_type === 'REPLENISH' && x.wave_id === t.wave_id
      && x.from_bin === t.from_bin && x.sku === t.sku && x.batch_lot === t.batch_lot && x.expiry_date === t.expiry_date && carried(x));
    const note = own ? null : restNoteAt(steps, i, t.from_bin);
    if (note) out.set(t.id, note);
  });
  return out;
}

export function sisaFromTasks(waves: WaveRow[], tasks: TaskRow[], stockNow: StockNow[]) {
  const live = executionOrder(waves, tasks);

  const done = (t: TaskRow) => t.status === 'COMPLETED';
  const qty = (t: TaskRow) => Number(done(t) ? t.actual_quantity ?? t.quantity : t.quantity);
  const src = (t: TaskRow) => done(t)
    ? idKey(t.actual_from_bin ?? t.from_bin, t.sku, t.actual_batch_lot ?? t.batch_lot, t.actual_expiry_date ?? t.expiry_date)
    : idKey(t.from_bin, t.sku, t.batch_lot, t.expiry_date);
  const dst = (t: TaskRow) => (t.to_bin ? idKey(t.to_bin, t.sku, t.batch_lot, t.expiry_date) : null);

  const start = new Map<string, number>();
  for (const r of stockNow) { const k = idKey(r.bin_code, r.sku, r.batch_lot, r.expiry_date); start.set(k, (start.get(k) ?? 0) + Number(r.quantity)); }
  for (const t of live.filter(done)) {
    start.set(src(t), (start.get(src(t)) ?? 0) + qty(t));
    const d = dst(t); if (d) start.set(d, (start.get(d) ?? 0) - qty(t));
  }

  const steps: ReplayStep[] = live.map((t) => t.task_type === 'REPLENISH'
    ? { key: src(t), qty: 0, moveToKey: dst(t), moveQty: qty(t) }
    : { key: src(t), qty: qty(t) });
  const r = replaySteps(start, steps);

  // Where an opened pallet's rest goes when this pick does not move it (picklist.ts restNoteAt).
  const no = new Map(waves.map((w) => [w.id, w.wave_no]));
  // A move counts only when the replay really carried something (a drifted shelf can leave it empty).
  const restSteps: RestStep[] = live.map((t, k) => ({ key: src(t), waveNo: no.get(t.wave_id) ?? '', picks: t.task_type === 'PICK',
    moveTo: t.task_type === 'REPLENISH' && r.moved[k] > 0 ? t.to_bin : null }));
  const out = new Map<string, { sisa: number; moveQty: number; moveTo: string | null; restNote: string | null }>();
  live.forEach((t, i) => {
    if (t.task_type !== 'PICK') return;
    // Its move: the REPLENISH right after (new plans) or right before (older plans) from the same bin/batch.
    const pair = [live[i + 1], live[i - 1]].find((x) => x && x.task_type === 'REPLENISH' && x.wave_id === t.wave_id
      && x.from_bin === t.from_bin && x.sku === t.sku && x.batch_lot === t.batch_lot && x.expiry_date === t.expiry_date);
    const p = pair ? live.indexOf(pair) : -1;
    const j = Math.max(i, p);
    // What the replay really carried (less than planned when the shelf holds less now), so Sisa and Bin To Bin agree.
    const moveQty = p >= 0 ? r.moved[p] : 0;
    out.set(t.id, { sisa: r.after[j], moveQty, moveTo: moveQty > 0 ? pair!.to_bin : null,
      restNote: t.breaks_pallet && moveQty <= 0 ? restNoteAt(restSteps, i, t.from_bin) : null });
  });
  return out;
}

/**
 * Rebuilds printable picklists (one per shipment, travel order) from a saved
 * plan, so a wave can be reprinted without re-running the allocation.
 * Cancelled tasks are left off the sheet. `stockNow` (physical stock of the
 * bins the tasks touch) gives the Sisa; without it Sisa is 0.
 */
export function picklistsFromTasks(waves: WaveRow[], tasks: TaskRow[], outbound: OutboundRow[], stockNow: StockNow[] = [], allWaves: WaveRow[] = waves): Picklist[] {
  const sisa = sisaFromTasks(allWaves, tasks, stockNow);
  const out: Picklist[] = [];
  for (const w of waves) {
    const picks = tasks
      .filter((t) => t.wave_id === w.id && t.task_type === 'PICK' && t.status !== 'CANCELLED')
      .sort((a, b) => a.seq - b.seq);
    const shipments = [...new Set([...w.shipment_numbers, ...picks.map((t) => t.shipment_number ?? '')])];
    for (const shipment of shipments) {
      const mine = picks.filter((t) => (t.shipment_number ?? '') === shipment);
      if (!mine.length) continue;
      const orderNos = [...new Set(outbound
        .filter((o) => o.wave_id === w.id && o.shipment_number === shipment)
        .flatMap((o) => o.order_nos))].sort();
      const lines: AllocationLine[] = mine.map((t, i) => ({
        shipmentNumber: shipment,
        waveNo: w.wave_no,
        orderNos,
        sku: t.sku,
        description: t.description,
        location: t.from_bin,
        binId: `${t.from_bin}|${t.sku}|${t.batch_lot || 'NOBATCH'}`,
        batch: t.batch_lot || null,
        expiryDate: new Date(`${t.expiry_date}T00:00:00Z`),
        qtyPick: Number(t.quantity),
        pickType: t.pick_type ?? 'CASE',
        upp: Number(t.upp) || 1,
        uom: lookupUom(t.sku) || t.uom,
        qtyRemainingInBin: sisa.get(t.id)?.sisa ?? 0,
        moveQty: sisa.get(t.id)?.moveQty ?? 0,
        moveTo: sisa.get(t.id)?.moveTo ?? null,
        daysToExpiry: 0,
        seq: i + 1,
        breaksPallet: t.breaks_pallet,
        slotTime: w.planned_slot,
        restNote: sisa.get(t.id)?.restNote ?? null,
      }));
      const hasPallet = lines.some((l) => l.pickType === 'PALLET');
      const hasCase = lines.some((l) => l.pickType === 'CASE');
      out.push({
        picklistId: `PL-${shipment || w.wave_no}`,
        waveNo: w.wave_no,
        shipmentNumbers: shipment ? [shipment] : [],
        destination: w.destination,
        shipToLocation: w.destination,
        transport: w.truck,
        truckType: w.truck,
        slotTime: w.planned_slot,
        taskType: hasPallet && hasCase ? 'MIXED' : hasPallet ? 'PALLET' : 'CASE',
        orderNos,
        lines,
        totalCartons: lines.reduce((s, l) => s + l.qtyPick, 0),
        totalPallets: lines.filter((l) => l.pickType === 'PALLET').length,
        distinctLocations: new Set(lines.map((l) => l.location)).size,
        distinctSkus: new Set(lines.map((l) => l.sku)).size,
        shortages: outbound
          .filter((o) => o.wave_id === w.id && o.shipment_number === shipment && o.quantity_requested !== undefined
            && Number(o.quantity_allocated ?? 0) < Number(o.quantity_requested))
          .map((o) => ({ sku: o.sku, qtyShort: Number(o.quantity_requested) - Number(o.quantity_allocated ?? 0) }))
          .sort((a, b) => b.qtyShort - a.qtyShort || a.sku.localeCompare(b.sku)),
      });
    }
  }
  return out;
}

/** One row of the printable Bin To Bin work sheet. */
export interface BinToBinRow {
  /** Continuous 1..N down the sheet. */
  seq: number;
  aisle: string;
  from_bin: string;
  to_bin: string;
  sku: string;
  description: string;
  shipment_number: string;
  batch_lot: string;
  /** Formatted by expiryText, '-' when the plan carries none. */
  expiry_date: string;
  quantity: number;
  uom: string;
  wave_no: string;
  /** The wave's date, printed in the sheet's title. */
  planned_date: string;
}

/** Leading letters of a bin code: CA01A01 → CA. */
function aisleOf(bin: string): string {
  return /^[A-Za-z]+/.exec(String(bin ?? '').trim().toUpperCase())?.[0] ?? '-';
}

/**
 * Every planned bin-to-bin move of the day (REPLENISH tasks still open) as
 * rows for one operator work sheet. Execution order first — waves by slot then
 * NO, tasks by seq, the same order as the Sisa replay — then grouped by aisle
 * in pick-path order (`config.aisleSequence`), keeping that execution order
 * inside an aisle; the No runs continuously over the sheet. Completed and
 * cancelled moves are left off: they already happened or will not.
 */
export function binToBinRows(waves: WaveRow[], tasks: TaskRow[]): BinToBinRow[] {
  const waveIds = new Set(waves.map((w) => w.id));
  const open = tasks.filter((t) => t.task_type === 'REPLENISH'
    && (t.status === 'PLANNED' || t.status === 'RESCHEDULED') && waveIds.has(t.wave_id));
  const ordered = executionOrder(waves, open);

  const cfg = withConfig();
  const rank = (aisle: string) => {
    const i = cfg.aisleSequence.indexOf(aisle);
    return i === -1 ? cfg.aisleSequence.length : i;
  };
  const groups = new Map<string, TaskRow[]>();
  for (const t of ordered) {
    const a = aisleOf(t.from_bin);
    const g = groups.get(a);
    if (g) g.push(t); else groups.set(a, [t]);
  }
  const aisles = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const wave = new Map(waves.map((w) => [w.id, w]));
  const rows: BinToBinRow[] = [];
  for (const aisle of aisles) {
    for (const t of groups.get(aisle) ?? []) {
      const w = wave.get(t.wave_id);
      rows.push({
        seq: rows.length + 1,
        aisle,
        from_bin: t.from_bin,
        to_bin: t.to_bin ?? '-',
        sku: t.sku,
        description: t.description,
        shipment_number: t.shipment_number || w?.shipment_numbers[0] || '-',
        batch_lot: t.batch_lot || '-',
        expiry_date: expiryText(new Date(`${t.expiry_date}T00:00:00Z`)),
        quantity: Number(t.quantity),
        uom: lookupUom(t.sku) || t.uom || '-',
        wave_no: t.wave_no,
        planned_date: w?.planned_date ?? '',
      });
    }
  }
  return rows;
}

/**
 * The same work sheet derived straight from an `AllocationResult` (the Alokasi
 * page prints from that, not from saved pick tasks): every pick line that
 * opens a pallet and moves its rest (`moveTo` set, `moveQty` > 0). Grouped
 * by aisle in pick-path order, continuous No — same layout as `binToBinRows`.
 */
export function binToBinRowsFromResult(result: AllocationResult, asOf: string): BinToBinRow[] {
  const lines: AllocationLine[] = [];
  for (const pl of result.picklists) {
    for (const l of pl.lines) {
      if (l.moveTo && l.moveQty > 0) lines.push(l);
    }
  }
  lines.sort((a, b) => String(a.waveNo).localeCompare(String(b.waveNo), undefined, { numeric: true }) || a.seq - b.seq);

  const cfg = withConfig();
  const rank = (aisle: string) => {
    const i = cfg.aisleSequence.indexOf(aisle);
    return i === -1 ? cfg.aisleSequence.length : i;
  };
  const groups = new Map<string, AllocationLine[]>();
  for (const l of lines) {
    const a = aisleOf(l.location);
    const g = groups.get(a);
    if (g) g.push(l); else groups.set(a, [l]);
  }
  const aisles = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const rows: BinToBinRow[] = [];
  for (const aisle of aisles) {
    for (const l of groups.get(aisle) ?? []) {
      rows.push({
        seq: rows.length + 1,
        aisle,
        from_bin: l.location,
        to_bin: l.moveTo ?? '-',
        sku: l.sku,
        description: l.description,
        shipment_number: l.shipmentNumber || '-',
        batch_lot: l.batch ?? '-',
        expiry_date: expiryText(l.expiryDate),
        quantity: l.moveQty,
        uom: lookupUom(l.sku) || l.uom || '-',
        wave_no: String(l.waveNo),
        planned_date: asOf,
      });
    }
  }
  return rows;
}
