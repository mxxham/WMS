/**
 * CKB 3PL — customer stock-ledger import lane.
 *
 * The second import lane of /ckb/sap/import: five customer workbooks that are not SAP files, but
 * warehouse ledgers kept by the customer. They end up in the SAME snapshot (ckb_import_sap_snapshot,
 * 0100) and go through the same validation, duplicate-file refusal and audit trail; nothing here
 * touches Shell stock or any Shell table.
 *
 * Pure: sheet rows in (already read by lib/read-sheet.ts, Excel row numbers included), snapshot rows
 * out. No fs, no xlsx, no database — like lib/allocator.
 *
 * Formats (one deterministic parser each, header detection first, refusal instead of guessing):
 *   SIP        "STOCK": Code | Date In | Date out | DO Inbound | Item Code | Item Description |
 *              Product Number | Batch | In | Out | Balance (header ~row 11, "Location" above it)
 *   CGP        "STOCK NEW": DO IN | TANGGAL | ITEM CODE | … | QTY | … | DO OUT | … | Qty |
 *              Final Stock (per inbound lot); "STOCK" is the 2023 summary and is skipped
 *   BOILERMECH "Stock": Batch | Date In | Date out | PT lama | PT Baru | Item Code | ITEM | PCS |
 *              No. of Packages | QTY PKG | PALLET ID… (header row 5, pallets spread rightwards)
 *   PTFI       "Rack" (Bins Location), "Floor" (no bin column) and "Yard" (no bin) ledgers with a
 *              per-row Balance; the companion PTFI-yard.xlsx "Yard" states the bin and batch of a
 *              yard item, which is the only place a yard bin exists.
 *
 * Quantity rule (owner-confirmed): one row per stock identity, quantity = Σ In − Σ Out over that
 * identity's ledger lines. A non-positive result is not stock ("saldo nol — bukan stok saat ini",
 * "saldo negatif — kemungkinan pembalikan") and is reported, never imported.
 *
 * Nothing is guessed silently. A line the parser cannot attribute becomes a decision row
 * (needs_decision) that a person must include or exclude in the preview, or a skipped line with a
 * reason. Two identities that would collide are listed as duplicates, never summed.
 */
import type { SnapshotRow } from "./sap-import";

/** One sheet as lib/read-sheet.ts returns it: values plus the Excel row number of each row. */
export type LedgerSheet = { rows: unknown[][]; lines: number[] };
/** One workbook: name plus every sheet it holds, keyed by the sheet name as Excel spells it. */
export type LedgerBook = { name: string; sheets: Record<string, LedgerSheet> };

export type LedgerFormat = "SIP" | "CGP" | "BOILERMECH" | "PTFI_RACK" | "PTFI_FLOOR" | "PTFI_YARD";

export const FORMAT_LABEL: Record<LedgerFormat, string> = {
  SIP: "SIP — STOCK (kartu stok per Code)",
  CGP: "CGP — STOCK NEW (per lot masuk)",
  BOILERMECH: "Boilmerch — Stock (per PALLET ID)",
  PTFI_RACK: "PTFI — Rack (per Bins Location)",
  PTFI_FLOOR: "PTFI — Floor (lantai, tanpa bin)",
  PTFI_YARD: "PTFI — Yard (dari file pendamping)",
};

/**
 * The SIP sheet carries no unit column. The owner confirmed the count unit of that workbook ("DR",
 * the drum the customer books in); it is a constant here rather than a guess per row, and the
 * preview says so.
 */
export const SIP_UOM = "DR";

/** A clean snapshot row plus what the preview shows about it (never sent to the RPC). */
export type LedgerRow = SnapshotRow & {
  note: string;
  sheet: string;
  /** the quantity the sheet itself printed for this identity, when it printed one */
  printed: number | null;
  /** quantity − printed; 0 when the sheet agrees with its own ledger */
  delta: number | null;
};

/** A ledger line or identity left out, and why. Nothing here is imported. */
export type LedgerSkip = {
  sheet: string;
  line: number;
  material_code: string;
  storage_bin: string;
  batch: string;
  quantity: number;
  reason: string;
};

/** A row the person uploading must decide on before it can be imported. */
export type LedgerDecision = LedgerRow & { reason: string };

/**
 * The same identity claimed by two places in one sheet (a restated block). It is kept out of the
 * import and listed: the two statements are shown side by side instead of being added together.
 */
export type LedgerDuplicate = {
  sheet: string;
  key: string;
  material_code: string;
  storage_bin: string;
  batch: string;
  lines: number[];
  note: string;
};

export type LedgerSheetInfo = { name: string; format: LedgerFormat | null; used: boolean; rows: number; note: string };

export type LedgerParse = {
  /** formats recognised in the uploaded file, in the order their first sheet appears */
  formats: LedgerFormat[];
  rows: LedgerRow[];
  skipped: LedgerSkip[];
  needsDecision: LedgerDecision[];
  duplicates: LedgerDuplicate[];
  sheets: LedgerSheetInfo[];
  summary: {
    labels: string[];
    cleanCount: number;
    decisionCount: number;
    skippedCount: number;
    identityCount: number;
    totalQty: number;
    decisionQty: number;
    /** the workbook's own stated total, when it states one ("Stock Akhir", "Total Stock") */
    printedQty: number | null;
    deltaQty: number | null;
    notes: string[];
  };
  /** nothing can be imported while this is non-empty */
  fileErrors: string[];
};

