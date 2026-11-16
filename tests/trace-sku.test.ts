/** Lacak batch → Daftar batch per SKU (lib/trace-sku.ts): reading a pasted request, batches per material, the reply sheets. */
import { strict as assert } from 'node:assert';
import {
  buildSkuReport, parseQty, parseSkuRequest, skuReplyRows, skuReplyTsv, skuReportSheets, skuReportTotals,
  type SkuItem, type SkuStock,
} from '../lib/trace-sku';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

// An e-mail table pasted from Outlook: one cell per line, blank lines and padding between.
const EMAIL = [
  'Dear Pak Ismail & Pak Somad,', '',
  'Mohon dikirimkan data batch number, production dan expired date dari produk berikut :', '',
  'Material', '    ', '', 'Product', '    ', '', 'Family', '    ', '', 'Stock I003', '',
  '550058593', '    ', '', 'Adv4TAX515W40SLMA2_12*0.8L_A04W', '    ', '', 'Advance', '    ', '', '                             3,474', '',
  '550044709', '    ', '', 'Adv4TAX5Sc10W30SLMB_12*0.8L_A04W', '    ', '', 'Advance', '    ', '', '                             7,854', '',
  '550044635', '    ', '', 'Rimula R2 40 CF_12*1L_A04W', '    ', '', 'Rimula', '    ', '', '                                    42', '',
  '550025058', '    ', '', 'Spirax S2 G 90_4*4L_A04W', '    ', '', 'Spirax', '    ', '', '                                      5 ', '',
  'Terima kasih,', 'Budi', '081234567890',
].join('\n');

const stock = (over: Partial<SkuStock> = {}): SkuStock => ({
  bin_code: 'CA10A02', zone: 'CA', sku: '550058593', description: 'Advance AX5 15W-40 12x0.8L', uom: 'CAR',
  batch_lot: '14H26JJ', quantity: 40, expiry_date: '2030-08-14', days_remaining: 1367, held: 0, ...over,
});
const ITEMS: SkuItem[] = [
  { sku: '550058593', description: 'Advance AX5 15W-40 12x0.8L', uom: 'CAR', shelf_life_months: null },
  { sku: '550044709', description: 'Advance AX5 Sc 10W-30 12x0.8L', uom: 'CAR', shelf_life_months: 60 },
  { sku: '550044635', description: 'Rimula R2 40 12x1L', uom: 'CAR', shelf_life_months: null },
];

console.log('\nDaftar batch per SKU');

test('quantities: thousands separators either way, plain and decimal numbers', () => {
  assert.equal(parseQty('3,474'), 3474); assert.equal(parseQty('3.474'), 3474); assert.equal(parseQty('1,234,567'), 1234567);
  assert.equal(parseQty('42'), 42); assert.equal(parseQty('12.5'), 12.5); assert.equal(parseQty('12,5'), 12.5);
  assert.equal(parseQty('Advance'), null); assert.equal(parseQty('12*1L'), null);
});

test('an e-mail table: material, product name and Stock I003, in the order written', () => {
  assert.deepEqual(parseSkuRequest(EMAIL), [
    { sku: '550058593', name: 'Adv4TAX515W40SLMA2_12*0.8L_A04W', sap: 3474 },
    { sku: '550044709', name: 'Adv4TAX5Sc10W30SLMB_12*0.8L_A04W', sap: 7854 },
    { sku: '550044635', name: 'Rimula R2 40 CF_12*1L_A04W', sap: 42 },
    // the phone number in the signature is not this material's stock
    { sku: '550025058', name: 'Spirax S2 G 90_4*4L_A04W', sap: 5 },
  ]);
});

test('rows copied from Excel (tabs), a bare list, and a sentence all read the same way', () => {
  assert.deepEqual(parseSkuRequest('550058593\tAdv 0.8L\tAdvance\t3474\n550058592\tAdv 1L\tAdvance\t3,595'), [
    { sku: '550058593', name: 'Adv 0.8L', sap: 3474 }, { sku: '550058592', name: 'Adv 1L', sap: 3595 }]);
  assert.deepEqual(parseSkuRequest('550058593\n550058592\n550058593').map((x) => x.sku), ['550058593', '550058592']);
  assert.deepEqual(parseSkuRequest('tolong cek 550058593, 550058592 dan 550077345').map((x) => [x.sku, x.sap]),
    [['550058593', null], ['550058592', null], ['550077345', null]]);
  assert.deepEqual(parseSkuRequest('tidak ada nomor, hanya 12345 dan 1234567890'), []);
});

const STOCK = [
  stock(), stock({ bin_code: 'CB03B01', quantity: 12 }),
  stock({ batch_lot: '02K26JJ', expiry_date: '2030-11-02', bin_code: 'CA02A01', quantity: 30, held: 4 }),
  stock({ sku: '550044709', batch_lot: '12658123', expiry_date: '2031-03-10', bin_code: 'CC01A01', quantity: 100 }),
  stock({ sku: '550044709', batch_lot: '14H26JJ', expiry_date: '1930-08-14', days_remaining: -35000, bin_code: 'QUARANTINE', zone: 'QUARANTINE', quantity: 6 }),
  stock({ sku: '550044709', batch_lot: '', expiry_date: null, days_remaining: null, bin_code: 'STAGING', zone: 'STAGING', quantity: 2 }),
  stock({ sku: '550058593', batch_lot: 'ZERO', quantity: 0 }),
  stock({ sku: '559999999', quantity: 999 }), // not asked for
];

