/** Lacak batch (lib/trace.ts): positions, expiry groups, history balance, summary, shipments, alerts, Excel sheets. */
import { strict as assert } from 'node:assert';
import {
  MANUAL_SHIPMENT, buildAlerts, buildCandidates, buildDestinations, buildExpiryGroups, buildHistory, buildPositions, buildShipments, buildSummary,
  jakartaDateTime, jakartaDay, moveDelta, traceFileName, traceSheets,
  type TraceData, type TraceHold, type TraceMove, type TraceStock, type TraceTask,
} from '../lib/trace';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const TODAY = '2026-11-16';
const BATCH = '14H26JJ'; // made 14 Aug 2026; 48 months -> 14 Aug 2030
const stock = (over: Partial<TraceStock> = {}): TraceStock => ({
  bin_code: 'CA10A02', zone: 'CA', rack: 'CA10', level: 'A', bin_status: 'active', sku: '550044709', description: 'Helix HX7 4x4L', uom: 'CAR', upp: 40,
  batch_lot: BATCH, quantity: 40, expiry_date: '2030-08-14', received_date: '2026-11-06', days_remaining: 1367, held: 0, hold_reasons: null, ...over,
});
let seq = 0;
const move = (over: Partial<TraceMove> = {}): TraceMove => ({
  id: `m${String(++seq).padStart(3, '0')}`, type: 'putaway', quantity: 40, batch_lot: BATCH, expiry_date: '2030-08-14', created_at: '2026-11-06T02:00:00Z',
  note: null, reason_code: null, by_name: null, approved_by_name: null, sku: '550044709', description: 'Helix HX7 4x4L', uom: 'CAR',
  from_bin: null, to_bin: 'CA10A02', user: 'Andi', shipment: null, wave_no: null, wave_date: null, truck: null, ...over,
});
const task = (over: Partial<TraceTask> = {}): TraceTask => ({
  task_type: 'PICK', sku: '550044709', description: 'Helix HX7 4x4L', from_bin: 'CA10A02', to_bin: null, batch_lot: BATCH, expiry_date: '2030-08-14',
  quantity: 10, wave_no: '3', planned_date: '2026-11-17', shipment_number: 'S100', ...over,
});
const hold = (over: Partial<TraceHold> = {}): TraceHold => ({
  id: 'h1', scope: 'BATCH', bin_code: null, sku: '550044709', batch_lot: BATCH, expiry_date: null, quantity: null, reason_code: 'RECALL', note: 'recall Shell',
  status: 'ACTIVE', created_by_name: 'Budi', created_at: '2026-11-10T03:00:00Z', released_by_name: null, released_at: null, release_note: null, covered_qty: 52, ...over,
});
const fmt = (d: string | null) => d ?? '–';

console.log('\nLacak batch');

test('a position: reserved by an open task, held, available, pallets, age', () => {
  const [p] = buildPositions([stock({ held: 5, hold_reasons: 'QC_HOLD' })], [task(), task({ wave_no: '5', quantity: 4 })], TODAY);
  assert.equal(p.quantity, 40);
  assert.equal(p.reserved, 14);
  assert.equal(p.held, 5);
  assert.equal(p.available, 21);
  assert.equal(p.pallets, 1);
  assert.equal(p.ageDays, 10);
  assert.deepEqual(p.waves, ['NO 3', 'NO 5']);
  assert.equal(p.loc, 'rack');
});

test('a task for another expiry date of the batch does not reserve this position', () => {
  const [p] = buildPositions([stock()], [task({ expiry_date: '2030-08-15' })], TODAY);
  assert.equal(p.reserved, 0);
  assert.equal(p.available, 40);
});

