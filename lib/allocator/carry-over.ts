import type { DemandLine } from './types';

/**
 * Orders parked with Tunda come back on a later Schedule of the day. A line
 * of today's schedule is the same order as a parked one when it has the same
 * SKU and the same shipment number (it stays when rescheduled) or a shared
 * Order No (in case a new shipment number is ever issued). Matches are grouped per parked wave.
 * The `shipments` rename map feeds `carry_over_wave` (0036). For ordinary carries (mode === 'carry'
 * with posted tasks), per docs/superpowers/specs/2026-10-24-remainder-wave-replan-design.md the
 * parked plan is superseded: open tasks are retracted at save and the remainder is planned fresh.
 */
export type ParkedOrder = {
  wave_id: string; wave_no: string; planned_date: string; shipment_number: string; sku: string; description: string;
  order_nos: string[]; quantity_requested: number; quantity_picked: number; posted_tasks: number;
};
export type CarryLine = { sku: string; description: string; oldShipment: string; newShipment: string; oldQty: number; newQty: number };
export type CarryMatch = {
  wave_id: string; wave_no: string; planned_date: string; posted_tasks: number;
  /** old shipment -> new shipment, for carry_over_wave */
  shipments: Record<string, string>;
  lines: CarryLine[];
  /** parked order lines with no match today: they move along with the wave */
  unmatched: { sku: string; shipment: string; qty: number }[];
  /** one old shipment matched to several new ones: needs a look before saving */
  ambiguous: boolean;
  /**
   * fresh: nothing of the wave posted yet, so it is cancelled on save and the
   * whole shipment (new items too) is planned again in one wave.
   * carry: something posted, so the wave is carried over and new items join it.
   */
  mode: 'fresh' | 'carry';
};

/** Return value from planRemainders describing what the save step must do. */
export interface RemainderSave {
  /** Open tasks to retract in the carried wave(s). One per shipment that gets replanned. */
  retracts: { wave_id: string; shipment_number: string; reason: string }[];
  /** Wave numbers of ambiguous carries that were skipped (today's behavior). */
  skippedFrom: string[];
}

const clean = (s: string) => s.trim();

/**
 * Returns the smallest numeric wave NO (>= 1) not present in `taken`, as a string.
 * Non-numeric entries in `taken` (e.g., "T5", "5-2") are ignored.
 */
export function nextFreeWaveNo(taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(String(n))) {
    n++;
  }
  return String(n);
}

/**
 * Plans the remainder (sheet minus already picked) for carried waves that have posted tasks.
 *
 * For `ambiguous: true` carry matches: demand lines are left untouched (today's skip behavior),
 * and the wave_no is recorded in `skippedFrom`.
 *
 * For ordinary `carry` matches (mode === 'carry' && !ambiguous):
 * - Each demand line matched to that wave gets `qtyCartons = newQty - quantity_picked`
 *   from the corresponding ParkedOrder.
 * - If the result is <= 0, the line is dropped entirely.
 * - A fresh numeric waveNo is assigned via `nextFreeWaveNo(takenWaveNos)`. The caller must
 *   pass the taken set as EVERY textually-existing NO the save touches: existing waves of
 *   the date (replaceable + kept) and the ordinary waveNos the run plans from the workbook.
 * - Each such match yields one retract entry with reason 'sisanya direncanakan ulang'
 *   per shipment actually planned from that wave.
 *
 * References: docs/superpowers/specs/2026-10-24-remainder-wave-replan-design.md,
 * migrations 0074 (cancel settle) and 0036 (carry_over_wave semantics).
 */
