/** Excel rows of the WMS-file picking audit (lib/sheet-audit-export.ts). */
import { strict as assert } from 'node:assert';
import { auditWorkbookRows, jakartaTime, moveRows, type ExportAttempt, type ExportLine, type ExportMove } from '../lib/sheet-audit-export';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nPicking audit export');

const line = (o: Partial<ExportLine>): ExportLine => ({
  id: 'l1', shipment_number: 'S1', wave_no: '1', picklist: 'PL-S1', seq: 1, bin_code: 'CA01A01', sku: '550024919', description: 'Rimula',
  uom: 'CAR', batch: 'C1', expiry: '2031-07-07', qty: 2, bin_remaining: 4, line_state: 'OK', volume_l: 20,
  do_nos: ['538306981'],
  destination: 'PT CHRYSANTA ARTHA PRATAMA', ship_to_location: 'GRESIK', ...o,
});
const att = (o: Partial<ExportAttempt>): ExportAttempt => ({
  line_id: 'l1', attempt_no: 1, checker_name: 'Sari', method: 'RACK', result: 'OK', errors: [], counted_qty: 2, found_sku: '550024919',
  found_batch: 'C1', rack_system: 4, rack_counted: 4, note: null, correction: false, created_at: '2026-09-29T03:00:00Z', ...o,
});

test('Jakarta time', () => assert.equal(jakartaTime('2026-09-29T03:05:00Z'), '2026-09-29 10:05'));

test('a corrected bin shows the latest count, the difference and Diubah', () => {
  const lines = [line({ line_state: 'MISMATCH' }), line({ id: 'l2', shipment_number: 'S2', bin_remaining: 1, qty: 3, line_state: 'OK' })];
  const attempts = [
    att({}), att({ line_id: 'l2' }),
    att({ attempt_no: 2, result: 'MISMATCH', errors: ['SHORT'], counted_qty: 1, rack_system: 1, rack_counted: 2, note: 'salah klik', correction: true, created_at: '2026-09-29T04:00:00Z' }),
  ];
  const { bins, lines: rows, history } = auditWorkbookRows(lines, attempts);
  assert.equal(bins.length, 1);
  assert.equal(bins[0]['Sisa di file'], 1);
  assert.equal(bins[0]['Sisa dihitung'], 2);
  assert.equal(bins[0].Selisih, 1);
  assert.equal(bins[0].Status, 'Selisih');
  assert.equal(bins[0].Diubah, 'Ya');
  assert.equal(bins[0]['Qty pick'], 5);
  assert.equal(rows[0].Error, 'Kurang');
  assert.equal(rows[0].Audit, 2);
  assert.equal(history.length, 3);
  assert.equal(history[2].Ubah, 'Ya');
});

test('wrong item shows what was found; unaudited bins stay blank', () => {
  const { bins } = auditWorkbookRows(
    [line({ line_state: 'MISMATCH' }), line({ id: 'l3', bin_code: 'STAGING', sku: '550056224', line_state: 'TODO', bin_remaining: 6 })],
    [att({ result: 'MISMATCH', errors: ['WRONG_SKU'], found_sku: '550044709', rack_counted: 0, note: 'isi lain' })]);
  const ca = bins.find((b) => b.Bin === 'CA01A01')!, stg = bins.find((b) => b.Bin === 'STAGING')!;
  assert.equal(ca['Barang ditemukan'], '550044709');
  assert.equal(stg.Rak, 'STAGING');
  assert.equal(stg.Status, 'Belum diaudit');
  assert.equal(stg['Sisa dihitung'], null);
});

test('Remain Qty sits right after Qty pick, missing keys get 0, TOTAL is empty', () => {
  const remain = new Map([['CA01A01|550024919', 7]]);
  const lines = [line({}), line({ id: 'l9', bin_code: 'CB02B02', sku: '550056224' })];
  const { bins, lines: rows } = auditWorkbookRows(lines, [], 'Sisa sistem', remain);
  const ca = bins.find((b) => b.Bin === 'CA01A01')!, cb = bins.find((b) => b.Bin === 'CB02B02')!;
  assert.equal(ca['Remain Qty'], 7);
  assert.equal(cb['Remain Qty'], 0);
  const bk = Object.keys(ca);
  assert.equal(bk[bk.indexOf('Qty pick') + 1], 'Remain Qty');
  const l1 = rows.find((r) => r.Bin === 'CA01A01')!;
  assert.equal(l1['Remain Qty'], 7);
  assert.equal(rows.find((r) => r.Bin === 'CB02B02')!['Remain Qty'], 0);
  const lk = Object.keys(l1);
  assert.equal(lk[lk.indexOf('Qty pick') + 1], 'Remain Qty');
  const total = rows.find((r) => r.Shipment === 'TOTAL')!;
  assert.equal(total['Remain Qty'], null);
  assert.equal(Object.keys(total).indexOf('Remain Qty'), Object.keys(total).indexOf('Qty pick') + 1);
});

