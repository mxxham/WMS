import type { AllocationResult, DemandLine, OrderQty } from './types';

/**
 * Which DO each picked carton belongs to.
 *
 * The allocator plans one demand line per shipment + SKU, so when a shipment
 * orders one SKU on several DOs (Schedule rows with different "Order No"), the
 * pick lines only know the whole list. Inside one shipment those cartons are
 * the same goods, so the split is a rule, and this is the one rule:
 *
 *   the lines, in printed order, fill the DOs in Schedule row order.
 *
 * Every surface reads the result of this rule (picklist, plan tasks, audit);
 * none of them re-derives it. Pure: no I/O.
 */

/** Adds a DO's cartons to a list, the same DO twice adds up (first-seen order). */
export function addOrder(list: OrderQty[], orderNo: string, qty: number): void {
  const no = orderNo.trim();
  const prev = list.find((o) => o.orderNo === no);
  if (prev) prev.qty += qty;
  else list.push({ orderNo: no, qty });
}

/**
 * The DO split of a demand line: its per-DO cartons, or the whole line on its
 * only DO. null when it names several DOs without their cartons: no split is
 * known, and the line keeps the whole list rather than a guessed one.
 */
export function demandOrders(d: Pick<DemandLine, 'orders' | 'orderNos' | 'qtyCartons'>): OrderQty[] | null {
  if (d.orders?.length) return d.orders;
  const nos = [...new Set(d.orderNos.map((o) => o.trim()).filter(Boolean))];
  if (nos.length === 1) return [{ orderNo: nos[0]!, qty: d.qtyCartons }];
  return nos.length ? null : [];
}

/** The DOs still open after `done` cartons were filled from the front (a carried-over remainder). */
export function ordersAfter(orders: OrderQty[] | undefined, done: number): OrderQty[] | undefined {
  if (!orders) return undefined;
  let skip = done;
  const out: OrderQty[] = [];
  for (const o of orders) {
    const used = Math.min(o.qty, Math.max(skip, 0));
    skip -= used;
    if (o.qty - used > 0) out.push({ orderNo: o.orderNo, qty: o.qty - used });
  }
  return out;
}

/**
 * Splits items over their group's DOs: items in the given order, each taking
 * cartons from the DOs in their listed order. A group without a known split
 * gives `null` for its items. Cartons beyond what the DOs order (an over-pick)
 * go to the group's last DO, so no carton is left without one.
 * `left` holds what each group's DOs still miss after the items.
 */
export function splitOverOrders<T>(
  items: T[],
  groupOf: (item: T) => string,
  qtyOf: (item: T) => number,
  ordersOf: (group: string) => OrderQty[] | null,
): { split: (OrderQty[] | null)[]; left: Map<string, OrderQty[] | null> } {
  const left = new Map<string, OrderQty[] | null>();
  const split = items.map((item) => {
    const g = groupOf(item);
    if (!left.has(g)) left.set(g, ordersOf(g)?.map((o) => ({ ...o })) ?? null);
    const pool = left.get(g);
    if (!pool) return null;
    const out: OrderQty[] = [];
    let need = qtyOf(item);
    for (const o of pool) {
      if (need <= 0) break;
      if (o.qty <= 0) continue;
      const q = Math.min(o.qty, need);
      o.qty -= q;
      need -= q;
      addOrder(out, o.orderNo, q);
    }
    const last = pool[pool.length - 1];
    if (need > 0 && last) addOrder(out, last.orderNo, need);
    return out;
  });
  return { split, left };
}

const key = (shipment: string, sku: string) => `${shipment}|${sku}`;

/**
 * Writes each line's own DOs (`orders`, `orderNos`) and each shortage's still
 * missing DOs, after the run is final. Lines are taken in printed order — the
 * picklists as sorted, lines by seq — the same order as the plan's tasks and
 * Sisa. A DO named blank keeps its cartons but is never shown as a DO.
 */
export function assignOrders(allocation: AllocationResult, demand: DemandLine[]): void {
  const byKey = new Map(demand.map((d) => [key(d.shipmentNumber, d.sku), d]));
  const lines = allocation.picklists.length ? allocation.picklists.flatMap((p) => p.lines) : allocation.lines;
  const { split, left } = splitOverOrders(lines, (l) => key(l.shipmentNumber, l.sku), (l) => l.qtyPick, (g) => {
    const d = byKey.get(g);
    return d ? demandOrders(d) : null;
  });
  lines.forEach((l, i) => {
    const s = split[i];
    if (!s) return;
    l.orders = s.filter((o) => o.orderNo !== '');
    l.orderNos = l.orders.map((o) => o.orderNo);
  });
  for (const s of allocation.shortages) {
    const g = key(s.shipmentNumber, s.sku);
    const d = byKey.get(g);
    // A shortage with no line at all still has the whole demand open.
    const pool = left.has(g) ? left.get(g) : d ? demandOrders(d) : null;
    if (pool) s.orderNos = pool.filter((o) => o.qty > 0 && o.orderNo !== '').map((o) => o.orderNo);
  }
}
