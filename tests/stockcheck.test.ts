/**
 * Stock Opname Rak (0144): the order of the sheet (bay 01 on top, 40 at the bottom), empty bins, what typed
 * values become, and the mistakes caught before anything is sent. Also the Excel list taken to the rack.
 */
import { strict as assert } from 'node:assert';
import ExcelJS from 'exceljs';
import {
  buildCheckRows, changesOf, compareBins, describeChange, diffOf, expiryPlausible, lineKey, multiSkuBins, payloadOf, reportPayload, summarize,
  type Added, type CheckRow, type Edit, type StockLine,
} from '../lib/stockcheck';
import { buildStockCheckWorkbook } from '../lib/stockcheck-workbook';

let passed = 0, failed = 0;
const running: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  const done = (ok: boolean, e?: unknown) => { if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}
    ${(e as Error).message}`); } };
  try {
    const r = fn();
    if (r instanceof Promise) running.push(r.then(() => done(true), (e) => done(false, e)));
    else done(true);
  } catch (e) { done(false, e); }
}
const line = (o: Partial<StockLine> & { bin_code: string }): StockLine => ({
  sku: '550044709', description: 'Helix 1L', uom: 'CAR', batch_lot: 'B1', expiry_date: '2030-08-20', quantity: 48, held: 0, reserved: 0, waves: [], ...o });
const SKUS = new Map([['550044709', 'Helix 1L'], ['550062463', 'Advance 0.8L']]);

console.log('\nOrder of the sheet');

test('bay 01 on top, bay 40 at the bottom; CB02 before CB10 (numbers, not text)', () => {
  const codes = ['CB40A01', 'CB10A01', 'CB02A01', 'CB01A01', 'CB21A01'];
  assert.deepEqual([...codes].sort(compareBins), ['CB01A01', 'CB02A01', 'CB10A01', 'CB21A01', 'CB40A01']);
});
test('inside a bay: level A to E, then position 01, 02', () => {
  const codes = ['CB05B01', 'CB05A02', 'CB05E01', 'CB05A01', 'CB05B02'];
  assert.deepEqual([...codes].sort(compareBins), ['CB05A01', 'CB05A02', 'CB05B01', 'CB05B02', 'CB05E01']);
});
test('a code that is not a rack location sorts after every rack bin', () => {
  assert.deepEqual(['STAGING', 'CB01A01', 'CA40E02'].sort(compareBins), ['CA40E02', 'CB01A01', 'STAGING']);
});

console.log('\nRows');

test('one row per stock line, an empty bin gets one row; a line of 0 is not a line', () => {
  const rows = buildCheckRows(['CB02A01', 'CB01A01', 'CB01A02'], [
    line({ bin_code: 'CB01A01', batch_lot: 'B2', expiry_date: '2031-01-01' }),
    line({ bin_code: 'CB01A01', batch_lot: 'B1', expiry_date: '2030-08-20' }),
    line({ bin_code: 'CB02A01', quantity: 0 }),
  ]);
  assert.deepEqual(rows.map((r) => `${r.bin}${r.line ? `/${r.line.batch_lot}` : ' (kosong)'}`),
    ['CB01A01/B1', 'CB01A01/B2', 'CB01A02 (kosong)', 'CB02A01 (kosong)'], 'oldest expiry first inside a bin');
});
test('stock in a bin that is not on the list of usable bins is still listed', () => {
  const rows = buildCheckRows(['CB01A01'], [line({ bin_code: 'CB01A01' }), line({ bin_code: 'CB03A01' })]);
  assert.deepEqual(rows.map((r) => r.bin), ['CB01A01', 'CB03A01']);
});

console.log('\nWhat was typed');

const rows = (): CheckRow[] => buildCheckRows(['CB01A01', 'CB01A02', 'CB02A01'], [
  line({ bin_code: 'CB01A01' }),
  line({ bin_code: 'CB01A02', sku: '550062463', description: 'Advance 0.8L', batch_lot: 'C1', quantity: 10 }),
]);
const key = (bin: string) => lineKey(rows().find((r) => r.bin === bin)!.line!);

test('nothing typed, nothing to save', () => {
  const r = changesOf(rows(), {}, [], SKUS);
  assert.deepEqual([r.changes.length, r.problems.length, r.stale.length], [0, 0, 0]);
});
test('a quantity typed becomes one line with the quantity the page showed as expected_qty', () => {
  const e: Record<string, Edit> = { [key('CB01A01')]: { qty: '46', base: 48 } };
  const r = changesOf(rows(), e, [], SKUS);
  assert.equal(r.changes.length, 1);
  assert.deepEqual(r.changes[0].payload, { bin_code: 'CB01A01', sku: '550044709', add: false, batch_lot: 'B1', expiry_date: '2030-08-20',
    expected_qty: 48, new_batch: 'B1', new_expiry: '2030-08-20', new_qty: 46 });
  assert.equal(describeChange(r.changes[0]), 'CB01A01 · 550044709 — qty 48 → 46');
});
test('batch and expiry: the batch in capitals, all three changes in one line', () => {
  const e: Record<string, Edit> = { [key('CB01A01')]: { qty: '40', batch: ' a9 ', expiry: '2031-02-02', base: 48 } };
  const c = changesOf(rows(), e, [], SKUS).changes[0];
  assert.deepEqual([c.payload.new_batch, c.payload.new_expiry, c.payload.new_qty], ['A9', '2031-02-02', 40]);
  assert.equal(describeChange(c), 'CB01A01 · 550044709 — qty 48 → 40, batch B1 → A9, exp 2030-08-20 → 2031-02-02');
});
test('typed back to what the system holds is no change', () => {
  const e: Record<string, Edit> = { [key('CB01A01')]: { qty: '48', batch: 'b1', base: 48 } };
  assert.equal(changesOf(rows(), e, [], SKUS).changes.length, 0);
});
test('mistakes are caught before anything is sent: a letter, a blank expiry, a year 1930', () => {
  const k = key('CB01A01');
  const text = (e: Edit) => changesOf(rows(), { [k]: e }, [], SKUS).problems.map((p) => p.text).join('|');
  assert.match(text({ qty: '4x', base: 48 }), /bilangan bulat/);
  assert.match(text({ qty: '', base: 48 }), /bilangan bulat/);
  assert.match(text({ expiry: '', base: 48 }), /tidak boleh dikosongkan/);
  assert.match(text({ expiry: '1930-11-02', base: 48 }), /tidak masuk akal/);
  assert.equal(expiryPlausible('2030-11-02'), true);
  assert.equal(expiryPlausible('2130-11-02'), false);
});
test('a line the system changed since it was edited is stale, not sent', () => {
  const r = changesOf(rows(), { [key('CB01A01')]: { qty: '46', base: 50 } }, [], SKUS);
  assert.deepEqual([r.changes.length, r.stale], [0, [key('CB01A01')]]);
});
test('stock found in an empty bin: SKU, quantity and expiry are required, and the SKU must exist', () => {
  const a = (o: Partial<Added>): Added => ({ id: 'a1', bin: 'CB02A01', sku: '550062463', qty: '12', batch: 'n1', expiry: '2031-03-03', ...o });
  const ok = changesOf(rows(), {}, [a({})], SKUS);
  assert.deepEqual([ok.changes.length, ok.problems.length, ok.changes[0].payload.new_batch], [1, 0, 'N1']);
  assert.equal(describeChange(ok.changes[0]), 'CB02A01 · 550062463 — tambah 12, batch N1, exp 2031-03-03');
  assert.match(changesOf(rows(), {}, [a({ sku: '999' })], SKUS).problems[0].text, /tidak ada di master item/);
  assert.match(changesOf(rows(), {}, [a({ qty: '0' })], SKUS).problems[0].text, /di atas 0/);
  assert.match(changesOf(rows(), {}, [a({ expiry: '' })], SKUS).problems[0].text, /expired wajib/);
  assert.equal(changesOf(rows(), {}, [a({ sku: '', qty: '', batch: '', expiry: '' })], SKUS).problems.length, 0, 'an untouched added line is ignored');
});

console.log('\nOne bin, one SKU');

test('a second SKU added to a bin that holds one is flagged; emptying the old one in the same save is not', () => {
  const add: Added = { id: 'a1', bin: 'CB01A01', sku: '550062463', qty: '5', batch: '', expiry: '2031-03-03' };
  const c1 = changesOf(rows(), {}, [add], SKUS).changes;
  assert.deepEqual(multiSkuBins(rows(), c1, true), [{ bin: 'CB01A01', skus: ['550044709', '550062463'] }]);
  const c2 = changesOf(rows(), { [key('CB01A01')]: { qty: '0', base: 48 } }, [add], SKUS).changes;
  assert.deepEqual(multiSkuBins(rows(), c2, true), []);
});
test('a bin that already held two is reported only when asked for every bin', () => {
  const two = buildCheckRows(['CC25A02'], [line({ bin_code: 'CC25A02' }), line({ bin_code: 'CC25A02', sku: '550062463', batch_lot: 'X' })]);
  assert.equal(multiSkuBins(two, [], false).length, 1);
  assert.equal(multiSkuBins(two, [], true).length, 0);
});

console.log('\nA different SKU on the shelf');

test('the physical SKU typed on a line empties the system SKU and adds the new one, in two lines of one save', () => {
  const c = changesOf(rows(), { [key('CB01A01')]: { sku: ' 550062463 ', base: 48 } }, [], SKUS);
  assert.deepEqual([c.problems.length, c.changes.length], [0, 1]);
  const lines = payloadOf(c.changes);
  assert.deepEqual(lines[0], { bin_code: 'CB01A01', sku: '550044709', add: false, batch_lot: 'B1', expiry_date: '2030-08-20',
    expected_qty: 48, new_batch: 'B1', new_expiry: '2030-08-20', new_qty: 0 });
  assert.deepEqual(lines[1], { bin_code: 'CB01A01', sku: '550062463', add: true, new_batch: 'B1', new_expiry: '2030-08-20', new_qty: 48 });
  assert.equal(describeChange(c.changes[0]), 'CB01A01 · 550044709 — SKU 550044709 → 550062463, qty 48 → 48');
  assert.deepEqual(diffOf(c.changes[0]), [{ label: 'SKU', from: '550044709', to: '550062463' }]);
});
test('a SKU swap keeps what else was typed: quantity, batch and expiry go to the new SKU', () => {
  const c = changesOf(rows(), { [key('CB01A01')]: { sku: '550062463', qty: '40', batch: 'z9', expiry: '2031-05-05', base: 48 } }, [], SKUS).changes[0];
  assert.deepEqual(c.extra, { bin_code: 'CB01A01', sku: '550062463', add: true, new_batch: 'Z9', new_expiry: '2031-05-05', new_qty: 40 });
  assert.deepEqual(diffOf(c).map((d) => d.label), ['SKU', 'Qty', 'Batch', 'Exp']);
});
test('a swap to a SKU not in the master, to 0 cartons or without an expiry is a problem, nothing is sent', () => {
  const k = key('CB01A01');
  const text = (e: Edit) => changesOf(rows(), { [k]: e }, [], SKUS).problems.map((p) => p.text).join('|');
  assert.match(text({ sku: '999', base: 48 }), /tidak ada di master item/);
  assert.match(text({ sku: '550062463', qty: '0', base: 48 }), /di atas 0/);
  assert.match(text({ sku: '550062463', expiry: '', base: 48 }), /tidak boleh dikosongkan/);
  assert.equal(changesOf(rows(), { [k]: { sku: '999', base: 48 } }, [], SKUS).changes.length, 0);
});
test('a swap does not make the bin hold two SKUs; the same SKU typed back is no change', () => {
  const c = changesOf(rows(), { [key('CB01A01')]: { sku: '550062463', base: 48 } }, [], SKUS).changes;
  assert.deepEqual(multiSkuBins(rows(), c, true), []);
  assert.equal(changesOf(rows(), { [key('CB01A01')]: { sku: '550044709', base: 48 } }, [], SKUS).changes.length, 0);
});

console.log('\nSummary before and after');

test('totals and per-SKU figures: a quantity difference, a swap and stock found', () => {
  const e: Record<string, Edit> = {
    [key('CB01A01')]: { qty: '46', base: 48 },                       // -2 of 550044709
    [key('CB01A02')]: { sku: '550044709', base: 10 },                // 10 cartons of 550062463 are really 550044709
  };
  const add: Added = { id: 'a1', bin: 'CB02A01', sku: '550062463', qty: '12', batch: 'n1', expiry: '2031-03-03' };
  const { changes } = changesOf(rows(), e, [add], SKUS);
  const s = summarize(rows(), changes, SKUS);
  assert.deepEqual([s.before, s.after, s.plus, s.minus], [58, 68, 12, 2]);
  assert.deepEqual(s.counts, { qty: 1, identity: 0, swap: 1, found: 1 });
  const by = Object.fromEntries(s.skus.map((x) => [x.sku, [x.before, x.after, x.diff]]));
  assert.deepEqual(by['550044709'], [48, 56, 8]);   // 48 - 2 + 10
  assert.deepEqual(by['550062463'], [10, 12, 2]);   // 10 - 10 + 12
  assert.equal(s.after - s.before, s.skus.reduce((n, x) => n + x.diff, 0), 'the SKU rows add up to the total');
});
test('the report kept for good holds the summary and system-vs-shelf per line, not the lines sent to the database', () => {
  const { changes } = changesOf(rows(), { [key('CB01A01')]: { sku: '550062463', qty: '40', base: 48 } }, [], SKUS);
  const r = reportPayload(summarize(rows(), changes, SKUS), changes);
  assert.deepEqual([r.summary.before, r.summary.after, r.changes.length], [58, 50, 1]);
  assert.equal('payload' in r.changes[0] || 'extra' in r.changes[0], false);
  assert.deepEqual(diffOf(r.changes[0]).map((d) => `${d.label} ${d.from}>${d.to}`), ['SKU 550044709>550062463', 'Qty 48>40']);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'survives being stored as JSON');
});
test('no changes: before equals after', () => {
  const s = summarize(rows(), [], SKUS);
  assert.deepEqual([s.before, s.after, s.skus.length], [58, 58, 0]);
});

console.log('\nThe Excel list');

test('one sheet per aisle: title, header repeated on every page, bin order, blanks to write in', async () => {
  const sheetRows = buildCheckRows(['CB02A01', 'CB01A01'], [line({ bin_code: 'CB01A01' })]);
  const buf = await buildStockCheckWorkbook([{ aisle: 'CB', rows: sheetRows }], { date: '2026-11-17' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Rak CB')!;
  assert.match(String(ws.getCell(1, 1).value), /CEK STOK RAK CB/);
  assert.deepEqual((ws.getRow(4).values as unknown[]).slice(1), ['Bin', 'SKU', 'Deskripsi', 'Batch', 'Expired', 'Satuan', 'Qty sistem', 'Qty fisik', 'Batch fisik', 'Expired fisik', 'Catatan']);
  assert.deepEqual([ws.getCell(5, 1).value, ws.getCell(5, 2).value, ws.getCell(5, 7).value, ws.getCell(5, 8).value], ['CB01A01', '550044709', 48, null]);
  assert.deepEqual([ws.getCell(6, 1).value, ws.getCell(6, 3).value], ['CB02A01', '(kosong)']);
  assert.equal(ws.pageSetup.orientation, 'landscape');
  assert.equal(ws.pageSetup.printTitlesRow, '4:4');
  assert.ok(ws.getCell(5, 5).value instanceof Date, 'the expiry is a real Excel date');
});

Promise.all(running).then(() => {
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
});