test('reserved never exceeds what is there; quarantine is all held; quantity 0 is left out', () => {
  const ps = buildPositions([
    stock({ quantity: 6 }),
    stock({ bin_code: 'QUARANTINE', zone: 'QUARANTINE', rack: null, level: null, quantity: 3 }),
    stock({ bin_code: 'CA11A01', quantity: 0 }),
  ], [task({ quantity: 10 })], TODAY);
  assert.equal(ps.length, 2);
  const rack = ps.find((p) => p.bin_code === 'CA10A02')!, q = ps.find((p) => p.bin_code === 'QUARANTINE')!;
  assert.equal(rack.reserved, 6); assert.equal(rack.available, 0);
  assert.equal(q.loc, 'quarantine'); assert.equal(q.held, 3); assert.equal(q.available, 0);
});

test('a Bin To Bin shows as incoming on its destination; no UPP means no pallet figure', () => {
  const ps = buildPositions([stock({ upp: null }), stock({ bin_code: 'CA01A01', quantity: 8 })],
    [task({ task_type: 'REPLENISH', from_bin: 'CA10A02', to_bin: 'CA01A01', quantity: 12 })], TODAY);
  assert.equal(ps.find((p) => p.bin_code === 'CA01A01')!.incoming, 12);
  assert.equal(ps.find((p) => p.bin_code === 'CA10A02')!.reserved, 12);
  assert.equal(ps.find((p) => p.bin_code === 'CA10A02')!.pallets, null);
});

test('expiry groups: two expiry dates of one batch stay apart, earliest first, each with its bins', () => {
  const ps = buildPositions([
    stock({ bin_code: 'CB03B01', quantity: 12 }),
    stock(),
    stock({ bin_code: 'CA10A02', expiry_date: '2030-08-13', days_remaining: 1366, quantity: 2 }),
  ], [], TODAY);
  const g = buildExpiryGroups(ps, {}, 48);
  assert.equal(g.length, 2);
  assert.equal(g[0].expiry, '2030-08-13'); assert.equal(g[0].qty, 2); assert.deepEqual(g[0].bins, [{ code: 'CA10A02', qty: 2 }]);
  assert.equal(g[1].expiry, '2030-08-14'); assert.equal(g[1].qty, 52);
  assert.deepEqual(g[1].bins.map((b) => b.code).sort(), ['CA10A02', 'CB03B01']);
  // The batch code says 14 Aug 2030: the 13th is a typing mistake, the 14th is fine.
  assert.equal(g[0].expected, '2030-08-14'); assert.equal(g[0].mismatch, 'typo');
  assert.equal(g[1].mismatch, null);
});

test('expiry check uses the item shelf life; the 1930 century mistake is named', () => {
  const ps = buildPositions([stock({ expiry_date: '1930-08-14', days_remaining: -35000 })], [], TODAY);
  assert.equal(buildExpiryGroups(ps, {}, 48)[0].mismatch, 'wrong_century');
  const ok = buildPositions([stock({ expiry_date: '2031-08-14' })], [], TODAY);
  assert.equal(buildExpiryGroups(ok, { '550044709': 60 }, 48)[0].mismatch, null);
  // A SAP lot number carries no date: nothing to check.
  const sap = buildPositions([stock({ batch_lot: '12658123', expiry_date: '1930-08-14' })], [], TODAY);
  assert.equal(buildExpiryGroups(sap, {}, 48)[0].mismatch, null);
});

test('movement effect: receiving adds, picking removes, adjustments are signed, moves between bins are 0', () => {
  assert.equal(moveDelta({ type: 'inbound', quantity: 40, from_bin: null }), 40);
  assert.equal(moveDelta({ type: 'putaway', quantity: 40, from_bin: null }), 40);
  assert.equal(moveDelta({ type: 'putaway', quantity: 40, from_bin: 'STAGING' }), 0);
  assert.equal(moveDelta({ type: 'transfer', quantity: 12, from_bin: 'CA10A02' }), 0);
  assert.equal(moveDelta({ type: 'picking', quantity: 15, from_bin: 'CA10A02' }), -15);
  assert.equal(moveDelta({ type: 'adjustment', quantity: -3, from_bin: null }), -3);
});

