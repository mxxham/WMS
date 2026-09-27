/**
 * Stress with dedicated pickfaces: the same random order load as
 * tests/picklist-stress.test.ts, but a random 30-100% of the SKUs have a fixed
 * pickface (config.pickfaceOverrides), drawn from every kind of bin an admin
 * can assign (tests/helpers/stress.ts randomPickfaces). Every Bin To Bin and
 * Sisa is checked with the same invariants, plus: a SKU with a dedicated
 * pickface is always topped up into that bin and nowhere else.
 *
 * STRESS_SEED=<seed> replays one case, STRESS_CASES=<n> changes the count.
 */
import { strict as assert } from 'node:assert';
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
        assert.equal(l.moveTo, fixed[l.sku], `${l.shipmentNumber} ${l.sku}: Bin To Bin to ${l.moveTo}, dedicated ${fixed[l.sku]}`);
        movesIn++;
      }
      if (l.location === fixed[l.sku]) picksFrom++;
    }
    dedicatedSkus += new Set(run.allocation.lines.filter((l) => fixed[l.sku]).map((l) => l.sku)).size;
  },
);

console.log(`  coverage: ${dedicatedSkus} ordered SKUs with a dedicated pickface, ${movesIn} Bin To Bin into one, ${picksFrom} picks from one\n`);
