/**
 * Shared by the picklist stress tests: seeded random orders (every line well
 * under a full pallet) and random dedicated pickfaces, run against each real
 * workbook's stock and checked with picklist-invariants.ts.
 */
import { readFileSync } from 'node:fs';
import { withConfig, type AllocatorConfig } from '../../lib/allocator/config';
import { loadWorkbookFromBuffer } from '../../lib/allocator/browser/browser-input';
import { parseLocation } from '../../lib/allocator/pickpath';
import { runPipeline, type PipelineResult } from '../../lib/allocator/pipeline';
import type { DemandLine, StockBin } from '../../lib/allocator/types';
import { checkPicklistRun } from './picklist-invariants';

/** mulberry32 — small, deterministic PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: T[]) => xs[Math.floor(next() * xs.length)];
  return { next, int, pick };
}

export function randomDemand(seed: number, stock: StockBin[], template: DemandLine): DemandLine[] {
  const r = rng(seed);
  const onHand = new Map<string, { upp: number; qty: number; description: string }>();
  for (const b of stock) {
    const e = onHand.get(b.sku);
    if (e) e.qty += b.qtyCartons;
    else onHand.set(b.sku, { upp: b.upp || 1, qty: b.qtyCartons, description: b.description ?? '' });
  }
  const skus = [...onHand.keys()];
  // A few hot SKUs make many shipments compete for the same bins and pickface.
  const hot = Array.from({ length: r.int(1, 5) }, () => r.pick(skus));

  const shipments = r.int(1, 60);
  const slots = ['07:00', '09:00', '11:00', '13:00', '15:00', null];
  const out: DemandLine[] = [];
  let wave = 0;
  for (let s = 0; s < shipments; s++) {
    if (s === 0 || r.next() < 0.6) wave++; // otherwise share the previous wave
    const shipmentNumber = String(900000000 + seed % 1000 * 1000 + s);
    const slotTime = r.pick(slots);
    for (let n = r.int(1, 8); n > 0; n--) {
      const unknown = r.next() < 0.03;
      const sku = unknown ? `99${r.int(1000000, 9999999)}` : r.next() < 0.4 ? r.pick(hot) : r.pick(skus);
      const info = onHand.get(sku) ?? { upp: r.int(2, 60), qty: 0, description: 'UNKNOWN' };
      const upp = info.upp;
      // Always well under a full pallet: mostly a small slice, sometimes 1-3 cartons,
      // rarely up to just below one pallet.
      const roll = r.next();
      const qtyCartons = Math.max(1,
        roll < 0.3 ? r.int(1, 3) :
        roll < 0.9 ? r.int(1, Math.floor(upp / 4)) :
        r.int(1, upp - 1));
      out.push({
        ...template,
        shipmentNumber,
        waveNo: `W${wave}`,
        orderNos: [`SO${shipmentNumber}${n}`],
        sku,
        description: info.description,
        qtyCartons,
        upp,
        slotTime,
      });
      if (r.next() < 0.05) out.push({ ...out[out.length - 1], orderNos: [`SO${shipmentNumber}${n}b`], qtyCartons: r.int(1, 3) }); // same SKU on a second order
    }
  }
  // One line per shipment + SKU, orders combined — exactly what both workbook
  // importers hand the allocator (excel-input.ts / browser-input.ts).
  const merged = new Map<string, DemandLine>();
  for (const d of out) {
    const k = `${d.shipmentNumber}|${d.sku}`;
    const m = merged.get(k);
    if (m) { m.qtyCartons += d.qtyCartons; m.orderNos.push(...d.orderNos); }
    else merged.set(k, { ...d, orderNos: [...d.orderNos] });
  }
  return [...merged.values()];
}

/**
 * Dedicated pickfaces (config.pickfaceOverrides) for a random share of the
 * SKUs, drawn from every kind of bin set_pickfaces (0009) accepts — any rack
 * bin, one SKU per bin:
 *   · an empty Level A slot in a bay where the SKU is stored (the usual setup)
 *   · an empty Level A slot anywhere in the rack
 *   · a Level A bin already holding this SKU
 *   · a reserve bin (level B-E) holding this SKU
 *   · a bin holding a different SKU
 */
