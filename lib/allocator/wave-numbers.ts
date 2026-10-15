import type { Warning } from './types';

/**
 * One wave per shipment: the shipment number is the wave key.
 * The NO column of Schedule of the day is no longer used to merge shipments;
 * it is retained on the sheet for reference only.
 */
export function assignWaves(rows: { shipment: string; no: string }[]): { waveByShipment: Map<string, string>; warnings: Warning[] } {
  const waveByShipment = new Map<string, string>();
  const seen: string[] = [];
  for (const r of rows) {
    if (!r.shipment) continue;
    if (!seen.includes(r.shipment)) seen.push(r.shipment);
  }
  for (const s of seen) waveByShipment.set(s, s);
  return { waveByShipment, warnings: [] };
}
