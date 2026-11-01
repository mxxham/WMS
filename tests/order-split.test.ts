/** Each pick line carries its own DOs (lib/allocator/orders.ts, 0124). */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { withConfig } from '../lib/allocator/config';
import { loadWorkbookFromBuffer } from '../lib/allocator/browser/browser-input';
import { runPipeline } from '../lib/allocator/pipeline';
import { buildPlan } from '../lib/allocator/plan';
import { demandOrders, ordersAfter, splitOverOrders } from '../lib/allocator/orders';
import type { OrderQty } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nDO per pick line');

const sum = (o: OrderQty[]) => o.reduce((n, x) => n + x.qty, 0);
const one = (orders: OrderQty[] | null) => () => orders;

test('lines fill the DOs in their listed order, a line spanning two DOs carries both', () => {
  const { split, left } = splitOverOrders([31, 5, 12], () => 'g', (q) => q,
    one([{ orderNo: 'A', qty: 20 }, { orderNo: 'B', qty: 20 }, { orderNo: 'C', qty: 10 }]));
  assert.deepEqual(split, [
    [{ orderNo: 'A', qty: 20 }, { orderNo: 'B', qty: 11 }],
    [{ orderNo: 'B', qty: 5 }],
    [{ orderNo: 'B', qty: 4 }, { orderNo: 'C', qty: 8 }],
  ]);
  assert.deepEqual(left.get('g'), [{ orderNo: 'A', qty: 0 }, { orderNo: 'B', qty: 0 }, { orderNo: 'C', qty: 2 }]);
});

test('an over-pick goes to the last DO, so no carton is without a DO', () => {
  const { split } = splitOverOrders([8, 4], () => 'g', (q) => q, one([{ orderNo: 'A', qty: 5 }, { orderNo: 'B', qty: 5 }]));
  assert.deepEqual(split, [[{ orderNo: 'A', qty: 5 }, { orderNo: 'B', qty: 3 }], [{ orderNo: 'B', qty: 4 }]]);
});

test('several DOs without cartons are not guessed: the line keeps the whole list', () => {
  assert.equal(demandOrders({ orderNos: ['A', 'B'], qtyCartons: 10 }), null);
  assert.deepEqual(demandOrders({ orderNos: [' A ', 'A'], qtyCartons: 10 }), [{ orderNo: 'A', qty: 10 }]);
  const { split } = splitOverOrders([3], () => 'g', (q) => q, () => null);
  assert.deepEqual(split, [null]);
});

test('a carried-over remainder keeps only the DOs still open', () => {
  assert.deepEqual(ordersAfter([{ orderNo: 'A', qty: 5 }, { orderNo: 'B', qty: 5 }], 7), [{ orderNo: 'B', qty: 3 }]);
  assert.deepEqual(ordersAfter([{ orderNo: 'A', qty: 5 }], 0), [{ orderNo: 'A', qty: 5 }]);
  assert.equal(ordersAfter(undefined, 3), undefined);
});

