import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { readSheet } from "./lib/read-sheet";
import { parseCustomerLedger, type LedgerBook } from "./lib/ckb/customer-ledger";

function load(path: string): LedgerBook {
  const wb = XLSX.read(readFileSync(path), { cellDates: false, type: "buffer" });
  const sheets: Record<string, any> = {};
  for (const name of wb.SheetNames) sheets[name] = readSheet(wb, name);
  return { name: path.split("/").pop()!, sheets };
}

const which = process.argv[2] ?? "sip";
const D = "/home/ilham/Downloads/";
let book: LedgerBook;
let companions: LedgerBook[] = [];
if (which === "sip") book = load(D + "01. Gate In Gate Out PT Supra Indolub Prakasa.xlsx");
else if (which === "cgp") book = load(D + "02. Gate In Gate Out PT Cipta Gria Paramita.xlsx");
else if (which === "boil") book = load(D + "Gate In Gate Out PT Boilmerch.xlsx");
else if (which === "ptfi") { book = load(D + "PTFI.xlsm"); companions = [load(D + "PTFI-yard.xlsx")]; }
else throw new Error("?");

const p = parseCustomerLedger(book, companions);
const sum = (a: number[]) => Math.round(a.reduce((s, n) => s + n, 0) * 1000) / 1000;
console.log("formats", p.formats);
console.log("sheetInfo", p.sheets);
console.log("summary", { ...p.summary, notes: undefined });
console.log("rows", p.rows.length, "qty", sum(p.rows.map((r) => r.quantity)));
console.log("decisions", p.needsDecision.length, "qty", sum(p.needsDecision.map((r) => r.quantity)));
console.log("skipped", p.skipped.length);
console.log("dupes", p.duplicates.length);
console.log("printed", p.summary.printedQty, "delta", p.summary.deltaQty);
console.log("fileErrors", p.fileErrors);
if (process.argv[3] === "all") {
  console.log("--- ROWS");
  for (const r of p.rows) console.log(JSON.stringify({ l: r.line, m: r.material_code, b: r.storage_bin, ba: r.batch, q: r.quantity, p: r.printed, d: r.delta, u: r.uom, n: r.note }));
  console.log("--- DECISIONS");
  for (const r of p.needsDecision) console.log(JSON.stringify({ l: r.line, m: r.material_code, b: r.storage_bin, ba: r.batch, q: r.quantity, n: r.note, why: r.reason }));
  console.log("--- SKIPPED");
  for (const r of p.skipped) console.log(JSON.stringify(r));
  console.log("--- DUPES");
  for (const r of p.duplicates) console.log(JSON.stringify(r));
}
