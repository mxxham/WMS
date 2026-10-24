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
import { parseFormChecker, FC_COL, detectColumns } from "../lib/form-checker/parse";
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
let done = 0, total = 11;
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

console.log("\nForm Checker: column detection & spans");

// Test 1: header detection with shifted columns (simulating a previous-session block on top)
test("header detection: re-aligned columns on a shifted template", () => {
  // Build a synthetic sheet where ALL data columns are shifted one to the right
  // Header row (shifted by 1)
  const header = Array(25).fill(null);
  header[1] = "Month"; header[2] = "User name"; header[3] = "Shipment No.";
  header[4] = "Item Code"; header[5] = "Qty Order"; header[6] = "UoM";
  header[7] = "ASN No"; header[8] = "Vendor ASN No/Delivery No"; header[9] = "Act. Qty";
  header[10] = "UoM"; header[11] = "Pallet ID"; header[12] = "Bin Location";
  header[13] = "GR No"; header[14] = "Batch No."; header[15] = "Manufacture Date";
  header[16] = "Exp Date"; header[17] = "Putaway no."; header[18] = "Print Putaway Sheet";
  header[19] = "Container"; header[20] = "Vehicle No."; header[21] = "SEAL";
  header[22] = "TRANSPORTER"; header[23] = "PALLET LOSCAM"; header[24] = "PALLET NON LOSCAM";

  const detected = detectColumns(header);
  assert.ok(detected !== null, "detectColumns should succeed on shifted header");
  assert.equal(detected!.SHIPMENT_NO, 3);
  assert.equal(detected!.ITEM_CODE, 4);
  assert.equal(detected!.ACT_QTY, 9);
  assert.equal(detected!.PALLET_ID, 11);
  assert.equal(detected!.BIN_LOCATION, 12);
  // Duplicate UoM: first at index 6 -> UOM (order), second at index 10 -> ACT_UOM
  assert.equal(detected!.UOM, 6);
  assert.equal(detected!.ACT_UOM, 10);

  // Old block (shipment 109700001) at rows 1-3 (data rows 0-2)
  // New block (shipment 109700002) at rows 4-6 (data rows 3-5)
  const rows: unknown[][] = [
    // Header is not passed to parseFormChecker; we build data rows directly using detected columns
    // Old shipment block
    (() => { const r = Array(25).fill(null); r[detected!.MONTH] = "JUNE"; r[detected!.USER_NAME] = "YUDI"; r[detected!.SHIPMENT_NO] = 109700001; r[detected!.ITEM_CODE] = 550074326; r[detected!.QTY_ORDER] = 100; r[detected!.UOM] = "CAR"; r[detected!.ACT_QTY] = 48; r[detected!.ACT_UOM] = "CAR"; r[detected!.PALLET_ID] = 540000000001; r[detected!.BIN_LOCATION] = "CA01C01"; return r; })(),
    (() => { const r = Array(25).fill(null); r[detected!.ACT_QTY] = 52; r[detected!.ACT_UOM] = "CAR"; r[detected!.PALLET_ID] = 540000000002; r[detected!.BIN_LOCATION] = "CA01C02"; return r; })(),
    // New shipment block (different shipment, different bins)
    (() => { const r = Array(25).fill(null); r[detected!.SHIPMENT_NO] = 109700002; r[detected!.ITEM_CODE] = 550074326; r[detected!.QTY_ORDER] = 200; r[detected!.UOM] = "CAR"; r[detected!.ACT_QTY] = 30; r[detected!.ACT_UOM] = "CAR"; r[detected!.PALLET_ID] = 540000000003; r[detected!.BIN_LOCATION] = "CB02C01"; return r; })(),
    (() => { const r = Array(25).fill(null); r[detected!.ACT_QTY] = 35; r[detected!.ACT_UOM] = "CAR"; r[detected!.PALLET_ID] = 540000000004; r[detected!.BIN_LOCATION] = "CB02C02"; return r; })(),
  ];

  const parsed = parseFormChecker(rows, detected!);
  assert.equal(parsed.shipments, 2, "both shipments detected");
  const byShipment = new Map<number, typeof parsed.cards>();
  for (const c of parsed.cards) {
    const arr = byShipment.get(c.shipmentNo) ?? [];
    arr.push(c);
    byShipment.set(c.shipmentNo, arr);
  }
  assert.equal(byShipment.get(109700001)?.length, 2, "old shipment has 2 pallets");
  assert.equal(byShipment.get(109700002)?.length, 2, "new shipment has 2 pallets");
  // Verify bins are correct for each shipment (not mixed)
  for (const c of byShipment.get(109700001)!) assert.ok(c.binLocation?.startsWith("CA01"), `old shipment bin ${c.binLocation} should be CA01*`);
  for (const c of byShipment.get(109700002)!) assert.ok(c.binLocation?.startsWith("CB02"), `new shipment bin ${c.binLocation} should be CB02*`);
});

