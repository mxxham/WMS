/** Excel rows of the putaway audit (lib/putaway-audit-export.ts). */
import { strict as assert } from 'node:assert';
import { putawayWorkbookRows, type PutawayExport } from '../lib/putaway-audit-export';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPutaway audit export');

const row = (o: Partial<PutawayExport>): PutawayExport => ({
  movement_id: 'm1', created_at: '2026-09-29T02:00:00Z', by: 'Budi', type: 'putaway', from_bin: 'STAGING', to_bin: 'CD03E01',
  sku: '550048593', description: 'Helix', uom: 'CAR', batch_lot: '17I26JJ', expiry_date: '2030-09-17', quantity: 48, audit: null, ...o,
});

test('rows sorted by bin, wrong SKU and difference shown', () => {
  const { putaway } = putawayWorkbookRows([
    row({ movement_id: 'm2', to_bin: 'CD05B01' }),
    row({ audit: { result: 'MISMATCH', counted: 46, foundSku: '550069888', foundBatch: '17I26JJ', checker: 'Sari', note: 'isi lain', at: '2026-09-29T05:00:00Z', attempts: 1 } }),
  ], []);
  assert.deepEqual(putaway.map((r) => r.Bin), ['CD03E01', 'CD05B01']);
  assert.equal(putaway[0]['SKU ditemukan'], '550069888');
  assert.equal(putaway[0].Selisih, -2);
  assert.equal(putaway[1].Status, 'Belum diaudit');
});

test('history keeps the earlier audit and the latest, oldest first', () => {
  const { history } = putawayWorkbookRows(
    [row({ audit: { result: 'OK', counted: 48, foundSku: '550048593', foundBatch: '17I26JJ', checker: 'Sari', note: 'ubah: salah klik', at: '2026-09-29T06:00:00Z', attempts: 2 } })],
    [{ movement_id: 'm1', entries: [{ result: 'MISMATCH', counted_qty: 40, found_sku: '550048593', found_batch: '17I26JJ', checker_name: 'Sari', note: 'x', audited_at: '2026-09-29T05:00:00Z' }] }]);
  assert.deepEqual(history.map((h) => [h.Hasil, h.Keterangan]), [['Selisih', 'diganti audit berikutnya'], ['OK', 'terakhir']]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