// ---------------------------------------------------------------------------------------------------
// cell helpers
// ---------------------------------------------------------------------------------------------------

const norm = (v: unknown) => String(v ?? "").replace(/\u00a0/g, " ").trim().toLowerCase().replace(/\s+/g, " ");
/** Text cell: trimmed, leading apostrophes removed (Excel text markers), inner runs kept. */
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/^'+/, "").trim());
/** Code/batch/bin cell: same, with inner whitespace collapsed (identities are uppercase in the database). */
const code = (v: unknown) => txt(v).replace(/\s+/g, " ");

/** A movement cell: empty is 0 (a line with no quantity is not a movement), text is refused. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === "") return 0;
  if (/^-?\d+([.,]\d+)?$/.test(s)) return Number(s.replace(",", "."));
  return null;
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const isSummaryWord = (v: unknown) => /^(stock akhir|total|total stock|grand total|jumlah)\b/.test(norm(v));
/** A batch that Excel (or the customer) turned into a date: kept verbatim, flagged. */
const DATE_LIKE = /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;

type Cols = Record<string, number>;

/** First column index per field, from the alias lists; null when a required field is missing. */
function headerAt(row: unknown[], aliases: Record<string, string[]>, required: string[]): Cols | null {
  const cells = row.map(norm);
  const cols: Cols = {};
  for (const [field, names] of Object.entries(aliases)) {
    const idx = cells.findIndex((c) => names.includes(c));
    if (idx >= 0) cols[field] = idx;
  }
  return required.every((f) => cols[f] !== undefined) ? cols : null;
}

function findHeader(rows: unknown[][], aliases: Record<string, string[]>, required: string[], limit = 40) {
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const cols = headerAt(rows[i], aliases, required);
    if (cols) return { index: i, cols };
  }
  return null;
}

const cell = (row: unknown[], cols: Cols, field: string): unknown => (cols[field] === undefined ? null : row[cols[field]]);
const at = (row: unknown[], index: number): unknown => (index < 0 || index >= row.length ? null : row[index]);

/** Rows are ragged (a sheet may hold a stray far-right cell); only the first `width` cells are read. */
const width = (rows: unknown[][], cap: number) => rows.reduce((w, r) => Math.min(cap, Math.max(w, r.length)), 0) || cap;

/** An accumulating ledger line for one identity. */
type Agg = {
  sheet: string;
  material_code: string;
  description: string;
  storage_bin: string;
  batch: string;
  uom: string;
  net: number;
  printed: number | null;
  sumBalance: number;
  firstLine: number;
  notes: string[];
  section: number;
};

function newAgg(sheet: string, line: number, p: Partial<Agg> & Pick<Agg, "material_code">): Agg {
  return {
    sheet, firstLine: line, description: "", storage_bin: "", batch: "", uom: "", net: 0,
    printed: null, sumBalance: 0, notes: [], section: 0, ...p,
  };
}

const identityKeyOf = (a: Pick<Agg, "material_code" | "storage_bin" | "batch" | "uom">) =>
  [a.material_code, a.storage_bin, a.batch, a.uom].map((s) => s.trim().toUpperCase()).join("|");

// ---------------------------------------------------------------------------------------------------
// result accumulation (shared by the format parsers)
// ---------------------------------------------------------------------------------------------------

type Out = {
  rows: LedgerRow[];
  skipped: LedgerSkip[];
  needsDecision: LedgerDecision[];
  duplicates: LedgerDuplicate[];
  sheetInfo: LedgerSheetInfo[];
  formats: LedgerFormat[];
  printedQty: number | null;
  notes: string[];
  fileErrors: string[];
};

const emptyOut = (): Out => ({ rows: [], skipped: [], needsDecision: [], duplicates: [], sheetInfo: [], formats: [], printedQty: null, notes: [], fileErrors: [] });

/** Turn an aggregated identity into a clean row, a skip, or a decision — the one place that rule lives. */
function settle(o: Out, a: Agg, opts: { reason?: string; binMissing?: string } = {}) {
  const note = a.notes.join("; ");
  const row: LedgerRow = {
    line: a.firstLine,
    material_code: a.material_code,
    description: a.description,
    plant: "",
    storage_location: "",
    storage_bin: a.storage_bin.toUpperCase(),
    batch: a.batch,
    expiry_date: null,
    uom: a.uom,
    quantity: round3(a.net),
    stock_type: "",
    note,
    sheet: a.sheet,
    printed: a.printed,
    delta: a.printed === null ? null : round3(a.net - a.printed),
  };
  if (a.net < 0) {
    o.skipped.push({ sheet: a.sheet, line: a.firstLine, material_code: a.material_code, storage_bin: a.storage_bin, batch: a.batch, quantity: round3(a.net), reason: `saldo negatif (${round3(a.net)}) — kemungkinan pembalikan (reversed?)` });
    return;
  }
  if (a.net === 0) {
    o.skipped.push({ sheet: a.sheet, line: a.firstLine, material_code: a.material_code, storage_bin: a.storage_bin, batch: a.batch, quantity: 0, reason: "saldo nol — bukan stok saat ini" });
    return;
  }
  if (opts.reason) { o.needsDecision.push({ ...row, reason: opts.reason }); return; }
  o.rows.push(row);
}

