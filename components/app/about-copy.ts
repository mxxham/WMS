import { BRAND } from "@/config/brand";

/**
 * The words about the system, its builders and its terms, in one place: the Home page, the welcome
 * screen, the footer and the Lisensi / Privasi pages all read them. Add a photo later by setting
 * `photo` to a file in public/ (e.g. "/team/ilham.jpg"); without one, the person's initials are shown.
 */
export const ABOUT = {
  name: "CKB Warehouse WMS",
  welcome: "Selamat datang.",
  about: "Sistem manajemen gudang untuk CKB Logistics.",
  creditTitle: "Dibuat oleh",
  credit: "Dibuat oleh Ilham & Rahman",
  builders: [
    { name: "Ilham", photo: undefined as string | undefined },
    { name: "Rahman", photo: undefined as string | undefined },
  ],
  modulesTitle: "Modul",
  welcomeButton: "Lanjut",

  copyright: `© ${BRAND.year} ${BRAND.owner}`,
  internal: "Hanya untuk penggunaan internal. Data di sistem ini rahasia perusahaan.",

  licensesTitle: "Lisensi",
  licensesIntro: `${BRAND.appName} dibuat untuk ${BRAND.owner}; hak cipta kode aplikasi milik ${BRAND.owner}. Aplikasi ini memakai pustaka sumber terbuka berikut, masing-masing dengan lisensinya sendiri. Teks lisensi dan pemberitahuan hak cipta mereka disertakan di bawah ini sesuai syarat lisensi tersebut.`,

  privacyTitle: "Privasi",
  /** Who workers contact about their data. Fill in once (name and role, or a team). */
  privacyContact: "Supervisor gudang WSM SUB 2",
  privacy: [
    { h: "Apa yang dicatat", p: [
      "Nama orang yang memposting, mengubah, mengaudit, menghitung atau menyetujui sesuatu di sistem, beserta waktunya. Jika Anda masuk dengan akun sendiri, akun Anda (nama dan nama pengguna) juga tercatat pada setiap tindakan itu.",
      "Tanpa akun sendiri, nama yang Anda ketik disimpan di perangkat ini (browser) supaya tidak perlu diketik ulang; data itu hanya ada di perangkat ini. Dengan akun sendiri, nama diisi dari akun dan tidak disimpan di perangkat.",
      "Tidak ada data lain tentang pekerja: tidak ada nomor telepon, alamat, foto, atau lokasi.",
    ] },
    { h: "Untuk apa", p: [
      "Jejak audit stok: setiap perubahan stok harus bisa ditelusuri ke orang dan waktunya. Catatan stok tidak bisa diubah atau dihapus; koreksi selalu menjadi catatan baru.",
    ] },
    { h: "Siapa yang bisa melihat", p: [
      "Orang yang memakai sistem ini untuk pekerjaan gudang. Data tidak dijual atau dibagikan ke pihak lain di luar perusahaan.",
    ] },
    { h: "Pertanyaan atau koreksi", p: [
      "Hubungi kontak di bawah. Nama yang salah dikoreksi dengan catatan baru, karena catatan lama tidak bisa dihapus.",
    ] },
  ],
};
