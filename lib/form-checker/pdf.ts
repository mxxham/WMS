import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from "pdf-lib";
import { PALLET_CARD } from "@/config/warehouse";
import type { FormCheckerCard } from "./types";

const MM = 72 / 25.4; // PDF points per millimetre
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.45, 0.45, 0.45);
const RULE = rgb(0.7, 0.7, 0.7);

/** Item master fields joined onto each card (from the items table by SKU). */
export type CardMaster = { uom: string | null };

/** The surface the card stack draws on — the real PDF page or the measuring stub. */
type CardCanvas = {
  drawText(text: string, options: { x: number; y: number; size: number; font: PDFFont; color: RGB }): unknown;
  drawRectangle(options: { x: number; y: number; width: number; height: number; color?: RGB }): unknown;
};

/**
 * Horizontal rule drawn as a filled rectangle, not a stroke. Hairline strokes are
 * the one PDF primitive that some browsers' print pipelines (pdf.js in Firefox, in
 * particular) drop when rasterising for print — the fill below has no stroke-width
 * semantics, so the ruled write-in lines survive in every viewer.
 */
function hline(canvas: CardCanvas, x: number, y: number, width: number, thickness: number, color: RGB) {
  canvas.drawRectangle({ x, y: y - thickness / 2, width, height: thickness, color });
}

function centered(canvas: CardCanvas, text: string, font: PDFFont, size: number, cx: number, baseline: number, color: RGB) {
  canvas.drawText(text, { x: cx - font.widthOfTextAtSize(text, size) / 2, y: baseline, size, font, color });
}

/** Measuring canvas factory: replays the card layout and records the extremes of
 * the drawn ink in full glyph-box terms (Helvetica ascent 0.718 / descent 0.207
 * of the size, matching what viewers and pdftotext report), lines included, so
 * centring balances what the eye sees on the printed sheet. */
function createMeasure(): { canvas: CardCanvas; midpoint: () => number } {
  let top = -Number.POSITIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  return {
    midpoint: () => Number.isFinite(top) && Number.isFinite(bottom) ? (top + bottom) / 2 : Number.NaN,
    canvas: {
      drawText(_text: string, options: { x: number; y: number; size: number; font: PDFFont; color: RGB }) {
        top = Math.max(top, options.y + 0.718 * options.size);
        bottom = Math.min(bottom, options.y - 0.207 * options.size);
      },
      drawRectangle(options: { x: number; y: number; width: number; height: number; color?: RGB }) {
        top = Math.max(top, options.y + options.height);
        bottom = Math.min(bottom, options.y);
      },
    },
  };
}

/**
 * Draws one card's content stack, top-anchored at yStart (PDF's y axis points up);
 * returns the final y. Every card runs this twice: once on MEASURE to learn the
 * stack height, once on the real page shifted so the stack is vertically centred.
 */
