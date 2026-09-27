import { parseBinCode, FLOOR_LOCATIONS } from "@/config/warehouse";
import { excelBatchText, excelCalendarDay, excelDateIso } from "@/lib/allocator/excel-date";
import { lookupUom } from "@/lib/allocator/uom-master";

export const FIELDS = ["bin_code", "sku", "description", "batch_lot", "quantity", "expiry_date", "received_date", "uom", "upp"] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Partial<Record<Field, number>>; // field -> column index

export const FIELD_LABELS: Record<Field, string> = {
  bin_code: "Kode bin *", sku: "SKU / material", description: "Deskripsi", batch_lot: "Batch/Lot", quantity: "Qty",
  expiry_date: "Tanggal expired", received_date: "Tanggal terima (GR)", uom: "UoM", upp: "Unit per palet (UPP)",
};

// Header aliases seen in CKB sheets, in priority order ("Remain Qty" beats "Qty").
const ALIASES: Record<Field, string[]> = {
  bin_code: ["lokasi", "bin location", "bin_code", "bin", "location"],
  sku: ["item", "item code", "material", "sku code", "sku"],
  description: ["description", "material description"],
  batch_lot: ["batch", "batch no", "batch_lot", "lot"],
  quantity: ["remain qty", "actual qty", "quantity", "qty", "fisik"],
  expiry_date: ["expired date", "exp date", "expiry", "expiry_date"],
  received_date: ["gr date", "received", "received_date"],
  uom: ["uom", "base unit of measure", "sales unit"],
  upp: ["upp"],
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Finds the header row (first row matching >= 2 known headers) within the first 15 rows. */
export function detectHeader(rows: unknown[][]): { headerRow: number; mapping: Mapping } {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const mapping = autoMap(rows[r] ?? []);
    if (Object.keys(mapping).length >= 2 && mapping.bin_code !== undefined) return { headerRow: r, mapping };
  }
  return { headerRow: 0, mapping: autoMap(rows[0] ?? []) };
}

export function autoMap(header: unknown[]): Mapping {
  const cells = header.map(norm);
  const m: Mapping = {};
  for (const f of FIELDS) {
    for (const alias of ALIASES[f]) {
      const idx = cells.indexOf(alias);
      if (idx >= 0 && !Object.values(m).includes(idx)) { m[f] = idx; break; }
    }
  }
  return m;
}

export type RowStatus = "ok" | "warning" | "error";
export type ImportRow = {
  line: number; // 1-based row number in the sheet (as seen in Excel)
  status: RowStatus; messages: string[];
  bin_code: string; zone: string; rack: string | null; level: string | null; position: string | null; bin_status: "active" | "blocked";
  sku: string; description: string; batch_lot: string; quantity: number | null;
  expiry_date: string | null; received_date: string | null; uom: string | null; upp: number | null;
};

/** Cell date -> YYYY-MM-DD. Rounds to the nearest midnight: see lib/allocator/excel-date.ts (Jakarta LMT offset). */
const isoDate = excelDateIso;

/** Cell -> YYYY-MM-DD. Accepts Excel dates, ISO text and dd/mm/yyyy. `problem` explains a rejection. */
export function toDate(v: unknown): { iso: string | null; problem: string | null } {
  if (v === null || v === undefined || v === "") return { iso: null, problem: "kosong" };
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = excelCalendarDay(v).y;
    if (y < 2000 || y > 2100) return { iso: isoDate(v), problem: `tahun ${y} tidak masuk akal` };
    return { iso: isoDate(v), problem: null };
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]]; // dd/mm/yyyy (Indonesia)
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    if (!Number.isNaN(dt.getTime())) return toDate(dt);
  }
  return { iso: null, problem: `"${s}" bukan tanggal` };
}

export type ValidationResult = { rows: ImportRow[]; skippedBlank: number };

