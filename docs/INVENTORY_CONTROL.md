# Kontrol inventory — cara kerja dan aturannya

Stok di sistem hanya benar sejauh data yang masuk benar dan kesalahan cepat
ketahuan. Tidak ada software yang membuat data "100% benar" dengan sendirinya;
yang membuatnya mendekati 100% adalah satu putaran kontrol yang dijalankan
setiap hari:

```
catat benar saat masuk  →  cegah data salah  →  temukan selisih (hitung, rekonsiliasi)
        ↑                                                     ↓
   ukur akurasi   ←   koreksi dengan alasan + persetujuan orang lain
```

Semua aturan angka ada di **Admin → Pengaturan → Aturan inventory** (satu
tempat, dibaca oleh database). Migrasi: `supabase/migrations/0016`–`0023`.

## 1. FEFO: dari mana sistem tahu urutan expired

Setiap baris stok = bin + SKU + batch + tanggal expired. Alokasi selalu
mengambil expired paling awal (lihat `docs/ALLOCATOR.md`). Jadi FEFO hanya
sebaik tanggal expired yang tercatat.

**Batch Shell berkode tanggal produksi.** `14H26JJ` = tanggal 14, bulan H
(A = Jan … L = Des), tahun 26, pabrik JJ. Expired = tanggal produksi + umur
simpan (standar **48 bulan**, bisa diubah per SKU di **Master item**). Di file
24 Sep, 1.083 dari 1.116 batch berkode tanggal persis cocok dengan aturan ini;
33 sisanya salah ketik (hari/bulan tertukar `09F26JJ` → 2030-09-06 padahal
2030-06-09, abad salah 1930, tahun salah 2029). Sistem sekarang:

- mengisi expired otomatis dari kode batch saat penerimaan, hitung, dan putaway;
- menolak / meminta konfirmasi bila expired yang diketik berbeda dari kode batch
  (penerimaan: ditolak kecuali dicentang "label memang begitu");
- menampilkan semua stok yang tidak cocok di **Kualitas data** (dengan tanggal
  yang disarankan) dan di **Inventory → Expired & FEFO**;
- menandai satu batch yang tercatat dengan beberapa tanggal expired.

Batch SAP 8 digit (`12658123`) tidak berkode tanggal: expired-nya harus dari
label / data batch Shell.

**Sisa umur minimum untuk dikirim** (standar 0 hari, bisa per SKU): stok di
bawahnya tidak dialokasikan. Konfirmasi angka ini dengan Shell / pelanggan.

**Kepatuhan FEFO diukur**: Inventory → Expired & FEFO membandingkan setiap pick
nyata dengan stok pada saat itu. Pelanggaran = mengambil batch lebih baru
padahal batch lebih tua dari SKU yang sama tersedia di rak (tidak ditahan,
tidak dipesan tugas lain, sisa umur cukup).

## 2. Status stok: hold dan karantina

Stok bisa **ditahan** tanpa dipindah: tunggu QC/Shell, rusak, investigasi,
recall, expired, retur. Dua cakupan:

- **Sebagian / satu bin** — mis. 2 karton penyok dari 44.
- **Seluruh batch (recall)** — semua karton SKU + batch di semua bin, termasuk
  yang datang nanti.

Stok yang ditahan tidak dialokasikan, tidak bisa di-pick (juga lewat wave),
dan tidak bisa dipindah ke rak lain. Yang boleh: pindah ke **karantina** (hold
ikut pindah; hanya supervisor) atau **tulis-off** lewat adjustment. Karantina
tidak pernah bisa di-pick. Hold hanya dilepas dengan alasan dan nama.

## 3. Menemukan selisih