test('without the map there is no Remain Qty column', () => {
  const { bins, lines: rows } = auditWorkbookRows([line({})], []);
  assert.ok(!('Remain Qty' in bins[0]));
  for (const r of rows) assert.ok(!('Remain Qty' in r));
});

test('DO sits right after Shipment in Per baris; TOTAL keeps the key empty', () => {
  const { lines: rows } = auditWorkbookRows([line({})], []);
  const l1 = rows.find((r) => r.Bin === 'CA01A01')!;
  assert.equal(l1.DO, '538306981');
  const lk = Object.keys(l1);
  assert.equal(lk[lk.indexOf('Shipment') + 1], 'DO');
  const total = rows.find((r) => r.Shipment === 'TOTAL')!;
  assert.equal(total.DO, null);
  assert.equal(Object.keys(total).indexOf('DO'), Object.keys(total).indexOf('Shipment') + 1);
  // a line without DOs still has the column, empty
  const { lines: bare } = auditWorkbookRows([line({ do_nos: undefined })], []);
  assert.equal(bare[0].DO, '');
});

// 0123: Destination and Location of the ship-to party sit right after the DO, on every row kind.
test('Destination then Location of the ship-to party follow the DO in Per baris', () => {
  const { lines: rows } = auditWorkbookRows([line({})], []);
  const l1 = rows.find((r) => r.Bin === 'CA01A01')!;
  assert.equal(l1.Destination, 'PT CHRYSANTA ARTHA PRATAMA');
  assert.equal(l1['Location of the ship-to party'], 'GRESIK');
  const lk = Object.keys(l1);
  assert.equal(lk[lk.indexOf('DO') + 1], 'Destination');
  assert.equal(lk[lk.indexOf('Destination') + 1], 'Location of the ship-to party');
  const total = rows.find((r) => r.Shipment === 'TOTAL')!;
  assert.equal(total.Destination, null);
  assert.equal(total['Location of the ship-to party'], null);
  assert.equal(Object.keys(total).indexOf('Destination'), Object.keys(total).indexOf('DO') + 1);
  // a line the source had no party for keeps the columns, empty
  const { lines: bare } = auditWorkbookRows([line({ destination: undefined, ship_to_location: undefined })], []);
  assert.equal(bare[0].Destination, '');
  assert.equal(bare[0]['Location of the ship-to party'], '');
});

test('Per bin: one row per bin + SKU and the union of its lines DOs', () => {
  const { bins } = auditWorkbookRows([
    line({ id: 'l1', do_nos: ['538306981'] }), line({ id: 'l2', shipment_number: 'S2', do_nos: ['538045290', '538306981'] }),
  ], []);
  assert.equal(bins.length, 1);
  assert.equal(bins[0].DO, '538306981, 538045290');
  assert.equal(bins[0].Shipment, 'S1, S2');
  const bk = Object.keys(bins[0]);
  assert.equal(bk[bk.indexOf('Shipment') + 1], 'DO');
});

// 0123: a bin that served two shipments with different parties names both, DO order kept (DO then party).
test('Per bin carries the distinct Destination and Location of its lines', () => {
  const { bins } = auditWorkbookRows([
    line({ id: 'l1' }), line({ id: 'l2', shipment_number: 'S2', destination: 'PT XYZ', ship_to_location: 'SIDOARJO' }),
  ], []);
  assert.equal(bins.length, 1);
  assert.equal(bins[0].Destination, 'PT CHRYSANTA ARTHA PRATAMA, PT XYZ');
  assert.equal(bins[0]['Location of the ship-to party'], 'GRESIK, SIDOARJO');
  const bk = Object.keys(bins[0]);
  assert.equal(bk[bk.indexOf('DO') + 1], 'Destination');
  assert.equal(bk[bk.indexOf('Destination') + 1], 'Location of the ship-to party');
});

// 0122: a Bin To Bin line serves the wave's shipments for its SKU, so it carries them and their DOs.
const move = (o: Partial<ExportMove>): ExportMove => ({
  task_id: 'm1', wave_no: '10975623', seq: 3, from_bin: 'CB05C01', from_zone: 'CB', to_bin: 'CF05A01', to_zone: 'CF',
  sku: '550024919', description: 'Rimula', uom: 'CAR', moved_qty: 4, line_state: 'TODO',
  from_state: 'TODO', from_system: 20, from_counted: 20, from_checker: 'Sari', from_found_sku: null,
  from_note: null, from_correction: false, from_audited_at: '2026-09-29T03:00:00Z',
  shipment_numbers: ['10975623'], do_nos: ['539468824', '539000001'], ...o,
});

