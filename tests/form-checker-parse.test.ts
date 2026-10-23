/**
 * Form Checker parser + pallet-card PDF (Kartu palet page, /labels/pallet).
 * Parser rules and the workbook layout: docs/FORM_CHECKER_FORMAT.md.
 * The real workbook in data/ is the format's source of truth.
 *
 * Run: tsx --conditions=react-server tests/form-checker-parse.test.ts
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { readSheet } from "../lib/read-sheet";
import { parseFormChecker, FC_COL } from "../lib/form-checker/parse";
import { buildPalletCardPdf } from "../lib/form-checker/pdf";
import { PDFDocument } from "pdf-lib";

let passed = 0, failed = 0;
function test(name: string, fn: (() => void) | (() => Promise<void>)) {
  (async () => {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
    if (done === total) finish();
  })();
}
let done = 0, total = 8;
function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

/** Blank Form Checker row (24 cells, A..X). */
const blank = () => Array(24).fill(null);
type Row = (string | number | null)[];

console.log("\nForm Checker: parser on the real workbook");

// Loaded once, shared by the tests below (rows across tests are only read, never mutated).
let fixtureRows: readonly unknown[][] = [];
test("fixture loads", () => {
  const wb = XLSX.read(readFileSync("data/Form_Checker_20261020.xlsx"), {});
  const { rows } = readSheet(wb, "FORM CHECKER");
  assert.ok(rows.length > 1, "sheet has only the header");
  fixtureRows = rows;
});

let cards: ReturnType<typeof parseFormChecker>["cards"] = [];
test("real workbook: 118 pallet cards over 6 shipments", () => {
  const parsed = parseFormChecker(fixtureRows.slice(1));
  cards = parsed.cards;
  assert.equal(parsed.shipments, 6, "shipments");
  assert.equal(cards.length, 118, "cards (one per pallet row)");
});

test("first card carries the first pallet line, context forward-filled", () => {
  const [c] = cards;
  assert.ok(c, "no cards at all");
  assert.equal(c.month, "JUNE");
  assert.equal(c.userName, "YUDI");
  assert.equal(c.shipmentNo, 109717235);
  assert.equal(c.itemCode, 550074326);
  assert.equal(c.qtyOrder, 139);
  assert.equal(c.orderUom, "CAR");
  assert.equal(c.actQty, 48);
  assert.equal(c.actUom, "CAR");
  assert.equal(c.palletId, "540000849095");
});

test("pallet-only rows keep the item's context (their own cells are empty)", () => {
  // The first item opens with 3 pallet lines; every line after the first carries only Act. Qty.
  const firstItem = cards.filter((c) => c.shipmentNo === 109717235 && c.itemCode === 550074326);
  assert.equal(firstItem.length, 3, "first item pallet lines");
  for (const c of firstItem) assert.equal(c.itemCode, 550074326, "context lost on a pallet row");
});

test("second item of the first shipment: forward fill across its 7 pallet lines", () => {
  const second = cards.filter((c) => c.shipmentNo === 109717235 && c.itemCode === 550069887);
  assert.equal(second.length, 7, "pallet lines for 550069887");
  for (const c of second) { assert.equal(c.qtyOrder, 300); assert.notEqual(c.palletId, ""); }
});

test("a mid-file blank row does not reset forward fill; a new Item Code row does", () => {
  const rows: Row[] = [
    (() => {
      const r = blank();
      r[FC_COL.MONTH] = "JUNE"; r[FC_COL.USER_NAME] = "YUDI"; r[FC_COL.SHIPMENT_NO] = 42;
      r[FC_COL.ITEM_CODE] = 555; r[FC_COL.QTY_ORDER] = 10; r[FC_COL.UOM] = "CAR";
      r[FC_COL.ACT_QTY] = 10; r[FC_COL.ACT_UOM] = "CAR"; r[FC_COL.PALLET_ID] = "540000000001";
      return r;
    })(),
    blank(), // separator inside the shipment block
    (() => {
      const r = blank();
      r[FC_COL.ACT_QTY] = 5; r[FC_COL.ACT_UOM] = "CAR"; r[FC_COL.PALLET_ID] = "540000000002";
      return r; // still item 555 thanks to forward fill
    })(),
    (() => {
      const r = blank();
      r[FC_COL.ITEM_CODE] = 556; r[FC_COL.UOM] = "EA";
      r[FC_COL.ACT_QTY] = 2; r[FC_COL.ACT_UOM] = "EA"; r[FC_COL.PALLET_ID] = "540000000003";
      return r;
    })(),
  ];
  const parsed = parseFormChecker(rows);
  assert.equal(parsed.cards.length, 3, "cards");
  assert.equal(parsed.shipments, 1);
  assert.equal(parsed.cards[1].itemCode, 555, "blank row must not clear the current item");
  assert.equal(parsed.cards[1].month, "JUNE");
  assert.equal(parsed.cards[2].itemCode, 556, "new item code starts a new item");
  assert.equal(parsed.cards[2].actUom, "EA");
});

test("Excel date serials become DD/MM/YYYY (UTC base, identical on every machine)", () => {
  const r = blank();
  r[FC_COL.MONTH] = "JULY"; r[FC_COL.USER_NAME] = "TEST"; r[FC_COL.SHIPMENT_NO] = 99;
  r[FC_COL.ITEM_CODE] = 1; r[FC_COL.MFG_DATE] = 46000; // 46000 days after 1899-12-30 = 2025-12-09
  r[FC_COL.EXP_DATE] = "31/01/2027"; // already formatted, passes through
  r[FC_COL.ACT_QTY] = 1; r[FC_COL.ACT_UOM] = "CAR"; r[FC_COL.PALLET_ID] = "540000000009";
  const { cards: one } = parseFormChecker([r]);
  assert.equal(one[0]!.mfgDate, "09/12/2025");
  assert.equal(one[0]!.expDate, "31/01/2027");
});

console.log("\nForm Checker: pallet-card PDF geometry");

test("one A4 landscape page per card, every page exactly A4", async () => {
  const master = new Map([["550074326", { uom: "CAR" }]]);
  const synth = cards.slice(0, 2).length === 2
    ? cards.slice(0, 2)
    : [{ month: "JUNE", userName: "T", shipmentNo: 1, itemCode: 550074326, qtyOrder: 10, orderUom: "CAR", asnNo: null, vendorAsnNo: null, actQty: 4, actUom: "CAR", palletId: "540000000004", binLocation: null, grNo: null, batchNo: null, mfgDate: null, expDate: null, putawayNo: null }];
  const pdf = await buildPalletCardPdf(synth, master);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), synth.length);
  const A4W = 297 * 72 / 25.4, A4H = 210 * 72 / 25.4;
  for (const page of doc.getPages()) {
    assert.ok(Math.abs(page.getWidth() - A4W) < 1, `width ${page.getWidth()} is not A4 landscape`);
    assert.ok(Math.abs(page.getHeight() - A4H) < 1, `height ${page.getHeight()} is not A4 landscape`);
  }
});
