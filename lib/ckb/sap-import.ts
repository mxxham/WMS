/**
 * CKB 3PL SAP stock snapshot parser. Pure: sheet rows in, validated snapshot rows + row errors out.
 *
 * The CKB SAP file format has NOT been confirmed with a real file yet. Column titles therefore come
 * from the admin-editable mapping (ckb_settings.sap_import), and every rule below refuses rather
 * than guesses:
 *   - a required column (material, unit, quantity) that is missing or matches two columns rejects
 *     the whole file — the parser will not pick one of two "Unrestricted" columns for you;
 *   - an empty quantity is an error, never zero; a quantity typed as text with a "." or "," is an
 *     error too (1.234 is one thousand two hundred thirty-four in Indonesian, 1.234 in English);
 *   - dates are accepted as Excel date cells, YYYY-MM-DD or DD.MM.YYYY only; "03/04/2027" is
 *     ambiguous between day-first and month-first and is refused;
 *   - a batch cell that Excel turned into a date is refused (docs/DATA_ISSUES.md: CD39C01).
 * The database re-validates every row (ckb_import_sap_snapshot) — this parser exists to show the
 * person uploading exactly which lines are wrong before anything is written.
 */

export const SAP_FIELDS = [
  "material_code", "description", "plant", "storage_location", "storage_bin",
  "batch", "expiry_date", "uom", "quantity", "stock_type",
] as const;
export type SapField = (typeof SAP_FIELDS)[number];
export const REQUIRED_FIELDS: readonly SapField[] = ["material_code", "uom", "quantity"];

export const SAP_FIELD_LABEL: Record<SapField, string> = {
  material_code: "Material",
  description: "Deskripsi",
  plant: "Plant",
  storage_location: "Storage location",
  storage_bin: "Storage bin",
  batch: "Batch",
  expiry_date: "Tanggal expired",
  uom: "Satuan",
  quantity: "Qty",
  stock_type: "Tipe stok",
};

/** Header titles (aliases) per field, as stored in ckb_settings.sap_import.columns. */
export type SapMapping = Partial<Record<SapField, string[]>>;

export type SnapshotRow = {
  line: number;
  material_code: string;
  description: string;
  plant: string;
  storage_location: string;
  storage_bin: string;
  batch: string;
  expiry_date: string | null;
  uom: string;
  quantity: number;
  stock_type: string;
};
export type RowError = { line: number; message: string };

export type SnapshotParse = {
  /** Excel row number of the header, or null when no header was found */
  headerLine: number | null;
  /** which sheet column (0-based) and title each field was read from */
  columns: Partial<Record<SapField, { index: number; header: string }>>;
  /** file-level problems: nothing can be imported while this is non-empty */
  fileErrors: string[];
  rows: SnapshotRow[];
  errors: RowError[];
  /** stock identities that appear on more than one row (kept, flagged later as AMBIGUOUS) */
  duplicateIdentities: number;
};

const HEADER_SCAN_ROWS = 30;
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The same identity spelling as public.ckb_identity_key (migration 0100). */
export function identityKey(r: Pick<SnapshotRow, "material_code" | "plant" | "storage_location" | "storage_bin" | "batch" | "expiry_date" | "uom" | "stock_type">): string {
  const u = (s: string) => s.trim().toUpperCase();
  return [u(r.material_code), u(r.plant), u(r.storage_location), u(r.storage_bin), u(r.batch), r.expiry_date ?? "", u(r.uom), u(r.stock_type)].join("|");
}

/** Find the header row: the first of the top rows where every required field matches a column. */
function findHeader(rows: unknown[][], mapping: SapMapping) {
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    const cells = rows[i].map(norm);
    const columns: SnapshotParse["columns"] = {};
    const doubles: string[] = [];
    for (const field of SAP_FIELDS) {
      const aliases = (mapping[field] ?? []).map(norm).filter(Boolean);
      const hits = cells.map((c, idx) => (aliases.includes(c) ? idx : -1)).filter((idx) => idx >= 0);
      if (hits.length > 1) doubles.push(`${SAP_FIELD_LABEL[field]} cocok dengan ${hits.length} kolom (${hits.map((h) => `"${String(rows[i][h])}"`).join(", ")})`);
      if (hits.length >= 1) columns[field] = { index: hits[0], header: String(rows[i][hits[0]]) };
    }
    if (REQUIRED_FIELDS.every((f) => columns[f])) return { index: i, columns, doubles };
  }
  return null;
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
};