| Kontrol | Di mana | Isi |
|---|---|---|
| Penerimaan vs DO | **Penerimaan** | Dokumen Shell (DO / surat jalan) dibandingkan dengan yang benar-benar datang per palet. Pemeriksa tidak melihat qty dokumen. Hasil: sesuai / kurang / lebih / tidak datang / tidak ada di dokumen / rusak. Karton rusak otomatis ke karantina dengan hold. |
| Cycle count buta | **Cycle count** | Penghitung tidak melihat isi dan qty sistem. Hitungan yang berbeda dari sistem (di luar toleransi kelas A/B/C) **dihitung ulang oleh orang lain**; dua hitungan yang sama = selisih terkonfirmasi. |
| Rekonsiliasi SAP | **Inventory → Rekonsiliasi SAP** | Upload stok SAP (MB52 / sheet "SAP vs fisik"). Unrestricted SAP vs stok bebas kita, Blocked SAP vs stok ditahan + karantina; pending GI / GR menjelaskan beda waktu. Tiap selisih: keterangan, status, atau "minta hitung ulang" (tugas hitung untuk semua bin SKU itu). Export dalam format sheet manual. |
| Kualitas data | **Kualitas data** | Batch kosong / terbaca tanggal, expired ≠ kode batch, satu batch banyak expired, tanpa expired, expired di rak, bin > 1 palet. |
| Scan barcode | Hitung, penerimaan, posting pick | Barcode karton (EAN) di Master item. Scan barang lain = ditolak. Opsi: wajib scan saat konfirmasi pick. |
| Audit | Audit picking / putaway | (sudah ada) cek ulang pekerjaan yang sudah selesai. |

## 4. Koreksi: alasan dan persetujuan orang lain

Setiap adjustment wajib **kode alasan** (selisih hitung, rusak, expired
dimusnahkan, salah input, salah ambil, ditemukan, hilang, selisih penerimaan,
retur, lainnya), **keterangan**, dan **nama petugas**.

- Adjustment **di atas batas** (standar 20 unit) tidak langsung berlaku: masuk
  **Inventory → Persetujuan** dan diputuskan oleh **orang lain** dari yang
  mengajukan.
- Hasil hitung diterapkan oleh orang yang **bukan** penghitung. Selisih di atas
  batas hanya bisa diterapkan setelah dua hitungan sama.
- Penerimaan diposting oleh orang yang **bukan** pemeriksa.
- Ganti item di atas batas butuh nama penyetuju.
- Koreksi batch/expired (qty tidak berubah) tercatat sebagai "salah input".

Situs memakai satu akun bersama, jadi "orang" di sini adalah **nama yang
diketik** di setiap langkah (disimpan di perangkat, tercatat di riwayat
mutasi). Aturannya tetap dijalankan database: nama yang sama ditolak.

## 5. Mengukur

**Inventory → Akurasi & adjustment**:

- **Akurasi qty** = 1 − (selisih terkonfirmasi ÷ stok tercatat saat dihitung),
  30 dan 90 hari, per kelas ABC, tren 12 minggu. Target di aturan (standar 98%).
- **Bin tepat** = bin yang selisihnya dalam toleransi kelas.
- **Hitungan pertama tepat** = ketelitian penghitung.
- Adjustment per kode alasan, SKU yang paling sering disesuaikan, adjustment
  yang butuh persetujuan.
- Akurasi rekonsiliasi SAP terakhir (SKU cocok ÷ semua SKU; sheet manual
  24 Sep: 88,3%).

## 6. Rutinitas harian inventory controller

1. **Penerimaan**: pastikan setiap truk diperiksa dan diposting; selisih
   dilaporkan ke Shell / transporter.
2. **Kualitas data**: bersihkan pengecualian baru (terutama expired ≠ batch).
3. **Cycle count**: buat tugas hari ini (Cycle count → Buat tugas), pastikan
   hitung ulang dikerjakan orang lain, terapkan dengan kode alasan.
4. **Persetujuan**: putuskan adjustment yang menunggu.
5. **Expired & FEFO**: stok expired ditahan/karantina; near-expiry dilaporkan
   ke Shell (Excel untuk Shell); cek pelanggaran FEFO kemarin.
6. **Mingguan**: rekonsiliasi SAP; tinjau akurasi dan adjustment per alasan.

## 7. Batasan yang disadari

- Nama petugas diketik, bukan login per orang: pemisahan tugas bergantung pada
  kejujuran nama.
- "Selesaikan wave" (posting sisa wave sekaligus) tidak meminta scan per karton;
  gunakan posting per tugas bila scan wajib.
- Laporan FEFO memakai stok saat pick yang dihitung ulang dari riwayat mutasi;
  reservasi tugas yang dibatalkan tidak punya waktu batal, jadi dianggap tidak
  memesan.
- SAP tidak mencatat batch asli (batch "UT"): rekonsiliasi per SKU, bukan per
  batch.
