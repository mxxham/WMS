import * as XLSX from "xlsx";
import { readSheet } from "./read-sheet";
import { excelDateIso, excelSerialToUtc } from "./allocator/excel-date";

/**
 * Shell's SAP stock export (MB52-style): Plant, Material / SKU CODE, Material
 * Description, Storage Location, Batch ("UT"), Base Unit of Measure,
 * Unrestricted, Blocked. The header row is found by its titles, wherever it
 * sits; when a sheet repeats Unrestricted / Blocked (SAP vs FISIK vs RAMCO
 * side by side) the FIRST pair is SAP's.
 */
export type SapRow = { sku: string; description: string; uom: string; unrestricted: number; blocked: number; line: number };
export type SapParse = { sheet: string; rows: SapRow[]; skipped: { line: number; why: string }[]; headerLine: number };
export type PendingRow = { sku: string; qty: number };

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const SKU = (h: string) => h === "material" || h === "sku code" || h === "sku" || h === "material number" || h === "item code";
const UNREST = (h: string) => h.startsWith("unrestricted") || h === "unrest" || h === "unrestricted use";
const BLOCK = (h: string) => h.startsWith("blocked") || h === "blok" || h === "block";
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const skuText = (v: unknown) => (typeof v === "number" ? String(Math.round(v)) : String(v ?? "").trim());

function findHeader(rows: unknown[][]): { idx: number; cols: Record<"sku" | "desc" | "uom" | "unrest" | "blocked", number> } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const h = rows[i].map(norm);
    const sku = h.findIndex(SKU);
    const unrest = h.findIndex(UNREST);
    const blocked = h.findIndex(BLOCK);
    if (sku >= 0 && (unrest >= 0 || blocked >= 0)) {
      return { idx: i, cols: { sku, unrest, blocked, desc: h.findIndex((x) => x.includes("description")), uom: h.findIndex((x) => x.includes("unit of measure") || x === "uom" || x === "bun") } };
    }
  }
  return null;
}

/** First sheet (or `sheet`) that looks like an SAP stock list. */
export function parseSapStock(wb: XLSX.WorkBook, sheet?: string): SapParse {
  const names = sheet ? [sheet] : wb.SheetNames;
  for (const name of names) {
    const { rows, lines } = readSheet(wb, name);
    const head = findHeader(rows);
    if (!head) continue;
    const { cols } = head;
    const out: SapRow[] = [];
    const skipped: SapParse["skipped"] = [];
    for (let i = head.idx + 1; i < rows.length; i++) {
      const r = rows[i];
      const sku = skuText(r[cols.sku]);
      if (!/^\d{6,12}$/.test(sku)) { if (sku) skipped.push({ line: lines[i], why: `bukan kode SKU: "${sku}"` }); continue; }
      const unrestricted = cols.unrest >= 0 ? num(r[cols.unrest]) : 0;
      const blocked = cols.blocked >= 0 ? num(r[cols.blocked]) : 0;
      if (Number.isNaN(unrestricted) || Number.isNaN(blocked)) { skipped.push({ line: lines[i], why: "qty bukan angka" }); continue; }
      out.push({ sku, description: cols.desc >= 0 ? String(r[cols.desc] ?? "") : "", uom: cols.uom >= 0 ? String(r[cols.uom] ?? "").toUpperCase() : "",
        unrestricted, blocked, line: lines[i] });
    }
    if (out.length) return { sheet: name, rows: out, skipped, headerLine: lines[head.idx] };
  }
  throw new Error("Tidak ada sheet dengan kolom Material / SKU CODE dan Unrestricted / Blocked.");
}

/**
 * Pending GI / GR list: a Material (SKU) column and a quantity column
 * ("Delivery quantity", "Qty", "Quantity"). Several rows per SKU are summed.
 */