test('Bin To Bin rows carry the move Shipment and DO on both bins', () => {
  const { bins } = auditWorkbookRows([], [], 'Sisa sistem', undefined, { rows: [move({})] });
  const src = bins.find((b) => b.Jenis === 'Bin To Bin (asal)')!, dst = bins.find((b) => b.Jenis === 'Bin To Bin (tujuan)')!;
  for (const r of [src, dst]) {
    assert.equal(r.Shipment, '10975623');
    assert.equal(r.DO, '539468824, 539000001');
  }
  // same column order as a pick row: Shipment then DO
  const k = Object.keys(src);
  assert.equal(k[k.indexOf('Shipment') + 1], 'DO');
});

test('a move with no shipment and no DO leaves both empty (also before 0122)', () => {
  for (const o of [{ shipment_numbers: null, do_nos: null }, { shipment_numbers: undefined, do_nos: undefined }, {}]) {
    const { bins } = auditWorkbookRows([], [], 'Sisa sistem', undefined, {
      rows: [move({ shipment_numbers: null, do_nos: null, ...o })],
    });
    const src = bins.find((b) => b.Jenis === 'Bin To Bin (asal)')!;
    assert.equal(src.Shipment, '');
    assert.equal(src.DO, '');
  }
});

// 0123: the move's ship-to parties and cities sit after its DO, on the source and destination rows alike.
test('Bin To Bin rows carry the move Destination and Location after the DO', () => {
  const { bins } = auditWorkbookRows([], [], 'Sisa sistem', undefined, {
    rows: [move({ destinations: ['PT CHRYSANTA ARTHA PRATAMA'], ship_to_locations: ['GRESIK'] })],
  });
  const src = bins.find((b) => b.Jenis === 'Bin To Bin (asal)')!, dst = bins.find((b) => b.Jenis === 'Bin To Bin (tujuan)')!;
  for (const r of [src, dst]) {
    assert.equal(r.Destination, 'PT CHRYSANTA ARTHA PRATAMA');
    assert.equal(r['Location of the ship-to party'], 'GRESIK');
  }
  const k = Object.keys(src);
  assert.equal(k[k.indexOf('DO') + 1], 'Destination');
  assert.equal(k[k.indexOf('Destination') + 1], 'Location of the ship-to party');
  // absent on a database before 0123: the columns stay, empty
  const bare = auditWorkbookRows([], [], 'Sisa sistem', undefined, { rows: [move({ destinations: undefined, ship_to_locations: undefined })] });
  const b = bare.bins.find((x) => x.Jenis === 'Bin To Bin (tujuan)')!;
  assert.equal(b.Destination, '');
  assert.equal(b['Location of the ship-to party'], '');
});

test('move history rows name the shipment and DO like a pick attempt', () => {
  const { lines: rows, history } = moveRows([{
    task_id: 'm1', wave_no: '10975623', seq: 3, from_bin: 'CB05C01', from_zone: 'CB', to_bin: 'CF05A01', to_zone: 'CF',
    sku: '550024919', description: 'Rimula', uom: 'CAR', batch: 'C1', expiry: '2031-07-07',
    planned_qty: 4, moved_qty: 4, line_state: 'MISMATCH',
    shipment_numbers: ['10975623'], do_nos: ['539468824', '539000001'],
    destinations: ['PT CHRYSANTA ARTHA PRATAMA'], ship_to_locations: ['GRESIK'],
  }], [att({ line_id: 'm1', method: null, result: 'MISMATCH', errors: ['SHORT'], counted_qty: 3, rack_system: null, rack_counted: null })]);
  assert.equal(rows[0].Shipment, '10975623');
  assert.equal(rows[0].DO, '539468824, 539000001');
  assert.equal(rows[0].Destination, 'PT CHRYSANTA ARTHA PRATAMA');
  assert.equal(rows[0]['Location of the ship-to party'], 'GRESIK');
  const k = Object.keys(rows[0]);
  assert.equal(k[k.indexOf('DO') + 1], 'Destination');
  assert.equal(history[0].Shipment, '10975623');
  assert.equal(history[0].DO, '539468824, 539000001');
  // a move without them keeps the columns, empty/null
  const bare = moveRows([{
    task_id: 'm2', wave_no: '1', seq: 1, from_bin: 'CB05C01', from_zone: 'CB', to_bin: 'CF05A01', to_zone: 'CF',
    sku: '550024919', description: 'Rimula', uom: 'CAR', batch: 'C1', expiry: null,
    planned_qty: 1, moved_qty: 1, line_state: 'OK',
  }], []);
  assert.equal(bare.lines[0].Shipment, '');
  assert.equal(bare.lines[0].DO, '');
  assert.equal(bare.lines[0].Destination, '');
  assert.equal(bare.lines[0]['Location of the ship-to party'], '');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
