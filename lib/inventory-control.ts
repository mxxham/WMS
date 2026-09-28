/**
 * Shared vocabulary of inventory control (migrations 0016-0022): reason
 * codes, hold reasons, the policy and its defaults. The database enforces
 * the same lists; this file only labels them.
 */

export const REASON_CODES = {
  COUNT_VARIANCE: "Selisih hitung",
  DAMAGED: "Rusak",
  EXPIRED: "Expired dimusnahkan",
  DATA_ENTRY: "Salah input data",
  MISPICK: "Salah ambil / salah kirim",
  FOUND: "Stok ditemukan",
  LOST: "Stok hilang",
  RECEIVING_DIFF: "Selisih penerimaan",
  RETURN: "Retur",
  OPENING: "Saldo awal / impor",
  OTHER: "Lainnya",
  PICK_AUDIT: "Koreksi audit picking",
} as const;
export type ReasonCode = keyof typeof REASON_CODES;
/** Codes a person picks by hand (OPENING is set by imports, PICK_AUDIT by the picking audit). */
export const MANUAL_REASONS = (Object.keys(REASON_CODES) as ReasonCode[]).filter((c) => c !== "OPENING" && c !== "PICK_AUDIT");

export const HOLD_REASONS = {
  QC_HOLD: "Tunggu QC / Shell",
  DAMAGED: "Rusak",
  INVESTIGATION: "Investigasi selisih",
  RECALL: "Recall batch",
  EXPIRED: "Expired",
  RETURN: "Retur pelanggan",
} as const;
export type HoldReason = keyof typeof HOLD_REASONS;

export type InventoryPolicy = {
  default_shelf_life_months: number;
  min_dispatch_days: number;
  near_expiry_days: number;
  adjust_approval_qty: number;
  count_tolerance_qty: { A: number; B: number; C: number };
  recount_on_variance: boolean;
  ira_target_pct: number;
  require_scan_on_pick: boolean;
  pick_accuracy_target_pct: number;
};

export const POLICY_DEFAULTS: InventoryPolicy = {
  default_shelf_life_months: 48,
  min_dispatch_days: 0,
  near_expiry_days: 180,
  adjust_approval_qty: 20,
  count_tolerance_qty: { A: 0, B: 0, C: 0 },
  recount_on_variance: true,
  ira_target_pct: 98,
  require_scan_on_pick: false,
  pick_accuracy_target_pct: 99.5,
};

export const POLICY_LABEL: Record<keyof InventoryPolicy, { label: string; help: string }> = {
  default_shelf_life_months: { label: "Umur simpan standar (bulan)", help: "Expired = tanggal produksi batch + umur simpan. Shell pelumas kemasan: 48 bulan. Bisa diubah per SKU di Master item." },
  min_dispatch_days: { label: "Sisa umur minimal untuk dikirim (hari)", help: "Stok dengan sisa umur lebih pendek tidak dialokasikan. Bisa diubah per SKU." },
  near_expiry_days: { label: "Batas near-expiry (hari)", help: "Stok di bawah batas ini masuk daftar near-expiry (kirim dulu / lapor ke Shell)." },
  adjust_approval_qty: { label: "Batas adjustment tanpa persetujuan (unit)", help: "Adjustment lebih besar dari ini harus diajukan dan disetujui orang lain." },
  count_tolerance_qty: { label: "Toleransi hitung per bin (unit)", help: "Selisih hitung dalam toleransi dianggap akurat dan tidak dihitung ulang. Per kelas A / B / C." },
  recount_on_variance: { label: "Hitung ulang buta bila ada selisih", help: "Hitungan yang berbeda dari sistem dihitung ulang oleh orang lain sebelum boleh diterapkan." },
  ira_target_pct: { label: "Target akurasi stok (%)", help: "Target Inventory Record Accuracy." },
  require_scan_on_pick: { label: "Wajib scan barcode karton saat konfirmasi pick", help: "Hanya untuk SKU yang barcode-nya sudah diisi di Master item." },
  pick_accuracy_target_pct: { label: "Target akurasi picking (%)", help: "Baris yang lolos audit pada percobaan pertama. Umumnya 99,5%." },
};

export function parsePolicy(v: unknown): InventoryPolicy {
  const o = (v && typeof v === "object" ? v : {}) as Partial<InventoryPolicy>;
  return { ...POLICY_DEFAULTS, ...o, count_tolerance_qty: { ...POLICY_DEFAULTS.count_tolerance_qty, ...(o.count_tolerance_qty ?? {}) } };
}

export const COUNT_STATUS: Record<string, string> = {
  OPEN: "Belum dihitung",
  RECOUNT: "Hitung ulang oleh orang lain",
  COUNTED: "Sudah dihitung, menunggu supervisor",
  APPLIED: "Diterapkan",
  CLOSED: "Ditutup",
};

export const RECEIPT_STATUS: Record<string, string> = {
  OPEN: "Menunggu diperiksa",
  CHECKED: "Sudah diperiksa, menunggu posting",
  POSTED: "Diposting",
  CANCELLED: "Dibatalkan",
};

export const RECEIPT_RESULT: Record<string, string> = {
  OK: "Sesuai",
  SHORT: "Kurang",
  OVER: "Lebih",
  MISSING: "Tidak datang",
  NOT_ON_DOC: "Tidak ada di dokumen",
  DAMAGED: "Ada yang rusak",
};

export const RECON_STATUS: Record<string, string> = {
  OPEN: "Belum ditangani",
  EXPLAINED: "Sudah dijelaskan",
  COUNT_REQUESTED: "Diminta hitung ulang",
  RESOLVED: "Selesai",
};

/**
 * Inventory Record Accuracy by quantity: 1 - sum|counted - system| / sum
 * system, over counts whose system quantity is known.
 */
export function quantityAccuracy(rows: { system_qty: number | null; variance_qty: number | null }[]): number | null {
  const known = rows.filter((r) => r.system_qty !== null && r.variance_qty !== null);
  const system = known.reduce((s, r) => s + Number(r.system_qty), 0);
  if (system <= 0) return null;
  const diff = known.reduce((s, r) => s + Number(r.variance_qty), 0);
  return Math.max(0, 1 - diff / system) * 100;
}