/** `lines[i]` is the Excel row number of `rows[i]` (see lib/read-sheet.ts). */
export function validateRows(rows: unknown[][], lines: number[], headerRow: number, map: Mapping, today = new Date()): ValidationResult {
  const out: ImportRow[] = [];
  const seen = new Map<string, number>();
  const todayIso = isoDate(today);
  let skippedBlank = 0;
  const get = (r: unknown[], f: Field) => (map[f] === undefined ? undefined : r[map[f]!]);

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rawBin = get(r, "bin_code");
    const rawSku = get(r, "sku");
    const rawQty = get(r, "quantity");
    if ([rawBin, rawSku, rawQty].every((v) => v === null || v === undefined || v === "")) { skippedBlank++; continue; }

    const msgs: string[] = [];
    let status = "ok" as RowStatus;
    const err = (m: string) => { msgs.push(m); status = "error"; };
    const warn = (m: string) => { msgs.push(m); if (status === "ok") status = "warning"; };

    const code = String(rawBin ?? "").trim().toUpperCase();
    const parsed = code ? parseBinCode(code) : null;
    if (!code) err("Kode bin kosong");
    else if (!parsed) err(`Format kode bin "${code}" tidak dikenal (contoh: CA01C01, STAGING, STG_01)`);

    const sku = rawSku === null || rawSku === undefined ? "" : String(rawSku).trim();
    let qty: number | null = null;
    if (rawQty === null || rawQty === undefined || rawQty === "") qty = sku ? null : 0;
    else if (typeof rawQty === "number") qty = rawQty;
    else if (/^-?\d+(\.\d+)?$/.test(String(rawQty).trim())) qty = Number(rawQty);
    else err(`Qty bukan angka (isi sel: ${String(rawQty)})`);
    if (sku && qty === null && status !== "error") err("Qty kosong untuk SKU yang terisi");
    if (qty !== null && qty < 0) err(`Qty negatif (${qty})`);
    if (!sku && qty !== null && qty > 0) err("Qty terisi tetapi SKU kosong");
    if (sku && qty === 0) warn("SKU tercatat tetapi qty 0: stok batch ini di-nol-kan");

    const rawBatch = get(r, "batch_lot");
    const batch = excelBatchText(rawBatch);
    if (rawBatch instanceof Date && /^\d{4}-/.test(batch)) {
      warn(`Batch terbaca sebagai tanggal oleh Excel (${batch}); isi batch asli perlu dicek`);
    }
    if (sku && qty && !batch) warn("Batch kosong");

    let expiry: string | null = null;
    if (sku && qty) {
      const d = toDate(get(r, "expiry_date"));
      expiry = d.iso;
      const isQuarantine = parsed?.zone === "QUARANTINE";
      if (d.problem === "kosong") { if (!isQuarantine) warn("Tanggal expired kosong"); }
      // Implausible years (e.g. 1930) are almost always typos: import but flag, so physical stock is not lost.
      else if (d.problem?.includes("tidak masuk akal")) warn(`Tanggal expired mencurigakan: ${d.problem}, kemungkinan salah ketik`);
      else if (d.problem) err(`Tanggal expired tidak valid: ${d.problem}`);
      if (expiry && expiry < todayIso) warn(`Sudah expired (${expiry})`);
    }
    const gr = toDate(get(r, "received_date"));

    if (code && sku && status !== "error") {
      const key = `${code}|${sku}|${batch}|${expiry ?? ""}`;
      if (seen.has(key)) err(`Duplikat bin+SKU+batch+expired dengan baris ${seen.get(key)}`);
      else seen.set(key, lines[i]);
    }

    const upp = Number(get(r, "upp"));
    out.push({
      line: lines[i], status, messages: msgs,
      bin_code: code, zone: parsed?.zone ?? "", rack: parsed?.rack ?? null, level: parsed?.level ?? null, position: parsed?.position ?? null,
      bin_status: code in FLOOR_LOCATIONS ? FLOOR_LOCATIONS[code].status : "active",
      sku, description: String(get(r, "description") ?? "").trim(), batch_lot: batch, quantity: qty,
      expiry_date: expiry, received_date: gr.problem ? null : gr.iso,
      // The WMS sheet's uom column is unreliable (blank / CAR / Fluidbag for one SKU): the
      // unit master wins, the file only fills SKUs the master does not know.
      uom: (sku && lookupUom(sku)) || (get(r, "uom") ? String(get(r, "uom")).trim() || null : null),
      upp: Number.isFinite(upp) && upp > 0 ? upp : null,
    });
  }
  return { rows: out, skippedBlank };
}

/**
 * Rows sent to the database (errors are excluded and stay in the report).
 * `existingSkus`: items already in the database keep their unit (import_snapshot
 * keeps the stored uom when the row sends none); only new SKUs get one.
 */
export function toPayload(rows: ImportRow[], existingSkus: ReadonlySet<string> = new Set()) {
  return rows.filter((r) => r.status !== "error").map((r) => ({
    bin_code: r.bin_code, zone: r.zone, rack: r.rack, level: r.level, position: r.position, status: r.bin_status,
    sku: r.sku || null, description: r.description || null, uom: existingSkus.has(r.sku) ? null : r.uom, upp: r.upp,
    batch_lot: r.batch_lot, quantity: r.quantity ?? 0, expiry_date: r.expiry_date, received_date: r.received_date,
  }));
}

/** Bins that have at least one rejected row: a full-snapshot import must not zero their stock. */
export function binsWithErrors(rows: ImportRow[]) {
  return [...new Set(rows.filter((r) => r.status === "error" && r.bin_code).map((r) => r.bin_code))];
}
