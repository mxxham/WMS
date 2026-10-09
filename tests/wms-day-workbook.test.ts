/**
 * Laporan WMS harian workbook: both data sheets are real Excel tables (filter
 * buttons, Total row), dates are real dates, and the SAP sheet's Selisih is a
 * formula — written to a buffer and read back, as a user opening it would.
 */
import { strict as assert } from 'node:assert';
import ExcelJS from 'exceljs';
import { buildWmsDayWorkbook, rowStatus, type WmsDayRow } from '../lib/wms-day-workbook';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

const row = (o: Partial<WmsDayRow>): WmsDayRow => ({
  bin_code: 'CE11A02', sku: '550061081', description: 'HELIX', uom: 'CAR', upp: 44, batch_lot: 'B1',
  expiry_date: '2030-08-05', received_date: '2026-10-05',
  on_hand: 0, pick: 0, b_out: 0, b_in: 0, putaway: 0, adjust: 0, remain: 0, ...o,
});

const rows = [
  row({ bin_code: 'CE11E01', on_hand: 44, remain: 44 }),
  row({ bin_code: 'CE11A02', on_hand: 54, pick: 13, b_out: 41, b_in: 41, adjust: 34, remain: 41 }),
  row({ bin_code: 'CA01C01', sku: '550058592', on_hand: 0, adjust: -44, remain: 0 }),
];

async function roundTrip(rs: WmsDayRow[]) {
  const buf = await buildWmsDayWorkbook(rs, '2026-10-05', new Date(Date.UTC(2026, 9, 5, 10))).xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

(async () => {
  await test('status separates stock, emptied today, and import zeroing', () => {
    assert.equal(rowStatus(rows[0]), 'Ada stok');
    assert.equal(rowStatus(rows[2]), 'Nol oleh impor/adjust');
    assert.equal(rowStatus(row({ on_hand: 10, pick: 10 })), 'Habis hari ini');
  });

  await test('WMS and SAP sheets are Excel tables with filters and a Total row', async () => {
    const wb = await roundTrip(rows);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['WMS', 'SAP', 'Nol impor', 'Catatan']);
    for (const name of ['WMS', 'SAP', 'Nol impor']) {
      const ws = wb.getWorksheet(name)!;
      const t = Object.values((ws as unknown as { tables: Record<string, { table: { tableRef: string; autoFilterRef?: string; totalsRow: boolean; columns: { filterButton?: boolean }[] } }> }).tables)[0];
      assert.ok(t, `${name} has a table`);
      assert.ok(t.table.tableRef.startsWith('A4:'), `${name} table starts under the title`);
      assert.ok(t.table.autoFilterRef, `${name} has filter buttons`);
      assert.equal(t.table.totalsRow, true);
      assert.ok(t.table.columns.every((c) => c.filterButton !== false));
      assert.equal(ws.views[0]?.state, 'frozen');
    }
  });

  await test('WMS rows sorted by bin, numbers and dates typed, header on row 4', async () => {
    const ws = (await roundTrip(rows)).getWorksheet('WMS')!;
    assert.equal(ws.getCell('A4').value, 'Lokasi');
    assert.deepEqual([5, 6].map((r) => ws.getCell(r, 1).value), ['CE11A02', 'CE11E01']);
    assert.equal(ws.getCell(5, 15).value, 41);
    const exp = ws.getCell(5, 7).value as Date;
    assert.ok(exp instanceof Date);
    assert.equal(exp.toISOString().slice(0, 10), '2030-08-05');
    assert.equal(ws.getCell(7, 1).value, 'Total');
  });

  await test('header is coloured on the cells, not left to the table style', async () => {
    const ws = (await roundTrip(rows)).getWorksheet('WMS')!;
    const h = ws.getCell('A4');
    assert.equal((h.fill as ExcelJS.FillPattern).fgColor?.argb, 'FF1F3864');
    assert.equal(h.font.color?.argb, 'FFFFFFFF');
    assert.equal(ws.getCell('J3').value, 'Gerak hari ini');
  });

  await test('import-zeroed rows go to Nol impor, out of WMS and SAP', async () => {
    const wb = await roundTrip(rows);
    const nol = wb.getWorksheet('Nol impor')!;
    assert.equal(nol.getCell(5, 1).value, 'CA01C01');
    assert.equal(nol.getCell(5, 14).value, -44);
    const sap = wb.getWorksheet('SAP')!;
    assert.deepEqual([5, 6].map((r) => sap.getCell(r, 1).value), ['550061081', 'Total']);
    assert.equal((await roundTrip(rows.slice(0, 2))).getWorksheet('Nol impor'), undefined);
  });

  await test('SAP sums per SKU and Selisih is a formula on the typed SAP stock', async () => {
    const ws = (await roundTrip(rows)).getWorksheet('SAP')!;
    assert.equal(ws.getCell(5, 1).value, '550061081');
    assert.equal(ws.getCell(5, 4).value, 2);
    assert.equal(ws.getCell(5, 9).value, 85);
    const f = ws.getCell(5, 11).value as { formula: string };
    assert.equal(f.formula, 'IF(J5="","",I5-J5)');
  });

  await test('an empty day still writes a valid workbook', async () => {
    const wb = await roundTrip([]);
    assert.equal(wb.getWorksheet('WMS')!.getCell('A4').value, 'Lokasi');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