export function parsePendingList(wb: XLSX.WorkBook): PendingRow[] {
  for (const name of wb.SheetNames) {
    const { rows } = readSheet(wb, name);
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const h = rows[i].map(norm);
      const s = h.findIndex(SKU);
      const q = h.findIndex((x) => x === "delivery quantity" || x === "qty" || x === "quantity" || x === "jumlah");
      if (s < 0 || q < 0) continue;
      const m = new Map<string, number>();
      for (const r of rows.slice(i + 1)) {
        const sku = skuText(r[s]); const qty = num(r[q]);
        if (/^\d{6,12}$/.test(sku) && Number.isFinite(qty)) m.set(sku, (m.get(sku) ?? 0) + qty);
      }
      if (m.size) return [...m].map(([sku, qty]) => ({ sku, qty }));
    }
  }
  throw new Error("Tidak ada sheet dengan kolom Material dan Delivery quantity / Qty.");
}

export type DocLine = { sku: string; batch_lot: string; quantity: number };

/**
 * Delivery document lines (Shell DO / packing list): Material, quantity
 * ("Delivery quantity" / "Qty"), and Batch when the document prints one.
 * Rows with the same SKU + batch are summed.
 */
export function parseDeliveryDoc(wb: XLSX.WorkBook): DocLine[] {
  for (const name of wb.SheetNames) {
    const { rows } = readSheet(wb, name);
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const h = rows[i].map(norm);
      const s = h.findIndex(SKU);
      const q = h.findIndex((x) => x === "delivery quantity" || x === "qty" || x === "quantity" || x === "jumlah");
      if (s < 0 || q < 0) continue;
      const b = h.findIndex((x) => x === "batch" || x === "batch no" || x === "lot");
      const m = new Map<string, DocLine>();
      for (const r of rows.slice(i + 1)) {
        const sku = skuText(r[s]); const qty = num(r[q]);
        if (!/^\d{6,12}$/.test(sku) || !(qty > 0)) continue;
        const batch = b >= 0 ? String(r[b] ?? "").trim().toUpperCase().replace(/^UT$/, "") : "";
        const k = `${sku}|${batch}`;
        const e = m.get(k);
        if (e) e.quantity += qty; else m.set(k, { sku, batch_lot: batch, quantity: qty });
      }
      if (m.size) return [...m.values()];
    }
  }
  throw new Error("Tidak ada sheet dengan kolom Material dan Delivery quantity / Qty.");
}

// ---------------------------------------------------------------------------
// MB52 by storage location, MB51 transactions (migration 0111)
// ---------------------------------------------------------------------------

/** One MB52 stock row: SKU + storage location + batch. */
export type Mb52Row = {
  sku: string; description: string; uom: string; plant: string; sloc: string; batch: string;
  unrestricted: number; blocked: number; sheet: string; line: number;
};
export type SlocTotal = { sloc: string; skus: number; unrestricted: number; blocked: number };
export type Mb52Parse = {
  rows: Mb52Row[]; sheets: string[]; slocs: SlocTotal[]; plants: string[];
  skipped: { sheet: string; line: number; why: string }[]; warnings: string[];
};

const SLOC = (h: string) => h === "storage location" || h === "sloc" || h === "stor. loc." || h === "stor. location" || h === "lokasi sap";

/**
 * Every sheet of an MB52 export that has Material + Unrestricted / Blocked.
 * Shell's file puts WHS1 on one sheet and INBD on another; both are read and
 * kept apart by storage location. Totals typed beside the table (the real
 * file has 59482 / 18 in J1 / L1) sit outside the SKU column and are ignored.
 */
