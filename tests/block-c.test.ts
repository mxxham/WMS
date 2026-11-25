// Block C floor storage (0147): slot codes, stack heights, and auto putaway into a SKU's dedicated slots.
import { strict as assert } from 'node:assert';
import { parseBinCode, palletsPerSlot, POSITIONS_PER_SLOT } from '../config/warehouse';
import { planPutaway } from '../lib/inbound/putaway-plan';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

test('FA-01 / FB-20 are floor slots, with lane as zone and slot as position', () => {
  assert.deepEqual(parseBinCode('fa-01'), { code: 'FA-01', kind: 'floor', zone: 'FA', rack: null, level: null, position: '01' });
  assert.equal(parseBinCode('FB-20')?.zone, 'FB');
  assert.equal(parseBinCode('FA-1'), null);
  assert.equal(parseBinCode('CA01C01')?.kind, 'rack');
  assert.equal(parseBinCode('STG_01')?.zone, 'STAGING');
});

test('slot capacity: 14 positions x stack height (drum 3, carton / IBC / fluid bag / the rest 2); 40 slots = 560 positions', () => {
  assert.equal(palletsPerSlot('Drum'), 42);
  assert.equal(palletsPerSlot('Carton'), 28);
  for (const p of ['IBC', 'Fluidbag', 'Pail', null, undefined]) assert.equal(palletsPerSlot(p as string | null), 28);
  assert.equal(40 * POSITIONS_PER_SLOT, 560);
});

const line = (sku: string, quantity: number) => ({ line: 1, sku, uom: 'CAR', description: 'x', quantity, upp: 50 });

test('a Block C SKU fills its own slots in order and never goes to a rack', () => {
  const r = planPutaway({
    lines: [line('S1', 220)], // 4 full pallets + 1 partial = 5 pallets
    emptyBins: ['CA01B01', 'CA01B02', 'CA01C01', 'CA01C02', 'CA01D01'], pickfaces: new Map(),
    blockC: { S1: [{ bin: 'FA-01', free: 3 }, { bin: 'FA-02', free: 2 }] },
  });
  assert.deepEqual(r.pallets.map((p) => p.bin), ['FA-01', 'FA-01', 'FA-01', 'FA-02', 'FA-02']);
  assert.equal(r.pallets.filter((p) => p.quantity === 20).length, 1); // the partial pallet also takes a place
});

test('when every slot is full the pallet gets no bin and a reason, not a rack', () => {
  const r = planPutaway({
    lines: [line('S1', 150)], emptyBins: ['CA01B01', 'CA01B02', 'CA01C01'], pickfaces: new Map(),
    blockC: { S1: [{ bin: 'FA-01', free: 2 }] },
  });
  assert.deepEqual(r.pallets.map((p) => p.bin), ['FA-01', 'FA-01', null]);
  assert.match(r.pallets[2].why ?? '', /slot Block C .* penuh/);
});

test('other SKUs still go to racks and never to a Block C slot', () => {
  const r = planPutaway({
    lines: [line('S2', 50)], emptyBins: ['CA01B01'], pickfaces: new Map(),
    blockC: { S1: [{ bin: 'FA-01', free: 3 }] },
  });
  assert.equal(r.pallets[0].bin, 'CA01B01');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