// ---- The real workbooks: every printed line names only its own DOs -------------------------
for (const [day, date] of [['15', '2026-09-15'], ['18', '2026-09-18'], ['24', '2026-09-24']]) {
  const buf = readFileSync(`data/Warehouse_Management_System_${day}_September_2026_.xlsx`);
  const config = withConfig({ asOf: new Date(`${date}T00:00:00Z`) });
  const wb = loadWorkbookFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), config);
  const run = runPipeline(wb.stock, wb.demand, wb.stagedBySku, config, wb.warnings);
  const printed = run.allocation.picklists.flatMap((p) => p.lines);
  const demandOf = new Map(wb.demand.map((d) => [`${d.shipmentNumber}|${d.sku}`, d]));

  test(`${day} Sep: every line's DO cartons add up to its pick, and orderNos names exactly them`, () => {
    for (const l of printed) {
      assert.ok(l.orders, `${l.shipmentNumber} ${l.sku} ${l.location}: no split`);
      assert.equal(sum(l.orders!), l.qtyPick, `${l.shipmentNumber} ${l.sku} ${l.location}`);
      assert.deepEqual(l.orderNos, l.orders!.map((o) => o.orderNo));
    }
  });

  test(`${day} Sep: per shipment + SKU, no DO gets more cartons than the Schedule orders, filled in Schedule order`, () => {
    const got = new Map<string, Map<string, number>>();
    const seq = new Map<string, string[]>();
    for (const l of printed) {
      const k = `${l.shipmentNumber}|${l.sku}`;
      const m = got.get(k) ?? new Map<string, number>();
      for (const o of l.orders!) {
        m.set(o.orderNo, (m.get(o.orderNo) ?? 0) + o.qty);
        const s = seq.get(k) ?? [];
        if (s[s.length - 1] !== o.orderNo) s.push(o.orderNo);
        seq.set(k, s);
      }
      got.set(k, m);
    }
    for (const [k, m] of got) {
      const d = demandOf.get(k)!;
      const ordered = new Map(d.orders!.map((o) => [o.orderNo, o.qty]));
      for (const [no, q] of m) assert.ok(q <= (ordered.get(no) ?? 0), `${k}: DO ${no} got ${q}, ordered ${ordered.get(no)}`);
      // The DOs are reached in Schedule order, never going back to an earlier one.
      const order = d.orders!.map((o) => o.orderNo);
      const s = seq.get(k)!;
      assert.deepEqual(s, [...s].sort((a, b) => order.indexOf(a) - order.indexOf(b)), `${k}: ${s.join(' > ')}`);
    }
  });

  test(`${day} Sep: a shortage names only the DOs still missing cartons`, () => {
    for (const s of run.allocation.shortages) {
      const d = demandOf.get(`${s.shipmentNumber}|${s.sku}`)!;
      const given = new Map<string, number>();
      for (const l of printed.filter((x) => x.shipmentNumber === s.shipmentNumber && x.sku === s.sku)) {
        for (const o of l.orders!) given.set(o.orderNo, (given.get(o.orderNo) ?? 0) + o.qty);
      }
      const open = d.orders!.filter((o) => o.qty > (given.get(o.orderNo) ?? 0)).map((o) => o.orderNo);
      assert.deepEqual(s.orderNos, open, `${s.shipmentNumber} ${s.sku}`);
    }
  });

  test(`${day} Sep: the plan writes each pick's DOs and each demand line's DO cartons`, () => {
    const plan = buildPlan(run.allocation, wb.demand, run.pickfaces);
    const picks = plan.tasks.filter((t) => t.task_type === 'PICK');
    assert.equal(picks.length, printed.length);
    picks.forEach((t, i) => {
      assert.deepEqual(t.orders, printed[i]!.orders!.map((o) => ({ order_no: o.orderNo, qty: o.qty })));
    });
    assert.ok(plan.tasks.filter((t) => t.task_type === 'REPLENISH').every((t) => t.orders === undefined));
    for (const o of plan.outbound) {
      assert.equal(o.order_qtys.reduce((n, x) => n + x.qty, 0), o.quantity_requested, `${o.shipment_number} ${o.sku}`);
    }
  });
}

test('18 Sep: 109669919 / 550072331 (DO 538061350 x139, 538007377 x2): only the last line carries the second DO', () => {
  const buf = readFileSync('data/Warehouse_Management_System_18_September_2026_.xlsx');
  const config = withConfig({ asOf: new Date('2026-09-18T00:00:00Z') });
  const wb = loadWorkbookFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), config);
  const run = runPipeline(wb.stock, wb.demand, wb.stagedBySku, config, wb.warnings);
  const lines = run.allocation.picklists.flatMap((p) => p.lines)
    .filter((l) => l.shipmentNumber === '109669919' && l.sku === '550072331');
  assert.equal(lines.length, 5);
  assert.ok(lines.slice(0, 4).every((l) => l.orderNos.join() === '538061350'), lines.map((l) => l.orderNos.join('/')).join(' ; '));
  assert.deepEqual(lines[4]!.orders, [{ orderNo: '538061350', qty: 34 }, { orderNo: '538007377', qty: 2 }]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
