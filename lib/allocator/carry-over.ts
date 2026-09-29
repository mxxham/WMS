import type { DemandLine } from './types';

/**
 * Orders parked with Tunda come back on a later Schedule of the day. A line
 * of today's schedule is the same order as a parked one when it has the same
 * SKU and the same shipment number (it stays when rescheduled) or a shared
 * Order No (in case a new shipment number is ever issued). Matches are grouped per parked wave, which is
 * carried over whole (carry_over_wave, 0036) instead of being planned again.
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
};

const clean = (s: string) => s.trim();

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
      shipments: {}, lines: [], unmatched: [], ambiguous: false,
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
  return { matches: [...byWave.values()], matchedDemand };
}
