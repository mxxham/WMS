/** Picking audit from the WMS file (lib/sheet-picklist.ts). */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { kOneLines, mergeLines, scheduleMeta, skuBatches, stagedLines, withBinRemaining, type SheetPickLine } from '../lib/sheet-picklist';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPicklist from the WMS file');

const HEAD = ['Picklist', 'NO (Wave)', 'Shipments', 'DO Number', 'Seq', 'Lokasi', 'Chk', 'Material', 'Description', 'Ke Lokasi',
  'Batch', 'Exp Date', 'Qty Pick', 'UOM', 'Pick Type', 'Sisa di Bin'];
function book(rows: unknown[][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'K_ONE');
  // Round-trip like an uploaded file, dates included.
  return XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true });
}

test('reads K_ONE rows below a header that is not on row 1', () => {
  const lines = kOneLines(book([
    [null, null, null, ' '],
    HEAD,
    ['PL-1', 1, 109693263, 'DO1', 1, 'cd40a02', null, 550024918, 'Spirax', 'STG', '12600813', new Date(Date.UTC(2030, 0, 10)), 2, 'EA', 'CASE', 6],
  ]));
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    picklist: 'PL-1', wave_no: '1', shipment_number: '109693263', seq: 1, bin_code: 'CD40A02', sku: '550024918',
    description: 'Spirax', uom: 'EA', batch: '12600813', expiry: '2030-01-10', qty: 2, picker_name: null, bin_remaining: 6,
    do_nos: ['DO1'],
    destination: '', ship_to_location: '',
  });
});

test('skips empty, #N/A and zero-quantity rows', () => {
  const lines = kOneLines(book([
    HEAD,
    [null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, '#N/A', null, 2, 'CA01A01', null, '#N/A', null, null, null, null, 3],
    ['PL', 1, 'S1', null, 3, 'CA01A01', null, 550044709, 'x', null, 'A7', null, 0],
  ]));
  assert.equal(lines.length, 0);
});

test('an empty K_ONE (header only) or a missing sheet gives no lines', () => {
  assert.equal(kOneLines(book([HEAD])).length, 0);
  assert.equal(kOneLines(XLSX.utils.book_new()).length, 0);
});

test('same shipment + bin + SKU + batch is one line, quantities added', () => {
  const l = (o: Partial<SheetPickLine>): SheetPickLine => ({
    picklist: null, wave_no: null, shipment_number: 'S1', seq: 1, bin_code: 'CA01A01', sku: '1', description: '', uom: null,
    batch: 'A7', expiry: null, qty: 1, picker_name: null, do_nos: [], bin_remaining: null, ...o,
  });
  const out = mergeLines([l({ seq: 4, qty: 2 }), l({ seq: 2, qty: 3, batch: ' a7' }), l({ batch: 'B8' })]);
  assert.equal(out.length, 2);
  assert.equal(out[0].qty, 5);
  assert.equal(out[0].seq, 2);
});

test('the DOs of merged lines are the union, first-seen order, no repeats', () => {
  const l = (o: Partial<SheetPickLine>): SheetPickLine => ({
    picklist: null, wave_no: null, shipment_number: 'S1', seq: 1, bin_code: 'CA01A01', sku: '1', description: '', uom: null,
    batch: 'A7', expiry: null, qty: 1, picker_name: null, do_nos: [], bin_remaining: null, ...o,
  });
  const out = mergeLines([l({ do_nos: ['538306981', ' 538045290 '] }), l({ do_nos: ['538045290', '538259123', ''] })]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].do_nos, ['538306981', '538045290', '538259123']);
});