const MOVES = [
  move({ created_at: '2026-11-06T02:00:00Z', quantity: 80 }),
  move({ created_at: '2026-11-07T02:00:00Z', type: 'transfer', quantity: 12, from_bin: 'CA10A02', to_bin: 'CB03B01' }),
  move({ created_at: '2026-11-08T03:00:00Z', type: 'picking', quantity: 20, from_bin: 'CA10A02', to_bin: null, shipment: 'S1', wave_no: '2', wave_date: '2026-11-08', truck: 'L 1 AA' }),
  move({ created_at: '2026-11-08T04:00:00Z', type: 'picking', quantity: 5, from_bin: 'CB03B01', to_bin: null, shipment: 'S1', wave_no: '2', wave_date: '2026-11-08' }),
  move({ created_at: '2026-11-09T04:00:00Z', type: 'picking', quantity: 2, from_bin: 'CB03B01', to_bin: null }),
  move({ created_at: '2026-11-10T04:00:00Z', type: 'adjustment', quantity: -1, to_bin: 'CA10A02', note: 'Rusak', reason_code: 'DAMAGED', by_name: 'Citra' }),
];

test('history is oldest first with a running balance per SKU', () => {
  const h = buildHistory([...MOVES].reverse());
  assert.deepEqual(h.map((x) => x.delta), [80, 0, -20, -5, -2, -1]);
  assert.deepEqual(h.map((x) => x.balance), [80, 80, 60, 55, 53, 52]);
  const two = buildHistory([move({ sku: 'A', quantity: 10 }), move({ sku: 'B', quantity: 7 }), move({ sku: 'A', type: 'picking', quantity: 4, from_bin: 'X' })]);
  assert.deepEqual(two.map((x) => `${x.sku}:${x.balance}`), ['A:10', 'B:7', 'A:6']);
});

test('summary per SKU matches the ledger when the history is complete', () => {
  const ps = buildPositions([stock({ quantity: 39 }), stock({ bin_code: 'CB03B01', quantity: 13 })], [task()], TODAY);
  const ex = buildExpiryGroups(ps, {}, 48);
  const [s] = buildSummary(buildHistory(MOVES), ps, ex);
  assert.equal(s.received, 80); assert.equal(s.shipped, 27); assert.equal(s.adjusted, -1); assert.equal(s.opening, 0);
  assert.equal(s.onHand, 52); assert.equal(s.ledger, 52); assert.equal(s.gap, 0);
  assert.equal(s.reserved, 10); assert.equal(s.available, 42); assert.equal(s.bins, 2);
  assert.equal(s.pallets, 1.3);
  assert.equal(s.expiries.length, 1);
  assert.equal(s.firstSeen, '2026-11-06T02:00:00Z'); assert.equal(s.lastMove, '2026-11-10T04:00:00Z');
});

test('an opening balance is counted apart; stock with no history shows as a gap', () => {
  const h = buildHistory([move({ type: 'adjustment', quantity: 30, note: 'OPENING BALANCE 24 Sep' })]);
  const ps = buildPositions([stock({ quantity: 35 })], [], TODAY);
  const [s] = buildSummary(h, ps, buildExpiryGroups(ps, {}, 48));
  assert.equal(s.opening, 30); assert.equal(s.adjusted, 0); assert.equal(s.ledger, 30); assert.equal(s.gap, 5);
});

