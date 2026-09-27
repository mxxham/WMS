import { classifyMismatch, expectedExpiry, MISMATCH_LABEL } from "./batch-code";

/**
 * Live data-quality checks over inventory_detail rows (the old
 * docs/DATA_ISSUES.md was a one-off report on the 24 Sep workbook).
 * Only issues that change what the allocator does are listed: rack stock
 * (pickable) is checked; floor locations only for missing expiry.
 */
export type StockRow = {
  bin_code: string; rack: string | null; zone: string; sku: string; description: string | null; upp: number | null;
  batch_lot: string; quantity: number; expiry_date: string | null;
};

export type IssueKind = "batch_missing" | "batch_is_date" | "expiry_vs_batch" | "batch_multi_expiry" | "expiry_missing" | "expired" | "over_pallet";
export type Issue = { kind: IssueKind; row: StockRow; detail: string; suggestedBatch?: string; suggestedExpiry?: string };

export const ISSUES: Record<IssueKind, { title: string; why: string; fix: "batch" | "expiry" | "count" }> = {
  batch_missing: { title: "Stok rak tanpa batch", why: "FEFO dan label tidak bisa menunjuk batch fisik.", fix: "batch" },
  batch_is_date: { title: "Batch berupa tanggal", why: "Excel mengubah nomor batch menjadi tanggal; nomor aslinya disarankan dari angka seri tanggal itu.", fix: "batch" },
  expiry_vs_batch: { title: "Expired tidak cocok dengan batch", why: "Batch Shell berkode tanggal produksi (14H26JJ = 14 Agu 2026); expired = produksi + umur simpan. Expired yang salah membuat FEFO mengambil stok yang salah.", fix: "expiry" },
  batch_multi_expiry: { title: "Satu batch, beberapa tanggal expired", why: "Satu batch hanya punya satu expired. Salah satu baris salah ketik; cek label lalu koreksi.", fix: "expiry" },
  expiry_missing: { title: "Tanpa tanggal expired", why: "Stok tanpa expired diurutkan paling akhir oleh FEFO.", fix: "expiry" },
  expired: { title: "Sudah expired di rak", why: "Tidak dialokasikan, tapi menempati bin rak.", fix: "count" },
  over_pallet: { title: "Bin berisi lebih dari 1 palet", why: "Bin rak = 1 palet. Qty kemungkinan salah atau stok tercampur.", fix: "count" },
};

/** 'YYYY-MM-DD' -> Excel serial day number (what the cell held before Excel showed it as a date). */
export function isoToExcelSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000) + 25569;
}

/**
 * `shelfLifeBySku`: item overrides of the shelf life (months); others use
 * `defaultShelfLife` (policy, 48). Only date-coded batches are checked.
 */
export function findIssues(rows: StockRow[], todayIso: string, shelfLifeBySku: Map<string, number> = new Map(), defaultShelfLife = 48): Issue[] {
  const out: Issue[] = [];
  const expiriesByBatch = new Map<string, Set<string>>();
  const pallets = new Map<string, number>();
  for (const r of rows) {
    const rack = r.rack !== null;
    if (rack && !r.batch_lot) out.push({ kind: "batch_missing", row: r, detail: `${r.quantity} ctn` });
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.batch_lot)) {
      const y = Number(r.batch_lot.slice(0, 4));
      out.push({ kind: "batch_is_date", row: r, detail: `batch "${r.batch_lot}"`, suggestedBatch: y > 2100 ? String(isoToExcelSerial(r.batch_lot)) : undefined });
    }
    if (!r.expiry_date && r.zone !== "QUARANTINE") out.push({ kind: "expiry_missing", row: r, detail: `${r.quantity} ctn` });
    if (r.expiry_date) {
      const expected = expectedExpiry(r.batch_lot, shelfLifeBySku.get(r.sku) ?? defaultShelfLife);
      const recorded = r.expiry_date.slice(0, 10);
      if (expected && expected !== recorded) {
        out.push({ kind: "expiry_vs_batch", row: r, suggestedExpiry: expected,
          detail: `batch ${r.batch_lot} → ${expected} (${MISMATCH_LABEL[classifyMismatch(recorded, expected)]})` });
      }
      if (r.batch_lot) {
        const k = `${r.sku}|${r.batch_lot}`;
        (expiriesByBatch.get(k) ?? expiriesByBatch.set(k, new Set()).get(k)!).add(recorded);
      }
    }
    if (rack && r.expiry_date && r.expiry_date < todayIso) out.push({ kind: "expired", row: r, detail: `expired ${r.expiry_date}` });
    if (rack && r.upp) pallets.set(r.bin_code, (pallets.get(r.bin_code) ?? 0) + Number(r.quantity) / Number(r.upp));
  }
  // One batch, several expiries: every row of it is listed so the wrong one can be fixed.
  for (const r of rows) {
    const set = r.batch_lot && r.expiry_date ? expiriesByBatch.get(`${r.sku}|${r.batch_lot}`) : undefined;
    if (!set || set.size < 2) continue;
    // A row already flagged against its batch code is fixed there; suggest the batch code's date if it has one.
    const expected = expectedExpiry(r.batch_lot, shelfLifeBySku.get(r.sku) ?? defaultShelfLife);
    out.push({ kind: "batch_multi_expiry", row: r, suggestedExpiry: expected ?? undefined,
      detail: `batch ini tercatat dengan expired ${[...set].sort().join(" / ")}` });
  }
  const flagged = new Set<string>();
  for (const r of rows) {
    const p = pallets.get(r.bin_code) ?? 0;
    if (p > 1.0001 && !flagged.has(r.bin_code)) {
      flagged.add(r.bin_code);
      out.push({ kind: "over_pallet", row: r, detail: `${p.toFixed(2)} palet` });
    }
  }
  return out;
}