// ---------------------------------------------------------------------------------------------------
// 1. SIP — "STOCK" sheet, one running balance per Code + Item Code + Batch
// ---------------------------------------------------------------------------------------------------

const SIP_ALIASES: Record<string, string[]> = {
  code: ["code"], dateIn: ["date in"], dateOut: ["date out"], doIn: ["do inbound"],
  item: ["item code"], desc: ["item description"], product: ["product number"],
  batch: ["batch"], in: ["in"], out: ["out"], balance: ["balance"],
};
const SIP_REQUIRED = ["code", "item", "in", "out"];

/** The "Location : (SUB50REGCW)" line above the SIP header. */
function sipLocation(rows: unknown[][], headerIndex: number): string {
  for (let i = Math.max(0, headerIndex - 12); i < headerIndex; i++) {
    const row = rows[i];
    const idx = row.findIndex((c) => norm(c) === "location" || norm(c) === "location ");
    if (idx < 0) continue;
    for (let c = idx + 1; c < row.length; c++) {
      const v = txt(row[c]);
      if (v) return v.replace(/^[:\s]+/, "").replace(/^\(|\)$/g, "").replace(/\)$/, "").trim();
    }
  }
  return "";
}

function parseSip(sheetName: string, sheet: LedgerSheet, o: Out) {
  const rows = sheet.rows;
  const head = findHeader(rows, SIP_ALIASES, SIP_REQUIRED);
  if (!head) return false;
  const cols = head.cols;
  const location = sipLocation(rows, head.index);
  const agg = new Map<string, Agg>();
  const restated = new Map<string, Agg>();
  const linesOf = new Map<string, number[]>();
  const sections = new Map<string, number[]>();
  let section = 0;
  let productMap = new Map<string, string>();
  let curCode = "", curItem = "", curBatch = "";

  for (let i = head.index + 1; i < rows.length; i++) {
    const row = rows[i];
    const line = sheet.lines[i];
    if (row.every((c) => txt(c) === "")) continue;
    if (row.some((c) => isSummaryWord(c))) continue;
    if (headerAt(row, SIP_ALIASES, SIP_REQUIRED)) {
      // A second header block: a restatement, not a continuation. Nothing carries over.
      section++; productMap = new Map(); curCode = ""; curItem = ""; curBatch = "";
      continue;
    }
    const codeCell = code(cell(row, cols, "code"));
    const itemCell = code(cell(row, cols, "item"));
    const productCell = code(cell(row, cols, "product"));
    const batchCell = code(cell(row, cols, "batch"));
    const inQty = num(cell(row, cols, "in"));
    const outQty = num(cell(row, cols, "out"));
    if (inQty === null || outQty === null) {
      o.skipped.push({ sheet: sheetName, line, material_code: itemCell, storage_bin: codeCell, batch: batchCell, quantity: 0, reason: "qty In/Out bukan angka" });
      continue;
    }
    if (!codeCell && !itemCell && !productCell && inQty === 0 && outQty === 0) continue;
    if (codeCell) curCode = codeCell;

    let item = itemCell;
    let batch = batchCell;
    let note = "";
    if (!item) {
      if (productCell && productMap.has(productCell.toUpperCase())) {
        item = productMap.get(productCell.toUpperCase())!;
        note = `Item Code dari Product Number ${productCell}`;
      } else if (productCell) {
        o.needsDecision.push({
          line, material_code: "", description: "", plant: "", storage_location: location, storage_bin: curCode,
          batch: batchCell, expiry_date: null, uom: SIP_UOM, quantity: round3(inQty - outQty), stock_type: "",
          note: "", sheet: sheetName, printed: null, delta: null,
          reason: `Product Number ${productCell} tidak ada di baris sebelumnya pada sheet ini; Item Code tidak bisa ditentukan`,
        });
        continue;
      } else {
        item = curItem;
        if (!batch) batch = curBatch;
        note = `baris lanjutan ${curCode}`;
      }
    } else if (productCell) {
      productMap.set(productCell.toUpperCase(), item);
    }
    if (!item) {
      o.skipped.push({ sheet: sheetName, line, material_code: "", storage_bin: curCode, batch: batchCell, quantity: 0, reason: "baris tanpa Item Code dan tanpa Product Number yang dikenal" });
      continue;
    }
    if (DATE_LIKE.test(batch)) note = `${note ? `${note}; ` : ""}batch "${batch}" terbaca seperti tanggal — dibiarkan apa adanya, mohon diperiksa`;

    curItem = item;
    curBatch = batch;
    const a = newAgg(sheetName, line, {
      material_code: item, description: code(cell(row, cols, "desc")), storage_location: location,
      storage_bin: curCode, batch, uom: SIP_UOM, section,
    } as Partial<Agg> & Pick<Agg, "material_code">);
    const key = `${section}|${identityKeyOf(a)}`;
    const sameKey = [...agg.keys()].find((k) => k.endsWith(`|${identityKeyOf(a)}`));
    let target: Agg;
    if (sameKey && agg.get(sameKey)!.section !== section) {
      // The same identity stated again in another block of the sheet: kept apart, listed, not summed.
      const rk = `${section}|${identityKeyOf(a)}`;
      target = restated.get(rk) ?? newAgg(sheetName, line, { ...a, net: 0, printed: null, sumBalance: 0, firstLine: line });
      target.section = section;
      restated.set(rk, target);
    } else {
      target = agg.get(key) ?? newAgg(sheetName, line, { ...a, net: 0 });
      agg.set(key, target);
    }
    target.net += inQty - outQty;
    if (!target.description && a.description) target.description = a.description;
    const balance = cell(row, cols, "balance");
    const printedQty = num(balance);
    if (printedQty !== null && balance !== null && txt(balance) !== "") {
      target.printed = printedQty;
      target.sumBalance += printedQty;
    }
    if (note) target.notes.push(note);
    if (!linesOf.has(target === a ? key : `${section}|${identityKeyOf(a)}`)) linesOf.set(`${section}|${identityKeyOf(a)}`, []);
    linesOf.get(`${section}|${identityKeyOf(a)}`)!.push(line);
    if (!sections.has(identityKeyOf(a))) sections.set(identityKeyOf(a), []);
    const secs = sections.get(identityKeyOf(a))!;
    if (!secs.includes(section)) secs.push(section);
  }

  for (const a of agg.values()) settle(o, a);
  for (const a of restated.values()) {
    const original = [...agg.values()].find((x) => identityKeyOf(x) === identityKeyOf(a));
    settle(o, a, { reason: `identitas sudah dibukukan di bagian lain sheet ini (baris ${original?.firstLine ?? "?"}); tidak dijumlahkan` });
  }
  for (const [key, secs] of sections) {
    if (secs.length < 2) continue;
    const [material, bin, batch] = key.split("|");
    const ls = [...linesOf.entries()].filter(([k]) => k.endsWith(`|${key}`)).flatMap(([, v]) => v).sort((x, y) => x - y);
    o.duplicates.push({ sheet: sheetName, key, material_code: material, storage_bin: bin, batch, lines: ls, note: "identitas sama di dua bagian sheet — tidak dijumlahkan; periksa yang benar" });
  }
  o.sheetInfo.push({ name: sheetName, format: "SIP", used: true, rows: rows.length - head.index - 1, note: location ? `Location ${location}` : "Location tidak tercantum" });
  return true;
}

