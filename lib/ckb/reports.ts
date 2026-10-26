/**
 * CKB 3PL reports — what each report is, who may run it, its columns, and its totals. Pure.
 * Rows are loaded by lib/ckb/report-data.ts under the viewer's own RLS, so a report can never
 * contain a record its viewer could not open; totals are always computed from those rows.
 */
import type { CkbRole } from "./permissions";

export type ReportKind =
  | "stocktakes" | "discrepancies" | "recounts" | "adjustments" | "rebagging"
  | "inspections" | "activity" | "sap_imports" | "sap_exports";

export type ColType = "text" | "num" | "date" | "datetime";
export type ReportColumn = { key: string; header: string; type?: ColType };
export type ReportFilters = {
  customer?: string; from?: string; to?: string; status?: string; material?: string;
  stocktake?: string; classification?: string; type?: string; location?: string;
};
export type ReportRow = Record<string, string | number | boolean | null>;

const LEAD: CkbRole[] = ["admin", "supervisor"];
const LEAD_AND_CUSTOMER: CkbRole[] = ["admin", "supervisor", "customer"];

export const REPORTS: Record<ReportKind, { title: string; blurb: string; roles: CkbRole[]; columns: ReportColumn[]; filters: (keyof ReportFilters)[] }> = {
  stocktakes: {
    title: "Penyelesaian stock take", blurb: "Per sesi: tugas, yang sudah dihitung, diputuskan, dan selisih.",
    roles: LEAD_AND_CUSTOMER, filters: ["customer", "from", "to", "status"],
    columns: [
      { key: "stocktake_ref", header: "Sesi" }, { key: "customer_name", header: "Customer" },
      { key: "baseline_ref", header: "Snapshot SAP" }, { key: "snapshot_date", header: "Tgl snapshot", type: "date" },
      { key: "status", header: "Status" }, { key: "created_at", header: "Dibuat", type: "datetime" },
      { key: "tasks", header: "Tugas", type: "num" }, { key: "counted", header: "Dihitung", type: "num" },
      { key: "decided", header: "Diputuskan", type: "num" }, { key: "discrepancies", header: "Selisih", type: "num" },
      { key: "pct_counted", header: "% dihitung", type: "num" },
    ],
  },
  discrepancies: {
    title: "Selisih hitung", blurb: "Setiap tugas yang tidak cocok dengan snapshot, per klasifikasi.",
    roles: LEAD_AND_CUSTOMER, filters: ["customer", "from", "to", "stocktake", "classification", "material", "location"],
    columns: [
      { key: "stocktake_ref", header: "Sesi" }, { key: "customer_name", header: "Customer" }, { key: "baseline_ref", header: "Snapshot" },
      { key: "seq", header: "#", type: "num" }, { key: "material_code", header: "Material" }, { key: "description", header: "Deskripsi" },
      { key: "storage_bin", header: "Bin" }, { key: "batch", header: "Batch" }, { key: "expiry_date", header: "Expired", type: "date" },
      { key: "uom", header: "Satuan" }, { key: "baseline_qty", header: "Qty SAP", type: "num" },
      { key: "accepted_qty", header: "Qty diterima", type: "num" }, { key: "variance", header: "Selisih", type: "num" },
      { key: "classification", header: "Klasifikasi" }, { key: "task_status", header: "Status" },
      { key: "decision_reason", header: "Alasan" },
    ],
  },
  recounts: {
    title: "Riwayat hitung ulang", blurb: "Tugas yang dihitung lebih dari satu putaran.",
    roles: LEAD_AND_CUSTOMER, filters: ["customer", "from", "to", "stocktake", "material"],
    columns: [
      { key: "stocktake_ref", header: "Sesi" }, { key: "customer_name", header: "Customer" }, { key: "seq", header: "#", type: "num" },
      { key: "material_code", header: "Material" }, { key: "storage_bin", header: "Bin" }, { key: "count_rounds", header: "Putaran", type: "num" },
      { key: "baseline_qty", header: "Qty SAP", type: "num" }, { key: "latest_qty", header: "Hitungan terakhir", type: "num" },
      { key: "accepted_qty", header: "Qty diterima", type: "num" }, { key: "task_status", header: "Status" },
      { key: "decision_reason", header: "Alasan" },
    ],
  },
  adjustments: {
    title: "Penyesuaian", blurb: "Usulan dan keputusan penyesuaian dari stock take.",
    roles: LEAD_AND_CUSTOMER, filters: ["customer", "from", "to", "status", "material", "location"],
    columns: [
      { key: "ref_no", header: "Ref" }, { key: "customer_name", header: "Customer" }, { key: "stocktake_ref", header: "Sesi" },
      { key: "material_code", header: "Material" }, { key: "storage_bin", header: "Bin" }, { key: "batch", header: "Batch" },
      { key: "uom", header: "Satuan" }, { key: "baseline_qty", header: "Qty SAP", type: "num" },
      { key: "accepted_qty", header: "Qty fisik", type: "num" }, { key: "delta", header: "Selisih", type: "num" },
      { key: "status", header: "Status" }, { key: "decided_by_name", header: "Diputuskan oleh" },
      { key: "decided_at", header: "Diputuskan", type: "datetime" }, { key: "decision_reason", header: "Alasan" },
    ],
  },
  rebagging: {
    title: "Rebagging", blurb: "Pekerjaan rebagging, jenis, status dan selisih.",
    roles: LEAD_AND_CUSTOMER, filters: ["customer", "from", "to", "status", "type"],
    columns: [
      { key: "job_no", header: "No" }, { key: "job_date", header: "Tanggal", type: "date" }, { key: "customer_name", header: "Customer" },
      { key: "operation_type", header: "Jenis" }, { key: "status", header: "Status" }, { key: "input_qty", header: "Qty masuk", type: "num" },
      { key: "output_qty", header: "Qty keluar", type: "num" }, { key: "unit", header: "Satuan" },
      { key: "variance_qty", header: "Selisih", type: "num" }, { key: "variance_reason", header: "Alasan selisih" },
      { key: "executor_name", header: "Pelaksana" }, { key: "verifier_name", header: "Verifikator" },
    ],
  },
  inspections: {
    title: "Hasil inspeksi", blurb: "Inspeksi kargo, hasil, kerusakan dan review.",
    roles: LEAD_AND_CUSTOMER, filters: ["customer", "from", "to", "status", "type", "material"],
    columns: [
      { key: "ref_no", header: "Ref" }, { key: "inspection_date", header: "Tanggal", type: "date" }, { key: "customer_name", header: "Customer" },
      { key: "inspection_type", header: "Jenis" }, { key: "source_ref", header: "Dokumen" }, { key: "material_code", header: "Material" },
      { key: "status", header: "Status" }, { key: "result", header: "Hasil" }, { key: "damage_class", header: "Kerusakan" },
      { key: "inspector_name", header: "Pemeriksa" }, { key: "reviewer_name", header: "Reviewer" }, { key: "review_note", header: "Catatan review" },
    ],
  },
  activity: {
    title: "Aktivitas", blurb: "Log audit semua tindakan CKB.",
    roles: LEAD, filters: ["customer", "from", "to", "type"],
    columns: [
      { key: "at", header: "Waktu", type: "datetime" }, { key: "actor_name", header: "Oleh" }, { key: "action", header: "Tindakan" },
      { key: "entity_type", header: "Data" }, { key: "entity_id", header: "ID" }, { key: "customer_name", header: "Customer" },
      { key: "details", header: "Rincian" },
    ],
  },
  sap_imports: {
    title: "Riwayat import SAP", blurb: "Setiap snapshot SAP yang diimpor.",
    roles: LEAD, filters: ["customer", "from", "to"],
    columns: [
      { key: "ref_no", header: "Ref" }, { key: "customer_name", header: "Customer" }, { key: "snapshot_date", header: "Tgl snapshot", type: "date" },
      { key: "file_name", header: "File" }, { key: "row_count", header: "Baris", type: "num" }, { key: "rejected_count", header: "Ditolak", type: "num" },
      { key: "duplicate_identity_count", header: "Identitas ganda", type: "num" }, { key: "total_qty", header: "Total qty", type: "num" },
      { key: "mapping_verified", header: "Format terverifikasi" }, { key: "is_active", header: "Aktif" },
      { key: "imported_by_name", header: "Oleh" }, { key: "imported_at", header: "Waktu", type: "datetime" },
    ],
  },
  sap_exports: {
    title: "Riwayat export SAP", blurb: "Setiap file penyesuaian yang dibuat, diekspor ulang, dikonfirmasi atau dibatalkan.",
    roles: LEAD, filters: ["customer", "from", "to", "status"],
    columns: [
      { key: "ref_no", header: "Ref" }, { key: "customer_name", header: "Customer" }, { key: "kind", header: "Jenis" },
      { key: "status", header: "Status" }, { key: "line_count", header: "Baris", type: "num" },
      { key: "total_gain", header: "Tambah", type: "num" }, { key: "total_loss", header: "Kurang", type: "num" },
      { key: "sap_document_ref", header: "Dok. SAP" }, { key: "created_by_name", header: "Oleh" },
      { key: "created_at", header: "Waktu", type: "datetime" }, { key: "download_count", header: "Unduhan", type: "num" },
      { key: "reason", header: "Alasan" },
    ],
  },
};

