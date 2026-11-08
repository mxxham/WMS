import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { readSheet } from "./lib/read-sheet";
const wb = XLSX.read(readFileSync(process.argv[2]!), { cellDates: false, type: "buffer" });
for (const name of process.argv.slice(3)) {
  const s = readSheet(wb, name);
  console.log("=====", name, s.rows.length);
  s.rows.forEach((r, i) => console.log(String(s.lines[i]).padStart(4), JSON.stringify(r.map((v) => v === null ? "" : v))));
}
