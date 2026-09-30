/**
 * Everything a generated picklist run must satisfy, whatever the order load.
 * Used by tests/b2b-sisa-consistency.test.ts. Throws on the first broken rule.
 */
import { strict as assert } from 'node:assert';
import { daysBetween, hasExpiry, isStagingLocation, minShelfLifeDays, type AllocatorConfig } from '../../lib/allocator/config';
import { allocate } from '../../lib/allocator/allocator';
import { parseLocation } from '../../lib/allocator/pickpath';
import { buildPlan } from '../../lib/allocator/plan';
import { binToBin, sisaPrinted } from '../../lib/allocator/picklist';
import type { PipelineResult } from '../../lib/allocator/pipeline';
import type { DemandLine, StockBin } from '../../lib/allocator/types';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const key = (loc: string, sku: string, batch: string | null, exp: string) => `${loc}|${sku}|${batch ?? ''}|${exp}`;

export function checkPicklistRun(run: PipelineResult, stock: StockBin[], demand: DemandLine[], config: AllocatorConfig, stagedBySku: Map<string, number>): void {
  const printed = run.allocation.picklists.flatMap((p) => p.lines);

  // Every allocated row is printed exactly once.
  assert.equal(printed.length, run.allocation.lines.length, 'printed rows = allocated rows');

  // Ordered = picked + short, per shipment/SKU; nothing picked that was not ordered.
  const ordered = new Map<string, number>();
  for (const d of demand) ordered.set(`${d.shipmentNumber}|${d.sku}`, (ordered.get(`${d.shipmentNumber}|${d.sku}`) ?? 0) + d.qtyCartons);
  const got = new Map<string, number>();
  for (const l of printed) {
    const k = `${l.shipmentNumber}|${l.sku}`;
    assert.ok(ordered.has(k), `${k} picked but never ordered`);
    assert.ok(l.qtyPick > 0, `${k} ${l.location}: pick of ${l.qtyPick}`);
    got.set(k, (got.get(k) ?? 0) + l.qtyPick);
  }
  for (const s of run.allocation.shortages) got.set(`${s.shipmentNumber}|${s.sku}`, (got.get(`${s.shipmentNumber}|${s.sku}`) ?? 0) + s.qtyShort);
  for (const [k, q] of ordered) assert.equal(got.get(k) ?? 0, q, `${k}: picked + short vs ordered`);

  // One picklist id per sheet, and each sheet holds a single shipment.
  const ids = run.allocation.picklists.map((p) => p.picklistId);
  assert.equal(new Set(ids).size, ids.length, 'duplicate picklist id');
  for (const p of run.allocation.picklists) {
    assert.equal(new Set(p.lines.map((l) => l.shipmentNumber)).size, 1, `${p.picklistId} mixes shipments`);
    assert.equal(p.totalCartons, p.lines.reduce((a, l) => a + l.qtyPick, 0), `${p.picklistId} total`);
  }

  // Walk the printed rows against real bins: Sisa, Bin To Bin, FEFO.
  const bal = new Map<string, number>();
  for (const b of stock) { const k = key(b.location, b.sku, b.batch, iso(b.expiryDate)); bal.set(k, (bal.get(k) ?? 0) + b.qtyCartons); }
  const atLocation = (loc: string, sku: string) => { let n = 0; for (const [k, q] of bal) if (k.startsWith(`${loc}|${sku}|`)) n += q; return n; };

  for (const l of printed) {
    const exp = iso(l.expiryDate);
    const k = key(l.location, l.sku, l.batch, exp);
    const left = (bal.get(k) ?? 0) - l.qtyPick;
    const pf = run.pickfaces.get(l.sku);
    const row = `${l.shipmentNumber} ${l.sku} ${l.location}`;

    assert.ok(left >= 0, `${row}: picks ${l.qtyPick}, only ${left + l.qtyPick} in the bin`);
    assert.equal(sisaPrinted(l), left, `${row}: printed Sisa vs bin right after the pick`);
    assert.equal(!!l.moveTo, l.moveQty > 0, `${row}: Bin To Bin ${l.moveTo} with move ${l.moveQty}`);
    assert.equal(binToBin(l), l.moveTo ?? (l.breaksPallet ? 'tetap di bin' : ''), `${row}: Bin To Bin text`);
    if (l.pickType === 'PALLET') assert.equal(l.qtyPick % l.upp, 0, `${row}: PALLET row of ${l.qtyPick} with UPP ${l.upp}`);
    if (l.breaksPallet) assert.ok(l.qtyPick < l.upp, `${row}: opens a pallet but picks ${l.qtyPick} of ${l.upp}`);
    if (l.moveTo) {
      assert.ok(l.breaksPallet, `${row}: Bin To Bin without opening a pallet`);
      assert.notEqual(l.moveTo, l.location, `${row}: Bin To Bin to itself`);
      assert.equal(l.moveQty, left, `${row}: carries the whole leftover`);
      assert.equal(l.qtyRemainingInBin, 0, `${row}: nothing stays once moved`);
      if (l.moveTo !== pf?.location) {
        const parsed = parseLocation(l.moveTo);
        assert.ok(parsed && config.pickfaceLevels.includes(parsed.level), `${row}: overflow Bin To Bin ${l.moveTo} is not a Level-A bin`);
        const allPf = new Set([...run.pickfaces.values()].map((p) => p.location));
        assert.ok(!allPf.has(l.moveTo), `${row}: overflow Bin To Bin ${l.moveTo} lands on a dedicated pickface`);
        let held = 0;
        for (const [bk, bq] of bal) if (bk.startsWith(`${l.moveTo}|`)) held += bq;
        assert.equal(held, 0, `${row}: overflow Bin To Bin ${l.moveTo} lands on an occupied bin`);
        const onPf = atLocation(pf!.location, l.sku);
        assert.ok(onPf >= pf!.targetQtyCartons, `${row}: overflow while pickface ${pf!.location} below target (${onPf}/${pf!.targetQtyCartons})`);
      }
    } else if (l.breaksPallet && left > 0 && pf && pf.location !== l.location) {
      const onPf = atLocation(pf.location, l.sku);
      assert.ok(onPf >= pf.targetQtyCartons, `${row}: opens a pallet, ${left} stay, pickface ${pf.location} has ${onPf}/${pf.targetQtyCartons}`);
    }

    bal.set(k, left - l.moveQty);
    if (l.moveTo) {
      const d = key(l.moveTo, l.sku, l.batch, exp);
      bal.set(d, (bal.get(d) ?? 0) + l.moveQty);
    }
  }

  // FEFO in allocation order (the documented rule; print order may differ across
  // shipments): among rack stock, no older expiry of the SKU left when a newer one is taken.
  const left = new Map<string, { sku: string; exp: string; q: number }>();
  // Only stock the allocator may take: blocked bins and short shelf life are refused.
  const pickable = (b: StockBin) => !isStagingLocation(b.location, config) && !config.blockedBins.includes(b.location)
    && !(hasExpiry(b.expiryDate) && daysBetween(config.asOf, b.expiryDate) < minShelfLifeDays(b.sku, config));
  for (const b of stock.filter(pickable)) {
    const k = key(b.location, b.sku, b.batch, iso(b.expiryDate));
    const e = left.get(k); if (e) e.q += b.qtyCartons; else left.set(k, { sku: b.sku, exp: iso(b.expiryDate), q: b.qtyCartons });
  }
  const allocated = allocate(stock, demand, config, stagedBySku).lines;
  // Moves and print order never change what is taken: the printed rows carry
  // exactly the allocated shipment / SKU / batch / expiry / quantity.
  const takes = (ls: typeof printed) => {
    const m = new Map<string, number>();
    for (const l of ls) { const k = `${l.shipmentNumber}|${l.sku}|${l.batch ?? ''}|${iso(l.expiryDate)}`; m.set(k, (m.get(k) ?? 0) + l.qtyPick); }
    return [...m].sort(([a], [b]) => a.localeCompare(b));
  };
  assert.deepEqual(takes(printed), takes(allocated), 'printed batches/expiries = allocated (FEFO)');
  for (const l of allocated.filter((x) => !isStagingLocation(x.location, config))) {
    const older = [...left.values()].find((v) => v.sku === l.sku && v.exp < iso(l.expiryDate) && v.q > 0);
    assert.ok(!older, `${l.shipmentNumber} ${l.sku}: takes ${iso(l.expiryDate)} from ${l.location} while ${older?.exp} is left`);
    left.get(key(l.location, l.sku, l.batch, iso(l.expiryDate)))!.q -= l.qtyPick;
  }

  // The plan executes exactly the printed moves.
  const plan = buildPlan(run.allocation, demand, run.pickfaces);
  const moves = printed.filter((l) => l.moveTo).map((l) => `${l.location}>${l.moveTo}|${l.sku}|${l.moveQty}`).sort();
  const replen = plan.tasks.filter((t) => t.task_type === 'REPLENISH').map((t) => `${t.from_bin}>${t.to_bin}|${t.sku}|${t.quantity}`).sort();
  assert.deepEqual(replen, moves, 'plan REPLENISH tasks = printed Bin To Bin rows');
  assert.equal(plan.tasks.filter((t) => t.task_type === 'PICK').length, printed.length, 'plan PICK tasks = printed rows');
}
