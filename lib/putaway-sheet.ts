import { excelBatchText } from "@/lib/allocator/excel-date";
import { toDate } from "@/lib/import-validate";
import type { SheetRows } from "@/lib/read-sheet";

/** One row of the "data putaway" sheet: a pallet that now sits in a bin. */
export type PutawayRow = {
  line: number; // Excel row number
  bin_code: string; sku: string; batch_lot: string; quantity: number | null; expiry_date: string | null;
  error: string | null; // set when the row cannot be sent at all
};

/** Resolution of a conflict, chosen per row by the supervisor. */
export type PutawayAction = "add" | "set";
export type PutawayKind = "qty_differs" | "bin_occupied" | "bin_unknown" | "bin_blocked" | "sku_unknown";
export type PutawayVerdict = {
  line: number; status: "new" | "same" | "conflict"; kind: PutawayKind | null; action: PutawayAction | null;
  current: { sku: string; batch_lot: string; expiry_date: string | null; quantity: number }[];
  /** Expiry the batch code implies, when the sheet's expiry differs (0018). */
  expiry_expected?: string | null;
};

/** Resolutions the database accepts for each conflict (see putaway_import in 0008). */
export const ACTIONS: Record<PutawayKind, PutawayAction[]> = {
  qty_differs: ["add", "set"], bin_occupied: ["add"], bin_unknown: [], bin_blocked: [], sku_unknown: [],
};

export const KIND_LABELS: Record<PutawayKind, string> = {
  qty_differs: "Bin sudah berisi SKU/batch ini dengan qty lain",
  bin_occupied: "Bin sudah berisi stok lain",
  bin_unknown: "Kode bin tidak ada di sistem",
  bin_blocked: "Bin diblokir",
  sku_unknown: "SKU belum ada di master data",
};

export const PUTAWAY_SHEET = /putaway/i;

const COLUMNS = {
  bin_code: ["bin location", "lokasi", "bin", "location"],
  sku: ["item code", "item", "material", "sku"],
  quantity: ["actual qty", "qty", "quantity"],
  batch_lot: ["batch no", "batch", "batch_lot"],
  expiry_date: ["expired date", "exp date", "expiry"],
} as const;
type Col = keyof typeof COLUMNS;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Finds the header row (within the first 10 rows) and each column's index. */
function findHeader(rows: unknown[][]): { headerRow: number; cols: Record<Col, number> } | null {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = (rows[r] ?? []).map(norm);
    const cols = {} as Record<Col, number>;
    for (const [col, aliases] of Object.entries(COLUMNS) as [Col, readonly string[]][]) {
      const idx = aliases.map((a) => cells.indexOf(a)).find((i) => i >= 0);
      if (idx !== undefined) cols[col] = idx;
    }
    if (Object.keys(cols).length === Object.keys(COLUMNS).length) return { headerRow: r, cols };
  }
  return null;
}

/** Reads the sheet into rows. Throws when the expected columns are missing. */
export function parsePutawaySheet(data: SheetRows): PutawayRow[] {
  const h = findHeader(data.rows);
  if (!h) throw new Error("Kolom tidak ditemukan. Sheet putaway butuh: BIN Location, Item Code, ACTUAL QTY, Batch No, Expired Date.");
  const out: PutawayRow[] = [];
  const seen = new Map<string, number>();
  for (let i = h.headerRow + 1; i < data.rows.length; i++) {
    const r = data.rows[i];
    const get = (c: Col) => r[h.cols[c]];
    const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
    if (blank(get("bin_code")) && blank(get("sku")) && blank(get("quantity"))) continue;

    const bin_code = String(get("bin_code") ?? "").trim().toUpperCase();
    const sku = String(get("sku") ?? "").trim();
    const batch_lot = excelBatchText(get("batch_lot"));
    const rawQty = get("quantity");
    const quantity = typeof rawQty === "number" ? rawQty : /^\d+(\.\d+)?$/.test(String(rawQty ?? "").trim()) ? Number(rawQty) : null;
    const exp = toDate(get("expiry_date"));

    let error: string | null = null;
    if (!bin_code) error = "Kode bin kosong";
    else if (!sku) error = "Item code kosong";
    else if (quantity === null || quantity <= 0) error = `Qty tidak valid (${String(rawQty ?? "kosong")})`;
    else if (!exp.iso) error = `Tanggal expired ${exp.problem === "kosong" ? "kosong" : `tidak valid: ${exp.problem}`}`;
    else {
      const key = `${bin_code}|${sku}|${batch_lot}|${exp.iso}`;
      if (seen.has(key)) error = `Duplikat dengan baris ${seen.get(key)}`;
      else seen.set(key, data.lines[i]);
    }
    out.push({ line: data.lines[i], bin_code, sku, batch_lot, quantity, expiry_date: exp.iso, error });
  }
  return out;
}