// Test 2: spans merged ranges per shipment
test("spans: merged ranges per shipment", () => {
  const header = Array(25).fill(null);
  header[1] = "Month"; header[2] = "User name"; header[3] = "Shipment No.";
  header[4] = "Item Code"; header[5] = "Qty Order"; header[6] = "UoM";
  header[7] = "ASN No"; header[8] = "Vendor ASN No/Delivery No"; header[9] = "Act. Qty";
  header[10] = "UoM"; header[11] = "Pallet ID"; header[12] = "Bin Location";
  header[13] = "GR No"; header[14] = "Batch No."; header[15] = "Manufacture Date";
  header[16] = "Exp Date"; header[17] = "Putaway no."; header[18] = "Print Putaway Sheet";
  header[19] = "Container"; header[20] = "Vehicle No."; header[21] = "SEAL";
  header[22] = "TRANSPORTER"; header[23] = "PALLET LOSCAM"; header[24] = "PALLET NON LOSCAM";

  const detected = detectColumns(header);
  assert.ok(detected !== null);

  // Shipment 109700001 has 3 pallet rows at data indices 0, 1, 2 (contiguous, no blank rows in data array)
  // Shipment 109700002 has 2 pallet rows at indices 3, 4
  // readSheet drops blank rows, so data array has no blank rows
  const rows: unknown[][] = [
    (() => { const r = Array(25).fill(null); r[detected!.MONTH] = "JUNE"; r[detected!.USER_NAME] = "YUDI"; r[detected!.SHIPMENT_NO] = 109700001; r[detected!.ITEM_CODE] = 550074326; r[detected!.QTY_ORDER] = 100; r[detected!.UOM] = "CAR"; r[detected!.ACT_QTY] = 48; r[detected!.ACT_UOM] = "CAR"; r[detected!.PALLET_ID] = 540000000001; r[detected!.BIN_LOCATION] = "CA01C01"; return r; })(),
    (() => { const r = Array(25).fill(null); r[detected!.ACT_QTY] = 52; r[detected!.ACT_UOM] = "CAR"; r[detected!.PALLET_ID] = 540000000002; r[detected!.BIN_LOCATION] = "CA01C02"; return r; })(),
    (() => { const r = Array(25).fill(null); r[detected!.ACT_QTY] = 10; r[detected!.ACT_UOM] = "CAR"; r[detected!.PALLET_ID] = 540000000003; r[detected!.BIN_LOCATION] = "CA01C03"; return r; })(),
    (() => { const r = Array(25).fill(null); r[detected!.SHIPMENT_NO] = 109700002; r[detected!.ITEM_CODE] = 550069887; r[detected!.QTY_ORDER] = 50; r[detected!.UOM] = "CAR"; r[detected!.ACT_QTY] = 25; r[detected!.ACT_UOM] = "CAR"; r[detected!.PALLET_ID] = 540000000004; r[detected!.BIN_LOCATION] = "CB02C01"; return r; })(),
    (() => { const r = Array(25).fill(null); r[detected!.ACT_QTY] = 25; r[detected!.ACT_UOM] = "CAR"; r[detected!.PALLET_ID] = 540000000005; r[detected!.BIN_LOCATION] = "CB02C02"; return r; })(),
  ];

  const parsed = parseFormChecker(rows, detected!);

  // Check spans for shipment 109700001: indices 0,1,2 -> merged to [0,2]
  const span1 = parsed.spans.find(s => s.shipmentNo === 109700001);
  assert.ok(span1, "span for shipment 109700001 exists");
  assert.deepEqual(span1.dataSetRows, [[0, 2]], "contiguous rows merge to single range 0-2");

  // Shipment 109700002: indices 3,4 -> [3,4]
  const span2 = parsed.spans.find(s => s.shipmentNo === 109700002);
  assert.ok(span2, "span for shipment 109700002 exists");
  assert.deepEqual(span2.dataSetRows, [[3, 4]], "contiguous rows merge to single range 3-4");

  // Simulate the route's line mapping: header at Excel row 1, data lines start at Excel row 2
  // If there was a blank row at Excel row 4 (between data rows 1 and 2), readSheet would skip it
  // dataLines would be [2, 3, 5, 6, 7] for our 5 data rows
  const dataLines = [2, 3, 5, 6, 7]; // Excel row numbers for the 5 data rows (blank at Excel row 4 skipped)
  const formatted = span1.dataSetRows.map(([start, end]) => {
    const s = dataLines[start];
    const e = dataLines[end];
    return s === e ? String(s) : `${s}–${e}`;
  }).join(", ");
  assert.equal(formatted, "2–5", "Excel row ranges mapped correctly (blank row in Excel skipped by readSheet)");
});

// Test 3: fallback to fixed columns when header unrecognized
test("fallback: unrecognized header keeps fixed columns", () => {
  const header = ["---", "***", "###", "???", "---", "***", "###", "???", "---", "***", "###", "???", "---", "***", "###", "???", "---", "***", "###", "???", "---", "***", "###", "???"];
  const detected = detectColumns(header);
  assert.equal(detected, null, "unrecognized header returns null");

  // Parser should still work with default FC_COL
  const rows: Row[] = [
    (() => {
      const r = blank();
      r[FC_COL.MONTH] = "JULY"; r[FC_COL.USER_NAME] = "TEST"; r[FC_COL.SHIPMENT_NO] = 88;
      r[FC_COL.ITEM_CODE] = 999; r[FC_COL.QTY_ORDER] = 10; r[FC_COL.UOM] = "CAR";
      r[FC_COL.ACT_QTY] = 10; r[FC_COL.ACT_UOM] = "CAR"; r[FC_COL.PALLET_ID] = "540000000088";
      r[FC_COL.BIN_LOCATION] = "CC01C01";
      return r;
    })(),
  ];
  const parsed = parseFormChecker(rows); // uses default FC_COL
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].shipmentNo, 88);
  assert.equal(parsed.cards[0].itemCode, 999);
  assert.equal(parsed.cards[0].binLocation, "CC01C01");
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