// ---------------------------------------------------------------------------------------------------
// 2. CGP — "STOCK NEW" (per inbound lot); the 2023 summary sheet is skipped with a reason
// ---------------------------------------------------------------------------------------------------

const CGP_LOT_REQUIRED = ["doIn", "item", "qtyIn", "qtyOut", "final"];
const CGP_LEGACY_REQUIRED = ["item", "qtyIn", "qtyOut", "stockInquiry"];

/** CGP shares "QTY" with both blocks; the outbound one is the last "qty" column of the header. */
function cgpLotHeader(row: unknown[]): Cols | null {
  const cells = row.map(norm);
  const first = (names: string[]) => cells.findIndex((c) => names.includes(c));
  const last = (names: string[]) => cells.reduce((idx, c, i) => (names.includes(c) ? i : idx), -1);
  const cols: Cols = {
    doIn: first(["do in"]), dateIn: first(["tanggal"]), item: first(["item code"]), desc: first(["good description"]),
    qtyIn: first(["qty"]), doOut: first(["do out"]), outItem: first(["product code"]), outQty: last(["qty"]),
    final: first(["final stock"]),
  };
  return CGP_LOT_REQUIRED.every((f) => cols[f] !== undefined && cols[f] >= 0) && cols.outQty > cols.qtyIn ? cols : null;
}

function cgpLegacyHeader(row: unknown[]): Cols | null {
  const cells = row.map(norm);
  const first = (names: string[]) => cells.findIndex((c) => names.includes(c));
  const cols: Cols = { item: first(["item code"]), desc: first(["good description"]), qtyIn: first(["qty in"]), qtyOut: first(["qty out"]), stockInquiry: first(["stock inquiry"]), uom: first(["uom"]) };
  return CGP_LEGACY_REQUIRED.every((f) => cols[f] !== undefined && cols[f] >= 0) ? cols : null;
}

/** Kode barang → UOM, from a "Master Product"-style sheet. */
function masterUoms(sheets: Record<string, LedgerSheet>): Map<string, string> {
  const map = new Map<string, string>();
  for (const sheet of Object.values(sheets)) {
    const head = findHeader(sheet.rows, { code: ["kode barang"], uom: ["uom"] }, ["code", "uom"], 10);
    if (!head) continue;
    for (let i = head.index + 1; i < sheet.rows.length; i++) {
      const k = code(cell(sheet.rows[i], head.cols, "code"));
      const u = code(cell(sheet.rows[i], head.cols, "uom"));
      if (k && u && !map.has(k.toUpperCase())) map.set(k.toUpperCase(), u.toUpperCase());
    }
  }
  return map;
}