test('shipments: picks grouped per shipment + SKU with destination, bins and expiry; manual picks apart', () => {
  const ships = buildShipments(buildHistory(MOVES), [{ shipment_number: 'S1', sku: '550044709', destination: 'PT Maju', truck: null, order_nos: ['801', '802'] }]);
  assert.equal(ships.length, 2);
  const s1 = ships.find((s) => s.shipment === 'S1')!, manual = ships.find((s) => s.shipment === MANUAL_SHIPMENT)!;
  assert.equal(s1.qty, 25); assert.equal(s1.destination, 'PT Maju'); assert.equal(s1.orders, '801, 802');
  assert.deepEqual(s1.bins, ['CA10A02', 'CB03B01']); assert.deepEqual(s1.expiries, ['2030-08-14']);
  assert.equal(s1.truck, 'L 1 AA'); assert.equal(s1.date, '2026-11-08'); assert.equal(s1.wave, '2');
  assert.equal(manual.qty, 2); assert.equal(manual.date, '2026-11-09');
  assert.equal(ships[0].shipment, MANUAL_SHIPMENT); // latest first
});

test('destinations: one row per receiver, most cartons first', () => {
  const d = buildDestinations(buildShipments(buildHistory(MOVES), [{ shipment_number: 'S1', sku: '550044709', destination: 'PT Maju', truck: null, order_nos: null }]));
  assert.deepEqual(d.map((x) => [x.destination, x.qty, x.shipments]), [['PT Maju', 25, 1], ['Pick manual (tanpa shipment)', 2, 1]]);
});

test('alerts: batch hold, expired, expiry mismatch, two expiry dates, near expiry, reserved', () => {
  const ps = buildPositions([
    stock({ expiry_date: '1930-08-14', days_remaining: -35000, quantity: 4 }),
    stock({ bin_code: 'CB03B01', quantity: 10, expiry_date: '2030-08-14', days_remaining: 30 }),
  ], [task({ from_bin: 'CB03B01', quantity: 3 })], TODAY);
  const ex = buildExpiryGroups(ps, {}, 48);
  const sum = buildSummary(buildHistory([move({ quantity: 14 })]), ps, ex);
  const a = buildAlerts({ positions: ps, summary: sum, holds: [hold()], nearDays: 90, fmtDate: fmt });
  const has = (re: RegExp, tone?: string) => a.some((x) => re.test(x.text) && (!tone || x.tone === tone));
  assert.ok(has(/Seluruh batch untuk SKU 550044709 sedang ditahan \(RECALL\)/, 'bad'));
  assert.ok(has(/4 unit sudah expired, masih tercatat di 1 bin/, 'bad'));
  assert.ok(has(/expired tercatat 1930-08-14, menurut kode batch seharusnya 2030-08-14 \(abad salah\)/, 'bad'));
  assert.ok(has(/punya 2 tanggal expired berbeda/, 'warn'));
  assert.ok(has(/10 unit akan expired dalam 90 hari \(1 bin\)/, 'warn'));
  assert.ok(has(/3 unit sudah dipesan wave/, 'info'));
  assert.ok(!has(/selisih/));
});

test('alerts: a clean batch has none; a batch that is gone says so; a ledger gap is explained', () => {
  const ps = buildPositions([stock()], [], TODAY);
  const sum = buildSummary(buildHistory([move()]), ps, buildExpiryGroups(ps, {}, 48));
  assert.deepEqual(buildAlerts({ positions: ps, summary: sum, holds: [hold({ status: 'RELEASED' })], nearDays: 90, fmtDate: fmt }), []);
  const gone = buildSummary(buildHistory([move(), move({ type: 'picking', from_bin: 'CA10A02', to_bin: null })]), [], []);
  assert.ok(buildAlerts({ positions: [], summary: gone, holds: [], nearDays: 90, fmtDate: fmt }).some((x) => /sudah tidak ada di gudang/.test(x.text)));
  const gapSum = buildSummary(buildHistory([move({ quantity: 30 })]), ps, buildExpiryGroups(ps, {}, 48));
  assert.ok(buildAlerts({ positions: ps, summary: gapSum, holds: [], nearDays: 90, fmtDate: fmt }).some((x) => /stok sekarang 40, menurut riwayat mutasi batch ini 30 \(selisih \+10\)/.test(x.text)));
});

