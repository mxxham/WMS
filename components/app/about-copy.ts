import { BRAND } from "@/config/brand";

/**
 * The words about the system, its builders and its terms, in one place: the Home page, the welcome
 * screen, the footer and the Lisensi / Privasi pages all read them. Add a photo later by setting
 * `photo` to a file in public/ (e.g. "/team/ilham.jpg"); without one, the person's initials are shown.
 */
export const ABOUT = {
  name: BRAND.appName,
  welcome: `Selamat datang di ${BRAND.appName}.`,
  about: "Sistem manajemen gudang untuk CKB Logistics.",
  creditTitle: "Dibuat oleh",
  credit: "Dibuat oleh Ilham & Rahman",
  builders: [
    { name: "Ilham", photo: undefined as string | undefined },
    { name: "Rahman", photo: undefined as string | undefined },
  ],
  modulesTitle: "Modul",
  modulesButton: "Lihat modul",
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

/**
 * The Home banner's greeting: exactly five lines per time-of-day bucket, one picked at random per
 * page request — on the server (app/(app)/home/page.tsx)! — so the greeting changes between visits
 * but never between hydration and the first paint, and one client re-render never reshuffles it.
 *
 * The six buckets use the owner's own clock (WIB, h23), the same hour arithmetic the page already
 * uses: pagi 05–10, tengah hari 11–12, siang 13–14, sore 15–17, malam 18–22, tengah malam 23–04.
 * Tengah malam wraps the night, which is why its `ends` is smaller than its `starts`. Each line
 * carries `{nama}` where the signed-in person's name goes (the shared account's name is "Gudang");
 * some lines deliberately leave it out, so the picker only substitutes when the line asks.
 */
export const GREETING_BUCKETS: readonly { /** Jakarta hour (h23) the bucket starts at. */ starts: number; /** Jakarta hour the bucket ends at (exclusive); smaller than `starts` means it wraps past midnight. */ ends: number; lines: readonly string[] }[] = [
  // 05:00–10:59 — pagi.
  { starts: 5, ends: 11, lines: [
    "Selamat pagi, {nama}! Saatnya cek stok, jangan sampai hari ini kamu yang kehabisan semangat.",
    "Pagi ini rak-rak sudah rapi, tinggal kamu yang bikin hari ini berjalan lancar.",
    "Selamat pagi! Semoga inbound lancar dan outbound tanpa drama.",
    "Truk pertama sudah antre di dock, {nama}, jangan sampai kamu ikut berstatus “pending”.",
    "Pagi yang cerah untuk memulai hitungan stok baru, semoga selisihnya nol seperti harapan kita.",
  ] },
  // 11:00–12:59 — tengah hari.
  { starts: 11, ends: 13, lines: [
    "Selamat tengah hari, {nama}! Jangan lupa isi ulang energi supaya produktivitasmu tidak low stock.",
    "Matahari sedang di puncak, semoga performa picking-mu juga.",
    "Barang bisa menunggu di rak, tapi perutmu tidak, jadi waktunya istirahat makan.",
    "Setengah hari sudah lewat, cek lagi order yang masih menunggu ya.",
    "Jangan sampai kamu overload seperti pallet yang kelebihan muatan, sempatkan makan siang.",
  ] },
  // 13:00–14:59 — siang.
  { starts: 13, ends: 15, lines: [
    "Selamat siang, {nama}! Saatnya mengejar target outbound sebelum cut-off.",
    "Pastikan setiap barang sampai di lokasi yang tepat, karena hidup sudah cukup membingungkan tanpa salah rak.",
    "Semangat! Hari masih panjang, seperti antrean truk di dock.",
    "Cek ulang dokumen pengiriman, supaya tidak ada paket nyasar yang jadi cerita.",
    "Semoga siang ini lancar seperti forklift di lorong kosong.",
  ] },
  // 15:00–17:59 — sore.
  { starts: 15, ends: 18, lines: [
    "Selamat sore, {nama}! Saatnya rekap: apakah yang masuk sudah sama dengan yang tercatat?",
    "Sore adalah waktu terbaik untuk merapikan rak dan pikiran.",
    "Sebentar lagi jam pulang, pastikan semua transaksi hari ini sudah tercatat.",
    "Terima kasih atas kerja kerasmu hari ini, kamu salah satu alasan gudang ini terus berputar.",
    "Sisa order tinggal sedikit lagi, satu dorongan terakhir seperti menutup pintu kontainer.",
  ] },
  // 18:00–22:59 — malam.
  { starts: 18, ends: 23, lines: [
    "Selamat malam, {nama}! Semoga shift malam ini seringan kardus kosong.",
    "Gudang boleh tenang, tapi stok tetap harus dihitung.",
    "Terima kasih sudah bekerja sampai malam, semoga semangatmu juga ter-restock.",
    "Pastikan lorong aman dan pencahayaan cukup, karena keselamatan selalu nomor satu.",
    "Istirahat itu penting, bahkan forklift pun butuh dicas.",
  ] },
  // 23:00–04:59 — tengah malam: the one bucket that crosses midnight (ends < starts).
  { starts: 23, ends: 5, lines: [
    "Selamat tengah malam, {nama}! Tinggal kamu dan stok yang masih terjaga.",
    "Semoga satu-satunya selisih yang kamu temui malam ini hanyalah selisih jam tidur.",
    "Gudang sunyi, tapi data tetap harus akurat, kamu pahlawan di balik layar.",
    "Jangan lupa ngopi, tapi jangan sampai melebihi kapasitas rak.",
    "Sebentar lagi pagi, semoga tidak ada barang maupun matamu yang hilang dari lokasi.",
  ] },
];

/** The lines the Jakarta hour belongs to. Paginating on [starts, ends) because tengah malam wraps
 *  past midnight: it owns 23:xx, then 00:xx–04:59 again — `starts <= hour < ends` for the plain
 *  buckets, `hour >= starts || hour < ends` for the wrap. With distinct non-overlapping intervals
 *  every hour matches exactly one bucket. */
export function greetingLinesFor(hour: number): readonly string[] {
  const bucket = GREETING_BUCKETS.find((b) => b.ends > b.starts
    ? hour >= b.starts && hour < b.ends
    : hour >= b.starts || hour < b.ends);
  // Unreachable with the six intervals above (the boundary test walks every hour); kept so a NaN
  // hour from the page's clock parse degrades to pagi instead of crashing the request.
  return bucket ? bucket.lines : GREETING_BUCKETS[0].lines;
}

/** One greeting, name included. Called once per request on the server. */
export function pickGreeting(hour: number, name: string): string {
  const lines = greetingLinesFor(hour);
  return lines[Math.floor(Math.random() * lines.length)].replace("{nama}", name);
}
