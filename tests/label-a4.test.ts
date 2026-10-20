/**
 * Rack-upright strips on A4 (Label page, "Strip tiang rak"): the original cell layout (QR above the
 * colour band) made compact, two strips side by side, each at least 8.5 cm wide, no arrows, all five
 * levels of both uprights on one sheet. Builds the real PDF.
 * Run with --conditions=react-server (lib/labels.ts is server-only).
 */
import { strict as assert } from 'node:assert';
import { PDFDocument } from 'pdf-lib';
import { buildLabelPdf, type LabelBin } from '../lib/labels';
import { LABEL } from '../config/warehouse';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
console.log('\nLabel strips on A4');

const MM = 72 / 25.4;
const A4 = { w: 210 * MM, h: 297 * MM };
const upright = (zone: string, rack: string, position: string): LabelBin[] =>
  ['A', 'B', 'C', 'D', 'E'].map((level) => ({ bin_code: `${zone}${rack}${level}${position}`, zone, rack, level, position, abc_class: 'A' }));

async function pages(bins: LabelBin[]) {
  const doc = await PDFDocument.load(await buildLabelPdf(bins, { layout: 'strip', colorMode: 'color', includeCode128: true }));
  return doc.getPages().map((p) => p.getSize());
}

(async () => {
  await test('each strip is at least 8.5 cm wide, two fit side by side on A4 with margins and a cutting gap', () => {
    assert.ok(LABEL.a4.stripWidthMm >= 85, `strip ${LABEL.a4.stripWidthMm} mm`);
    assert.ok(2 * LABEL.a4.marginMm + 2 * LABEL.a4.stripWidthMm + LABEL.a4.gapMm <= 210, 'two strips do not fit across A4');
  });
  await test('all five levels fit down A4, no arrow blocks', () => {
    assert.equal(LABEL.a4.levelsPerSheet, 5);
    assert.ok(5 * LABEL.a4.cellHeightMm + 2 * LABEL.a4.marginMm <= 297, 'five cells do not fit down A4');
    assert.ok(!('arrowBlockMm' in LABEL.a4), 'arrow blocks are still configured');
  });
  await test('each compact cell holds its parts: name, QR with 3 mm quiet zone, [Code 128], band, info line', () => {
    const a = LABEL.a4, q = LABEL.quietZoneMm;
    const nameMm = 4, gapMm = 2, infoMm = 5;
    assert.ok(nameMm + q + a.qrWithCode128Mm + q + a.code128Mm + gapMm + a.bandMm + infoMm <= a.cellHeightMm, 'with Code 128 the cell overflows');
    assert.ok(nameMm + q + a.qrMm + q + a.bandMm + infoMm <= a.cellHeightMm, 'without Code 128 the cell overflows');
    assert.ok(a.qrWithCode128Mm >= 20, 'QR under 2 cm is too small to scan reliably');
    assert.ok(a.bandMm * 72 / 25.4 >= LABEL.minBinCodePt * 0.9, 'the band cannot hold the minimum bin code size');
  });
  await test('two uprights: one A4 sheet', async () => {
    const p = await pages([...upright('CA', '01', '01'), ...upright('CA', '01', '02')]);
    assert.equal(p.length, 1);
    assert.ok(Math.abs(p[0].width - A4.w) < 0.5 && Math.abs(p[0].height - A4.h) < 0.5, `page ${p[0].width}x${p[0].height} pt is not A4`);
  });
  await test('three uprights: two sheets (the second has one strip)', async () => {
    const p = await pages([...upright('CA', '01', '01'), ...upright('CA', '01', '02'), ...upright('CA', '02', '01')]);
    assert.equal(p.length, 2);
  });
  await test('floor bins (no rack) are packed five to a strip, not one strip each', async () => {
    const floor: LabelBin[] = Array.from({ length: 10 }, (_, i) => ({ bin_code: `STG_${String(i + 1).padStart(2, '0')}`, zone: 'STAGING', rack: null, level: null, position: String(i + 1).padStart(2, '0'), abc_class: null }));
    assert.equal((await pages(floor)).length, 1);
  });
  await test('Per sel is unchanged: one 80 x 85 mm page per bin', async () => {
    const doc = await PDFDocument.load(await buildLabelPdf(upright('CA', '01', '01'), { layout: 'cell', colorMode: 'mono', includeCode128: false }));
    const s = doc.getPages().map((p) => p.getSize());
    assert.equal(s.length, 5);
    assert.ok(Math.abs(s[0].width - 80 * MM) < 0.5 && Math.abs(s[0].height - 85 * MM) < 0.5);
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
})();
