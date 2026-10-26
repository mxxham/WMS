import "server-only";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { readSheet } from "@/lib/read-sheet";
import { parseSapSnapshot, type SapMapping, type SnapshotParse } from "./sap-import";

/** Vercel caps a request body at 4.5 MB; the same limit locally keeps behaviour identical. */
export const MAX_SAP_FILE_BYTES = 4_400_000;
const ALLOWED_EXT = /\.(xlsx|xls|csv)$/i;

export type SapFileRead = SnapshotParse & { sheet: string | null; sheets: string[]; sha256: string; size: number; name: string };

/** Validate the upload itself before reading it. null when acceptable. */
export function sapUploadError(file: File | null): string | null {
  if (!file || typeof file === "string") return "Pilih file SAP.";
  if (!ALLOWED_EXT.test(file.name)) return "File harus .xlsx, .xls atau .csv.";
  if (file.size === 0) return "File kosong.";
  if (file.size > MAX_SAP_FILE_BYTES) return "File lebih dari 4,4 MB. Pisahkan per customer atau per plant.";
  return null;
}

/**
 * Read an uploaded SAP file: checksum of the exact bytes, then the first sheet whose header matches
 * the mapping (or the sheet asked for). Dates stay Excel serial numbers (cellDates: false).
 */
export async function readSapFile(file: File, mapping: SapMapping, sheet?: string | null): Promise<SapFileRead> {
  const buf = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const base = { sha256, size: buf.length, name: file.name };
  let book: XLSX.WorkBook;
  try { book = XLSX.read(buf, { type: "buffer", cellDates: false }); }
  catch { return { ...base, sheet: null, sheets: [], headerLine: null, columns: {}, fileErrors: ["File tidak bisa dibaca sebagai spreadsheet."], rows: [], errors: [], duplicateIdentities: 0 }; }
  const names = sheet && book.SheetNames.includes(sheet) ? [sheet] : book.SheetNames;
  let first: (SnapshotParse & { sheet: string }) | null = null;
  for (const name of names) {
    const { rows, lines } = readSheet(book, name);
    const p = parseSapSnapshot(rows, lines, mapping);
    if (!first) first = { ...p, sheet: name };
    if (p.headerLine !== null) return { ...base, ...p, sheet: name, sheets: book.SheetNames };
  }
  return { ...base, ...(first ?? { headerLine: null, columns: {}, fileErrors: ["File tidak punya sheet."], rows: [], errors: [], duplicateIdentities: 0, sheet: "" }), sheet: first?.sheet ?? null, sheets: book.SheetNames };
}
