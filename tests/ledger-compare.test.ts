/** Buku stok: SAP book against WMS book per day (lib/ledger/compare.ts). */
import { strict as assert } from 'node:assert';
import type { SapBookLine } from '../lib/ledger/sap-book';
import { chainBreaks, compareDay, ledgerSheetRows, type LedgerNote, type WmsBookLine } from '../lib/ledger/compare';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const D = '2026-10-27';
const sap = (sku: string, o: Partial<SapBookLine> = {}): SapBookLine => ({
  sku, description: `d${sku}`, uom: 'CAR', awal_unrest: 0, awal_block: 0, inbound: 0, outbound: 0, mv343: 0, mv344: 0, z55: 0,
  other_unrest: 0, other_by_type: {}, akhir_unrest: 0, akhir_block: 0, inbd: 0, ...o,
});
const wms = (sku: string, o: Partial<WmsBookLine> = {}): WmsBookLine => ({
  sku, description: `d${sku}`, uom: 'CAR', awal_unrest: 0, awal_block: 0, inbound: 0, inbound_block: 0, inbound_assumed: 0,
  outbound: 0, q_in: 0, q_out: 0, other_unrest: 0, other_block: 0, akhir_unrest: 0, akhir_block: 0, ...o,
});
const vol = (o: Record<string, number | null> = {}) => new Map(Object.entries(o));
const note = (o: Partial<LedgerNote>): LedgerNote => ({ id: 'n', sku: 'A', from_date: D, note: 'kurang 1', closed: false, by_name: 'Sari', created_at: '2026-10-27T10:00:00Z', ...o });

console.log('\nBuku stok: compare');

test('a SKU in SAP only and one in WMS only both get a line', () => {
  const r = compareDay([sap('A', { awal_unrest: 5, akhir_unrest: 5 })], [wms('B', { awal_unrest: 3, akhir_unrest: 3 })], vol(), [], D);
  assert.deepEqual(r.lines.map((l) => [l.sku, l.diff_unrest]), [['A', -5], ['B', 3]]);
  assert.equal(r.lines[0].wms, null);
  assert.equal(r.summary.accuracy, 0);
});

test('match needs unrestricted and blocked equal', () => {
  const r = compareDay([sap('A', { akhir_unrest: 5, akhir_block: 1 })], [wms('A', { awal_unrest: 5, akhir_unrest: 5 })], vol(), [], D);
  assert.equal(r.lines[0].match, false);
  assert.equal(r.lines[0].diff_block, -1);
});

const three = compareDay(
  [sap('A', { akhir_unrest: 5 }), sap('B', { akhir_unrest: 2 }), sap('C', { akhir_unrest: 1 })],
  [wms('A', { awal_unrest: 5, akhir_unrest: 5 }), wms('B', { awal_unrest: 2, akhir_unrest: 2 }), wms('C', { awal_unrest: 4, akhir_unrest: 4 })],
  vol({ A: 9.6, B: null }), [], D);

test('accuracy = matching / SKUs, 2 decimals', () => {
  assert.equal(three.summary.matching, 2);
  assert.equal(three.summary.differing, 1);
  assert.equal(three.summary.accuracy, 66.67);
  assert.equal(three.summary.absDiff, 3);
});

test('a SKU with no stock at the end in either book is shown but not counted in accuracy', () => {
  const r = compareDay([sap('A', { akhir_unrest: 5 }), sap('I', { inbd: 880 })], [wms('A', { awal_unrest: 4, akhir_unrest: 4 })], vol(), [], D);
  assert.equal(r.lines.length, 2);
  assert.deepEqual([r.summary.skus, r.summary.matching, r.summary.accuracy], [1, 0, 0]);
});

test('accuracy by quantity: 1 - difference / SAP total, also per unrestricted and blocked', () => {
  // the 28 Oct case in small: unrestricted equal, 18 blocked in SAP only
  const r = compareDay(
    [sap('A', { akhir_unrest: 59477 - 99, akhir_block: 15 }), sap('B', { akhir_unrest: 99, akhir_block: 3 })],
    [wms('A', { awal_unrest: 59477 - 99, akhir_unrest: 59477 - 99 }), wms('B', { awal_unrest: 99, akhir_unrest: 99 })], vol(), [], D);
  assert.equal(r.summary.qtyAccuracy, 99.97);
  assert.equal(r.summary.qtyAccuracyUnrest, 100);
  assert.equal(r.summary.qtyAccuracyBlock, 0);
  assert.equal(r.summary.accuracy, 0, 'by SKU both differ');
});

test('quantity accuracy never goes below 0, and is null without SAP stock', () => {
  const r = compareDay([sap('A', { akhir_unrest: 2 })], [wms('A', { awal_unrest: 10, akhir_unrest: 10 })], vol(), [], D);
  assert.equal(r.summary.qtyAccuracy, 0);
  const none = compareDay([], [wms('A', { awal_unrest: 3, akhir_unrest: 3 })], vol(), [], D);
  assert.equal(none.summary.qtyAccuracy, null);
  assert.equal(none.summary.qtyAccuracyBlock, null, 'no blocked stock on either side: nothing to score');
});