test('batches per material: earliest expiry first, bins summed, one line per batch + expiry', () => {
  const rows = buildSkuReport(parseSkuRequest(EMAIL), STOCK, ITEMS, 48);
  assert.deepEqual(rows.map((r) => r.sku), ['550058593', '550044709', '550044635', '550025058']);
  const a = rows[0];
  assert.equal(a.wms, 82); assert.equal(a.sap, 3474); assert.equal(a.diff, -3392);
  assert.deepEqual(a.batches.map((b) => [b.batch, b.expiry, b.qty]), [['14H26JJ', '2030-08-14', 52], ['02K26JJ', '2030-11-02', 30]]);
  assert.deepEqual(a.batches[0].bins, [{ code: 'CA10A02', qty: 40 }, { code: 'CB03B01', qty: 12 }]);
  assert.equal(a.batches[1].held, 4);
});

test('production date: from the batch code, else expiry minus the item shelf life; mismatches are named', () => {
  const rows = buildSkuReport(parseSkuRequest(EMAIL), STOCK, ITEMS, 48);
  assert.equal(rows[0].batches[0].mfg, '2026-08-14'); assert.equal(rows[0].batches[0].mfgSource, 'batch'); assert.equal(rows[0].batches[0].note, null);
  const b = rows[1].batches;
  assert.deepEqual(b.map((x) => x.batch), ['14H26JJ', '12658123', '']); // 1930 first, no date last
  // SAP lot number, 60-month item: 10 Mar 2031 - 60 months
  assert.equal(b[1].mfg, '2026-03-10'); assert.equal(b[1].mfgSource, 'shelf_life');
  // date-coded batch with a 1930 expiry: production from the code, expiry flagged (60 months -> 14 Aug 2031)
  assert.equal(b[0].mfg, '2026-08-14'); assert.match(b[0].note ?? '', /2031-08-14 \(tahun salah\)/);
  assert.equal(b[0].held, 6); // quarantine
  assert.equal(b[2].mfg, null); assert.equal(b[2].mfgSource, null);
});

test('a material with nothing on hand, and one the item master does not know, still get a row', () => {
  const rows = buildSkuReport(parseSkuRequest(EMAIL), STOCK, ITEMS, 48);
  assert.equal(rows[2].wms, 0); assert.equal(rows[2].known, true); assert.equal(rows[2].diff, -42); assert.deepEqual(rows[2].batches, []);
  assert.equal(rows[3].known, false); assert.equal(rows[3].description, null);
  assert.deepEqual(skuReportTotals(rows), { skus: 4, withStock: 2, unknown: 1, batches: 5, wms: 190, sap: 11375, diff: 190 - 11375, differing: 4 });
});

test('a request without stock figures is not compared', () => {
  const rows = buildSkuReport(parseSkuRequest('550058593\n550044635'), STOCK, ITEMS, 48);
  assert.equal(rows[0].diff, null);
  const t = skuReportTotals(rows);
  assert.equal(t.sap, null); assert.equal(t.diff, null); assert.equal(t.differing, 0);
});

test('the reply: one line per material + batch, nothing asked is missing, three sheets', () => {
  const rows = buildSkuReport(parseSkuRequest(EMAIL), STOCK, ITEMS, 48);
  const reply = skuReplyRows(rows);
  assert.equal(reply.length, 2 + 3 + 1 + 1);
  assert.deepEqual(reply[0], { Material: '550058593', Product: 'Adv4TAX515W40SLMA2_12*0.8L_A04W', 'Batch number': '14H26JJ', 'Production date': '2026-08-14',
    'Expired date': '2030-08-14', Qty: 52, UOM: 'CAR', 'Stock (permintaan)': 3474, 'Stock WMS': 82, Keterangan: '' });
  assert.equal(reply[1].Keterangan, '4 ditahan / karantina');
  assert.match(String(reply[3].Keterangan), /Tgl produksi dihitung dari expired − umur simpan/);
  assert.match(String(reply[4].Keterangan), /Batch tidak tercatat; Expired tidak tercatat/);
  assert.equal(reply[5].Keterangan, 'Tidak ada stok di gudang'); assert.equal(reply[5].Qty, 0);
  assert.equal(reply[6].Keterangan, 'Material tidak ada di master item');
  const sheets = skuReportSheets(rows);
  assert.deepEqual(Object.keys(sheets), ['Batch per material', 'Ringkasan', 'Per bin']);
  assert.equal(sheets.Ringkasan.length, 4); assert.equal(sheets.Ringkasan[0].Selisih, -3392); assert.equal(sheets.Ringkasan[0]['Expired terdekat'], '2030-08-14');
  assert.equal(sheets['Per bin'].length, 6);
  const tsv = skuReplyTsv(rows).split('\n');
  assert.equal(tsv[0], 'Material\tProduct\tBatch number\tProduction date\tExpired date\tQty');
  assert.equal(tsv[1], '550058593\tAdv4TAX515W40SLMA2_12*0.8L_A04W\t14H26JJ\t2026-08-14\t2030-08-14\t52');
  assert.equal(tsv.length, 8);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