// 0123: ship-to party and city are shipment-level; a merged line keeps the first one named.
test('merged lines keep the first non-empty destination and ship-to city', () => {
  const l = (o: Partial<SheetPickLine>): SheetPickLine => ({
    picklist: null, wave_no: null, shipment_number: 'S1', seq: 1, bin_code: 'CA01A01', sku: '1', description: '', uom: null,
    batch: 'A7', expiry: null, qty: 1, picker_name: null, do_nos: [], bin_remaining: null, ...o,
  });
  const out = mergeLines([l({ destination: '', ship_to_location: 'GRESIK' }), l({ destination: 'PT XYZ', ship_to_location: '' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].destination, 'PT XYZ');
  assert.equal(out[0].ship_to_location, 'GRESIK');
});

test('short lines already at staging: STAGING bin, batch from the WMS sheet (earliest expiry)', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [null], [null], [null],
    ['xxx', 'Lokasi', 'Batch', 'Expired Date', 'item', 'Remain Qty'],
    ['a', 'CD26A02', '12663924', new Date(Date.UTC(2030, 5, 22)), 550056224, 0],
    ['b', 'CE03A02', 12663924, new Date(Date.UTC(2030, 5, 22)), 550056224, 0],
    ['c', 'CA01A01', 'LATE', new Date(Date.UTC(2031, 0, 1)), 550056224, 4],
  ]), 'WMS');
  const batches = skuBatches(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true }));
  assert.deepEqual(batches.get('550056224'), [{ batch: '12663924', expiry: '2030-06-22' }, { batch: 'LATE', expiry: '2031-01-01' }]);
  const short = { shipmentNumber: '109689769', orderNos: [], sku: '550056224', description: 'IAGO', qtyRequested: 3, qtyAllocated: 0, qtyShort: 3,
    reason: 'NO_STOCK' as const, qtyRejectedByShelfLife: 0, qtyInStaging: 0 };
  const [l] = stagedLines([short], batches, new Map([['109689769', '7']]));
  assert.equal(l.bin_code, 'STAGING');
  assert.equal(l.batch, '12663924');
  assert.equal(l.expiry, '2030-06-22');
  assert.equal(l.qty, 3);
  assert.equal(l.wave_no, '7');
});

test('staged lines carry the shortage orderNos as DOs', () => {
  const batches = new Map<string, { batch: string; expiry: string | null }[]>();
  const short = { shipmentNumber: '109689769', orderNos: [' 538228980 ', '538255983', '538228980'], sku: '550056224',
    description: 'IAGO', qtyRequested: 1, qtyAllocated: 0, qtyShort: 1, reason: 'NO_STOCK' as const,
    qtyRejectedByShelfLife: 0, qtyInStaging: 0 };
  assert.deepEqual(stagedLines([short], batches, new Map())[0].do_nos, ['538228980', '538255983']);
});

// 0123: the scheduled ship-to party and city reach STAGING lines (and liner lines) through the meta map.
test('staged lines take their destination and city from Schedule of the day', () => {
  const meta = new Map([['109689769', { destination: 'PT CHRYSANTA ARTHA PRATAMA', shipToLocation: 'GRESIK' }]]);
  const short = { shipmentNumber: '109689769', orderNos: [], sku: '550056224', description: 'IAGO',
    qtyRequested: 1, qtyAllocated: 0, qtyShort: 1, reason: 'NO_STOCK' as const, qtyRejectedByShelfLife: 0, qtyInStaging: 0 };
  const [l] = stagedLines([short], new Map(), new Map(), meta);
  assert.equal(l.destination, 'PT CHRYSANTA ARTHA PRATAMA');
  assert.equal(l.ship_to_location, 'GRESIK');
});

// 0123: scheduleMeta reads the Schedule of the day sheet even when its header sits below row 1.
test('scheduleMeta maps shipment to its party and city below a moved header', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['x', null, null],
    ['y', null, null],
    ['Order No', 'Shipment Number', 'Destination', 'Location of the ship-to party'],
    ['538306981', 109682957, 'PT CHRYSANTA ARTHA PRATAMA', 'GRESIK'],
    ['538306981', 109682957, '', 'SIDOARJO'],
    [null, null, null, null],
  ]), 'Schedule of the day');
  const meta = scheduleMeta(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true }));
  assert.deepEqual(meta.get('109682957'), { destination: 'PT CHRYSANTA ARTHA PRATAMA', shipToLocation: 'GRESIK' });
  assert.equal(meta.size, 1);
});

test('real workbook: the DO of an item is its own Order No, not the shipment DO list', () => {
  const wb = XLSX.read(readFileSync('data/Warehouse_Management_System_24_September_2026_.xlsx'), { type: 'buffer', cellDates: true });
  const lines = kOneLines(wb);
  const of = (sku: string) => [...new Set(lines.filter((l) => l.shipment_number === '109682957' && l.sku === sku)
    .flatMap((l) => l.do_nos))];
  // Both materials are on the same shipment, whose "DO Number" lists 538045290 and 538306981:
  // the per-line "Order No" is what tells them apart.
  assert.deepEqual(of('550062462'), ['538306981']);
  assert.deepEqual(of('550062463'), ['538045290']);
  assert.ok(lines.every((l) => l.do_nos.length > 0));
});

