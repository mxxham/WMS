/**
 * Wave creation keys off the shipment number: each shipment is its own wave
 * (lib/allocator/wave-numbers.ts). The NO column no longer merges shipments.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { assignWaves } from '../lib/allocator/wave-numbers';
import { loadWorkbookFromBuffer } from '../lib/allocator/browser/browser-input';
import { withConfig } from '../lib/allocator/config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

console.log('\nWave numbers from Schedule of the day');

test('each shipment becomes its own wave, regardless of the NO column', () => {
  const { waveByShipment, warnings } = assignWaves([
    { shipment: '109704727', no: '13' }, { shipment: '109704727', no: '' },
    { shipment: '109704770', no: '15' }, { shipment: '109704770', no: '' }, { shipment: '109704770', no: '' },
    { shipment: '109702466', no: '' }, { shipment: '109702466', no: '' },
  ]);
  assert.equal(waveByShipment.get('109704727'), '109704727');
  assert.equal(waveByShipment.get('109704770'), '109704770');
  assert.equal(waveByShipment.get('109702466'), '109702466');
  assert.equal(warnings.length, 0);
});

test('a shipment with a NO typed on a later row still uses the shipment number', () => {
  const { waveByShipment, warnings } = assignWaves([{ shipment: 'A', no: '' }, { shipment: 'A', no: '4' }]);
  assert.equal(waveByShipment.get('A'), 'A');
  assert.equal(warnings.length, 0);
});

test('two shipments are never merged, even with the same NO', () => {
  const { waveByShipment } = assignWaves([{ shipment: 'A', no: '1' }, { shipment: 'B', no: '1' }]);
  assert.equal(waveByShipment.get('A'), 'A');
  assert.equal(waveByShipment.get('B'), 'B');
});

test('15 Sep workbook: every shipment becomes its own wave', () => {
  const buf = readFileSync('data/Warehouse_Management_System_15_September_2026_.xlsx');
  const wb = loadWorkbookFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), withConfig({ asOf: new Date('2026-09-15T00:00:00Z') }));
  const byWave = new Map<string, Set<string>>();
  for (const d of wb.demand) byWave.set(d.waveNo, (byWave.get(d.waveNo) ?? new Set()).add(d.shipmentNumber));
  for (const [wave, ships] of byWave) assert.equal(ships.size, 1, `wave ${wave} holds ${ships.size} shipments`);
  assert.equal(wb.warnings.filter((w: any) => w.code === 'SHIPMENT_WITHOUT_NO').length, 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