function parseCgp(sheets: Record<string, LedgerSheet>, o: Out) {
  let legacy: { name: string; cols: Cols; sheet: LedgerSheet } | null = null;
  const legacyUom = new Map<string, string>();
  for (const [name, sheet] of Object.entries(sheets)) {
    const head = findHeader(sheet.rows, {}, CGP_LEGACY_REQUIRED, 10);
    if (!head) continue;
    const cols = cgpLegacyHeader(sheet.rows[head.index]);
    if (!cols) continue;
    legacy = { name, cols, sheet };
    for (let i = head.index + 1; i < sheet.rows.length; i++) {
      const k = code(cell(sheet.rows[i], cols, "item"));
      const u = code(cell(sheet.rows[i], cols, "uom"));
      if (k && u && !legacyUom.has(k.toUpperCase())) legacyUom.set(k.toUpperCase(), u.toUpperCase());
    }
    break;
  }
  const uoms = new Map([...legacyUom, ...masterUoms(sheets)]);

  let lotSheet: { name: string; sheet: LedgerSheet; head: { index: number; cols: Cols } } | null = null;
  for (const [name, sheet] of Object.entries(sheets)) {
    for (let i = 0; i < Math.min(sheet.rows.length, 10); i++) {
      const cols = cgpLotHeader(sheet.rows[i]);
      if (cols) { lotSheet = { name, sheet, head: { index: i, cols } }; break; }
    }
    if (lotSheet) break;
  }
  if (!lotSheet) return false;

  const { name, sheet, head } = lotSheet;
  const cols = head.cols;
  const lots = new Map<string, Agg>();
  let lot: Agg | null = null;
  for (let i = head.index + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const line = sheet.lines[i];
    if (row.every((c) => txt(c) === "")) continue;
    if (row.some((c) => /^(total stock|total|final stock)$/.test(norm(c)))) break;
    const doIn = code(cell(row, cols, "doIn"));
    const itemCell = code(cell(row, cols, "item"));
    const outQty = num(cell(row, cols, "outQty"));
    if (outQty === null) {
      o.skipped.push({ sheet: name, line, material_code: itemCell, storage_bin: "", batch: doIn, quantity: 0, reason: "qty out bukan angka" });
      continue;
    }
    if (doIn && itemCell) {
      const key = `${itemCell.toUpperCase()}|${doIn.toUpperCase()}`;
      lot = lots.get(key) ?? newAgg(name, line, { material_code: itemCell, storage_bin: "", batch: doIn });
      if (!lots.has(key)) lots.set(key, lot);
      lot.net += num(cell(row, cols, "qtyIn")) ?? 0;
      lot.description = lot.description || code(cell(row, cols, "desc"));
    }
    if (outQty !== 0) {
      if (!lot) {
        o.skipped.push({ sheet: name, line, material_code: code(cell(row, cols, "outItem")), storage_bin: "", batch: "", quantity: outQty, reason: "baris keluar tanpa lot masuk di atasnya" });
        continue;
      }
      lot.net -= outQty;
    }
    if (lot) {
      const fin = cell(row, cols, "final");
      const finQty = num(fin);
      if (finQty !== null && txt(fin) !== "") { lot.printed = finQty; lot.sumBalance += finQty; }
    }
  }

  let printed: number | null = null;
  for (const r of sheet.rows) {
    if (!r.some((c) => norm(c) === "total stock")) continue;
    const numbers = r.map(num).filter((n): n is number => typeof n === "number" && n !== 0);
    if (numbers.length) printed = numbers[numbers.length - 1];
  }
  if (printed !== null) o.printedQty = printed;

  for (const a of lots.values()) {
    const uom = uoms.get(a.material_code.toUpperCase()) ?? "";
    const withUom = { ...a, uom };
    if (!uom) {
      o.skipped.push({ sheet: name, line: a.firstLine, material_code: a.material_code, storage_bin: "", batch: a.batch, quantity: round3(a.net), reason: "satuan tidak ditemukan (Master Product / STOCK) — baris tidak bisa diimpor" });
      continue;
    }
    withUom.notes.push(`lot masuk ${a.batch}`);
    const mismatch = a.printed !== null && a.printed !== a.net;
    settle(o, withUom, mismatch
      ? { reason: `selisih terhadap "Final Stock" tercetak: hitung ${round3(a.net)} vs ${a.printed}` }
      : {});
  }
  o.sheetInfo.push({ name, format: "CGP", used: true, rows: sheet.rows.length - head.index - 1, note: "satu baris per lot masuk (Batch = nomor DO masuk)" });
  if (legacy) {
    o.sheetInfo.push({
      name: legacy.name, format: null, used: false, rows: legacy.sheet.rows.length,
      note: "ringkasan 2023 per SKU tanpa lot/bin dan kolom saldo yang tidak konsisten — dilewati; angka stok terkini diambil dari STOCK NEW",
    });
  }
  o.notes.push("CGP: kuantitas dihitung Σ masuk − Σ keluar per lot; kolom \"Final Stock\" hanya terisi pada sebagian baris dan tidak selalu sama dengan hitungan lot.");
  return true;
}

// ---------------------------------------------------------------------------------------------------
// 3. Boilmerch — "Stock", one physical pallet per PALLET ID
// ---------------------------------------------------------------------------------------------------

const BOIL_ALIASES: Record<string, string[]> = {
  batch: ["batch"], dateIn: ["date in"], dateOut: ["date out"], item: ["item code"], itemName: ["item"],
  pcs: ["pcs"], packages: ["no. of packages"], qtyPkg: ["qty pkg"], pallet: ["pallet id"],
};
const BOIL_REQUIRED = ["batch", "item", "pcs", "pallet"];
const BOIL_PALLET_CAP = 60;