// 0124: a K_ONE row naming several DOs is split over the Schedule's DO cartons, rows in printed order.
test('K_ONE rows listing several DOs are split by the Schedule; a row naming one DO keeps it', () => {
  const wb = XLSX.utils.book_new();
  const head = [...HEAD, 'Order No'];
  const row = (bin: string, qty: number, order: string) =>
    ['PL-1', 1, 109669919, 'A, B', 1, bin, null, 550072331, 'Rimula', '', 'A7', null, qty, 'Carton', 'CASE', 0, order];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head,
    row('CD04A02', 30, 'A, B'), row('CD22A02', 5, 'B'), row('CF24D01', 10, 'A, B'), row('CF24D02', 4, 'A, B')]), 'K_ONE');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Order No', 'Shipment Number', 'Material', 'Delivery quantity', 'Destination'],
    ['A', 109669919, 550072331, 35, 'X'], ['B', 109669919, 550072331, 12, 'X'], ['C', 109669919, 550099999, 3, 'X'],
  ]), 'Schedule of the day');
  const lines = kOneLines(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true }));
  const of = (bin: string) => lines.find((l) => l.bin_code === bin)!.do_nos;
  // The single-DO row takes 5 of B first; the rest fill A (35) then B's last 7.
  assert.deepEqual(of('CD22A02'), ['B']);
  assert.deepEqual(of('CD04A02'), ['A']);
  assert.deepEqual(of('CF24D01'), ['A', 'B']);
  assert.deepEqual(of('CF24D02'), ['B']);
});

test('K_ONE without Schedule cartons keeps the listed DOs rather than guessing', () => {
  const lines = kOneLines(book([[...HEAD, 'Order No'],
    ['PL-1', 1, 109669919, 'A, B', 1, 'CD04A02', null, 550072331, 'Rimula', '', 'A7', null, 3, 'Carton', 'CASE', 0, 'A, B']]));
  assert.deepEqual(lines[0].do_nos, ['A', 'B']);
});

test('real workbook: a K_ONE line names more than one DO only when its cartons really span them', () => {
  const wb = XLSX.read(readFileSync('data/Warehouse_Management_System_24_September_2026_.xlsx'), { type: 'buffer', cellDates: true });
  const multi = kOneLines(wb).filter((l) => l.do_nos.length > 1).map((l) => `${l.shipment_number} ${l.bin_code} ${l.qty} ${l.do_nos.join('/')}`);
  // 22 rows list several DOs in the file; after the split two remain, and both carry cartons of each:
  // CC33A02 is all 20 cartons of 8 DOs (2+3+2+2+1+8+1+1), CF14A01 is the boundary between two DOs.
  assert.deepEqual(multi.sort(), [
    '109679525, 109683113 CF14A01 48 538228980/538223237',
    '109683115 CC33A02 20 538297114/538297116/538297117/538297119/538297120/538297121/538297123/538297124',
  ]);
});

test('real workbook: each shipment gets its ship-to party and city from Schedule of the day', () => {
  const wb = XLSX.read(readFileSync('data/Warehouse_Management_System_24_September_2026_.xlsx'), { type: 'buffer', cellDates: true });
  const lines = kOneLines(wb);
  const one = lines.filter((l) => l.shipment_number === '109682957');
  assert.ok(one.length > 0);
  // Destination and city are shipment-level: every line of the shipment names the same pair.
  assert.ok(one.every((l) => l.destination && l.destination.length > 3));
  assert.ok(one.every((l) => l.ship_to_location && l.ship_to_location.length > 3));
  assert.equal(new Set(one.map((l) => l.destination)).size, 1);
});

test('one remaining per bin + SKU: lowest in a rack bin, all cartons at STAGING', () => {
  const l = (o: Partial<SheetPickLine>): SheetPickLine => ({
    picklist: null, wave_no: null, shipment_number: 'S1', seq: 1, bin_code: 'CA01A01', sku: '1', description: '', uom: null,
    batch: 'A7', expiry: null, qty: 1, picker_name: null, do_nos: [], bin_remaining: null, ...o,
  });
  const out = withBinRemaining([
    l({ shipment_number: 'S1', bin_remaining: 30 }), l({ shipment_number: 'S2', bin_remaining: 22 }), l({ shipment_number: 'S3' }),
    l({ bin_code: 'STAGING', shipment_number: 'S1', qty: 3 }), l({ bin_code: 'STAGING', shipment_number: 'S2', qty: 3 }),
    l({ bin_code: 'CB01A01' }),
  ]);
  assert.deepEqual(out.map((x) => x.bin_remaining), [22, 22, 22, 6, 6, null]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
