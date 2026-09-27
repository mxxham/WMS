/**
 * Picklist Sisa must be what physically stays in the bin, on every sheet,
 * however the picklists are printed. Uses the three real workbooks:
 *
 *   1. Replaying the saved plan's tasks (the order the Wave page works in)
 *      against opening stock reproduces every printed Sisa, and no task
 *      takes from a bin that does not hold that SKU/batch at that moment.
 *   2. Reprinting from the saved plan (Wave page: whole day, or wave by
 *      wave) gives the same rows as printing everything from Alokasi.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { isStagingLocation, withConfig } from '../lib/allocator/config';
import { loadWorkbookFromBuffer } from '../lib/allocator/browser/browser-input';
import { runPipeline } from '../lib/allocator/pipeline';
import { allocate } from '../lib/allocator/allocator';
import { buildPlan } from '../lib/allocator/plan';
import { picklistsFromTasks, type TaskRow, type WaveRow } from '../lib/allocator/picklist-from-tasks';
import { binToBin, sisaPrinted } from '../lib/allocator/picklist';
import type { AllocationLine } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const key = (loc: string, sku: string, batch: string | null, exp: string) => `${loc}|${sku}|${batch ?? ''}|${exp}`;
const sig = (l: AllocationLine) => `${l.shipmentNumber}|${l.location}|${l.sku}|${l.description}|${l.batch ?? ''}|${iso(l.expiryDate)}|${l.qtyPick}|sisa ${l.qtyRemainingInBin}|move ${l.moveQty}->${l.moveTo ?? ''}`;
console.log('\nPicklist Sisa replay (real workbooks)');

for (const [day, date] of [['15', '2026-09-15'], ['18', '2026-09-18'], ['24', '2026-09-24']]) {
  const buf = readFileSync(`data/Warehouse_Management_System_${day}_September_2026_.xlsx`);
  const config = withConfig({ asOf: new Date(`${date}T00:00:00Z`) });
  const wb = loadWorkbookFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), config);
  const run = runPipeline(wb.stock, wb.demand, wb.stagedBySku, config, wb.warnings);
  const plan = buildPlan(run.allocation, wb.demand, run.pickfaces);
  const printed = run.allocation.picklists.flatMap((p) => p.lines);

  // What the database's items table holds: the master name of each SKU.
  const masterName = new Map(wb.stock.filter((b) => b.description).map((b) => [b.sku, b.description]));

  test(`${day} Sep: every row's SKU was ordered by its shipment, never over-picked, printed with its master name`, () => {
    const ordered = new Map<string, number>();
    for (const d of wb.demand) ordered.set(`${d.shipmentNumber}|${d.sku}`, (ordered.get(`${d.shipmentNumber}|${d.sku}`) ?? 0) + d.qtyCartons);
    const picked = new Map<string, number>();
    for (const l of printed) {
      const k = `${l.shipmentNumber}|${l.sku}`;
      assert.ok(ordered.has(k), `${l.shipmentNumber} picks SKU ${l.sku} it did not order`);
      picked.set(k, (picked.get(k) ?? 0) + l.qtyPick);
      assert.match(l.sku, /^\d{9}$/, `SKU text "${l.sku}"`);
      if (masterName.has(l.sku)) assert.equal(l.description, masterName.get(l.sku), `${l.shipmentNumber} ${l.location} ${l.sku} name`);
    }
    for (const [k, q] of picked) assert.ok(q <= ordered.get(k)!, `${k} picked ${q} > ordered ${ordered.get(k)}`);
  });

  test(`${day} Sep: a bin (same batch/expiry) appears at most once per picklist`, () => {
    for (const p of run.allocation.picklists) {
      const seen = new Set<string>();
      for (const l of p.lines) {
        const k = key(l.location, l.sku, l.batch, iso(l.expiryDate));
        assert.ok(!seen.has(k), `${p.picklistId}: ${l.location} ${l.sku} ${l.batch} printed twice`);
        seen.add(k);
      }
    }
  });

  // Staging only covers what the racks cannot (allocator.ts rule 6), outside FEFO, so FEFO is checked among rack stock.
  test(`${day} Sep: FEFO at every rack pick - no older rack batch of the SKU left when a newer one is taken`, () => {
    const left = new Map<string, { sku: string; exp: string; q: number }>();
    for (const b of wb.stock.filter((x) => !isStagingLocation(x.location, config))) { const k = key(b.location, b.sku, b.batch, iso(b.expiryDate)); const e = left.get(k); if (e) e.q += b.qtyCartons; else left.set(k, { sku: b.sku, exp: iso(b.expiryDate), q: b.qtyCartons }); }
    const raw = allocate(wb.stock, wb.demand, config, wb.stagedBySku);
    for (const l of raw.lines.filter((x) => !isStagingLocation(x.location, config))) {
      const older = [...left.values()].filter((v) => v.sku === l.sku && v.exp < iso(l.expiryDate) && v.q > 0);
      assert.equal(older.length, 0, `${l.shipmentNumber} ${l.sku} takes ${iso(l.expiryDate)} from ${l.location} while older stock is left`);
      left.get(key(l.location, l.sku, l.batch, iso(l.expiryDate)))!.q -= l.qtyPick;
    }
  });

  test(`${day} Sep: replaying the plan reproduces every printed Sisa, no bin below zero`, () => {
    const bal = new Map<string, number>();
    for (const b of wb.stock) { const k = key(b.location, b.sku, b.batch, iso(b.expiryDate)); bal.set(k, (bal.get(k) ?? 0) + b.qtyCartons); }
    const slot = new Map(plan.waves.map((w) => [w.wave_no, w.planned_slot ?? '99:99']));
    const tasks = [...plan.tasks].sort((a, b) => slot.get(a.wave_no)!.localeCompare(slot.get(b.wave_no)!) || Number(a.wave_no) - Number(b.wave_no) || a.seq - b.seq);
    const sisa: number[] = [];
    for (const t of tasks) {
      const src = key(t.from_bin, t.sku, t.batch_lot || null, t.expiry_date);
      const left = (bal.get(src) ?? 0) - t.quantity;
      assert.ok(left >= 0, `${t.task_type} NO ${t.wave_no} takes ${t.quantity} from ${src}, only ${left + t.quantity} there`);
      bal.set(src, left);
      if (t.task_type === 'REPLENISH') {
        const d = key(t.to_bin!, t.sku, t.batch_lot || null, t.expiry_date); bal.set(d, (bal.get(d) ?? 0) + t.quantity);
        sisa[sisa.length - 1] = left; // a pick's Sisa counts its own move (the REPLENISH right after it)
      } else sisa.push(left);
    }
    // Plan tasks are in printed order, so the i-th PICK is the i-th printed line.
    assert.equal(sisa.length, printed.length);
    printed.forEach((l, i) => assert.equal(l.qtyRemainingInBin, sisa[i], `${l.shipmentNumber} ${l.location} ${l.sku}: printed ${l.qtyRemainingInBin}, replay ${sisa[i]}`));
  });

  test(`${day} Sep: printed Bin To Bin = destination, 'tetap di bin' for a break without a move, Sisa = leftover right after the pick`, () => {
    for (const l of printed) {
      assert.equal(binToBin(l), l.moveTo ?? (l.breaksPallet ? 'tetap di bin' : ''));
      if (l.moveTo) assert.equal(sisaPrinted(l), l.moveQty, `${l.location}: Sisa shows the cartons carried to ${l.moveTo}`);
      else assert.equal(sisaPrinted(l), l.qtyRemainingInBin);
    }
  });

  test(`${day} Sep: Wave-page reprint (whole day and wave by wave) = Alokasi printout`, () => {
    const waves: WaveRow[] = plan.waves.map((w) => ({ id: `w${w.wave_no}`, wave_no: w.wave_no, planned_date: date, shipment_numbers: w.shipment_numbers, truck: w.truck, destination: w.destination, planned_slot: w.planned_slot, status: 'PENDING' }));
    const tasks: TaskRow[] = plan.tasks.map((t, i) => ({ id: `t${i}`, wave_id: `w${t.wave_no}`, wave_no: t.wave_no, planned_slot: null, shipment_number: t.shipment_number, task_type: t.task_type, seq: t.seq, status: 'PLANNED',
      sku: t.sku, description: masterName.get(t.sku) ?? '', uom: null, upp: null, from_bin: t.from_bin, to_bin: t.to_bin, batch_lot: t.batch_lot, expiry_date: t.expiry_date, quantity: t.quantity, pick_type: t.pick_type, breaks_pallet: t.breaks_pallet,
      completed_at: null, completed_by_name: null, actual_quantity: null, actual_from_bin: null, actual_batch_lot: null, actual_expiry_date: null, deviation_reason: null }));
    const stockNow = wb.stock.map((b) => ({ bin_code: b.location, sku: b.sku, batch_lot: b.batch ?? '', expiry_date: iso(b.expiryDate), quantity: b.qtyCartons }));
    const expected = printed.map(sig).sort();
    assert.deepEqual(picklistsFromTasks(waves, tasks, [], stockNow).flatMap((p) => p.lines.map(sig)).sort(), expected);
    assert.deepEqual(waves.flatMap((w) => picklistsFromTasks([w], tasks, [], stockNow, waves).flatMap((p) => p.lines.map(sig))).sort(), expected);
  });
}

test('after posting a task short, the reprint shows Sisa from what was really taken', () => {
  const w: WaveRow = { id: 'w1', wave_no: '1', planned_date: '2026-09-24', shipment_numbers: ['A', 'B'], truck: null, destination: '', planned_slot: '01:00', status: 'PENDING' };
  const base = { wave_id: 'w1', wave_no: '1', planned_slot: null, task_type: 'PICK' as const, sku: 'S', description: '', uom: null, upp: 48, from_bin: 'CA01A01', to_bin: null,
    batch_lot: 'B1', expiry_date: '2031-01-01', pick_type: 'CASE' as const, breaks_pallet: false, completed_at: null, completed_by_name: null,
    actual_from_bin: null, actual_batch_lot: null, actual_expiry_date: null, deviation_reason: null };
  const tasks: TaskRow[] = [
    { ...base, id: 'a', shipment_number: 'A', seq: 1, status: 'COMPLETED', quantity: 10, actual_quantity: 8, deviation_reason: 'rusak' },
    { ...base, id: 'b', shipment_number: 'B', seq: 2, status: 'PLANNED', quantity: 5, actual_quantity: null },
  ];
  // 30 at start, 8 really taken -> 22 on the shelf now. B's 5 leaves 17.
  const lines = picklistsFromTasks([w], tasks, [], [{ bin_code: 'CA01A01', sku: 'S', batch_lot: 'B1', expiry_date: '2031-01-01', quantity: 22 }]).flatMap((p) => p.lines);
  assert.deepEqual(lines.map((l) => [l.shipmentNumber, l.qtyRemainingInBin]), [['A', 22], ['B', 17]]);
});

test('reprint after stock drift: Bin To Bin carries only what is really left, Sisa = that same number', () => {
  const w: WaveRow = { id: 'w1', wave_no: '1', planned_date: '2026-09-24', shipment_numbers: ['A'], truck: null, destination: '', planned_slot: '01:00', status: 'PENDING' };
  const base = { wave_id: 'w1', wave_no: '1', planned_slot: null, sku: 'S', description: '', uom: null, upp: 44, batch_lot: 'B1', expiry_date: '2031-01-01',
    pick_type: 'CASE' as const, breaks_pallet: true, status: 'PLANNED' as const, completed_at: null, completed_by_name: null, actual_quantity: null,
    actual_from_bin: null, actual_batch_lot: null, actual_expiry_date: null, deviation_reason: null };
  // Planned: open a 44 pallet in CA01A01, pick 10, carry 34 to the pickface CB01A01.
  const tasks: TaskRow[] = [
    { ...base, id: 'p', shipment_number: 'A', task_type: 'PICK', seq: 1, from_bin: 'CA01A01', to_bin: null, quantity: 10 },
    { ...base, id: 'r', shipment_number: null, task_type: 'REPLENISH', seq: 2, from_bin: 'CA01A01', to_bin: 'CB01A01', quantity: 34 },
  ];
  // The shelf now holds 30, not 44: after the pick 20 are left, and that is all that can move.
  const [l] = picklistsFromTasks([w], tasks, [], [{ bin_code: 'CA01A01', sku: 'S', batch_lot: 'B1', expiry_date: '2031-01-01', quantity: 30 }]).flatMap((p) => p.lines);
  assert.equal(l.moveTo, 'CB01A01');
  assert.equal(l.moveQty, 20, 'carried');
  assert.equal(l.qtyRemainingInBin, 0, 'stays after the move');
  assert.equal(sisaPrinted(l), 20, 'printed Sisa');
  // Nothing left after the pick: no move to print.
  const [e] = picklistsFromTasks([w], tasks, [], [{ bin_code: 'CA01A01', sku: 'S', batch_lot: 'B1', expiry_date: '2031-01-01', quantity: 10 }]).flatMap((p) => p.lines);
  assert.equal(e.moveTo, null);
  assert.equal(e.moveQty, 0);
  assert.equal(binToBin(e), 'tetap di bin');
  assert.equal(sisaPrinted(e), 0);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