test('finding a batch: stock grouped per batch + SKU, the batch expiring first on top', () => {
  const c = buildCandidates([
    stock({ batch_lot: '02K26JJ', expiry_date: '2030-11-02', bin_code: 'CA02A01', quantity: 10 }),
    stock(), stock({ bin_code: 'CB03B01', quantity: 12 }),
    stock({ batch_lot: '12658123', expiry_date: null, bin_code: 'CC01A01', quantity: 5 }),
    stock({ batch_lot: 'ZERO', quantity: 0 }),
  ]);
  assert.deepEqual(c.map((x) => x.batch), [BATCH, '02K26JJ', '12658123']);
  assert.equal(c[0].qty, 52); assert.deepEqual(c[0].bins, ['CA10A02', 'CB03B01']); assert.equal(c[0].mfg, '2026-08-14');
  assert.equal(c[2].mfg, null); assert.deepEqual(c[2].expiries, []);
});

test('times are Jakarta wall-clock, whatever the machine', () => {
  assert.equal(jakartaDay('2026-11-08T18:30:00Z'), '2026-11-09'); // 01:30 the next day in Jakarta
  assert.match(jakartaDateTime('2026-11-08T18:30:00Z'), /^09 Nov 2026.*01[.:]30$/);
  assert.equal(jakartaDateTime(null), '–');
});

test('Excel: every section is a sheet, names within 31 characters, rows match the screen', () => {
  const ps = buildPositions([stock({ quantity: 39 }), stock({ bin_code: 'CB03B01', quantity: 13 })], [task()], TODAY);
  const ex = buildExpiryGroups(ps, {}, 48);
  const history = buildHistory(MOVES);
  const summary = buildSummary(history, ps, ex);
  const ships = buildShipments(history, []);
  const d: TraceData = { batch: BATCH, skuFilter: '', printedAt: '16 Nov 2026 10.00', positions: ps, summary, expiries: ex, ships, destinations: buildDestinations(ships),
    history, tasks: [task()], holds: [hold()], alerts: buildAlerts({ positions: ps, summary, holds: [hold()], nearDays: 90, fmtDate: fmt }) };
  const sheets = traceSheets(d);
  assert.deepEqual(Object.keys(sheets), ['Ringkasan', 'Posisi sekarang', 'Per expired', 'Dikirim ke', 'Per tujuan', 'Dipesan wave', 'Hold', 'Riwayat', 'Peringatan']);
  assert.ok(Object.keys(sheets).every((n) => n.length <= 31));
  assert.equal(sheets['Posisi sekarang'].length, 2);
  const row = sheets['Posisi sekarang'].find((r) => r.Bin === 'CA10A02')!;
  assert.equal(row.Expired, '2030-08-14'); assert.equal(row.Qty, 39); assert.equal(row.Dipesan, 10); assert.equal(row.Tersedia, 29);
  assert.equal(row['Lama di gudang (hari)'], 10); assert.equal(row.Wave, 'NO 3');
  assert.equal(sheets['Per expired'][0].Bin, 'CA10A02 (39), CB03B01 (13)');
  assert.equal(sheets.Ringkasan[0]['Stok sekarang'], 52); assert.equal(sheets.Ringkasan[0]['Tgl produksi (kode batch)'], '2026-08-14');
  assert.equal(sheets.Riwayat.length, 6); assert.equal(sheets.Riwayat[5]['Saldo batch'], 52); assert.equal(sheets.Riwayat[5]['Kode alasan'], 'DAMAGED');
  assert.equal(sheets.Hold[0]['Qty ditahan'], 52); assert.equal(sheets.Hold[0].Cakupan, 'Seluruh batch');
  assert.equal(sheets['Dipesan wave'][0]['Dari bin'], 'CA10A02');
});

test('file name is safe for any batch text', () => {
  assert.equal(traceFileName('14H26JJ'), 'lacak-batch_14H26JJ.xlsx');
  assert.equal(traceFileName('A/B 01', 'posisi'), 'lacak-batch_A_B_01_posisi.xlsx');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
