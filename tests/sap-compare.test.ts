/** MB52 / MB51 reading and the SAP vs WMS comparison (lib/sap-stock.ts, lib/sap-compare.ts), on the real 28 Oct 2026 export. */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { dateFromFileName, defaultSlocs, parseMb51, parseMb52, splitBySloc } from '../lib/sap-stock';
import { compareStats, cutoffIso, defaultCutoff, direction, filterLines, flags, gapTotal, hint, isFuture, nowWib, type CompareLine } from '../lib/sap-compare';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nSAP comparison (MB52 + MB51)');
const wb = XLSX.read(readFileSync('data/MB52_2810_28_Oktober_2026.xlsx'), { cellDates: false });

test('MB52: both stock sheets, kept apart by storage location', () => {
  const p = parseMb52(wb);
  assert.deepEqual(p.sheets, ['mb52', 'INBD']);
  // the mb52 sheet also holds one RETN row (550066782, 5: the 311 WHS1 -> RETN in MB51)
  assert.deepEqual(p.slocs.map((s) => [s.sloc, s.skus]), [['INBD', 16], ['RETN', 1], ['WHS1', 105]]);
  const whs = p.slocs.find((s) => s.sloc === 'WHS1')!, retn = p.slocs.find((s) => s.sloc === 'RETN')!;
  // J1 / L1 of the mb52 sheet hold SAP's own totals of that sheet: the rows must add up to them.
  assert.deepEqual([whs.unrestricted + retn.unrestricted, whs.blocked], [59482, 18]);
  assert.deepEqual(p.plants, ['I003']);
  assert.equal(p.skipped.length, 0);
});
test('MB52: a SKU in WHS1 and INBD stays two rows (550070614: 3011 + 3600)', () => {
  const rows = parseMb52(wb).rows.filter((r) => r.sku === '550070614');
  assert.deepEqual(rows.map((r) => [r.sloc, r.unrestricted, r.blocked, r.uom]), [['WHS1', 3011, 12, 'CAR'], ['INBD', 3600, 0, 'CAR']]);
});
test('default counted location is WHS1; INBD and RETN go to "other"', () => {
  const p = parseMb52(wb);
  const counted = defaultSlocs(p.slocs.map((s) => s.sloc));
  assert.deepEqual(counted, ['WHS1']);
  const { sap, other } = splitBySloc(p.rows, counted);
  assert.equal(sap.length, 105);
  assert.equal(other.length, 17);
  assert.deepEqual([...new Set(other.map((o) => o.sloc))].sort(), ['INBD', 'RETN']);
});
test('defaultSlocs without WHS1 skips inbound / transit locations', () => {
  assert.deepEqual(defaultSlocs(['INBD', 'WHS2']), ['WHS2']);
  assert.deepEqual(defaultSlocs(['INBD']), ['INBD']);
});
test('MB51: 40 lines, posting date from the Excel serial, signed quantity, DO without leading zero', () => {
  const m = parseMb51(wb);
  assert.equal(m.sheet, 'mb51');
  assert.equal(m.rows.length, 40);
  assert.deepEqual([m.from, m.to], ['2026-10-27', '2026-10-27']);
  const gi = m.rows.find((r) => r.mat_doc === '3331845754' && r.sku === '550024919')!;
  assert.deepEqual([gi.mvt_type, gi.quantity, gi.uom, gi.reference, gi.sloc], ['601', -5, 'EA', '539230381', 'WHS1']);
  const ret = m.rows.find((r) => r.sloc === 'RETN')!;
  assert.deepEqual([ret.mvt_type, ret.quantity], ['311', 5]);
  assert.ok(m.rows.some((r) => r.mvt_type === 'Z31'));
});
test('only the chosen sheets are read', () => {
  const p = parseMb52(wb, ['INBD']);
  assert.deepEqual([p.sheets, p.rows.length], [['INBD'], 16]);
});
test('stock date from the file name', () => {
  assert.equal(dateFromFileName('MB52 2810_28 Oktober 2026.xlsx'), '2026-10-28');
  assert.equal(dateFromFileName('mb52_5 Agustus 2026.xlsx'), '2026-08-05');
  assert.equal(dateFromFileName('MB52 12 Mei 2026.xlsx'), '2026-05-12');
  assert.equal(dateFromFileName('stock 2026-11-02.xlsx'), '2026-11-02');
  assert.equal(dateFromFileName('MB52.xlsx'), null);
});
test('a workbook with only MB51 gives a clear MB52 error', () => {
  const b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(b, wb.Sheets['mb51'], 'mb51');
  assert.throws(() => parseMb52(b), /Tidak ada sheet MB52/);
});

