import { excelBatchText } from "@/lib/allocator/excel-date";
import { toDate } from "@/lib/import-validate";
import type { SheetRows } from "@/lib/read-sheet";

/** One row of the "data putaway" sheet: a pallet that now sits in a bin. */
export type PutawayRow = {
  line: number; // Excel row number
  bin_code: string; sku: string; batch_lot: string; quantity: number | null; expiry_date: string | null;
  error: string | null; // set when the row cannot be sent at all
  /** set when the row was sent to another bin than the sheet says ("Pindah ke bin lain", 0042) */
  sheet_bin?: string;
};

/** Resolution of a conflict, chosen per row by the supervisor. "fix": the sheet is right, the bin is corrected (0066). */
export type PutawayAction = "add" | "set" | "fix";
export type PutawayKind = "qty_differs" | "bin_occupied" | "bin_unknown" | "bin_blocked" | "sku_unknown" | "moved_in";
export type PutawayVerdict = {
  line: number; status: "new" | "same" | "conflict"; kind: PutawayKind | null; action: PutawayAction | null;
  current: { sku: string; batch_lot: string; expiry_date: string | null; quantity: number }[];
  /** The Bin To Bin that brought this SKU into the bin in the last two days (0059). */
  moved_in?: { quantity: number; from_bin: string | null; batch_lot: string; at: string; note: string | null } | null;
  /** Expiry the batch code implies, when the sheet's expiry differs (0018). */
  expiry_expected?: string | null;
  /** Why a "Sheet benar" fix cannot run (bin changed, stock reserved or held, bad target bin; 0066). */
  fix_error?: string | null;
};

/** Resolutions the database accepts for each conflict (see putaway_import in 0008). */
export const ACTIONS: Record<PutawayKind, PutawayAction[]> = {
  qty_differs: ["add", "set", "fix"], bin_occupied: ["add", "fix"], bin_unknown: [], bin_blocked: [], sku_unknown: [], moved_in: ["add", "fix"],
};

/** A line the system holds in the bin, as the check showed it. */
export type BinLine = { sku: string; batch_lot: string; expiry_date: string | null; quantity: number };
/** "Sheet benar": what really happened to one line the system holds in the bin. */
export type FixChoice = "keep" | "count" | "remove" | "move";
export type FixLine = BinLine & { choice: FixChoice | ""; counted?: string; move_to?: string };

export const FIX_LABELS: Record<FixChoice, string> = {
  keep: "Tetap (memang ada)", count: "Jumlah sebenarnya", remove: "Tidak ada (hapus)", move: "Pindah ke bin",
};

/** Every line the bin holds, undecided. */
export function fixLinesFor(current: BinLine[]): FixLine[] {
  return current.map((c) => ({ ...c, choice: "" }));
}

const BIN = /^[A-Z0-9_]{3,20}$/;
const isCount = (v: string | undefined) => /^\d+(\.\d+)?$/.test((v ?? "").trim());

/** What still has to be filled in before the fix can be posted, or null. Mirrors putaway_fix_error. */
export function fixProblem(bin: string, lines: FixLine[]): string | null {
  for (const l of lines) {
    const what = `${l.sku} batch ${l.batch_lot || "–"}`;
    if (!l.choice) return `${what}: pilih keputusan`;
    if (l.choice === "count" && !isCount(l.counted)) return `${what}: isi jumlah sebenarnya`;
    if (l.choice === "move") {
      const to = (l.move_to ?? "").trim().toUpperCase();
      if (!BIN.test(to)) return `${what}: isi bin tujuan`;
      if (to === bin.toUpperCase()) return `${what}: bin tujuan sama dengan bin ini`;
    }
  }
  return null;
}

/** The adjustment a line makes (0 for keep and move). */
export function fixDelta(l: FixLine): number {
  if (l.choice === "remove") return -l.quantity;
  if (l.choice === "count" && isCount(l.counted)) return Number(l.counted) - l.quantity;
  return 0;
}

/** The fix as putaway_import takes it. */
export function fixPayload(lines: FixLine[]) {
  return lines.map((l) => ({
    sku: l.sku, batch_lot: l.batch_lot, expiry_date: l.expiry_date, quantity: l.quantity, choice: l.choice,
    counted: l.choice === "count" ? (l.counted ?? "").trim() : undefined,
    move_to: l.choice === "move" ? (l.move_to ?? "").trim().toUpperCase() : undefined,
  }));
}

/**
 * The confirmation sentence for one fixed bin, e.g.
 * "CA06C01: putaway 4 × 550056224; 36 × 550038021 pindah ke CA02D02."
 * Adjustments above the limit are marked: they wait for a second person in Adjust stok.
 */
export function fixSummary(row: Pick<PutawayRow, "bin_code" | "sku" | "quantity">, lines: FixLine[], limit: number): string {
  const parts = lines.map((l) => {
    const what = `${l.quantity} × ${l.sku}${l.batch_lot ? ` (${l.batch_lot})` : ""}`;
    const d = fixDelta(l);
    const approval = Math.abs(d) > limit ? " (perlu persetujuan)" : "";
    switch (l.choice) {
      case "keep": return `${what} tetap`;
      case "move": return `${what} pindah ke ${(l.move_to ?? "").trim().toUpperCase()}`;
      case "remove": return `${what} dihapus${approval}`;
      case "count": return d === 0 ? `${what} tetap` : `${l.sku}${l.batch_lot ? ` (${l.batch_lot})` : ""} ${l.quantity} → ${Number(l.counted)}${approval}`;
      default: return `${what} belum diputuskan`;
    }
  });
  return `${row.bin_code}: putaway ${row.quantity ?? "?"} × ${row.sku}${parts.length ? "; " + parts.join("; ") : ""}.`;
}

export const KIND_LABELS: Record<PutawayKind, string> = {
  qty_differs: "Bin sudah berisi SKU/batch ini dengan qty lain",
  bin_occupied: "Bin sudah berisi stok lain",
  bin_unknown: "Kode bin tidak ada di sistem",
  bin_blocked: "Bin diblokir",
  sku_unknown: "SKU belum ada di master data",
  moved_in: "SKU ini baru masuk ke bin lewat Bin To Bin: kemungkinan sisa palet yang sama, jangan dihitung dua kali",
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
