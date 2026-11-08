// Rak & Lokasi (0132) in the FEFO engine: which bins exist comes from the database (state + owner);
// how they are ranked does not change (selectNextBin is untouched).
import { strict as assert } from 'node:assert';
import { DEFAULT_CONFIG, withConfig } from '../lib/allocator/config';
import { runPipeline } from '../lib/allocator/pipeline';
import { inventoryToStock, type InventoryRow } from '../lib/allocator/adapters/inventory-stock';
import { shellBinRules } from '../lib/racks';
import type { DemandLine } from '../lib/allocator/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const UPP = 48;
const row = (bin: string, expiry: string, qty: number, status: 'active' | 'blocked' = 'active'): InventoryRow => ({
  bin_code: bin, bin_status: status, sku: 'S', description: 'S', uom: 'CAR', upp: UPP,
  batch_lot: `B${expiry.slice(0, 7)}`, quantity: qty, expiry_date: expiry, received_date: '2026-01-01',
});
const order = (qty: number): DemandLine => ({ shipmentNumber: 'SH1', waveNo: '1', orderNos: ['O1'], sku: 'S', description: 'S', qtyCartons: qty,
  upp: UPP, destination: '', shipToLocation: '', transport: null, truckType: null, slotTime: '01:00', deliveryDate: null });
const base = { asOf: new Date('2026-11-08T00:00:00Z'), minRemainingShelfLifeDays: 1 };
const run = (rows: InventoryRow[], qty: number, extra: Parameters<typeof withConfig>[0] = {}) => {
  const config = withConfig({ ...base, ...extra });
  const { stock } = inventoryToStock(rows, config);
  return runPipeline(stock, [order(qty)], new Map(), config).allocation;
};
const picked = (res: ReturnType<typeof run>) => res.lines.map((l) => `${l.location} ${l.qtyPick}`);

test('a CKB bin with the earliest expiry is never picked (planning_stock reports it blocked)', () => {
  const res = run([row('CF21A01', '2030-01-10', 48, 'blocked'), row('CA05B01', '2030-06-10', 48), row('CA06B01', '2030-09-10', 48)], 60);
  assert.deepEqual(picked(res), ['CA05B01 48', 'CA06B01 12']);
  assert.equal(res.shortages.length, 0);
});

test('a bin in a new aisle (CI) is picked once it is active, in FEFO order', () => {
  const res = run([row('CI01B01', '2030-03-10', 48), row('CA05B01', '2030-06-10', 48)], 30);
  assert.deepEqual(picked(res), ['CI01B01 30']);
});

test('shellBinRules: unusable rack bins join the blocked list, aisle order comes from the layout', () => {
  const rules = shellBinRules([
    { bin_code: 'CA01A01', rack: '01', status: 'active', owner: 'SHELL' },
    { bin_code: 'CG01A01', rack: '01', status: 'active', owner: 'CKB' },
    { bin_code: 'CE33A01', rack: '33', status: 'blocked', owner: 'SHELL' },
    { bin_code: 'CI01A01', rack: '01', status: 'blocked', owner: 'SHELL' },
    { bin_code: 'STAGING', rack: null, status: 'active', owner: null },
  ], ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH', 'CI']);
  assert.deepEqual(rules.blockedBins.filter((b) => !DEFAULT_CONFIG.blockedBins.includes(b)), ['CG01A01', 'CI01A01']);
  assert.ok(DEFAULT_CONFIG.blockedBins.every((b) => rules.blockedBins.includes(b)), 'the offline fallback list stays');
  assert.deepEqual(rules.aisleSequence, ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH', 'CI']);
});

test('an unusable code in blockedBins is never a relocation target', () => {
  // A 60-carton order breaks the CA05B01 pallet; its rest must go to a pickface, never to CA07B01.
  const rows = [row('CA05B01', '2030-06-10', 48), row('CA05B02', '2030-06-10', 48)];
  const res = run(rows, 60, { blockedBins: [...DEFAULT_CONFIG.blockedBins, 'CA05C01', 'CA05C02', 'CA05D01', 'CA05D02', 'CA05E01', 'CA05E02'] });
  for (const l of res.lines) assert.ok(!l.moveTo || !/^CA05[C-E]0[12]$/.test(l.moveTo), `moved to ${l.moveTo}`);
});

test('the layout aisle order keeps today\'s route for CA-CF', () => {
  const rows = [row('CC10B01', '2030-06-10', 10), row('CA10B01', '2030-06-10', 10), row('CB10B01', '2030-06-10', 10)];
  const a = picked(run(rows, 30));
  const b = picked(run(rows, 30, { aisleSequence: ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'CH', 'CI'] }));
  assert.deepEqual(a, b);
});

console.log(`\nracks-allocator: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