export function parseMb52(wb: XLSX.WorkBook, only?: string[]): Mb52Parse {
  const rows: Mb52Row[] = [];
  const sheets: string[] = [];
  const skipped: Mb52Parse["skipped"] = [];
  for (const name of only ?? wb.SheetNames) {
    if (!wb.Sheets[name]) continue;
    const { rows: grid, lines } = readSheet(wb, name);
    const head = findHeader(grid);
    if (!head) continue;
    const h = grid[head.idx].map(norm);
    if (h.some((x) => x === "movement type")) continue; // an MB51 sheet
    const sloc = h.findIndex(SLOC), batch = h.findIndex((x) => x === "batch"), plant = h.findIndex((x) => x === "plant");
    const { cols } = head;
    let n = 0;
    for (let i = head.idx + 1; i < grid.length; i++) {
      const r = grid[i];
      const sku = skuText(r[cols.sku]);
      if (!/^\d{6,12}$/.test(sku)) { if (sku) skipped.push({ sheet: name, line: lines[i], why: `bukan kode SKU: "${sku}"` }); continue; }
      const unrestricted = cols.unrest >= 0 ? num(r[cols.unrest]) : 0;
      const blocked = cols.blocked >= 0 ? num(r[cols.blocked]) : 0;
      if (Number.isNaN(unrestricted) || Number.isNaN(blocked)) { skipped.push({ sheet: name, line: lines[i], why: "qty bukan angka" }); continue; }
      rows.push({
        sku, description: cols.desc >= 0 ? String(r[cols.desc] ?? "").trim() : "",
        uom: cols.uom >= 0 ? String(r[cols.uom] ?? "").trim().toUpperCase() : "",
        plant: plant >= 0 ? String(r[plant] ?? "").trim() : "",
        sloc: sloc >= 0 ? String(r[sloc] ?? "").trim().toUpperCase() : "",
        batch: batch >= 0 ? String(r[batch] ?? "").trim().toUpperCase() : "",
        unrestricted, blocked, sheet: name, line: lines[i],
      });
      n++;
    }
    if (n) sheets.push(name);
  }
  if (!rows.length) throw new Error("Tidak ada sheet MB52: kolom Material / SKU CODE dan Unrestricted / Blocked tidak ditemukan.");

  const bySloc = new Map<string, { skus: Set<string>; unrestricted: number; blocked: number }>();
  const uoms = new Map<string, Set<string>>();
  const warnings: string[] = [];
  for (const r of rows) {
    const s = bySloc.get(r.sloc) ?? { skus: new Set<string>(), unrestricted: 0, blocked: 0 };
    s.skus.add(r.sku); s.unrestricted += r.unrestricted; s.blocked += r.blocked; bySloc.set(r.sloc, s);
    if (r.uom) uoms.set(r.sku, (uoms.get(r.sku) ?? new Set<string>()).add(r.uom));
    if (r.unrestricted < 0 || r.blocked < 0) warnings.push(`SKU ${r.sku} (${r.sloc || "tanpa lokasi"}) stok minus di SAP: ${r.unrestricted} / ${r.blocked}`);
  }
  for (const [sku, set] of uoms) if (set.size > 1) warnings.push(`SKU ${sku} punya beberapa satuan di SAP: ${[...set].join(", ")}`);
  const plants = [...new Set(rows.map((r) => r.plant).filter(Boolean))].sort();
  if (plants.length > 1) warnings.push(`File berisi beberapa plant: ${plants.join(", ")}`);
  const slocs = [...bySloc].map(([sloc, s]) => ({ sloc, skus: s.skus.size, unrestricted: s.unrestricted, blocked: s.blocked }))
    .sort((a, b) => a.sloc.localeCompare(b.sloc));
  return { rows, sheets, slocs, plants, skipped, warnings };
}

/**
 * The storage locations counted as warehouse stock unless the user picks
 * others: WHS1 when the file has it; otherwise everything that is not an
 * inbound / in-transit location; otherwise everything.
 */
export function defaultSlocs(slocs: string[]): string[] {
  if (slocs.includes("WHS1")) return ["WHS1"];
  const stock = slocs.filter((s) => !/^(INB|TRAN|TRNS|TRS)/.test(s));
  return stock.length ? stock : [...slocs];
}

export type SapPayloadRow = { sku: string; description: string; uom: string; unrestricted: number; blocked: number };
/** Split MB52 rows into the counted locations and the others (kept per location). */
export function splitBySloc(rows: Mb52Row[], counted: string[]): { sap: SapPayloadRow[]; other: (SapPayloadRow & { sloc: string })[] } {
  const keep = new Set(counted);
  const sap: SapPayloadRow[] = [], other: (SapPayloadRow & { sloc: string })[] = [];
  for (const r of rows) {
    const p = { sku: r.sku, description: r.description, uom: r.uom, unrestricted: r.unrestricted, blocked: r.blocked };
    // A file without a storage location column has one location, and it counts.
    if (!r.sloc || keep.has(r.sloc)) sap.push(p); else other.push({ ...p, sloc: r.sloc });
  }
  return { sap, other };
}

