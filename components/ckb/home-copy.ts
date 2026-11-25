import type { CkbRole } from "@/lib/ckb/permissions";

/** One plain line per CKB page for the home directory (hrefs are those of CKB_NAV in lib/ckb/permissions.ts). */
export const CKB_BLURBS: Record<string, string> = {
  "/ckb/dashboard": "Angka stock take, rebagging, inspeksi dan housekeeping dalam satu layar.",
  "/ckb/count": "Baris stock take yang ditugaskan ke Anda, dihitung buta.",
  "/ckb/housekeeping": "Foto sebelum dan sesudah tiap rak, tinjauan, nilai mingguan dan temuan.",
  "/ckb/rebagging": "Catat dan verifikasi pekerjaan rebagging.",
  "/ckb/inspections": "Periksa kargo masuk dengan checklist dan foto.",
  "/ckb/stock-take": "Sesi penghitungan stok, selisih, hitung ulang dan penyesuaian.",
  "/ckb/inventory": "Stok CKB per rak, SKU dan batch.",
  "/ckb/sap/import": "Unggah snapshot SAP sebagai dasar stock take.",
  "/ckb/sap/export": "Buat file penyesuaian untuk SAP dan catat konfirmasinya.",
  "/ckb/reports": "Laporan stock take, selisih, inspeksi, rebagging dan housekeeping.",
  "/ckb/photos": "Arsip foto bukti stock take, inspeksi dan rebagging.",
  "/ckb/activity": "Siapa mengubah apa dan kapan.",
  "/ckb/customers": "Enam aliran customer: Freeport, CGP, SIP, MNE, Boiler, SSB.",
  "/ckb/users": "Akun CKB, peran dan customer yang boleh dilihat.",
  "/ckb/settings": "Pengaturan aplikasi CKB.",
};

/** The first stop of each role: the one button at the end of the floor line. */
export function ckbPrimary(role: CkbRole): { href: string; label: string } {
  return role === "operator" ? { href: "/ckb/count", label: "Mulai hitung" } : { href: "/ckb/dashboard", label: "Buka dashboard" };
}
