import type { AllocationLine, AllocationResult, DemandLine, PickfaceAssignment } from './types';

/**
 * Turns a finished allocation into the payload of the `save_plan` RPC
 * (supabase/migrations/0004_allocation.sql). Pure: no I/O.
 *
 * The AllocationResult must be the FINAL one from runPipeline(): tasks follow
 * the printed picklist order, and pallet-break moves (moveQty / moveTo) and
 * post-break pick locations are read from the lines.
 */

export interface PlanWave {
  wave_no: string;
  shipment_numbers: string[];
  truck: string | null;
  destination: string;
  planned_slot: string | null;
}

export interface PlanTask {
  wave_no: string;
  shipment_number: string | null;
  task_type: 'PICK' | 'REPLENISH';
  sku: string;
  from_bin: string;
  to_bin: string | null;
  batch_lot: string;
  expiry_date: string;
  quantity: number;
  pick_type: 'PALLET' | 'CASE';
  breaks_pallet: boolean;
  seq: number;
}

export interface PlanOutbound {
  wave_no: string;
  shipment_number: string;
  sku: string;
  description: string;
  order_nos: string[];
  truck: string | null;
  destination: string;
  quantity_requested: number;
  quantity_allocated: number;
  shortage_reason: string | null;
}

export interface PlanPayload {
  waves: PlanWave[];
  tasks: PlanTask[];
  outbound: PlanOutbound[];
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function groupWaves(demand: DemandLine[]): PlanWave[] {
  const byWave = new Map<string, PlanWave>();
  for (const d of demand) {
    let w = byWave.get(d.waveNo);
    if (!w) {
      w = { wave_no: d.waveNo, shipment_numbers: [], truck: d.truckType, destination: d.destination, planned_slot: d.slotTime };
      byWave.set(d.waveNo, w);
    }
    if (!w.shipment_numbers.includes(d.shipmentNumber)) w.shipment_numbers.push(d.shipmentNumber);
    w.truck ??= d.truckType;
    w.destination ||= d.destination;
    // A wave's slot is its earliest shipment's (see waveSlots in allocator.ts).
    if (d.slotTime && (!w.planned_slot || d.slotTime < w.planned_slot)) w.planned_slot = d.slotTime;
  }
  return [...byWave.values()];
}

export function buildPlan(
  allocation: AllocationResult,
  demand: DemandLine[],
  pickfaces: Map<string, PickfaceAssignment>,
): PlanPayload {
  const waves = groupWaves(demand);

  // Tasks in the printed order (picklists as sorted, lines by seq): the same
  // order settleSisa() computed every Sisa in. A pallet-break move is the
  // line's own moveQty/moveTo and goes right AFTER its pick (take the cartons,
  // carry the rest of the pallet to the pickface).
  const tasks: PlanTask[] = [];
  const seqByWave = new Map<string, number>();
  const ordered = allocation.picklists.length ? allocation.picklists.flatMap((p) => p.lines) : allocation.lines;
  for (const l of ordered) {
    const seq = () => { const n = (seqByWave.get(l.waveNo) ?? 0) + 1; seqByWave.set(l.waveNo, n); return n; };
    const base = { wave_no: l.waveNo, sku: l.sku, batch_lot: l.batch ?? '', expiry_date: isoDate(l.expiryDate) };
    tasks.push({
      ...base, shipment_number: l.shipmentNumber, task_type: 'PICK', from_bin: l.location, to_bin: null,
      quantity: l.qtyPick, pick_type: l.pickType, breaks_pallet: l.breaksPallet, seq: seq(),
    });
    if (l.moveQty > 0 && l.moveTo) {
      tasks.push({
        ...base, shipment_number: null, task_type: 'REPLENISH', from_bin: l.location, to_bin: l.moveTo,
        quantity: l.moveQty, pick_type: 'CASE', breaks_pallet: true, seq: seq(),
      });
    }
  }

  // One outbound row per demand line: requested vs allocated, with the
  // shortage reason when it fell short.
  const allocated = new Map<string, number>();
  for (const l of allocation.lines) {
    const k = `${l.shipmentNumber}|${l.sku}`;
    allocated.set(k, (allocated.get(k) ?? 0) + l.qtyPick);
  }
  const shortReason = new Map(allocation.shortages.map((s) => [`${s.shipmentNumber}|${s.sku}`, s.reason]));
  const outbound: PlanOutbound[] = demand.map((d) => {
    const k = `${d.shipmentNumber}|${d.sku}`;
    return {
      wave_no: d.waveNo,
      shipment_number: d.shipmentNumber,
      sku: d.sku,
      description: d.description,
      order_nos: d.orderNos,
      truck: d.truckType,
      destination: d.destination,
      quantity_requested: d.qtyCartons,
      quantity_allocated: allocated.get(k) ?? 0,
      shortage_reason: shortReason.get(k) ?? null,
    };
  });

  return { waves, tasks, outbound };
}
