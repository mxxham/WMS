import type { DemandLine } from './types';

/**
 * Shipments of a schedule that already had a wave on an EARLIER day. The
 * schedule lists a postponed shipment again under the NO it had then, which
 * on the new day belongs to another shipment (13 Oct's file: 12 Oct's NO 5,
 * 6, 7 at the bottom, next to 13 Oct's own NO 5, 6, 7). Waves are grouped by
 * NO, so without this they merge, and a shipment already picked is planned
 * and picked a second time. Per shipment, the latest earlier wave decides:
 *
 *   loaded                     -> planned as a new order (warned)
 *   picks posted, not loaded   -> not planned again: the cartons left stock then
 *   Batal, nothing posted      -> planned in its own wave "<NO> RESCHEDULE"
 *   open, nothing posted       -> not planned twice: finish or cancel it first
 *   Tunda (RESCHEDULED)        -> left to the carry-over flow (carry-over.ts)
 *
 * Pure: the facts are read by the caller (plan-client.ts loadEarlierWaves).
 */
export type EarlierWave = { id: string; wave_no: string; planned_date: string; status: string; shipment_numbers: string[] };
export type EarlierFacts = {
  waves: EarlierWave[];
  /** cartons of posted PICK tasks per wave + shipment */
  posted: { wave_id: string; shipment_number: string; quantity: number }[];
  loaded: { wave_id: string; shipment_number: string }[];
};
type From = { wave_id: string; wave_no: string; planned_date: string };
export type EarlierDecision =
  | { kind: 'reschedule'; shipment: string; from: From; waveNo: string }
  | { kind: 'picked'; shipment: string; from: From; quantity: number }
  | { kind: 'open'; shipment: string; from: From; status: string }
  | { kind: 'loaded'; shipment: string; from: From };

export const RESCHEDULE = 'RESCHEDULE';

/**
 * The one order of wave numbers: 5, 5 RESCHEDULE, 5 RESCHEDULE-2, 6 … 10,
 * then names without a leading number (T4, a carried Tunda wave) after
 * every number, as before.
 */
export function compareWaveNo(a: string, b: string): number {
  const da = /^\d/.test(a), db = /^\d/.test(b);
  if (da !== db) return da ? -1 : 1;
  return a.localeCompare(b, undefined, { numeric: true });
}

export function sortEarlier(demand: DemandLine[], facts: EarlierFacts): { demand: DemandLine[]; decisions: EarlierDecision[] } {
  const posted = new Map<string, number>();
  for (const p of facts.posted) {
    const k = `${p.wave_id}|${p.shipment_number}`;
    posted.set(k, (posted.get(k) ?? 0) + Number(p.quantity));
  }
  const loaded = new Set(facts.loaded.map((l) => `${l.wave_id}|${l.shipment_number}`));
  // Latest earlier wave of each shipment (a later day decides over an earlier one).
  const latest = new Map<string, EarlierWave>();
  for (const w of [...facts.waves].sort((a, b) => a.planned_date.localeCompare(b.planned_date))) {
    for (const s of w.shipment_numbers) latest.set(s, w);
  }

  const decided = new Map<string, EarlierDecision | null>();
  // "<NO> RESCHEDULE" per earlier wave: shipments of one earlier wave stay together,
  // a second earlier wave under the same NO gets -2 (never merged).
  const names = new Map<string, string>();
  const used = new Set<string>();
  const decide = (d: DemandLine): EarlierDecision | null => {
    if (decided.has(d.shipmentNumber)) return decided.get(d.shipmentNumber)!;
    const w = latest.get(d.shipmentNumber);
    let r: EarlierDecision | null = null;
    if (w && w.status !== 'RESCHEDULED') {
      const from = { wave_id: w.id, wave_no: w.wave_no, planned_date: w.planned_date };
      const k = `${w.id}|${d.shipmentNumber}`;
      const qty = posted.get(k) ?? 0;
      if (loaded.has(k)) r = { kind: 'loaded', shipment: d.shipmentNumber, from };
      else if (qty > 0) r = { kind: 'picked', shipment: d.shipmentNumber, from, quantity: qty };
      else if (w.status === 'CANCELLED') {
        const no = (d.waveNo || w.wave_no).trim();
        const key = `${no}|${w.id}`;
        let name = names.get(key);
        if (!name) {
          name = `${no} ${RESCHEDULE}`;
          for (let n = 2; used.has(name); n++) name = `${no} ${RESCHEDULE}-${n}`;
          names.set(key, name); used.add(name);
        }
        r = { kind: 'reschedule', shipment: d.shipmentNumber, from, waveNo: name };
      } else r = { kind: 'open', shipment: d.shipmentNumber, from, status: w.status };
    }
    decided.set(d.shipmentNumber, r);
    return r;
  };

  const out: DemandLine[] = [];
  for (const d of demand) {
    const r = decide(d);
    if (!r || r.kind === 'loaded') out.push(d);
    else if (r.kind === 'reschedule') out.push({ ...d, waveNo: r.waveNo });
  }
  return { demand: out, decisions: [...decided.values()].filter((x): x is EarlierDecision => x !== null) };
}

const MONTHS = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];

/** The date a file name carries ("…_13 Oktober 2026_.xlsx", "picklist_2026-10-09.xlsx"), ISO, or null. */
export function fileDate(name: string): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = new RegExp(`(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})`, 'i').exec(name);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