export function randomPickfaces(seed: number, stock: StockBin[], config: AllocatorConfig): Record<string, string> {
  const r = rng(seed ^ 0x5bd1e995);
  const rack = stock.filter((b) => b.qtyCartons > 0 && parseLocation(b.location) && config.rackLocationPattern.test(b.location));
  const occupied = new Set(rack.map((b) => b.location));
  const bays = new Map<string, string[]>(); // "CA05" -> its Level A slots
  for (const b of rack) {
    const p = parseLocation(b.location)!;
    const bay = `${p.aisle}${String(p.bay).padStart(2, '0')}`;
    bays.set(bay, [`${bay}A01`, `${bay}A02`]);
  }
  const emptySlots = [...bays.values()].flat().filter((l) => !occupied.has(l) && !config.blockedBins.includes(l));
  const bySku = new Map<string, StockBin[]>();
  for (const b of rack) bySku.set(b.sku, [...(bySku.get(b.sku) ?? []), b]);

  const taken = new Set<string>();
  const out: Record<string, string> = {};
  const share = 0.3 + r.next() * 0.7;
  for (const [sku, bins] of bySku) {
    if (r.next() > share) continue;
    const level = (b: StockBin) => parseLocation(b.location)!.level;
    const ownBays = new Set(bins.map((b) => b.location.slice(0, 4)));
    const free = (ls: string[]) => ls.filter((l) => !taken.has(l));
    const kind = r.next();
    const choices =
      kind < 0.4 ? free(emptySlots.filter((l) => ownBays.has(l.slice(0, 4)))) :
      kind < 0.55 ? free(emptySlots) :
      kind < 0.75 ? free(bins.filter((b) => level(b) === 'A').map((b) => b.location)) :
      kind < 0.9 ? free(bins.filter((b) => level(b) !== 'A').map((b) => b.location)) :
      free(rack.filter((b) => b.sku !== sku).map((b) => b.location));
    const loc = choices.length ? r.pick(choices) : r.pick(free(emptySlots));
    if (!loc) continue;
    taken.add(loc);
    out[sku] = loc;
  }
  return out;
}

export const stockDays = () => [['15', '2026-09-15'], ['18', '2026-09-18'], ['24', '2026-09-24']].map(([day, date]) => {
  const buf = readFileSync(`data/Warehouse_Management_System_${day}_September_2026_.xlsx`);
  const config = withConfig({ asOf: new Date(`${date}T00:00:00Z`) });
  return { day, config, wb: loadWorkbookFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), config) };
});

/**
 * Runs STRESS_CASES seeded cases per stock day (or the one STRESS_SEED) and
 * checks each. `setup` may return config overrides for the case.
 */
export function runStress(
  title: string,
  seedBase: number,
  setup: (seed: number, stock: StockBin[], config: AllocatorConfig) => Partial<AllocatorConfig> & { note?: string },
  inspect: (run: PipelineResult, config: AllocatorConfig) => void = () => {},
): void {
  let passed = 0, failed = 0, rows = 0;
  const only = process.env.STRESS_SEED ? Number(process.env.STRESS_SEED) : null;
  const cases = Number(process.env.STRESS_CASES ?? 40);
  console.log(`\n${title} (${only !== null ? `seed ${only}` : `${cases} cases per stock day`})`);

  for (const [i, S] of stockDays().entries()) {
    const seeds = only !== null ? [only] : Array.from({ length: cases }, (_, c) => seedBase + (i + 1) * 10000 + c);
    for (const seed of seeds) {
      const demand = randomDemand(seed, S.wb.stock, S.wb.demand[0]);
      const { note, ...overrides } = setup(seed, S.wb.stock, S.config);
      const config = { ...S.config, ...overrides };
      const shipments = new Set(demand.map((d) => d.shipmentNumber)).size;
      try {
        const run = runPipeline(S.wb.stock, demand, S.wb.stagedBySku, config, []);
        rows += run.allocation.lines.length;
        checkPicklistRun(run, S.wb.stock, demand, config, S.wb.stagedBySku);
        inspect(run, config);
        passed++;
      } catch (e) {
        failed++;
        console.log(`  ✗ STRESS_SEED=${seed} stock ${S.day} Sep, ${shipments} shipments / ${demand.length} lines${note ? `, ${note}` : ''}\n    ${(e as Error).message}`);
      }
    }
  }

  console.log(`  ${rows} pick rows checked\n  ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}
