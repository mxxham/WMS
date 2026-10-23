import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { PALLET_CARD } from "@/config/warehouse";
import type { FormCheckerCard } from "./types";

const MM = 72 / 25.4; // PDF points per millimetre
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.45, 0.45, 0.45);
const RULE = rgb(0.7, 0.7, 0.7);

/** Item master fields joined onto each card (from the items table by SKU). */
export type CardMaster = { uom: string | null };

function centered(page: PDFPage, text: string, font: PDFFont, size: number, cx: number, baseline: number, color: RGB) {
  page.drawText(text, { x: cx - font.widthOfTextAtSize(text, size) / 2, y: baseline, size, font, color });
}

/**
 * One A4 landscape page per pallet (page.count === cards.length). Vertical stack, all centred:
 * shipment context → item code (largest on the page) → ACT. QTY + UoM →
 * BATCH NO. (readable from across the floor; ruled line when blank) →
 * LOCATION (ruled line when blank) →
 * optional detail strip (exp/GR/putaway in one gray line).
 * Long values shrink to fit instead of shrinking the SKU or wrapping off-page.
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
  const colW = inner / 2 - 24;

  for (const card of cards) {
    const page = pdf.addPage([W, H]);
    const m = master.get(String(card.itemCode));
    const uom = m?.uom ?? card.actUom ?? card.orderUom ?? "";

    // Cutting/print border at the page edge, 2 mm outside the content margin.
    page.drawRectangle({ x: M - 2 * MM, y: M - 2 * MM, width: inner + 4 * MM, height: H - 2 * M + 4 * MM, borderColor: RULE, borderWidth: 0.3 });

    let y = H - M; // cursor measured from the top; every block subtracts its height
    const advance = (h: number) => { y -= h; };

    // Shipment context band
    const context = [`Bulan: ${card.month}`, card.userName, `Shipment: ${card.shipmentNo}`].filter((s) => s && !s.endsWith(": ")).join("  ·  ");
    centered(page, context, fonts.reg, C.contextPt, cx, y - C.contextPt, GRAY);
    advance(C.contextPt * 1.5 + 10);

    // Item code — the first thing a checker reads from below
    centered(page, "SKU", fonts.reg, C.labelPt, cx, y - C.labelPt, GRAY);
    advance(C.labelPt + 4);
    {
      let skuSize = C.skuPt;
      const code = String(card.itemCode);
      while (fonts.bold.widthOfTextAtSize(code, skuSize) > inner && skuSize > 60) skuSize -= 4;
      centered(page, code, fonts.bold, skuSize, cx, y - skuSize * 0.95, BLACK);
      advance(skuSize * 1.15 + 5);
    }

    // Rule between the item code and the quantities
    page.drawLine({ start: { x: M, y }, end: { x: M + inner, y }, thickness: 0.5, color: RULE });
    advance(14);

    // ACT. QTY + UoM
    centered(page, "ACT. QTY", fonts.reg, C.labelPt, cx, y - C.labelPt, GRAY);
    advance(C.labelPt + 2);
    const qty = card.actQty === null ? "—" : String(card.actQty);
    const qtyW = fonts.bold.widthOfTextAtSize(qty, C.qtyPt);
    const uomText = uom || "—";
    const uomW = fonts.bold.widthOfTextAtSize(` ${uomText}`, C.uomPt);
    const startX = cx - (qtyW + uomW) / 2;
    page.drawText(qty, { x: startX, y: y - C.qtyPt * 0.95, size: C.qtyPt, font: fonts.bold, color: BLACK });
    page.drawText(` ${uomText}`, { x: startX + qtyW, y: y - C.qtyPt * 0.98, size: C.uomPt, font: fonts.bold, color: GRAY });
    advance(C.qtyPt * 1.1 + 6);

    // BATCH NO. — must be readable from across the floor, so it sits right under the quantities.
    advance(4);
    const batchLabelW = fonts.reg.widthOfTextAtSize("BATCH NO.", C.labelPt);
    page.drawText("BATCH NO.", { x: cx - batchLabelW / 2, y: y - C.labelPt, size: C.labelPt, font: fonts.reg, color: GRAY });
    advance(C.labelPt + 2);
    if (card.batchNo) {
      let batchSize = C.batchPt;
      while (fonts.bold.widthOfTextAtSize(card.batchNo, batchSize) > inner && batchSize > 40) batchSize -= 4;
      centered(page, card.batchNo, fonts.bold, batchSize, cx, y - batchSize * 0.95, BLACK);
      advance(batchSize * 1.1 + 6);
    } else {
      const lineWb = inner * 0.7;
      page.drawLine({ start: { x: cx - lineWb / 2, y: y - C.batchPt * 0.75 }, end: { x: cx + lineWb / 2, y: y - C.batchPt * 0.75 }, thickness: 0.7, color: BLACK });
      advance(C.batchPt * 0.95 + 10);
    }

    // LOCATION — where this pallet belongs/what it holds.
    advance(4);
    const locLabelW = fonts.reg.widthOfTextAtSize("LOCATION", C.labelPt);
    page.drawText("LOCATION", { x: cx - locLabelW / 2, y: y - C.labelPt, size: C.labelPt, font: fonts.reg, color: GRAY });
    advance(C.labelPt + 2);
    if (card.binLocation) {
      // Shrink-to-fit safety: a location string wider than the card steps down before wrapping.
      let locSize = C.locationPt;
      while (fonts.bold.widthOfTextAtSize(card.binLocation, locSize) > inner && locSize > 40) locSize -= 4;
      centered(page, card.binLocation, fonts.bold, locSize, cx, y - locSize * 0.95, BLACK);
      advance(locSize * 1.1 + 6);
    } else {
      // Hand-writing ruled line, nearly full width (filled at the dock).
      const lineW = inner * 0.9;
      page.drawLine({ start: { x: cx - lineW / 2, y: y - C.locationPt * 0.75 }, end: { x: cx + lineW / 2, y: y - C.locationPt * 0.75 }, thickness: 0.7, color: BLACK });
      advance(C.locationPt * 0.95 + 10);
    }

    // Optional detail strip: exp/GR/putaway, one shrink-to-fit gray line.
    const details: [string, string][] = [];
    if (card.expDate) details.push(["Exp", card.expDate]);
    if (card.grNo) details.push(["GR No", card.grNo]);
    if (card.putawayNo) details.push(["Putaway", card.putawayNo]);
    if (details.length) {
      advance(6);
      let size = C.detailPt;
      const text = details.map(([l, v]) => `${l}: ${v}`).join("    ·    ");
      while (fonts.reg.widthOfTextAtSize(text, size) > inner && size > 8) size -= 1;
      centered(page, text, fonts.reg, size, cx, y - size, GRAY);
      advance(size * 1.4);
    }
    advance(12);
  }
  return pdf.save();
}
