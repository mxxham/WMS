/**
 * The raw "Planning Outbound" workbook as the Alokasi page's schedule: one sheet per day
 * ("1 Oktober 2026"), a title, the day as a date cell, the "Schedule of the day" columns on
 * row 4 and TOTAL rows between shipments. No WMS or MASTER DATA sheet, so stock comes from
 * the database and UPP must be left for the stock to fill.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as XLSX from 'xlsx';
import { withConfig } from '../lib/allocator/config';
import { loadWorkbookFromBuffer, pickScheduleSheet } from '../lib/allocator/browser/browser-input';
import { loadWorkbook } from '../lib/allocator/adapters/excel-input';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const HEAD = ['No', 'Order No', 'Purchasing Document', 'Ship-to party', 'Shipment Number', 'Destination', 'Location of the ship-to party',
  'Material', 'Description', 'Delivery quantity', 'Sales Unit', 'Volume', 'Total Weight', 'Purchase Order Number', 'First Delivery Date',
  'TRANSPORT', 'Type Truck', 'Arrival Slot Time', 'NO', 'KET'];

function daySheet(serial: number, rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([['Planning Outbound Shell'], [], [serial], HEAD, ...rows]);
}

function planningBook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, daySheet(46296, [
    [1, 538476620, 930172369, 11520114, 109698344, 'PT A', 'GRESIK', 550053782, 'RimR5_4*4L', 27, 'CAR', 0, 0, '', 46276, 'DHL', 'CDD', 1 / 3, 1, ''],
    ['', 538556804, 931118174, 11520114, 109698344, 'PT A', 'GRESIK', 550070612, 'HlxHX6_12*1L', 58, 'CAR', 0, 0, '', 46303, 'DHL', '', '', '', ''],
    ['', 538556805, 931118174, 11520114, 109698344, 'PT A', 'GRESIK', 550070612, 'HlxHX6_12*1L', 2, 'CAR', 0, 0, '', 46303, 'DHL', '', '', '', ''],
    ['', '', '', '', '', '', '', '', 'TOTAL', 87, '', 0, 0, '', '', '', '', '', '', ''],
    [2, 538476700, 930172370, 11520115, 109698345, 'PT B', 'SURABAYA', 550053782, 'RimR5_4*4L', 5, 'CAR', 0, 0, '', 46276, 'LF', 'L300', 1 / 3, 2, ''],
    ['', '', '', '', '', '', '', '', 'TOTAL', 5, '', 0, 0, '', '', '', '', '', '', ''],
  ]), '1 Oktober 2026');
  XLSX.utils.book_append_sheet(wb, daySheet(46297, [
    [1, 538564572, 931145086, 12779110, 109700441, 'PT C', 'SIDOARJO', 550063232, 'HOP Grease', 30, 'EA', 0, 0, '', 46303, 'DHL', 'CDE', 1 / 3, 1, ''],
  ]), '02 Oktober 2026');
  // A day whose sheet name has no date: the date cell above the header decides.
  XLSX.utils.book_append_sheet(wb, daySheet(46298, [
    [1, 538564498, 931144247, 12638467, 109702461, 'SHELL KENJERAN', 'SURABAYA', 550058593, 'Adv4T', 13, 'CAR', 0, 0, '', 46303, 'LF', 'CDE', 1 / 3, 1, ''],
  ]), 'Sabtu');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

const cfg = (day: string) => withConfig({ asOf: new Date(`${day}T00:00:00Z`) });

test('the run date picks its own day sheet', () => {
  const wb = loadWorkbookFromBuffer(planningBook(), cfg('2026-10-01'));
  assert.equal(wb.scheduleSheet, '1 Oktober 2026');
  assert.equal(wb.hasStock, false);
  assert.equal(wb.stock.length, 0);
  // Two shipments; the TOTAL rows are not orders; one line per shipment + SKU; wave = shipment (wave-numbers.ts).
  assert.deepEqual(wb.demand.map((d) => `${d.shipmentNumber}|${d.sku}|${d.qtyCartons}|${d.waveNo}`).sort(), [
    '109698344|550053782|27|109698344', '109698344|550070612|60|109698344', '109698345|550053782|5|109698345',
  ]);
  const two = wb.demand.find((d) => d.sku === '550070612')!;
  assert.deepEqual(two.orders, [{ orderNo: '538556804', qty: 58 }, { orderNo: '538556805', qty: 2 }]);
});

test('no MASTER DATA: UPP stays 0 so the stock decides, never a 1-carton pallet', () => {
  const wb = loadWorkbookFromBuffer(planningBook(), cfg('2026-10-01'));
  assert.ok(wb.demand.every((d) => d.upp === 0));
});

test('a "02 Oktober" sheet name and a date-cell-only sheet are both found', () => {
  assert.equal(loadWorkbookFromBuffer(planningBook(), cfg('2026-10-02')).demand[0].qtyCartons, 30);
  const sat = loadWorkbookFromBuffer(planningBook(), cfg('2026-10-03'));
  assert.equal(sat.scheduleSheet, 'Sabtu');
  assert.equal(sat.demand[0].sku, '550058593');
});

test('a day the file does not have is refused, listing the days it has', () => {
  const book = XLSX.read(planningBook(), { type: 'array', cellDates: true });
  assert.throws(() => pickScheduleSheet(book, new Date('2026-10-04T00:00:00Z')), /tidak punya sheet untuk tanggal 2026-10-04.*2026-10-01, 2026-10-02, 2026-10-03/);
});

test('a WMS file still reads "Schedule of the day" and its stock', () => {
  const buf = fs.readFileSync('data/Warehouse_Management_System_24_September_2026_.xlsx');
  const wb = loadWorkbookFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), cfg('2026-09-24'));
  assert.equal(wb.scheduleSheet, 'Schedule of the day');
  assert.equal(wb.hasStock, true);
  assert.ok(wb.stock.length > 1000);
  assert.ok(wb.demand.length > 0 && wb.demand.every((d) => d.upp > 0));
});

// Arrival Slot Time: SheetJS builds 08:00 with Jakarta's 1899 offset (+7:07:12), which read
// as UTC was 00:52 on the page while the CLI (ExcelJS) said 08:00. Both must agree.
const WMS24 = 'data/Warehouse_Management_System_24_September_2026_.xlsx';
const cliSlots = new Map((await loadWorkbook(WMS24, cfg('2026-09-24'))).demand.map((d) => [d.shipmentNumber, d.slotTime]));

test('slot time: the page reads the same clock time as the CLI', () => {
  const buf = fs.readFileSync(WMS24);
  const web = loadWorkbookFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), cfg('2026-09-24')).demand;
  assert.ok(web.some((d) => d.slotTime === '08:00'));
  for (const d of web) assert.equal(d.slotTime, cliSlots.get(d.shipmentNumber), `shipment ${d.shipmentNumber}`);
});

test('slot time: a bare day fraction (1/3) is 08:00', () => {
  const wb = loadWorkbookFromBuffer(planningBook(), cfg('2026-10-01'));
  assert.ok(wb.demand.every((d) => d.slotTime === '08:00'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