export const REPORT_KINDS = Object.keys(REPORTS) as ReportKind[];
export const isReportKind = (v: unknown): v is ReportKind => typeof v === "string" && v in REPORTS;
export const reportsFor = (role: CkbRole): ReportKind[] => REPORT_KINDS.filter((k) => REPORTS[k].roles.includes(role));

/** Headline figures for a report, computed from exactly the rows shown. */
export function reportSummary(kind: ReportKind, rows: ReportRow[]): { label: string; value: number }[] {
  const n = (k: string) => rows.reduce((s, r) => s + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  const count = (pred: (r: ReportRow) => boolean) => rows.filter(pred).length;
  switch (kind) {
    case "stocktakes": return [{ label: "Sesi", value: rows.length }, { label: "Tugas", value: n("tasks") }, { label: "Dihitung", value: n("counted") }, { label: "Selisih", value: n("discrepancies") }];
    case "discrepancies": return [{ label: "Baris", value: rows.length }, { label: "Kurang", value: count((r) => r.classification === "SHORTAGE") }, { label: "Lebih / temuan", value: count((r) => r.classification === "OVERAGE" || r.classification === "UNEXPECTED") }, { label: "Belum pasti", value: count((r) => ["UNCOUNTED", "AMBIGUOUS", "BATCH_MISMATCH"].includes(String(r.classification))) }];
    case "recounts": return [{ label: "Tugas", value: rows.length }, { label: "Putaran total", value: n("count_rounds") }];
    case "adjustments": return [{ label: "Penyesuaian", value: rows.length }, { label: "Tambah", value: rows.reduce((s, r) => s + Math.max(0, Number(r.delta) || 0), 0) }, { label: "Kurang", value: rows.reduce((s, r) => s + Math.max(0, -(Number(r.delta) || 0)), 0) }, { label: "Disetujui", value: count((r) => r.status === "APPROVED" || r.status === "EXPORTED") }];
    case "rebagging": return [{ label: "Pekerjaan", value: rows.length }, { label: "Selesai", value: count((r) => r.status === "COMPLETED") }, { label: "Dengan selisih", value: count((r) => Number(r.variance_qty) !== 0 && r.variance_qty !== null) }];
    case "inspections": return [{ label: "Inspeksi", value: rows.length }, { label: "Lulus", value: count((r) => r.result === "PASS") }, { label: "Temuan", value: count((r) => r.result === "FAIL") }];
    case "activity": return [{ label: "Kejadian", value: rows.length }];
    case "sap_imports": return [{ label: "Import", value: rows.length }, { label: "Baris", value: n("row_count") }, { label: "Ditolak", value: n("rejected_count") }];
    case "sap_exports": return [{ label: "Ekspor", value: rows.length }, { label: "Dikonfirmasi SAP", value: count((r) => r.status === "SAP_CONFIRMED") }, { label: "Belum dikonfirmasi", value: count((r) => r.status === "GENERATED") }];
  }
}

/** Stock-take completion rows from the per-task discrepancy rows (one source for both reports). */
export function stocktakeCompletion(tasks: ReportRow[]): ReportRow[] {
  const by = new Map<string, ReportRow & { tasks: number; counted: number; decided: number; discrepancies: number }>();
  for (const t of tasks) {
    const id = String(t.stocktake_id);
    let s = by.get(id);
    if (!s) {
      s = { stocktake_ref: t.stocktake_ref, customer_name: t.customer_name, baseline_ref: t.baseline_ref, snapshot_date: t.snapshot_date,
        status: t.stocktake_status, created_at: t.created_at, tasks: 0, counted: 0, decided: 0, discrepancies: 0, pct_counted: 0 };
      by.set(id, s);
    }
    s.tasks++;
    if (Number(t.count_rounds) > 0) s.counted++;
    if (t.task_status === "ACCEPTED" || t.task_status === "EXCLUDED") s.decided++;
    if (t.classification && t.classification !== "MATCH" && t.classification !== "COUNTED") s.discrepancies++;
  }
  return [...by.values()].map((s) => ({ ...s, pct_counted: s.tasks ? Math.round((s.counted / s.tasks) * 100) : 0 }));
}

/** Plain value for a cell in a sheet or PDF. */
export function cellText(v: unknown, type: ColType = "text"): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Ya" : "Tidak";
  if (type === "date" && typeof v === "string") return v.slice(0, 10);
  if (type === "datetime" && typeof v === "string") return v.replace("T", " ").slice(0, 16);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