function cardStack(
  canvas: CardCanvas,
  card: FormCheckerCard,
  uom: string,
  fonts: { reg: PDFFont; bold: PDFFont },
  C: typeof PALLET_CARD,
  inner: number,
  cx: number,
  yStart: number,
): number {
  let y = yStart;
  const dy = (h: number) => { y -= h; };

  // Item code — the first thing a checker reads from below
  centered(canvas, "SKU", fonts.reg, C.labelPt, cx, y - C.labelPt, GRAY);
  dy(C.labelPt + 4);
  {
    let skuSize = C.skuPt;
    const code = String(card.itemCode);
    while (fonts.bold.widthOfTextAtSize(code, skuSize) > inner && skuSize > 60) skuSize -= 4;
    centered(canvas, code, fonts.bold, skuSize, cx, y - skuSize * 0.95, BLACK);
    dy(skuSize * 1.15 + 5);
  }

  // Rule between the item code and the quantities
  hline(canvas, cx - inner / 2, y, inner, 0.6, RULE);
  dy(14);

  // Quantity + UoM — the bare number, its meaning is obvious on a pallet card
  dy(10); // gap in place of the removed field label
  const qty = card.actQty === null ? "—" : String(card.actQty);
  const qtyW = fonts.bold.widthOfTextAtSize(qty, C.qtyPt);
  const uomText = uom || "—";
  const uomW = fonts.bold.widthOfTextAtSize(` ${uomText}`, C.uomPt);
  const startX = cx - (qtyW + uomW) / 2;
  canvas.drawText(qty, { x: startX, y: y - C.qtyPt * 0.95, size: C.qtyPt, font: fonts.bold, color: BLACK });
  canvas.drawText(` ${uomText}`, { x: startX + qtyW, y: y - C.qtyPt * 0.98, size: C.uomPt, font: fonts.bold, color: GRAY });
  dy(C.qtyPt * 1.1 + 6);

  // BATCH NO. — must be readable from across the floor, so it sits right under the quantities.
  dy(4);
  centered(canvas, "BATCH NO.", fonts.reg, C.labelPt, cx, y - C.labelPt, GRAY);
  dy(C.labelPt + 2);
  if (card.batchNo) {
    let batchSize = C.batchPt;
    while (fonts.bold.widthOfTextAtSize(card.batchNo, batchSize) > inner && batchSize > 40) batchSize -= 4;
    centered(canvas, card.batchNo, fonts.bold, batchSize, cx, y - batchSize * 0.95, BLACK);
    dy(batchSize * 1.1 + 6);
  } else {
    const lineWb = inner * 0.7;
    hline(canvas, cx - lineWb / 2, y - C.batchPt * 0.75, lineWb, 1, BLACK);
    dy(C.batchPt * 0.95 + 10);
  }

  // LOCATION — where this pallet belongs/what it holds.
  dy(4);
  centered(canvas, "LOCATION", fonts.reg, C.labelPt, cx, y - C.labelPt, GRAY);
  dy(C.labelPt + 2);
  if (card.binLocation) {
    // Shrink-to-fit safety: a location string wider than the card steps down before wrapping.
    let locSize = C.locationPt;
    while (fonts.bold.widthOfTextAtSize(card.binLocation, locSize) > inner && locSize > 40) locSize -= 4;
    centered(canvas, card.binLocation, fonts.bold, locSize, cx, y - locSize * 0.95, BLACK);
    dy(locSize * 1.1 + 6);
  } else {
    // Hand-writing ruled line, nearly full width (filled at the dock).
    const lineW = inner * 0.9;
    hline(canvas, cx - lineW / 2, y - C.locationPt * 0.75, lineW, 1, BLACK);
    dy(C.locationPt * 0.95 + 10);
  }

  // Optional detail strip: exp/GR/putaway, one shrink-to-fit gray line.
  const details: [string, string][] = [];
  if (card.expDate) details.push(["Exp", card.expDate]);
  if (card.grNo) details.push(["GR No", card.grNo]);
  if (card.putawayNo) details.push(["Putaway", card.putawayNo]);
  if (details.length) {
    dy(6);
    let size = C.detailPt;
    const text = details.map(([l, v]) => `${l}: ${v}`).join("    ·    ");
    while (fonts.reg.widthOfTextAtSize(text, size) > inner && size > 8) size -= 1;
    centered(canvas, text, fonts.reg, size, cx, y - size, GRAY);
    dy(size * 1.4);
  }
  dy(12);
  return y;
}

/**
 * One A4 landscape page per pallet (page.count === cards.length). Vertical stack, all centred:
 * item code (largest on the page) → quantity + UoM (bare number, no label) →
 * BATCH NO. (readable from across the floor; ruled line when blank) →
 * LOCATION (ruled line when blank) →
 * optional detail strip (exp/GR/putaway in one gray line).
 * Long values shrink to fit instead of shrinking the SKU or wrapping off-page.
 * The whole stack is vertically centred on the sheet, so cards with blank
 * batch/location and no detail strip no longer print top-heavy.
 */
export async function buildPalletCardPdf(cards: FormCheckerCard[], master: Map<string, CardMaster>): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Kartu palet WSM SUB 2 (${cards.length})`);
  const fonts = {
    reg: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const C = PALLET_CARD;
  const W = C.pageWidthMm * MM, H = C.pageHeightMm * MM;
  const M = C.marginMm * MM;
  const inner = W - 2 * M;
  const cx = W / 2;

  for (const card of cards) {
    const page = pdf.addPage([W, H]);
    const m = master.get(String(card.itemCode));
    const uom = m?.uom ?? card.actUom ?? card.orderUom ?? "";

    // Cutting/print border at the page edge, 2 mm outside the content margin —
    // a frame of filled strips, same reason as hline() above.
    const bx = M - 2 * MM, by = M - 2 * MM, bw = inner + 4 * MM, bh = H - 2 * M + 4 * MM;
    hline(page, bx, by, bw, 0.6, RULE);
    hline(page, bx, by + bh, bw, 0.6, RULE);
    hline(page, bx, by, 0.6, bh, RULE); // vertical strip: height is the extent
    page.drawRectangle({ x: bx + bw - 0.6, y: by, width: 0.6, height: bh, color: RULE });

    // Measure the ink mid-point, then draw so that ink is vertically centred on
    // the sheet: cards with blank batch/location and no detail strip used to
    // print top-heavy. Shift never moves content above the original margin
    // (overfull cards keep the top-anchor).
    const yTop = H - M;
    const measure = createMeasure();
    cardStack(measure.canvas, card, uom, fonts, C, inner, cx, yTop);
    const shift = Number.isFinite(measure.midpoint()) ? Math.min(0, H / 2 - measure.midpoint()) : 0;
    cardStack(page, card, uom, fonts, C, inner, cx, yTop + shift);
  }
  return pdf.save();
}
