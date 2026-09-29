import * as XLSX from "xlsx";

type Row = Record<string, string | number | null>;

/** Writes sheets (name -> rows) as one .xlsx download in the browser. An empty sheet gets a note row. */
export function saveSheets(sheets: Record<string, Row[]>, filename: string, empty = "belum ada data") {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Keterangan: empty }]), name);
  }
  XLSX.writeFile(wb, filename);
}
