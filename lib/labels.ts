import "server-only";
import bwipjs from "bwip-js/node";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { LABEL, LEVEL_COLORS, POSITION_ARROW, STRIP_LEVEL_ORDER, WAREHOUSE_NAME } from "@/config/warehouse";

const MM = 72 / 25.4; // PDF points per millimetre
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

export type LabelBin = { bin_code: string; zone: string; rack: string | null; level: string | null; position: string | null; abc_class: string | null };
export type LabelOptions = {
  layout: "cell" | "strip";     // cell = one 80x85 mm page per bin; strip = rack uprights, two per A4 sheet
  colorMode: "color" | "mono";  // mono for direct-thermal printers (black only)
  includeCode128: boolean;      // add a Code 128 above the colour band
};

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Draws a QR code as vector squares. bwip-js returns filled SVG paths whose
 * inner rings wind the opposite way, so PDF's non-zero fill keeps the holes.
 * Vector output stays sharp at any printer resolution (no bitmap scaling).
 */
function drawQr(page: PDFPage, text: string, x: number, yTop: number, sizePt: number) {
  // eclevel is a valid BWIPP option but missing from the bundled typings.
  const svg = bwipjs.toSVG({ bcid: "qrcode", text, ...({ eclevel: "M" } as object) });
  const view = Number(svg.match(/viewBox="0 0 (\d+) /)![1]);
  const scale = sizePt / view;
  for (const m of svg.matchAll(/<path[^>]*d="([^"]+)"/g)) {
    page.drawSvgPath(m[1], { x, y: yTop, scale, color: BLACK, borderWidth: 0 });
  }
}

/** Code 128 from bwip-js stroke paths, redrawn as filled bars (exact bar widths). */
function drawCode128(page: PDFPage, text: string, x: number, yTop: number, widthPt: number, heightPt: number) {
  const svg = bwipjs.toSVG({ bcid: "code128", text, height: 10 });
  const [, vw, vh] = svg.match(/viewBox="0 0 (\d+) (\d+)"/)!.map(Number);
  const sx = widthPt / vw;
  for (const g of svg.matchAll(/<path stroke="[^"]*" stroke-width="(\d+)" d="([^"]+)"/g)) {
    const w = Number(g[1]);
    for (const bar of g[2].matchAll(/M(\d+(?:\.\d+)?) \d+L/g)) {
      const cx = Number(bar[1]);
      page.drawRectangle({ x: x + (cx - w / 2) * sx, y: yTop - heightPt, width: w * sx, height: heightPt, color: BLACK });
    }
  }
  return vh;
}

/** Filled arrow pointing left or right, centred in a box. */
function drawArrow(page: PDFPage, dir: "left" | "right", cx: number, cy: number, lengthPt: number, color: RGB) {
  const h = lengthPt * 0.28; // head height
  const shaft = lengthPt * 0.09;
  const s = dir === "left" ? -1 : 1;
  const tip = cx + (s * lengthPt) / 2, tail = cx - (s * lengthPt) / 2, neck = tip - s * h;
  // pdf-lib's drawSvgPath uses a y-down coordinate system anchored at (x, y).
  const p = (px: number, py: number) => `${px} ${-py}`;
  const d = `M ${p(tail, cy + shaft)} L ${p(neck, cy + shaft)} L ${p(neck, cy + h / 1.4)} L ${p(tip, cy)} L ${p(neck, cy - h / 1.4)} L ${p(neck, cy - shaft)} L ${p(tail, cy - shaft)} Z`;
  page.drawSvgPath(d, { x: 0, y: 0, color, borderWidth: 0 });
}

function centered(page: PDFPage, text: string, font: PDFFont, size: number, cx: number, baseline: number, color: RGB) {
  page.drawText(text, { x: cx - font.widthOfTextAtSize(text, size) / 2, y: baseline, size, font, color });
}

/**
 * One 80 x 85 mm cell, top to bottom:
 * warehouse name -> QR (with 3 mm quiet zone) -> [Code 128] -> colour band with
 * bin code (>= 28 pt bold) and bay arrow -> aisle / rack / level / position / ABC (>= 8 pt).
 */
/** Sizes inside a cell (mm, pt). Per sel uses CELL; the A4 strips use the compact A4_CELL. */
type CellDims = { heightMm: number; nameTopMm: number; nameSize: number; qrTopMm: number; qrMm: number; qrWithCode128Mm: number; code128Mm: number; code128GapMm: number; bandMm: number; codePt: number; infoGapMm: number };
const CELL: CellDims = { heightMm: LABEL.cellHeightMm, nameTopMm: 3, nameSize: 8, qrTopMm: 8, qrMm: 48, qrWithCode128Mm: 34, code128Mm: 11, code128GapMm: LABEL.quietZoneMm, bandMm: 15, codePt: 32, infoGapMm: 2 };
const A4_CELL: CellDims = {
  heightMm: LABEL.a4.cellHeightMm, nameTopMm: 1.5, nameSize: 6.5, qrTopMm: 4, qrMm: LABEL.a4.qrMm, qrWithCode128Mm: LABEL.a4.qrWithCode128Mm,
  code128Mm: LABEL.a4.code128Mm, code128GapMm: 2, bandMm: LABEL.a4.bandMm, codePt: LABEL.minBinCodePt, infoGapMm: 1.2,
};

function drawCell(page: PDFPage, bin: LabelBin, originY: number, opt: LabelOptions, fonts: { bold: PDFFont; reg: PDFFont }, showArrowInBand: boolean, x = 0, widthMm: number = LABEL.cellWidthMm, d: CellDims = CELL) {
  const W = widthMm * MM;
  const H = d.heightMm * MM;
  const q = LABEL.quietZoneMm * MM;
  const top = originY + H;
  const cx = x + W / 2;

  // Warehouse name
  const nameSize = d.nameSize;
  centered(page, WAREHOUSE_NAME, fonts.reg, nameSize, cx, top - d.nameTopMm * MM - nameSize * 0.8, BLACK);

  // QR block
  const qrSize = (opt.includeCode128 ? d.qrWithCode128Mm : d.qrMm) * MM;
  const qrTop = top - d.qrTopMm * MM - q;
  drawQr(page, bin.bin_code, cx - qrSize / 2, qrTop, qrSize);
  let cursor = qrTop - qrSize - q;

  if (opt.includeCode128) {
    const bw = W - 2 * (3 * MM + q); // label margin + quiet zone each side
    const bh = d.code128Mm * MM;
    drawCode128(page, bin.bin_code, x + 3 * MM + q, cursor, bw, bh);
    cursor -= bh + d.code128GapMm * MM;
  }

  // Colour band (level colour) or solid black in mono mode.
  const bandH = d.bandMm * MM;
  const bandY = cursor - bandH;
  const levelHex = bin.level ? LEVEL_COLORS[bin.level]?.hex : undefined;
  const bandColor = opt.colorMode === "color" && levelHex ? hexToRgb(levelHex) : BLACK;
  const textColor = opt.colorMode === "color" && levelHex ? BLACK : WHITE;
  page.drawRectangle({ x, y: bandY, width: W, height: bandH, color: bandColor });

  const codeSize = Math.max(LABEL.minBinCodePt, d.codePt);
  const codeW = fonts.bold.widthOfTextAtSize(bin.bin_code, codeSize);
  const arrowDir = bin.position ? POSITION_ARROW[bin.position] : undefined;
  const arrowLen = 11 * MM;
  const gap = 3 * MM;
  const groupW = codeW + (showArrowInBand && arrowDir ? arrowLen + gap : 0);
  let textX = cx - groupW / 2;
  const midY = bandY + bandH / 2;
  if (showArrowInBand && arrowDir === "left") {
    drawArrow(page, "left", textX + arrowLen / 2, midY, arrowLen, textColor);
    textX += arrowLen + gap;
  }
  page.drawText(bin.bin_code, { x: textX, y: midY - codeSize * 0.35, size: codeSize, font: fonts.bold, color: textColor });
  if (showArrowInBand && arrowDir === "right") drawArrow(page, "right", textX + codeW + gap + arrowLen / 2, midY, arrowLen, textColor);

  // Info line
  const info = bin.rack
    ? `Aisle ${bin.zone}  Rak ${bin.rack}  Level ${bin.level}  Pos ${bin.position}  ABC ${bin.abc_class ?? "-"}`
    : `Area ${bin.zone}${bin.position ? `  Lajur ${bin.position}` : ""}  ABC ${bin.abc_class ?? "-"}`;
  const infoSize = Math.max(LABEL.minInfoPt, 9);
  centered(page, info, fonts.reg, infoSize, cx, bandY - d.infoGapMm * MM - infoSize * 0.8, BLACK);
}

/** Groups rack bins into upright strips: same aisle + rack + position, levels A..E. */
function toStrips(bins: LabelBin[]): LabelBin[][] {
  const groups = new Map<string, LabelBin[]>();
  for (const b of bins) {
    if (!b.rack) continue;
    const key = `${b.zone}-${b.rack}-${b.position}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  // Floor bins have no upright: five to a strip, in order, so they fill the sheet like racks do.
  const floor = bins.filter((b) => !b.rack);
  for (let i = 0; i < floor.length; i += LABEL.a4.levels) groups.set(`floor-${i}`, floor.slice(i, i + LABEL.a4.levels));
  const order = (l: string | null) => (l ? STRIP_LEVEL_ORDER.indexOf(l as (typeof STRIP_LEVEL_ORDER)[number]) : 0);
  return [...groups.values()].map((g) => g.sort((a, b) => order(a.level) - order(b.level)));
}

export async function buildLabelPdf(bins: LabelBin[], opt: LabelOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Label bin WSM SUB 2 (${bins.length})`);
  const fonts = { bold: await pdf.embedFont(StandardFonts.HelveticaBold), reg: await pdf.embedFont(StandardFonts.Helvetica) };
  const W = LABEL.cellWidthMm * MM;
  const H = LABEL.cellHeightMm * MM;

  if (opt.layout === "cell") {
    for (const b of bins) {
      const page = pdf.addPage([W, H]);
      drawCell(page, b, 0, opt, fonts, true);
    }
  } else {
    // A4 portrait (LABEL.a4): two uprights side by side, the Per sel layout made compact, all five
    // levels on one sheet, no arrows. Print at 100%.
    const g = LABEL.a4;
    const SW = g.stripWidthMm * MM, CH = g.cellHeightMm * MM, M = g.marginMm * MM;
    const xs = [M, M + SW + g.gapMm * MM];
    const top = 297 * MM - (297 * MM - g.levelsPerSheet * CH) / 2; // centred vertically
    const strips = toStrips(bins);
    for (let s = 0; s < strips.length; s += 2) {
      const pair = strips.slice(s, s + 2);
      const rows = Math.max(...pair.map((st) => st.length));
      for (let r0 = 0; r0 < rows; r0 += g.levelsPerSheet) {
        const page = pdf.addPage([210 * MM, 297 * MM]);
        pair.forEach((strip, col) => {
          const x = xs[col];
          const cells = strip.slice(r0, r0 + g.levelsPerSheet);
          cells.forEach((b, i) => {
            const originY = top - (i + 1) * CH;
            drawCell(page, b, originY, opt, fonts, false, x, g.stripWidthMm, A4_CELL);
            // Hairline between cells so a strip can also be cut into single cells.
            if (i > 0) page.drawLine({ start: { x, y: originY + CH }, end: { x: x + SW, y: originY + CH }, thickness: 0.3, color: rgb(0.6, 0.6, 0.6) });
          });
          // Cutting outline around this sheet's part of the strip.
          if (cells.length) page.drawRectangle({ x, y: top - cells.length * CH, width: SW, height: cells.length * CH, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.3 });
        });
      }
    }
  }
  return pdf.save();
}
