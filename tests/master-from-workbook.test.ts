/** New SKUs read from the WMS file's master sheets (lib/master-from-workbook.ts). */
import { strict as assert } from 'node:assert';
import * as XLSX from 'xlsx';
import { allMasterSkus, masterFromWorkbook } from '../lib/master-from-workbook';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nMaster data from the WMS file');

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Material', 'Material Description', 'Storage Location', 'Batch', 'UPP', 'VOLUME'],
  [550027044, 'Gadus S3 V220C 3_1*18kg_A227', 'WHS1', 'UT', 24, 18],
]), 'MASTER DATA');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  [null, null, null], ['Material Type', 'Material', 'Material Description', 'Base Unit of Measure', 'Gross Weight', 'Weight Unit', 'Volume', 'Volume Unit', 'Pallet'],
  ['YPAC', 550027044, 'Gadus S3 V220C 3_1*18kg_A227', 'EA', 19.8, 'KG', 18, 'L15', 24],
  ['YPAC', 550099999, 'Only in Master SKU', 'CAR', 5, 'KG', 12, 'L15', 48],
]), 'Master SKU');

test('550027044 from both sheets: description, EA, UPP 24, 18 L', () => {
  assert.deepEqual(masterFromWorkbook(wb, ['550027044']),
    [{ sku: '550027044', description: 'Gadus S3 V220C 3_1*18kg_A227', uom: 'EA', upp: 24, volume_l: 18 }]);
});
test('only in Master SKU: pallet size used as UPP', () => {
  assert.deepEqual(masterFromWorkbook(wb, ['550099999']),
    [{ sku: '550099999', description: 'Only in Master SKU', uom: 'CAR', upp: 48, volume_l: 12 }]);
});
test('a SKU in neither sheet is left out', () => {
  assert.deepEqual(masterFromWorkbook(wb, ['550000000']), []);
});

test('all SKUs of both master sheets, once each', () => {
  assert.deepEqual(allMasterSkus(wb), ['550027044', '550099999']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
