/**
 * NO per shipment on Schedule of the day (lib/allocator/wave-numbers.ts):
 * filled down within a shipment, never into the next shipment (6 Oct:
 * 109702466 had no NO and was planned inside NO 15).
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

test('6 Oct: a shipment without NO below NO 15 becomes its own wave (16), with a warning', () => {
  const { waveByShipment, warnings } = assignWaves([
    { shipment: '109704727', no: '13' }, { shipment: '109704727', no: '' },
    { shipment: '109704770', no: '15' }, { shipment: '109704770', no: '' }, { shipment: '109704770', no: '' },
    { shipment: '109702466', no: '' }, { shipment: '109702466', no: '' },
  ]);
  assert.equal(waveByShipment.get('109704770'), '15');
  assert.equal(waveByShipment.get('109702466'), '16');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'SHIPMENT_WITHOUT_NO');
  assert.ok(warnings[0].message.includes('109702466') && warnings[0].message.includes('NO 16'));
});

test('a NO typed on a later row of the same shipment still counts for that shipment', () => {
  const { waveByShipment, warnings } = assignWaves([{ shipment: 'A', no: '' }, { shipment: 'A', no: '4' }]);
  assert.equal(waveByShipment.get('A'), '4');
  assert.equal(warnings.length, 0);
});

test('two shipments given the same NO on purpose stay one wave', () => {
  const { waveByShipment } = assignWaves([{ shipment: 'A', no: '1' }, { shipment: 'B', no: '1' }]);
  assert.equal(waveByShipment.get('A'), '1');
  assert.equal(waveByShipment.get('B'), '1');
});

test('15 Sep workbook: NO 1, 5 and 6 keep their two shipments each (each typed its own NO); nothing unnumbered', () => {
  const buf = readFileSync('data/Warehouse_Management_System_15_September_2026_.xlsx');
  const wb = loadWorkbookFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), withConfig({ asOf: new Date('2026-09-15T00:00:00Z') }));
  const byWave = new Map<string, Set<string>>();
  for (const d of wb.demand) byWave.set(d.waveNo, (byWave.get(d.waveNo) ?? new Set()).add(d.shipmentNumber));
  for (const no of ['1', '5', '6']) assert.equal(byWave.get(no)?.size, 2, `NO ${no}`);
  assert.equal(wb.warnings.filter((w) => w.code === 'SHIPMENT_WITHOUT_NO').length, 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
