/**
 * Stress with dedicated pickfaces: the same random order load as
 * tests/picklist-stress.test.ts, but a random 30-100% of the SKUs have a fixed
 * pickface (config.pickfaceOverrides), drawn from every kind of bin an admin
 * can assign (tests/helpers/stress.ts randomPickfaces). Every Bin To Bin and
 * Sisa is checked with the same invariants, plus: a SKU with a dedicated
 * pickface is topped up into that bin, or — when it is already full — into
 * the nearest empty Level-A bin as a one-time overflow, nowhere else.
 *
 * STRESS_SEED=<seed> replays one case, STRESS_CASES=<n> changes the count.
 */
import { strict as assert } from 'node:assert';
import { parseLocation } from '../lib/allocator/pickpath';
import { randomPickfaces, runStress } from './helpers/stress';

let dedicatedSkus = 0, movesIn = 0, picksFrom = 0;

runStress(
  'Picklist stress (random orders, dedicated pickfaces)',
  500000,
  (seed, stock, config) => {
    const pickfaceOverrides = randomPickfaces(seed, stock, config);
    return { pickfaceOverrides, note: `${Object.keys(pickfaceOverrides).length} dedicated pickfaces` };
  },
  (run, config) => {
    const fixed = config.pickfaceOverrides;
    for (const [sku, loc] of Object.entries(fixed)) {
      const pf = run.pickfaces.get(sku);
      assert.ok(pf, `${sku}: dedicated pickface ${loc} missing from the run`);
      assert.deepEqual([pf.location, pf.isAuto], [loc, false], `${sku}: pickface is ${pf.location}, dedicated ${loc}`);
    }
    for (const l of run.allocation.lines) {
      if (!fixed[l.sku]) continue;
      if (l.moveTo) {
        if (l.moveTo !== fixed[l.sku]) {
          const parsed = parseLocation(l.moveTo);
          assert.ok(parsed && config.pickfaceLevels.includes(parsed.level), `${l.shipmentNumber} ${l.sku}: overflow Bin To Bin ${l.moveTo} is not a Level-A bin`);
          const allPf = new Set([...run.pickfaces.values()].map((p) => p.location));
          assert.ok(!allPf.has(l.moveTo), `${l.shipmentNumber} ${l.sku}: overflow Bin To Bin ${l.moveTo} lands on a dedicated pickface`);
          assert.notEqual(l.moveTo, l.location, `${l.shipmentNumber} ${l.sku}: Bin To Bin to itself`);
        } else {
          movesIn++;
        }
      }
      if (l.location === fixed[l.sku]) picksFrom++;
    }
    dedicatedSkus += new Set(run.allocation.lines.filter((l) => fixed[l.sku]).map((l) => l.sku)).size;
  },
);

console.log(`  coverage: ${dedicatedSkus} ordered SKUs with a dedicated pickface, ${movesIn} Bin To Bin into one, ${picksFrom} picks from one\n`);
