import type { Warning } from './types';

/**
 * Which wave (NO) each shipment of Schedule of the day belongs to.
 *
 * The NO column is typed on a shipment's first row and left blank below it,
 * so a blank NO is filled down — but only within the same shipment. A NO is
 * never carried over from another shipment: on 6 Oct shipment 109702466 had
 * no NO at all, sat right below NO 15, and was planned and printed as part of
 * NO 15. A shipment without a NO of its own gets its own wave, numbered after
 * the highest NO of the day, and a warning says so. Shipments the admin gave
 * the same NO on purpose (15 Sep: NO 1, 5, 6 each two shipments, every one
 * with its own NO typed) stay together.
 */
export function assignWaves(rows: { shipment: string; no: string }[]): { waveByShipment: Map<string, string>; warnings: Warning[] } {
  const own = new Map<string, string>();
  const order: string[] = [];
  for (const r of rows) {
    if (!r.shipment) continue;
    if (!own.has(r.shipment) && !order.includes(r.shipment)) order.push(r.shipment);
    if (r.no && !own.has(r.shipment)) own.set(r.shipment, r.no);
  }
  const numbers = [...own.values()].map(Number).filter((n) => Number.isInteger(n) && n > 0);
  let next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  const waveByShipment = new Map<string, string>();
  const warnings: Warning[] = [];
  for (const s of order) {
    const no = own.get(s);
    if (no) { waveByShipment.set(s, no); continue; }
    const given = String(next++);
    waveByShipment.set(s, given);
    warnings.push({
      level: 'WARN', code: 'SHIPMENT_WITHOUT_NO',
      message: `Shipment ${s} tidak punya NO di Schedule of the day: dijadikan wave sendiri, NO ${given}. Isi kolom NO di file bila harus ikut wave lain.`,
      context: { shipment: s, wave: given },
    });
  }
  return { waveByShipment, warnings };
}
