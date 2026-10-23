// CKB 3PL module registry — one source for the sidebar rail and the landing grid.
// Placeholder modules (no backend yet): each entry links to a stub page under /ckb.
export type CkbModule = {
  href: string;          // stub page path
  label: string;         // Indonesian UI label
  group: "Operasional" | "Data & laporan" | "Pengaturan";
  blurb: string;         // one-line Indonesian description
};

export const CKB_MODULES: CkbModule[] = [
  { href: "/ckb/rebagging",   label: "Rebagging",        group: "Operasional",     blurb: "Catat dan kelola operasi rebagging." },
  { href: "/ckb/inspections", label: "Inspeksi kargo",   group: "Operasional",     blurb: "Kontrol pemeriksaan kargo masuk." },
  { href: "/ckb/stock-take",  label: "Stock take",       group: "Operasional",     blurb: "Sesi penghitungan stok berkala." },
  { href: "/ckb/sap/import",  label: "Import SAP",       group: "Data & laporan",  blurb: "Unggah dan proses file SAP." },
  { href: "/ckb/sap/export",  label: "Export SAP",       group: "Data & laporan",  blurb: "Ekspor data untuk SAP." },
  { href: "/ckb/reports",     label: "Laporan",          group: "Data & laporan",  blurb: "Laporan operasional CKB 3PL." },
  { href: "/ckb/photos",      label: "Foto",             group: "Data & laporan",  blurb: "Arsip foto dokumen dan barang." },
  { href: "/ckb/inventory",   label: "Inventaris",       group: "Data & laporan",  blurb: "Rincian stok dan mutasi CKB." },
  { href: "/ckb/customers",   label: "Customer",         group: "Pengaturan",      blurb: "Enam aliran: Freeport, CGP, SIP, MNE, Boiler, SSB." },
  { href: "/ckb/users",       label: "Pengguna",         group: "Pengaturan",      blurb: "Akun CKB dan perannya." },
  { href: "/ckb/settings",    label: "Pengaturan",       group: "Pengaturan",      blurb: "Konfigurasi aplikasi CKB." },
];