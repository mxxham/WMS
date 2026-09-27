import "server-only";
import bwipjs from "bwip-js/node";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { LABEL, LEVEL_COLORS, POSITION_ARROW, STRIP_LEVEL_ORDER, WAREHOUSE_NAME } from "@/config/warehouse";

const MM = 72 / 25.4; // PDF points per millimetre
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

export type LabelBin = { bin_code: string; zone: string; rack: string | null; level: string | null; position: string | null; abc_class: string | null };
export type LabelOptions = {
  layout: "cell" | "strip";     // cell = one 80x85 mm page per bin; strip = one long page per rack upright
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
function drawCell(page: PDFPage, bin: LabelBin, originY: number, opt: LabelOptions, fonts: { bold: PDFFont; reg: PDFFont }, showArrowInBand: boolean) {
  const W = LABEL.cellWidthMm * MM;
  const H = LABEL.cellHeightMm * MM;
  const q = LABEL.quietZoneMm * MM;
  const top = originY + H;
  const cx = W / 2;

  // Warehouse name
  const nameSize = 8;
  centered(page, WAREHOUSE_NAME, fonts.reg, nameSize, cx, top - 3 * MM - nameSize * 0.8, BLACK);

  // QR block
  const qrSize = (opt.includeCode128 ? 34 : 48) * MM;
  const qrTop = top - 8 * MM - q;
  drawQr(page, bin.bin_code, cx - qrSize / 2, qrTop, qrSize);
  let cursor = qrTop - qrSize - q;

  if (opt.includeCode128) {
    const bw = W - 2 * (3 * MM + q); // label margin + quiet zone each side
    const bh = 11 * MM;
    drawCode128(page, bin.bin_code, 3 * MM + q, cursor, bw, bh);
    cursor -= bh + q;
  }

  // Colour band (level colour) or solid black in mono mode.
  const bandH = 15 * MM;
  const bandY = cursor - bandH;
  const levelHex = bin.level ? LEVEL_COLORS[bin.level]?.hex : undefined;
  const bandColor = opt.colorMode === "color" && levelHex ? hexToRgb(levelHex) : BLACK;
  const textColor = opt.colorMode === "color" && levelHex ? BLACK : WHITE;
  page.drawRectangle({ x: 0, y: bandY, width: W, height: bandH, color: bandColor });

  const codeSize = Math.max(LABEL.minBinCodePt, 32);
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
  centered(page, info, fonts.reg, infoSize, cx, bandY - 2 * MM - infoSize * 0.8, BLACK);
}

/** Groups rack bins into upright strips: same aisle + rack + position, levels A..E. */
function toStrips(bins: LabelBin[]): LabelBin[][] {
  const groups = new Map<string, LabelBin[]>();
  for (const b of bins) {
    const key = b.rack ? `${b.zone}-${b.rack}-${b.position}` : `floor-${b.bin_code}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
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
    const A = LABEL.arrowBlockMm * MM;
    for (const strip of toStrips(bins)) {
      const dir = strip[0].position ? POSITION_ARROW[strip[0].position] : undefined;
      const hasArrows = Boolean(strip[0].rack && dir);
      const pageH = strip.length * H + (hasArrows ? 2 * A : 0);
      const page = pdf.addPage([W, pageH]);
      if (hasArrows) {
        drawArrow(page, dir!, W / 2, pageH - A / 2, 34 * MM, BLACK);
        drawArrow(page, dir!, W / 2, A / 2, 34 * MM, BLACK);
      }
      strip.forEach((b, i) => {
        const originY = pageH - (hasArrows ? A : 0) - (i + 1) * H;
        drawCell(page, b, originY, opt, fonts, false);
        // Hairline between cells so a continuous strip can also be cut into cells.
        if (i > 0) page.drawLine({ start: { x: 0, y: originY + H }, end: { x: W, y: originY + H }, thickness: 0.3, color: rgb(0.6, 0.6, 0.6) });
      });
    }
  }
  return pdf.save();
}