const line = (o: Partial<CompareLine>): CompareLine => ({
  sku: '550000001', description: 'X', item_id: 'i', sap_uom: 'CAR', wms_uom: 'CAR', sap_unrestricted: 0, sap_blocked: 0,
  wms_unrestricted: 0, wms_blocked: 0, pending_gi: 0, pending_gr: 0, auto_gi: 0, diff_unrestricted: 0, diff_blocked: 0,
  sap_other: {}, status: 'OPEN', cause: null, ...o,
});
// diff as the database computes it
const db = (o: Partial<CompareLine>) => {
  const l = line(o);
  return { ...l, diff_unrestricted: l.sap_unrestricted - (l.wms_unrestricted + l.pending_gi + l.auto_gi - l.pending_gr), diff_blocked: l.sap_blocked - l.wms_blocked };
};

test('gap reads from our side: WMS 105 vs SAP 100 = +5 (lebih)', () => {
  const l = db({ sap_unrestricted: 100, wms_unrestricted: 105 });
  assert.equal(gapTotal(l), 5);
  assert.equal(direction(l), 'MORE');
});
test('pending GI / auto GI close a timing gap', () => {
  assert.equal(direction(db({ sap_unrestricted: 100, wms_unrestricted: 90, pending_gi: 6, auto_gi: 4 })), 'MATCH');
});
test('more free stock but less blocked is MIXED, flagged as a status difference', () => {
  const l = db({ sap_unrestricted: 10, sap_blocked: 2, wms_unrestricted: 12, wms_blocked: 0 });
  assert.equal(direction(l), 'MIXED');
  assert.ok(flags(l).includes('STATUS'));
});
test('a surplus equal to SAP INBD stock hints "still in INBD"', () => {
  const l = db({ sap_unrestricted: 3011, wms_unrestricted: 6611, sap_other: { INBD: 3600 } });
  assert.equal(hint(l)?.cause, 'SAP_INBOUND');
  assert.match(hint(l)!.text, /persis/);
  assert.equal(hint(db({ sap_unrestricted: 0, wms_unrestricted: 5, sap_other: { RETN: 5 } }))?.cause, 'RETURN');
});
test('stats: SKU and quantity accuracy, more / less totals', () => {
  const lines = [db({ sku: 'a', sap_unrestricted: 100, wms_unrestricted: 100 }), db({ sku: 'b', sap_unrestricted: 100, wms_unrestricted: 90 }),
    db({ sku: 'c', sap_unrestricted: 0, wms_unrestricted: 10 })];
  const s = compareStats(lines);
  assert.deepEqual([s.match, s.more, s.less, s.moreQty, s.lessQty, s.onlyWms], [1, 1, 1, 10, 10, 1]);
  assert.equal(s.qtyAccuracy, 90);
  assert.equal(Math.round(s.skuAccuracy!), 33);
});
test('filter + search + sort', () => {
  const lines = [db({ sku: '1', description: 'Helix', sap_unrestricted: 10, wms_unrestricted: 4 }),
    db({ sku: '2', description: 'Rimula', sap_unrestricted: 10, wms_unrestricted: 1 }), db({ sku: '3', sap_unrestricted: 5, wms_unrestricted: 5 })];
  assert.deepEqual(filterLines(lines, 'less', '', 'gap').map((l) => l.sku), ['2', '1']);
  assert.deepEqual(filterLines(lines, 'all', 'helix', 'gap').map((l) => l.sku), ['1']);
  assert.deepEqual(filterLines(lines, 'match', '', 'gap').map((l) => l.sku), ['3']);
});

test('cut-off: 00:00 WIB of the SAP stock date, sent with the +07:00 offset', () => {
  assert.equal(defaultCutoff('2026-10-28'), '2026-10-28T00:00');
  assert.equal(cutoffIso('2026-10-28T09:45'), '2026-10-28T09:45:00+07:00');
  assert.equal(new Date(cutoffIso('2026-10-28T00:00')).toISOString(), '2026-10-27T17:00:00.000Z');
  const at = new Date('2026-10-28T03:00:00Z'); // 10:00 WIB
  assert.equal(nowWib(at), '2026-10-28T10:00');
  assert.equal(isFuture('2026-10-28T09:59', at), false);
  assert.equal(isFuture('2026-10-28T10:01', at), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
