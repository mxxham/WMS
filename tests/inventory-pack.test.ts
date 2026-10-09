/**
 * Inventory → Stok sends its lines packed (lib/inventory-pack.ts): every field
 * must come back exactly, and the packed form must be much smaller.
 */
import { strict as assert } from 'node:assert';
import { packLines, unpackLines, type PackLine } from '../lib/inventory-pack';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const line = (o: Partial<PackLine>): PackLine => ({
  bin_code: 'CE28D02', zone: 'CE', rack: '28', level: 'D', bin_status: 'active', sku: '550058592',
  description: 'Rimula R4X 15W-40 CI-4_1*209L_A227', uom: 'CAR', upp: 44, item_abc: 'A', batch_lot: '05H26JJ',
  quantity: 44, expiry_date: '2030-08-05', received_date: '2026-10-05', days_remaining: 1399, held: 0, hold_reasons: null, ...o,
});

console.log('\nInventory packing');
test('every field round-trips, per line, in order', () => {
  const lines = [line({}), line({ bin_code: 'CF39A02', zone: 'CF', rack: '39', level: 'A', quantity: 3, held: 1, hold_reasons: 'QC' }),
    line({ sku: '550044709', description: 'Advance 4T', uom: null, upp: null, item_abc: null, expiry_date: null, received_date: null, days_remaining: null }),
    line({ bin_code: 'STAGING', zone: 'STAGING', rack: null, level: null, bin_status: 'blocked', batch_lot: '' })];
  assert.deepEqual(unpackLines(packLines(lines)), lines);
});
test('a SKU and a bin are sent once, however many lines use them', () => {
  const lines = Array.from({ length: 50 }, (_, i) => line({ batch_lot: `B${i}` }));
  const p = packLines(lines);
  assert.equal(Object.keys(p.items).length, 1);
  assert.equal(Object.keys(p.bins).length, 1);
  assert.equal(p.rows.length, 50);
});
test('packed JSON is well under half the size of the plain lines', () => {
  const lines = Array.from({ length: 1800 }, (_, i) => line({ bin_code: `C${String.fromCharCode(65 + (i % 6))}${String(i % 40).padStart(2, '0')}A01`, sku: `5500${i % 106}`, batch_lot: `B${i}` }));
  const plain = JSON.stringify(lines).length, packed = JSON.stringify(packLines(lines)).length;
  assert.ok(packed < plain * 0.5, `packed ${packed} vs plain ${plain}`);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