/** Quantity cell → number, or an error message. */
export function parseQuantity(v: unknown): number | string {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return "qty kosong";
  if (typeof v === "number") return Number.isFinite(v) ? v : "qty bukan angka";
  const s = String(v).trim();
  if (/^#/.test(s)) return `qty berisi error Excel ${s}`;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/[.,]/.test(s)) return `qty "${s}" ditulis sebagai teks dengan pemisah; simpan kolom qty sebagai angka`;
  return `qty "${s}" bukan angka`;
}

const pad = (n: number) => String(n).padStart(2, "0");
function validYmd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Expiry cell → 'YYYY-MM-DD', null when empty, or an error message (object). */
export function parseExpiry(v: unknown): string | null | { error: string } {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  if (typeof v === "number") {
    // Excel serial day (workbooks are read with cellDates: false, so no timezone is involved).
    if (!Number.isInteger(v) || v < 32874 || v > 73051) return { error: `tanggal expired ${v} tidak masuk akal` };
    const dt = new Date(Math.round((v - 25569) * 86_400_000));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]) ?? { error: `tanggal expired "${s}" tidak valid` };
  m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (m) return validYmd(+m[3], +m[2], +m[1]) ?? { error: `tanggal expired "${s}" tidak valid` };
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return { error: `tanggal expired "${s}" ambigu (hari/bulan); pakai DD.MM.YYYY atau sel tanggal` };
  return { error: `tanggal expired "${s}" tidak dikenali` };
}

/**
 * Parse one sheet (rows as read by lib/read-sheet.ts with cellDates: false; `lines` are the Excel
 * row numbers) against the mapping.
 */
export function parseSapSnapshot(rows: unknown[][], lines: number[], mapping: SapMapping): SnapshotParse {
  const out: SnapshotParse = { headerLine: null, columns: {}, fileErrors: [], rows: [], errors: [], duplicateIdentities: 0 };
  const head = findHeader(rows, mapping);
  if (!head) {
    const missing = REQUIRED_FIELDS.map((f) => `${SAP_FIELD_LABEL[f]} (${(mapping[f] ?? []).join(" / ") || "belum dipetakan"})`);
    out.fileErrors.push(`Baris judul tidak ditemukan di ${HEADER_SCAN_ROWS} baris pertama. Kolom wajib: ${missing.join(", ")}.`);
    return out;
  }
  out.headerLine = lines[head.index];
  out.columns = head.columns;
  const requiredDoubles = head.doubles.filter((d) => REQUIRED_FIELDS.some((f) => d.startsWith(SAP_FIELD_LABEL[f])));
  if (requiredDoubles.length) {
    out.fileErrors.push(...requiredDoubles.map((d) => `Kolom wajib ganda: ${d}. Perjelas pemetaan di Pengaturan.`));
    return out;
  }
  for (const d of head.doubles) out.fileErrors.push(`Kolom ganda: ${d}. Perjelas pemetaan di Pengaturan.`);
  if (out.fileErrors.length) return out;

  const col = (r: unknown[], f: SapField) => (head.columns[f] ? r[head.columns[f]!.index] : null);
  const seen = new Map<string, number>();
  for (let i = head.index + 1; i < rows.length; i++) {
    const r = rows[i];
    const line = lines[i];
    const problems: string[] = [];

    const material = text(col(r, "material_code"));
    if (!material) problems.push("material kosong");
    else if (/^#/.test(material)) problems.push(`material berisi error Excel ${material}`);
    const uom = text(col(r, "uom")).toUpperCase();
    if (!uom) problems.push("satuan kosong");
    const qty = parseQuantity(col(r, "quantity"));
    if (typeof qty === "string") problems.push(qty);
    else if (qty < 0) problems.push(`qty negatif (${qty})`);
    const expiry = parseExpiry(col(r, "expiry_date"));
    if (expiry && typeof expiry === "object") problems.push(expiry.error);
    const batchCell = col(r, "batch");
    if (batchCell instanceof Date) problems.push("batch terbaca sebagai tanggal oleh Excel; ketik ulang sebagai teks");

    if (problems.length) { out.errors.push({ line, message: problems.join("; ") }); continue; }
    const row: SnapshotRow = {
      line,
      material_code: material,
      description: text(col(r, "description")),
      plant: text(col(r, "plant")),
      storage_location: text(col(r, "storage_location")),
      storage_bin: text(col(r, "storage_bin")).toUpperCase(),
      batch: text(batchCell),
      expiry_date: expiry as string | null,
      uom,
      quantity: qty as number,
      stock_type: text(col(r, "stock_type")),
    };
    out.rows.push(row);
    const key = identityKey(row);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  out.duplicateIdentities = [...seen.values()].filter((n) => n > 1).length;
  return out;
}

/** Sum of quantities, for the preview line. */
export const totalQty = (rows: SnapshotRow[]): number => rows.reduce((s, r) => s + r.quantity, 0);