/** One MB51 line. `quantity` is signed in the base unit; `reference` loses its leading zeros. */
export type Mb51Row = {
  line_no: number; sku: string; description: string; sloc: string; mvt_type: string; mvt_text: string; mat_doc: string;
  posting_date: string | null; quantity: number; uom: string; reference: string; customer: string; customer_name: string; user_name: string;
};
export type Mb51Parse = { sheet: string; rows: Mb51Row[]; skipped: { line: number; why: string }[]; from: string | null; to: string | null };

function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return excelSerialToUtc(v).toISOString().slice(0, 10);
  if (v instanceof Date) return excelDateIso(v);
  const s = String(v).trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** First sheet with Material + Movement Type + a quantity column (SAP MB51). */
export function parseMb51(wb: XLSX.WorkBook): Mb51Parse {
  for (const name of wb.SheetNames) {
    const { rows: grid, lines } = readSheet(wb, name);
    for (let i = 0; i < Math.min(grid.length, 30); i++) {
      const h = grid[i].map(norm);
      const col = (...names: string[]) => h.findIndex((x) => names.includes(x));
      const sku = h.findIndex(SKU), mvt = col("movement type", "mvt type", "mvt", "bwart");
      let qty = col("quantity", "qty in base unit", "quantity in base unit");
      if (qty < 0) qty = col("qty in unit of entry", "qty in une");
      if (sku < 0 || mvt < 0 || qty < 0) continue;
      const c = {
        desc: col("material description"), sloc: h.findIndex(SLOC), text: col("movement type text", "mvt type text"),
        doc: col("material document", "mat. doc."), date: col("posting date", "pstng date"),
        uom: col("base unit of measure", "bun"), uoe: col("unit of entry", "eun"), ref: col("reference"),
        cust: col("customer"), name: col("name 1", "name"), user: col("user name", "user"),
      };
      const s = (r: unknown[], k: number) => (k >= 0 ? String(r[k] ?? "").trim() : "");
      const rows: Mb51Row[] = [];
      const skipped: Mb51Parse["skipped"] = [];
      for (let j = i + 1; j < grid.length; j++) {
        const r = grid[j];
        const code = skuText(r[sku]);
        if (!/^\d{6,12}$/.test(code)) { if (code) skipped.push({ line: lines[j], why: `bukan kode SKU: "${code}"` }); continue; }
        const q = num(r[qty]);
        if (!Number.isFinite(q)) { skipped.push({ line: lines[j], why: "qty bukan angka" }); continue; }
        rows.push({
          line_no: lines[j], sku: code, description: s(r, c.desc), sloc: s(r, c.sloc).toUpperCase(), mvt_type: s(r, mvt).toUpperCase(),
          mvt_text: s(r, c.text), mat_doc: s(r, c.doc), posting_date: c.date >= 0 ? isoDate(r[c.date]) : null, quantity: q,
          uom: (s(r, c.uom) || s(r, c.uoe)).toUpperCase(), reference: s(r, c.ref).replace(/^0+(?=\d)/, ""),
          customer: s(r, c.cust), customer_name: s(r, c.name), user_name: s(r, c.user),
        });
      }
      if (!rows.length) continue;
      const dates = rows.map((r) => r.posting_date).filter((d): d is string => !!d).sort();
      return { sheet: name, rows, skipped, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
    }
  }
  throw new Error("Tidak ada sheet MB51: kolom Material, Movement Type dan Quantity tidak ditemukan.");
}

const MONTHS = ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"];
/**
 * The stock date written in an SAP export's file name: "MB52 2810_28 Oktober
 * 2026.xlsx" -> 2026-10-28. Indonesian or English month names, or 2026-10-28.
 */
export function dateFromFileName(name: string): string | null {
  const s = name.toLowerCase();
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})[\s_-]+([a-z]{3,9})[\s_-]+(\d{4})/.exec(s);
  if (!m) return null;
  const en = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const i = MONTHS.findIndex((x) => x.startsWith(m![2].slice(0, 3)) || m![2].startsWith(x.slice(0, 3)));
  const k = i >= 0 ? i : en.findIndex((x) => m![2].startsWith(x));
  const day = Number(m[1]);
  if (k < 0 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(k + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