function parseBoilmerch(sheetName: string, sheet: LedgerSheet, o: Out) {
  const head = findHeader(sheet.rows, BOIL_ALIASES, BOIL_REQUIRED);
  if (!head) return false;
  const cols = head.cols;
  const rows = sheet.rows;
  const maxCol = width(rows, BOIL_PALLET_CAP);
  let curItem = "", curName = "", curBatch = "";
  let counted = 0;
  for (let i = head.index + 1; i < rows.length; i++) {
    const row = rows[i];
    const line = sheet.lines[i];
    if (row.every((c) => txt(c) === "")) continue;
    const itemCell = code(cell(row, cols, "item"));
    const batch = code(cell(row, cols, "batch"));
    if (batch) curBatch = batch;
    if (itemCell) curItem = itemCell;
    if (!itemCell) curName = code(cell(row, cols, "itemName")) || curName;
    if (itemCell) curName = code(cell(row, cols, "itemName")) || curName;
    const material = curItem || curName;
    const pcs = num(cell(row, cols, "pcs")) ?? 0;
    const pallets: string[] = [];
    for (let c = cols.pallet; c < Math.min(maxCol, cols.pallet + 40); c++) {
      const v = code(at(row, c));
      if (v && /^[A-Z0-9]+[-.][0-9A-Z-]+$/i.test(v)) pallets.push(v);
    }
    if (!material) {
      if (pallets.length) o.skipped.push({ sheet: sheetName, line, material_code: "", storage_bin: pallets[0], batch: curBatch, quantity: 0, reason: "baris palet tanpa Item Code di atasnya" });
      continue;
    }
    counted++;
    if (pallets.length === 0) {
      o.needsDecision.push({
        line, material_code: material, description: curName, plant: "", storage_location: "", storage_bin: "",
        batch: curBatch, expiry_date: null, uom: "PCS", quantity: round3(pcs), stock_type: "", note: "", sheet: sheetName,
        printed: null, delta: null, reason: "baris tanpa PALLET ID — bin belum dikonfirmasi",
      });
      continue;
    }
    const per = round3(pcs / pallets.length);
    for (const pallet of pallets) {
      o.needsDecision.push({
        line, material_code: material, description: curName, plant: "", storage_location: "", storage_bin: pallet.toUpperCase(),
        batch: curBatch, expiry_date: null, uom: "PCS", quantity: per, stock_type: "", sheet: sheetName,
        note: `${pcs} PCS / ${pallets.length} palet`, printed: null, delta: null,
        reason: `bin palet ${pallet} belum dikonfirmasi${Number.isInteger(per) ? "" : `; qty per palet tidak bulat (${pcs}/${pallets.length})`}`,
      });
    }
  }
  o.sheetInfo.push({ name: sheetName, format: "BOILERMECH", used: true, rows: counted, note: "PALLET ID dipakai sebagai bin, menunggu konfirmasi pemilik" });
  o.notes.push("Boilmerch: setiap baris PALLET ID menunggu keputusan (bin palet belum dikonfirmasi); kuantitas per palet = PCS / jumlah palet pada baris itu.");
  return true;
}

// ---------------------------------------------------------------------------------------------------
// 4. PTFI — Rack / Floor / Yard ledgers (+ the companion yard file that carries the bins)
// ---------------------------------------------------------------------------------------------------

const PTFI_ALIASES: Record<string, string[]> = {
  dateIn: ["date in"], location: ["type location"], bins: ["bins location"], material: ["no material"],
  desc: ["material description"], in: ["qty in"], out: ["qty out"], balance: ["balance"], batch: ["batch"],
};
const PTFI_REQUIRED = ["material", "in", "out", "balance"];
const PTFI_YARD_COMPANION_REQUIRED = ["item", "batch", "bins"];

/** material → the one floor bin code the workbook's own history states (0501NP0506 style). */
function floorBins(sheets: Record<string, LedgerSheet>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const sheet of Object.values(sheets)) {
    const head = findHeader(sheet.rows, PTFI_ALIASES, ["location", "bins", "material"], 5);
    if (!head) continue;
    for (let i = head.index + 1; i < sheet.rows.length; i++) {
      const location = norm(cell(sheet.rows[i], head.cols, "location"));
      const material = code(cell(sheet.rows[i], head.cols, "material"));
      const bin = code(cell(sheet.rows[i], head.cols, "bins"));
      if (!material || !bin || location === "" || location === "rack" || location === "yard") continue;
      const set = map.get(material.toUpperCase()) ?? new Set<string>();
      set.add(bin.toUpperCase());
      map.set(material.toUpperCase(), set);
    }
  }
  return map;
}

