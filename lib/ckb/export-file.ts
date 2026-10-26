/**
 * CKB 3PL SAP export worksheet layout. Pure: frozen export lines in, sheet rows out.
 *
 * Format CKB-INTERNAL-1 is a review worksheet, not a confirmed SAP upload format (none has been
 * provided). The first rows say so on the sheet itself, so a printed or forwarded copy cannot be
 * mistaken for a posting file. When the real format is confirmed, add a new layout next to this
 * one and switch ckb_settings.sap_export.format_version.
 */

export type ExportLineData = {
  adjustment_ref: string; stocktake_ref: string; baseline_snapshot_ref: string; customer_code: string;
  material_code: string; description: string; plant: string; storage_location: string; storage_bin: string;
  batch: string; expiry_date: string | null; uom: string; stock_type: string;
  baseline_qty: number; counted_qty: number; delta: number; direction: "GAIN" | "LOSS";
  classification: string; approved_by: string | null; approved_at: string | null;
};
export type ExportHeader = {
  ref_no: string; kind: "EXPORT" | "REEXPORT"; original_ref: string | null; reason: string | null;
  customer_code: string; customer_name: string; created_by_name: string; created_at: string;
  format_version: string; format_verified: boolean;
};

export const EXPORT_COLUMNS: { key: keyof ExportLineData | "line_no"; header: string; width: number }[] = [
  { key: "line_no", header: "No", width: 5 },
  { key: "adjustment_ref", header: "Ref penyesuaian", width: 14 },
  { key: "stocktake_ref", header: "Ref stock take", width: 13 },
  { key: "baseline_snapshot_ref", header: "Snapshot SAP", width: 13 },
  { key: "customer_code", header: "Customer", width: 11 },
  { key: "material_code", header: "Material", width: 14 },
  { key: "description", header: "Deskripsi", width: 32 },
  { key: "plant", header: "Plant", width: 8 },
  { key: "storage_location", header: "SLoc", width: 8 },
  { key: "storage_bin", header: "Bin", width: 10 },
  { key: "batch", header: "Batch", width: 12 },
  { key: "expiry_date", header: "Expired", width: 11 },
  { key: "uom", header: "Satuan", width: 7 },
  { key: "stock_type", header: "Tipe stok", width: 9 },
  { key: "baseline_qty", header: "Qty SAP", width: 10 },
  { key: "counted_qty", header: "Qty fisik", width: 10 },
  { key: "delta", header: "Selisih", width: 10 },
  { key: "direction", header: "Arah", width: 7 },
  { key: "approved_by", header: "Disetujui oleh", width: 18 },
  { key: "approved_at", header: "Disetujui pada", width: 18 },
];

export function exportFileName(h: Pick<ExportHeader, "ref_no" | "customer_code">): string {
  return `${h.ref_no}_${h.customer_code}_penyesuaian.xlsx`;
}

/** Notice rows printed above the table. */
export function exportNotice(h: ExportHeader): string[] {
  const lines = [
    `Ekspor ${h.ref_no}${h.kind === "REEXPORT" ? ` — EKSPOR ULANG dari ${h.original_ref}: ${h.reason}` : ""}`,
    `Customer ${h.customer_code} (${h.customer_name}) · dibuat ${h.created_at} oleh ${h.created_by_name}`,
    h.format_verified
      ? `Format ${h.format_version}.`
      : `Format ${h.format_version}: lembar kerja internal CKB, BELUM format unggah SAP yang terverifikasi.`,
    "File ini bukan bukti posting SAP. Status berubah hanya setelah nomor dokumen SAP dicatat di aplikasi.",
  ];
  return lines;
}

export function exportRows(lines: { line_no: number; data: ExportLineData }[]): (string | number | null)[][] {
  return [...lines].sort((a, b) => a.line_no - b.line_no).map((l) =>
    EXPORT_COLUMNS.map((c) => (c.key === "line_no" ? l.line_no : (l.data[c.key] ?? null) as string | number | null)));
}

/** Totals from the lines themselves (never from a stored figure). */
export function exportTotals(lines: { data: ExportLineData }[]): { gain: number; loss: number; lines: number } {
  let gain = 0, loss = 0;
  for (const l of lines) { if (l.data.delta > 0) gain += l.data.delta; else loss -= l.data.delta; }
  return { gain, loss, lines: lines.length };
}