export function planRemainders(
  demand: DemandLine[],
  matches: CarryMatch[],
  parked: ParkedOrder[],
  takenWaveNos: ReadonlySet<string>
): { demand: DemandLine[]; remainders: RemainderSave } {
  const retracts: RemainderSave['retracts'] = [];
  const skippedFrom: string[] = [];

  // Build a lookup for parked orders by (wave_id, sku, shipment_number)
  const parkedLookup = new Map<string, ParkedOrder>();
  for (const p of parked) {
    const key = `${p.wave_id}|${p.sku}|${p.shipment_number}`;
    parkedLookup.set(key, p);
  }

  // Track which demand lines are matched to ordinary carry waves
  const matchedToOrdinaryCarry = new Set<DemandLine>();
  // Track which shipments have been processed for retract entries per wave
  const processedShipments = new Set<string>();

  // First pass: identify demand lines matched to ordinary carry waves
  for (const match of matches) {
    if (match.mode !== 'carry' || match.ambiguous) continue;

    for (const line of match.lines) {
      // Find the corresponding demand line
      const origDemand = demand.find(d => d.sku === line.sku && d.shipmentNumber === line.newShipment);
      if (origDemand) {
        matchedToOrdinaryCarry.add(origDemand);
      }
    }
  }

  // Build new demand array
  const newDemand: DemandLine[] = [];
  const localTaken = new Set(takenWaveNos);

  for (const d of demand) {
    if (matchedToOrdinaryCarry.has(d)) {
      // This line is handled by its carry match below
      continue;
    }
    // Unmatched lines (fresh demand, ambiguous carry matches, etc.) pass through
    newDemand.push(d);
  }

  // Second pass: process ordinary carry matches and add remainder lines
  for (const match of matches) {
    if (match.mode !== 'carry' || match.ambiguous) continue;

    const freshWaveNo = nextFreeWaveNo(localTaken);
    localTaken.add(freshWaveNo);

    for (const line of match.lines) {
      const p = parkedLookup.get(`${match.wave_id}|${line.sku}|${line.oldShipment}`);
      const picked = p?.quantity_picked ?? 0;
      const remainder = line.newQty - picked;

      if (remainder > 0) {
        // Find the original demand line to copy other fields
        const origDemand = demand.find(d => d.sku === line.sku && d.shipmentNumber === line.newShipment);
        if (origDemand) {
          newDemand.push({
            ...origDemand,
            qtyCartons: remainder,
            waveNo: freshWaveNo,
          });
        }
      }
      // If remainder <= 0, line is dropped (not added to newDemand)
    }

    // Create retract entries from unique oldShipment values in match.lines
    // This covers both same-number (oldShipment === newShipment) and rename cases.
    const seenOldShipments = new Set<string>();
    for (const line of match.lines) {
      const oldShipment = line.oldShipment;
      if (seenOldShipments.has(oldShipment)) continue;
      seenOldShipments.add(oldShipment);
      if (!processedShipments.has(`${match.wave_id}|${oldShipment}`)) {
        retracts.push({
          wave_id: match.wave_id,
          shipment_number: oldShipment,
          reason: 'sisanya direncanakan ulang',
        });
        processedShipments.add(`${match.wave_id}|${oldShipment}`);
      }
    }
  }

  // Third pass: handle ambiguous carry matches (record skippedFrom)
  for (const match of matches) {
    if (match.mode !== 'carry' || !match.ambiguous) continue;
    skippedFrom.push(match.wave_no);
    // Demand lines for ambiguous matches already passed through in first pass
  }

  return { demand: newDemand, remainders: { retracts, skippedFrom } };
}

export function matchParked(demand: DemandLine[], parked: ParkedOrder[]): { matches: CarryMatch[]; matchedDemand: Set<DemandLine> } {
  const byWave = new Map<string, CarryMatch>();
  const matchedDemand = new Set<DemandLine>();
  const newShipsOf = new Map<string, Map<string, Set<string>>>();
  const used = new Set<ParkedOrder>();

  for (const d of demand) {
    const orders = new Set(d.orderNos.map(clean).filter(Boolean));
    // Same SKU, and the same shipment number (it stays when rescheduled) or a shared Order No.
    const p = parked.find((x) => !used.has(x) && x.sku === d.sku
      && (x.shipment_number === d.shipmentNumber || x.order_nos.some((o) => orders.has(clean(o)))));
    if (!p) continue;
    used.add(p); matchedDemand.add(d);
    const m = byWave.get(p.wave_id) ?? {
      wave_id: p.wave_id, wave_no: p.wave_no, planned_date: p.planned_date, posted_tasks: p.posted_tasks,
      shipments: {}, lines: [], unmatched: [], ambiguous: false, mode: p.posted_tasks > 0 ? 'carry' : 'fresh',
    };
    m.lines.push({ sku: d.sku, description: d.description || p.description, oldShipment: p.shipment_number, newShipment: d.shipmentNumber,
      oldQty: Number(p.quantity_requested), newQty: d.qtyCartons });
    const ships = newShipsOf.get(p.wave_id) ?? new Map<string, Set<string>>();
    ships.set(p.shipment_number, (ships.get(p.shipment_number) ?? new Set()).add(d.shipmentNumber));
    newShipsOf.set(p.wave_id, ships);
    byWave.set(p.wave_id, m);
  }

  for (const m of byWave.values()) {
    for (const [oldSh, news] of newShipsOf.get(m.wave_id)!) {
      m.shipments[oldSh] = [...news][0];
      if (news.size > 1) m.ambiguous = true;
    }
    // Same number again: nothing to rename.
    for (const [o, n] of Object.entries(m.shipments)) if (o === n) delete m.shipments[o];
    m.unmatched = parked.filter((x) => x.wave_id === m.wave_id && !used.has(x))
      .map((x) => ({ sku: x.sku, shipment: x.shipment_number, qty: Number(x.quantity_requested) }));
  }
  // A fresh plan takes the whole shipment again: only carried waves keep their lines out of it.
  const carried = new Set([...byWave.values()].filter((m) => m.mode === 'carry').map((m) => m.wave_id));
  for (const d of [...matchedDemand]) {
    const p = parked.find((x) => used.has(x) && x.sku === d.sku && carried.has(x.wave_id)
      && (x.shipment_number === d.shipmentNumber || x.order_nos.some((o) => d.orderNos.map(clean).includes(clean(o)))));
    if (!p) matchedDemand.delete(d);
  }
  return { matches: [...byWave.values()], matchedDemand };
}