function parsePtfiLedger(sheetName: string, sheet: LedgerSheet, format: LedgerFormat, o: Out, opts: { floorBin: Map<string, Set<string>>; skipReason?: string }) {
  const head = findHeader(sheet.rows, PTFI_ALIASES, PTFI_REQUIRED);
  if (!head) return false;
  const cols = head.cols;
  if (opts.skipReason) {
    o.sheetInfo.push({ name: sheetName, format, used: false, rows: sheet.rows.length - head.index - 1, note: opts.skipReason });
    return true;
  }
  const agg = new Map<string, Agg>();
  for (let i = head.index + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const line = sheet.lines[i];
    const material = code(cell(row, cols, "material"));
    const inQty = num(cell(row, cols, "in"));
    const outQty = num(cell(row, cols, "out"));
    if (!material && inQty === 0 && outQty === 0) continue;
    if (!material) {
      o.skipped.push({ sheet: sheetName, line, material_code: "", storage_bin: "", batch: "", quantity: 0, reason: "baris tanpa No Material" });
      continue;
    }
    if (inQty === null || outQty === null) {
      o.skipped.push({ sheet: sheetName, line, material_code: material, storage_bin: "", batch: "", quantity: 0, reason: "qty In/Out bukan angka" });
      continue;
    }
    let bin = code(cell(row, cols, "bins")).toUpperCase();
    let reason: string | undefined;
    if (!bin && format === "PTFI_FLOOR") {
      const candidates = opts.floorBin.get(material.toUpperCase());
      if (candidates && candidates.size === 1) bin = [...candidates][0];
      else if (candidates && candidates.size > 1) reason = `bin lantai ganda (${[...candidates].join(", ")}); bin tidak bisa ditentukan`;
    }
    const batch = code(cell(row, cols, "batch"));
    const key = `${material.toUpperCase()}|${bin}|${batch.toUpperCase()}`;
    const a = agg.get(key) ?? newAgg(sheetName, line, { material_code: material, description: code(cell(row, cols, "desc")), storage_bin: bin, batch });
    if (!agg.has(key)) agg.set(key, a);
    a.net += inQty - outQty;
    const balance = num(cell(row, cols, "balance"));
    if (balance !== null) { a.printed = balance; a.sumBalance += balance; }
    if (reason) a.notes.push(reason);
    if (!a.description) a.description = code(cell(row, cols, "desc"));
  }
  for (const a of agg.values()) {
    const reason = a.notes.find((n) => n.startsWith("bin lantai ganda"));
    const notes = a.notes.filter((n) => n !== reason);
    settle(o, { ...a, notes }, reason ? { reason } : {});
  }
  o.sheetInfo.push({
    name: sheetName, format, used: true, rows: sheet.rows.length - head.index - 1,
    note: cols.bins === undefined ? "sheet ini tidak punya kolom bin" : "bin dari kolom Bins Location",
  });
  return true;
}

/** The companion PTFI-yard.xlsx "Yard" sheet: item + batch + the bin(s) that batch occupies. */
function parsePtfiYardCompanion(book: LedgerBook, o: Out) {
  let used = false;
  for (const [sheetName, sheet] of Object.entries(book.sheets)) {
    const head = findHeader(sheet.rows, { item: ["item code"], desc: ["material description"], qty: ["qty"], batch: ["batch no"], bins: ["bins location"] }, PTFI_YARD_COMPANION_REQUIRED, 5);
    if (!head) {
      o.sheetInfo.push({ name: `${book.name} · ${sheetName}`, format: null, used: false, rows: sheet.rows.length, note: "bukan daftar stok (dimensi/ukuran) — tidak diimpor" });
      continue;
    }
    used = true;
    for (let i = head.index + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const line = sheet.lines[i];
      const material = code(cell(row, head.cols, "item"));
      if (!material) continue;
      const qty = num(cell(row, head.cols, "qty")) ?? 0;
      const batch = code(cell(row, head.cols, "batch"));
      const binsRaw = code(cell(row, head.cols, "bins"));
      const bins = binsRaw.split(",").map((b) => b.trim().toUpperCase()).filter(Boolean);
      const base = {
        line, material_code: material, description: code(cell(row, head.cols, "desc")), plant: "", storage_location: "",
        batch, expiry_date: null, uom: "PCS", stock_type: "", sheet: `${book.name} · ${sheetName}`, printed: null,
        delta: null, note: binsRaw ? `bin ${binsRaw}` : "",
      };
      if (qty <= 0) {
        o.skipped.push({ sheet: `${book.name} · ${sheetName}`, line, material_code: material, storage_bin: binsRaw, batch, quantity: qty, reason: "qty nol — bukan stok saat ini" });
        continue;
      }
      if (bins.length > 1) {
        o.needsDecision.push({
          ...base, storage_bin: "", quantity: round3(qty),
          reason: `batch ${batch} ada di beberapa bin (${binsRaw}) — pecahan per bin tidak diketahui`,
        });
        continue;
      }
      o.rows.push({ ...base, storage_bin: bins[0] ?? "", quantity: round3(qty) });
    }
    o.sheetInfo.push({ name: `${book.name} · ${sheetName}`, format: "PTFI_YARD", used: true, rows: sheet.rows.length - head.index - 1, note: "bin dan batch yard dari file pendamping" });
  }
  return used;
}

// ---------------------------------------------------------------------------------------------------
// detection + entry point
// ---------------------------------------------------------------------------------------------------

export type LedgerSheetDetection = { format: LedgerFormat; headerIndex: number } | null;

/** Which of the five customer formats a sheet is, from its header alone. */
export function detectLedgerSheet(sheetName: string, sheet: LedgerSheet): LedgerSheetDetection {
  const rows = sheet.rows;
  if (findHeader(rows, SIP_ALIASES, SIP_REQUIRED)) return { format: "SIP", headerIndex: findHeader(rows, SIP_ALIASES, SIP_REQUIRED)!.index };
  for (let i = 0; i < Math.min(rows.length, 10); i++) if (cgpLotHeader(rows[i])) return { format: "CGP", headerIndex: i };
  if (findHeader(rows, BOIL_ALIASES, BOIL_REQUIRED)) return { format: "BOILERMECH", headerIndex: findHeader(rows, BOIL_ALIASES, BOIL_REQUIRED)!.index };
  const ptfi = findHeader(rows, PTFI_ALIASES, PTFI_REQUIRED);
  if (ptfi) {
    const format: LedgerFormat = norm(sheetName) === "yard" ? "PTFI_YARD" : norm(sheetName) === "floor" ? "PTFI_FLOOR" : "PTFI_RACK";
    return { format, headerIndex: ptfi.index };
  }
  return null;
}

