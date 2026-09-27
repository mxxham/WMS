/**
 * Bin To Bin and Sisa must always tell the same story, however many orders
 * run at once. Each real workbook's stock is run against every mix of the
 * three days' orders (up to 38 shipments); tests/helpers/picklist-invariants.ts
 * replays every printed row against the bin it picks from.
 */
import { readFileSync } from 'node:fs';
import { withConfig } from '../lib/allocator/config';
import { loadWorkbookFromBuffer } from '../lib/allocator/browser/browser-input';
import { runPipeline } from '../lib/allocator/pipeline';
import { checkPicklistRun } from './helpers/picklist-invariants';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nBin To Bin / Sisa consistency (real workbooks, mixed order loads)');

const days = [['15', '2026-09-15'], ['18', '2026-09-18'], ['24', '2026-09-24']].map(([day, date]) => {
  const buf = readFileSync(`data/Warehouse_Management_System_${day}_September_2026_.xlsx`);
  const config = withConfig({ asOf: new Date(`${date}T00:00:00Z`) });
  return { day, config, wb: loadWorkbookFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), config) };
});

for (const S of days) {
  for (let mask = 1; mask < 8; mask++) {
    const mix = days.filter((_, i) => (mask >> i) & 1);
    // Other days' wave NOs are prefixed so they don't merge into this day's waves.
    const demand = mix.flatMap((D) => D.wb.demand.map((d) => (D === S ? d : { ...d, waveNo: `${D.day}-${d.waveNo}` })));
    const shipments = new Set(demand.map((d) => d.shipmentNumber)).size;
    test(`stock ${S.day} Sep, orders ${mix.map((D) => D.day).join('+')} Sep (${shipments} shipments)`, () => {
      checkPicklistRun(runPipeline(S.wb.stock, demand, S.wb.stagedBySku, S.config, []), S.wb.stock, demand, S.config, S.wb.stagedBySku);
    });
  }
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
