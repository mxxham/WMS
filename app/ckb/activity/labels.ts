/** Indonesian labels for ckb_audit_events.action. Unknown actions show their code. */
const LABELS: Record<string, string> = {
  ACCESS_BOOTSTRAP_ADMIN: "menjadi admin CKB pertama",
  ACCESS_SET: "mengubah akses pengguna",
  ACCESS_PASSWORD_RESET: "mengganti kata sandi akun CKB",
  APP_GRANT: "memberi akses aplikasi CKB",
  APP_REVOKE: "mencabut akses aplikasi CKB",
  CUSTOMER_CREATE: "menambah customer",
  CUSTOMER_UPDATE: "mengubah customer",
  SETTING_UPDATE: "mengubah pengaturan",
  SAP_IMPORT: "mengimpor snapshot SAP",
  SNAPSHOT_ACTIVATE: "mengaktifkan snapshot SAP",
  STOCKTAKE_CREATE: "membuat sesi stock take",
  STOCKTAKE_START: "memulai penghitungan",
  STOCKTAKE_REVIEW: "menutup penghitungan (review)",
  STOCKTAKE_CLOSE: "menutup sesi stock take",
  STOCKTAKE_CANCEL: "membatalkan sesi stock take",
  COUNT_SUBMIT: "mengirim hitungan",
  COUNT_FOUND_ITEM: "mencatat barang temuan",
  COUNT_RECOUNT_REQUEST: "meminta hitung ulang",
  COUNT_ACCEPT: "menerima hasil hitung",
  COUNT_EXCLUDE: "mengecualikan tugas hitung",
  TASK_NOTE: "menambah catatan investigasi",
  ADJUSTMENT_APPROVE: "menyetujui penyesuaian",
  ADJUSTMENT_REJECT: "menolak penyesuaian",
  SAP_EXPORT: "membuat ekspor SAP",
  SAP_REEXPORT: "mengekspor ulang ke SAP",
  SAP_EXPORT_DOWNLOAD: "mengunduh file ekspor SAP",
  SAP_EXPORT_CONFIRM: "mencatat konfirmasi SAP",
  SAP_EXPORT_VOID: "membatalkan ekspor SAP",
  INSPECTION_TEMPLATE_SAVE: "menyimpan checklist inspeksi",
  INSPECTION_TEMPLATE_ACTIVATE: "mengaktifkan checklist",
  INSPECTION_TEMPLATE_RETIRE: "menonaktifkan checklist",
  INSPECTION_CREATE: "membuat inspeksi",
  INSPECTION_SUBMIT: "mengirim inspeksi",
  INSPECTION_ACCEPT: "menerima inspeksi",
  INSPECTION_REJECT: "menolak inspeksi",
  INSPECTION_CLOSE: "menutup inspeksi",
  EVIDENCE_UPLOAD: "mengunggah bukti",
  EVIDENCE_VIEW: "membuka bukti",
  EVIDENCE_WITHDRAW: "menarik bukti",
  EVIDENCE_HOLD: "menahan bukti (legal hold)",
  EVIDENCE_RELEASE: "melepas penahanan bukti",
  EVIDENCE_ARCHIVE: "mencatat arsip bukti",
};

export function actionLabel(action: string): string {
  if (LABELS[action]) return LABELS[action];
  if (action.startsWith("REBAGGING_")) return `rebagging: ${action.slice(10).toLowerCase()}`;
  return action;
}

/** Prefixes offered in the activity filter. */
export const ACTION_GROUPS: { value: string; label: string }[] = [
  { value: "ACCESS", label: "Akses pengguna" }, { value: "APP", label: "Akses aplikasi" }, { value: "CUSTOMER", label: "Customer" },
  { value: "SETTING", label: "Pengaturan" }, { value: "SAP", label: "SAP" }, { value: "SNAPSHOT", label: "Snapshot" },
  { value: "STOCKTAKE", label: "Sesi stock take" }, { value: "COUNT", label: "Hitungan" }, { value: "ADJUSTMENT", label: "Penyesuaian" },
  { value: "INSPECTION", label: "Inspeksi" }, { value: "EVIDENCE", label: "Bukti" }, { value: "REBAGGING", label: "Rebagging" },
];