/**
 * Read one customer workbook (and its companion file, for the Freeport yard bins) into snapshot
 * rows. Every recognised sheet contributes; everything else is reported as unused with a reason.
 */
export function parseCustomerLedger(book: LedgerBook, companions: LedgerBook[] = []): LedgerParse {
  const o = emptyOut();
  const append = (format: LedgerFormat) => { if (!o.formats.includes(format)) o.formats.push(format); };

  const companionYard = companions.some((c) => parsePtfiYardCompanion(c, o));
  if (companionYard) append("PTFI_YARD");

  const floorBin = floorBins(book.sheets);
  const detected = Object.entries(book.sheets).map(([name, sheet]) => ({ name, sheet, detection: detectLedgerSheet(name, sheet) }));

  for (const { name, sheet, detection } of detected) {
    if (!detection) {
      o.sheetInfo.push({ name, format: null, used: false, rows: sheet.rows.length, note: "bukan daftar stok (log gate in/out, rekap, dimensi) — tidak dibaca" });
      continue;
    }
    if (detection.format === "SIP") { if (parseSip(name, sheet, o)) append("SIP"); continue; }
    if (detection.format === "BOILERMECH") { if (parseBoilmerch(name, sheet, o)) append("BOILERMECH"); continue; }
    if (detection.format === "PTFI_RACK" || detection.format === "PTFI_FLOOR" || detection.format === "PTFI_YARD") {
      const isYard = detection.format === "PTFI_YARD";
      const skip = isYard && companionYard ? "baris yard di file utama dilewati: bin dan batch diambil dari file pendamping PTFI-yard" : undefined;
      if (parsePtfiLedger(name, sheet, detection.format, o, { floorBin, skipReason: skip })) append(detection.format);
      continue;
    }
  }

  if (!parseCgp(book.sheets, o)) {
    // no CGP lot sheet: nothing to do, but a legacy summary sheet must still be reported
  } else {
    append("CGP");
  }

  if (o.formats.length === 0 && o.needsDecision.length === 0 && o.rows.length === 0) {
    o.fileErrors.push(
      "Format tidak dikenali. File harus salah satu dari: kartu stok SIP (kolom Code | Item Code | In | Out | Balance), " +
      "STOCK NEW CGP (DO IN | ITEM CODE | QTY | Final Stock), Stock Boilmerch (PALLET ID), " +
      "atau ledger PTFI (Rack/Floor/Yard dengan Bins Location | No Material | Qty In | Qty Out | Balance).",
    );
  }
  if (o.formats.some((f) => f === "BOILERMECH") && o.rows.length === 0 && o.needsDecision.length > 0) {
    o.notes.push("Semua baris Boilmerch menunggu keputusan; tidak ada baris yang siap diimpor sampai bin palet dikonfirmasi.");
  }

  const totalQty = round3(o.rows.reduce((s, r) => s + r.quantity, 0));
  const decisionQty = round3(o.needsDecision.reduce((s, r) => s + r.quantity, 0));
  const labeled = o.formats.map((f) => FORMAT_LABEL[f]);
  return {
    formats: o.formats,
    rows: o.rows,
    skipped: o.skipped,
    needsDecision: o.needsDecision,
    duplicates: o.duplicates,
    sheets: o.sheetInfo,
    summary: {
      labels: labeled,
      cleanCount: o.rows.length,
      decisionCount: o.needsDecision.length,
      skippedCount: o.skipped.length,
      identityCount: o.rows.length + o.needsDecision.length,
      totalQty,
      decisionQty,
      printedQty: o.printedQty,
      deltaQty: o.printedQty === null ? null : round3(totalQty - o.printedQty),
      notes: o.notes,
    },
    fileErrors: o.fileErrors,
  };
}

/** The note stored on the snapshot: what was read, from which sheets, and what did not add up. */
export function ledgerNote(p: LedgerParse, extra?: string | null): string {
  const parts = [
    `Daftar stok pelanggan (${p.formats.map((f) => f.replace("_", " ")).join(" + ") || "tidak dikenali"}) dari ${p.sheets.filter((s) => s.used).map((s) => s.name).join(", ") || "tidak ada sheet"}.`,
    `${p.rows.length} identitas (${p.summary.totalQty} qty) diimpor`,
    p.needsDecision.length ? `${p.needsDecision.length} baris diputuskan manual` : "",
    p.skipped.length ? `${p.skipped.length} baris dilewati` : "",
    p.summary.printedQty === null ? "" : `total tercetak ${p.summary.printedQty}`,
    extra ? extra.trim() : "",
  ];
  return parts.filter(Boolean).join("; ");
}

/** Snapshot rows only: what ckb_import_sap_snapshot reads (preview fields are dropped). */
export const toSnapshotRows = (rows: readonly SnapshotRow[]): SnapshotRow[] =>
  rows.map((r) => ({
    line: r.line, material_code: r.material_code, description: r.description, plant: r.plant,
    storage_location: r.storage_location, storage_bin: r.storage_bin, batch: r.batch,
    expiry_date: r.expiry_date, uom: r.uom, quantity: r.quantity, stock_type: r.stock_type,
  }));