test('no SKU at all: accuracy null, not 100', () => assert.equal(compareDay([], [], vol(), [], D).summary.accuracy, null));

test('litres use volume_l; a SKU without volume is listed, not counted as 0', () => {
  assert.deepEqual(three.summary.missingVolume, ['B', 'C']);
  assert.equal(three.summary.sap.litres.akhir_unrest, 48);
  assert.equal(three.summary.sap.akhir_unrest, 8);
  assert.equal(three.lines.find((l) => l.sku === 'B')!.volume_l, null);
});

test('a note shows on its date and later days while the SKU differs', () => {
  const differ = [sap('A', { akhir_unrest: 5 })], wDiff = [wms('A', { awal_unrest: 4, akhir_unrest: 4 })];
  const same = [wms('A', { awal_unrest: 5, akhir_unrest: 5 })];
  assert.equal(compareDay(differ, wDiff, vol(), [note({})], D).lines[0].note?.note, 'kurang 1');
  assert.equal(compareDay(differ, wDiff, vol(), [note({})], '2026-10-29').lines[0].note?.note, 'kurang 1', 'carried forward');
  assert.equal(compareDay(differ, same, vol(), [note({})], '2026-10-29').lines[0].note, null, 'gone once it matches');
  assert.equal(compareDay(differ, same, vol(), [note({})], D).lines[0].note?.note, 'kurang 1', 'kept on its own date');
  assert.equal(compareDay(differ, wDiff, vol(), [note({})], '2026-10-26').lines[0].note, null, 'not before its date');
});

test('a closed note hides the earlier one; the latest row wins', () => {
  const ns = [note({ id: '1' }), note({ id: '2', from_date: '2026-10-28', closed: true, note: '', created_at: '2026-10-28T10:00:00Z' })];
  const r = (d: string) => compareDay([sap('A', { akhir_unrest: 5 })], [wms('A', { awal_unrest: 4, akhir_unrest: 4 })], vol(), ns, d).lines[0].note;
  assert.equal(r('2026-10-27')?.id, '1');
  assert.equal(r('2026-10-29'), null);
});

test('chainBreaks lists SKUs whose awal is not the previous day akhir', () => {
  assert.deepEqual(chainBreaks([sap('A', { awal_unrest: 9 }), sap('B', { awal_unrest: 5 })], [sap('A', { akhir_unrest: 9 }), sap('B', { akhir_unrest: 4 })]), ['B']);
  assert.deepEqual(chainBreaks([sap('A', { awal_unrest: 9 })], null), [], 'no previous day: nothing to check');
  assert.deepEqual(chainBreaks([sap('A', { awal_block: 1 })], [sap('A', {})]), ['A'], 'blocked counts too');
  assert.deepEqual(chainBreaks([], [sap('A', { akhir_unrest: 2 })]), ['A'], 'a SKU gone from today');
});

test('a broken WMS identity is flagged, a quarantine receipt is not', () => {
  assert.equal(compareDay([], [wms('A', { awal_unrest: 1, akhir_unrest: 5 })], vol(), [], D).lines[0].wms_identity_ok, false);
  const q = wms('A', { awal_unrest: 10, inbound: 3, inbound_block: 1, outbound: 2, q_in: 1, akhir_unrest: 9, akhir_block: 2 });
  assert.equal(compareDay([], [q], vol(), [], D).lines[0].wms_identity_ok, true);
});

test('assumed inbound is totalled for the warning', () =>
  assert.equal(compareDay([], [wms('A', { inbound: 7, inbound_assumed: 7, akhir_unrest: 7 })], vol(), [], D).summary.inboundAssumed, 7));

test('sheet rows keep the BOOK TO BOOK order', () => {
  const rows = ledgerSheetRows(three.lines);
  assert.deepEqual(Object.keys(rows[0]), ['Material', 'Material Description', 'UOM', 'SAP Unrest Awal', 'SAP Block Awal', 'SAP Inbound',
    'SAP Outbound', 'SAP Unrest Akhir', 'SAP Block Akhir', 'WMS Unrest Awal', 'WMS Block Awal', 'WMS Inbound', 'WMS Outbound',
    'WMS Unrest Akhir', 'WMS Block Akhir', 'Selisih Unrest', 'Selisih Block', '344 Release to Block', '343 Block to Release', 'Z55 Write Off', 'Karantina masuk', 'Karantina keluar',
    'Lain-lain SAP', 'Lain-lain WMS', 'INBD', 'Volume (L)', 'Selisih Unrest (L)', 'Selisih Block (L)', 'Catatan']);
  assert.equal(rows[2]['Selisih Unrest'], 3);
  assert.equal(rows[2]['Selisih Unrest (L)'], null, 'no volume: litres left empty');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
