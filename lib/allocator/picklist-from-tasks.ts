import { replaySteps, stockIdentityKey, type ReplayStep } from './ledger';
import type { AllocationLine, Picklist, PickType } from './types';
import { lookupUom } from './uom-master';

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
export function sisaFromTasks(waves: WaveRow[], tasks: TaskRow[], stockNow: StockNow[]) {
  const slot = new Map(waves.map((w) => [w.id, w.planned_slot ?? '99:99']));
  const waveNo = new Map(waves.map((w) => [w.id, Number(w.wave_no) || Number.MAX_SAFE_INTEGER]));
  const live = tasks.filter((t) => t.status !== 'CANCELLED' && slot.has(t.wave_id)).sort((a, b) =>
    slot.get(a.wave_id)!.localeCompare(slot.get(b.wave_id)!) || waveNo.get(a.wave_id)! - waveNo.get(b.wave_id)! || a.seq - b.seq);

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

  const out = new Map<string, { sisa: number; moveQty: number; moveTo: string | null }>();
  live.forEach((t, i) => {
    if (t.task_type !== 'PICK') return;
    // Its move: the REPLENISH right after (new plans) or right before (older plans) from the same bin/batch.
    const pair = [live[i + 1], live[i - 1]].find((x) => x && x.task_type === 'REPLENISH' && x.wave_id === t.wave_id
      && x.from_bin === t.from_bin && x.sku === t.sku && x.batch_lot === t.batch_lot && x.expiry_date === t.expiry_date);
    const p = pair ? live.indexOf(pair) : -1;
    const j = Math.max(i, p);
    // What the replay really carried (less than planned when the shelf holds less now), so Sisa and Bin To Bin agree.
    const moveQty = p >= 0 ? r.moved[p] : 0;
    out.set(t.id, { sisa: r.after[j], moveQty, moveTo: moveQty > 0 ? pair!.to_bin : null });
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
      });
    }
  }
  return out;
}
