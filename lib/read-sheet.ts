import * as XLSX from "xlsx";

export type SheetRows = { rows: unknown[][]; lines: number[] };

/**
 * Reads one sheet as arrays of cell values (cached formula results).
 * - The declared range is ignored: the WMS export claims A1:AO1048563 because of
 *   formatted empty rows, so we only walk up to the last cell that has a value.
 * - Excel error cells (#VALUE!, #N/A) are returned as their text so validation can report them.
 * - Blank rows are skipped; `lines[i]` keeps the original Excel row number of `rows[i]`.
 */
export function readSheet(wb: XLSX.WorkBook, name: string): SheetRows {
  const ws = wb.Sheets[name];
  let maxR = 0, maxC = 0;
  for (const key of Object.keys(ws)) {
    if (key[0] === "!") continue;
    const cell = ws[key] as XLSX.CellObject;
    if (cell.v === undefined || cell.v === null || cell.v === "") continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  const rows: unknown[][] = [];
  const lines: number[] = [];
  for (let r = 0; r <= maxR; r++) {
    const row: unknown[] = new Array(maxC + 1).fill(null);
    let any = false;
    for (let c = 0; c <= maxC; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (!cell || cell.v === undefined || cell.v === null || cell.v === "") continue;
      row[c] = cell.t === "e" ? (cell.w ?? "#ERROR") : cell.v;
      any = true;
    }
    if (any) { rows.push(row); lines.push(r + 1); }
  }
  return { rows, lines };
}
