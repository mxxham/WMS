// Inventory → Stok sorts (0142): "Bin" orders rows the way the rack is walked, so a filtered
// aisle reads in position order instead of SKU order; the opened-before-sealed rule inside a
// Per-SKU expansion stays untouched.
import { strict as assert } from 'node:assert';
import { INVENTORY_SORTS, lineSortCompare, skuSortCompare, type InventorySort } from '../lib/inventory-view';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

type L = Parameters<ReturnType<typeof lineSortCompare>>[0];
const line = (bin_code: string, sku: string, o: Partial<L> = {}): L =>
  ({ bin_code, sku, batch_lot: '', quantity: 24, expiry_date: null, reserved: 0, ...o });

// One aisle seen through a filter: a pickface-style partial line, a sealed full pallet and
// another SKU — deliberately not in bin order per SKU.
const aisle = [
  line('CB03C01', '9000003'),
  line('CA02B02', '9000001'),
  line('CA01A01', '9000002', { quantity: 3 }),
  line('CA01A01', '9000004', { batch_lot: 'B2' }),
];
const bins = (sort: InventorySort) => [...aisle].sort(lineSortCompare(sort)).map((l) => l.bin_code);

test('the sort list contains the bin order', () => {
  assert.deepEqual(INVENTORY_SORTS, ['sku', 'qty', 'expiry', 'reserved', 'bin']);
});

test('default sort stays SKU then bin (the order the user saw as random)', () => {
  assert.deepEqual(bins('sku'), ['CA02B02', 'CA01A01', 'CB03C01', 'CA01A01']);
});

test('"Bin" walks the rack: position order, opened or sealed alike', () => {
  assert.deepEqual(bins('bin'), ['CA01A01', 'CA01A01', 'CA02B02', 'CB03C01']);
});

test('inside one bin, lines go by SKU then batch', () => {
  const same = [
    line('CC05A02', '9000002', { batch_lot: 'B9' }),
    line('CC05A02', '9000001'),
    line('CC05A02', '9000004', { batch_lot: 'B1' }),
  ];
  assert.deepEqual(
    [...same].sort(lineSortCompare('bin')).map((l) => `${l.sku}/${l.batch_lot}`),
    ['9000001/', '9000002/B9', '9000004/B1']);
});

test('the other sorts keep their meaning', () => {
  assert.deepEqual([...aisle].sort(lineSortCompare('qty')).map((l) => l.quantity), [24, 24, 24, 3]);
  assert.deepEqual(
    [...aisle].sort(lineSortCompare('reserved')).map((l) => l.reserved).reverse(),
    [...aisle].sort(lineSortCompare('reserved')).map((l) => l.reserved));
  const dated = [
    line('CA01A01', '9000002', { expiry_date: '2027-05-01' }),
    line('CA02B02', '9000001', { expiry_date: '2026-12-01' }),
  ];
  assert.deepEqual([...dated].sort(lineSortCompare('expiry')).map((l) => l.expiry_date), ['2026-12-01', '2027-05-01']);
});

test('Per SKU with "Bin": SKUs ordered by where their stock sits', () => {
  type S = Parameters<ReturnType<typeof skuSortCompare>>[0];
  const rows: S[] = [
    { sku: '9000003', firstBin: 'CB03C01', total: 24, reserved: 0, earliest: null },
    { sku: '9000001', firstBin: 'CA02B02', total: 48, reserved: 0, earliest: null },
    { sku: '9000002', firstBin: 'CA01A01', total: 3, reserved: 0, earliest: null },
  ];
  assert.deepEqual([...rows].sort(skuSortCompare('bin')).map((r) => r.sku), ['9000002', '9000001', '9000003']);
  assert.deepEqual([...rows].sort(skuSortCompare('bin')).map((r) => r.firstBin),
    [...rows].sort(skuSortCompare('bin')).map((r) => r.firstBin).sort());
  assert.deepEqual([...rows].sort(skuSortCompare('sku')).map((r) => r.sku), ['9000001', '9000002', '9000003']);
  assert.deepEqual([...rows].sort(skuSortCompare('qty')).map((r) => r.sku), ['9000001', '9000003', '9000002']);
});

test('a missing expiry sorts last in expiry order, as before', () => {
  const dated = [
    line('CA01A01', '9000002'),
    line('CA02B02', '9000001', { expiry_date: '2026-12-01' }),
  ];
  assert.deepEqual([...dated].sort(lineSortCompare('expiry')).map((l) => l.sku), ['9000001', '9000002']);
});

console.log(`\ninventory-sort: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
