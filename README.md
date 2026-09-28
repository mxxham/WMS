<p align="center">
  <img src="https://raw.githubusercontent.com/mxxham/WMS/integrate-bin-system/public/k-one-logo.png" width="88" alt="CKB Warehouse logo" />
</p>

<h1 align="center">WMS — CKB Warehouse</h1>

<p align="center"><b>PT Cipta Krida Bahari · WSM SUB 2 Surabaya</b><br />Gudang pelumas Shell</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15-000000?logo=next.js" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/React-19-087ea4?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Tailwind-3-38BDF8?logo=tailwindcss" alt="Tailwind CSS 3" />
  <img src="https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase" alt="Supabase" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql" alt="PostgreSQL 16" />
  <img src="https://img.shields.io/badge/Three.js-0.186-black?logo=three.js" alt="Three.js" />
  <img src="https://img.shields.io/badge/Lucide-F565B3?logo=lucide" alt="Lucide" />
  <img src="https://img.shields.io/badge/version-2.0.0-orange" alt="v2.0.0" />
</p>

<p align="center"><b>label bin · scan · 3D · alokasi FEFO · picklist · wave</b></p>

---

> Sistem label barcode lokasi bin, scan, visualisasi stok 3D, **alokasi FEFO, picklist, dan eksekusi wave** untuk gudang pelumas Shell — satu aplikasi, satu database, satu ledger stok.

<p align="center">
  <a href="#fitur"><img src="https://img.shields.io/badge/%F0%9F%93%8D-Fitur-2563EB?style=for-the-badge" alt="Fitur" /></a>
  <a href="#angka"><img src="https://img.shields.io/badge/%F0%9F%93%8A-Angka-0F766E?style=for-the-badge" alt="Angka" /></a>
  <a href="#5-yang-sudah-diuji--belum"><img src="https://img.shields.io/badge/%E2%9C%85-Status%20uji-16A34A?style=for-the-badge" alt="Status uji" /></a>
  <a href="#2-setup"><img src="https://img.shields.io/badge/%F0%9F%93%A7-Setup-B45309?style=for-the-badge" alt="Setup" /></a>
  <a href="#3-per-fase-file-perintah-cara-uji"><img src="https://img.shields.io/badge/%F0%9F%93%81-Fase-6D28D9?style=for-the-badge" alt="Fase" /></a>
  <a href="#4-keputusan-design-untuk-laporan-magang"><img src="https://img.shields.io/badge/%F0%9F%A7%A0-Keputusan%20desain-9333EA?style=for-the-badge" alt="Keputusan desain" /></a>
  <a href="#6-catatan-teknis"><img src="https://img.shields.io/badge/%F0%9F%93%9C-Catatan-475569?style=for-the-badge" alt="Catatan" /></a>
</p>

## 📊 Angka

<p align="center">

| Bin | SKU | Baris stok | Total karton | Dialokasikan | Wave |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **2.570** | **106** | **1.790** | **52.078** | **1.293** | **8** / 51 tugas |

</p>

## ✨ Fitur

| | Fitur | Yang dikerjakan |
|:--:|---|---|
| 🏷️ | **Label** | Strip A–E 80×85mm, QR + Code128 vektor |
| 📱 | **Scan** | Kamera / USB scanner, auto-focus + Enter |
| 🧊 | **3D** | 2.570 bin 1 draw call, on-demand render |
| 🧠 | **FEFO** | `planning_stock`, reservasi, re-plan aman |
| 🌊 | **Wave** | Posting idempoten, ledger `movements` |

📖 Aturan alokasi lengkap: **`docs/ALLOCATOR.md`** · ✅ Status verifikasi: bagian **Yang sudah diuji** · 🐞 Data issue: **`docs/DATA_ISSUES.md`**

<details>
<summary><b>🏷️ Contoh label — hasil cetak 203 dpi</b></summary>

<p align="center">
  <img src="https://raw.githubusercontent.com/mxxham/WMS/integrate-bin-system/docs/label-samples/contoh-strip-203dpi.png" width="260" alt="Contoh strip label rak A–E, 203 dpi" />
</p>

</details>

---

## ⚠️ 1. Konfirmasi dulu sebelum go-live

Nilai berikut **asumsi**. Ubah di file/menu yang disebut, jangan di banyak tempat.

<details>
<summary><b>📋 12 asumsi yang harus dikonfirmasi sebelum go-live</b></summary>

| # | Asumsi | Ubah di |
|---|---|---|
| 1 | Urutan sel label strip: **A (atas) → E (bawah)**, warna A merah, B oranye, C kuning, D hijau, E biru | `config/warehouse.ts` → `STRIP_LEVEL_ORDER`, `LEVEL_COLORS` |
| 2 | Arah panah: posisi **01 = kiri**, **02 = kanan** (menghadap rak) | `config/warehouse.ts` → `POSITION_ARROW` |
| 3 | 1 bin rak = 1 palet (kapasitas 1) | `bins.capacity` |
| 4 | Dimensi rak untuk 3D (bay 2,7 m, level 1,6 m, kedalaman 1,2 m, lorong 3,2 m) adalah **placeholder**. Bentuk rak sudah dikonfirmasi: blok back-to-back, rak 01–20 sisi kiri, 21–40 sisi kanan (21 di belakang 01), lorong di antara sisi kanan satu aisle dan sisi kiri aisle berikutnya | Admin → Pengaturan (`Rak per sisi` = 20); rute pick: `lib/allocator/config.ts` → `baysPerSide` |
| 5 | Kelas ABC dari 91 baris picking K_ONE: **sementara** | Admin → Pengaturan → Hitung ulang ABC (setelah ≥ 1 bulan data picking) |
| 6 | Aisle **CG** tidak ada di tabel status `warehouse mapping`, diimpor sebagai aktif | Admin → Pengaturan → Status bin |
| 7 | Rak CC19, CC20, CE33 tidak ada di data (tiang/pilar?) | cek lapangan |
| 8 | Batas "segera expired" = 90 hari | `config/warehouse.ts` → `NEAR_EXPIRY_DAYS` |
| 9 | Umur simpan pelumas Shell = **48 bulan** dari tanggal produksi di kode batch (cocok untuk 97% batch 24 Sep); SKU dengan umur lain diisi sendiri | Admin → Pengaturan → Aturan inventory; per SKU di Master item |
| 10 | Sisa umur minimum untuk dikirim = **0 hari** (belum ada aturan dari Shell / pelanggan) | idem |
| 11 | Adjustment > **20 unit** butuh persetujuan orang lain; toleransi hitung A/B/C = **0** karton | idem |
| 12 | Scan barcode karton saat posting pick **tidak wajib** (master belum punya EAN) | idem, setelah barcode diisi di Master item |

</details>

> [!WARNING]
> **Warna vs printer thermal.** Printer thermal 4 inci (direct thermal) hanya mencetak hitam. Pita warna per level butuh salah satu dari: label pra-cetak berwarna, printer warna, atau mode **Hitam-putih** di menu Label (pita hitam, teks putih). Mode warna tetap disediakan karena mengikuti contoh foto.

> [!CAUTION]
> **Masalah data dari file WMS 24 Sep 2026.** Lihat **`docs/DATA_ISSUES.md`** (bin CC01C01 `#VALUE!`, CE08A01 expired tahun 1930, batch CD39C01/C02 terbaca tanggal oleh Excel, 129 bin ber-SKU dengan qty 0, dll.). Pemetaan kolom: **`docs/DATA_MAPPING.md`**.

---

## 2. Setup

### 2.1 Supabase

1. Buat project di supabase.com (region Singapore).
2. **SQL Editor** → jalankan berurutan: `supabase/migrations/0001_schema.sql`, `0002_functions.sql`, `0003_rls.sql`, `0004_allocation.sql`, `0005_explicit_grants.sql`, `0006_back_to_back_racks.sql`, `0007_rolling_execution.sql`, `0008_putaway_import.sql`, `0009_fixed_pickfaces.sql`, `0010_cycle_counts.sql`, `0011_stock_corrections.sql`, `0012_audits.sql`, `0013_stock_fixes.sql`, `0014_cycle_count.sql`, `0015_realtime.sql`. Atau dengan CLI: `supabase link --project-ref <ref>` lalu `supabase db push`.
   **Project yang sudah jalan** (0001–0003 sudah diterapkan): cukup jalankan `0004` sampai `0015`. `0015` menyalakan Realtime (halaman diperbarui otomatis, titik *Live* di judul); tanpa itu halaman tetap jalan tetapi titiknya tidak pernah menerima perubahan. `0004` mengubah identitas stok menjadi bin + SKU + batch + **expired**; data lama tetap valid.
3. Jalankan `supabase/seed.sql` (2.570 bin, 106 SKU, 1.790 baris stok dari file WMS). File ini ±230 KB; jika editor menolak, pakai CLI: `psql "<connection string>" -f supabase/seed.sql`.
4. **Akun situs**: buat satu akun di **Authentication → Users → Add user** (mis. nama *Gudang*), lalu di SQL Editor:
   ```sql
   update public.profiles set role = 'admin', name = 'Gudang' where id = (select id from auth.users where email = '<email akun situs>');
   ```
   Isi `SITE_ACCOUNT_EMAIL` dan `SITE_ACCOUNT_PASSWORD` di environment hosting (Vercel) dan di `.env.local`. Semua pengunjung memakai sesi akun ini; aplikasi langsung terbuka.
5. **Authentication → Providers → Email**: matikan "Allow new users to sign up".

Membuat ulang seed dari file WMS baru:
```bash
pip install openpyxl
python3 scripts/generate_seed.py path/ke/Warehouse_Management_System.xlsx
```
Untuk update rutin, pakai menu **Import** di aplikasi (tercatat sebagai mutasi), bukan seed.

### 2.2 Uji SQL lokal (tanpa Supabase)

```bash
psql -f supabase/tests/00_local_auth_stub.sql   # stub skema auth + role
for f in supabase/migrations/*.sql; do psql -f "$f"; done
psql -f supabase/seed.sql
psql -f supabase/tests/01_rls_and_stock_rules.sql
psql -f supabase/tests/02_allocation_flow.sql   # semua baris harus PASS
psql -f supabase/tests/03_rolling_execution.sql # semua baris harus PASS (stub auth, bukan Supabase asli)
psql -f supabase/tests/04_putaway_import.sql    # semua PASS; rollback, aman di Supabase lokal
psql -f supabase/tests/05_pickfaces_counts_corrections.sql  # idem
psql -f supabase/tests/06_audits.sql            # idem
psql -f supabase/tests/07_stock_fixes.sql       # idem
psql -f supabase/tests/08_cycle_count.sql       # idem
psql -f supabase/tests/09_inventory_control.sql # kontrol inventory (0016–0023), idem
psql -f supabase/tests/10_pick_audit.sql     # audit picking (0024), idem
```
Atau semuanya sekaligus di database lokal sementara: `scripts/sql-test.sh`.

### 2.3 Aplikasi

```bash
cp .env.example .env.local   # isi URL, anon key, service role key (Project Settings → API)
npm install
npm run dev                  # http://localhost:3000
```
Kamera ponsel butuh **HTTPS** (atau localhost). Untuk uji di ponsel saat dev: `npx next dev --experimental-https` atau deploy ke Vercel.

### 2.4 Deploy ke Vercel

Import repo di Vercel → isi 3 environment variable yang sama → Deploy. Vercel mendeteksi Next.js otomatis (`vercel.json` lama untuk web statis sudah dihapus).

---

## 3. Per fase: file, perintah, cara uji

### Fase 1 — Skema, migrasi, RLS, seed
File: `supabase/migrations/*`, `supabase/seed.sql`, `scripts/generate_seed.py`, `supabase/tests/*`.
Uji:
```sql
select count(*) from bins;                          -- 2570
select count(*), sum(quantity) from inventory;       -- 1790 | 52078
select * from bin_summary where bin_code = 'CA01C01';
```
Uji aturan stok & RLS di Postgres lokal (bukan Supabase): `psql -f supabase/tests/00_local_auth_stub.sql`, migrasi, seed, lalu `01_rls_and_stock_rules.sql`.

### Fase 2 — Import
File: `app/(app)/admin/import/*`, `lib/import-validate.ts`, `lib/read-sheet.ts`, fungsi SQL `import_snapshot`.
Uji: Import → pilih file WMS → sheet `WMS` & baris judul 4 terdeteksi otomatis → Validasi. Hasil yang diharapkan untuk file 24 Sep: **2.468 ok, 146 peringatan, 1 error** (CC01C01 berisi `#VALUE!`). Impor ulang file yang sama setelah seed → **0 mutasi**.

### Fase 3 — Label
File: `lib/labels.ts`, `app/api/labels/route.ts`, `app/(app)/labels/*`.
Uji: Label → Satu rak → CA / 01 → Strip → Buat PDF. Satu halaman = satu tiang (posisi 01 atau 02), lebar 80 mm, 5 sel × 85 mm + panah 22 mm atas/bawah = 469 mm. Mode **Per sel** = halaman 80 × 85 mm. Cetak di skala **100%**. Contoh hasil: `docs/label-samples/`.

### Fase 4 — Scan & detail bin
File: `app/(app)/scan/*`, `app/(app)/bin/[code]/*`, `components/bin/*`, `components/scan/*`.
Uji: buka `/scan` di ponsel → Scan pakai kamera → arahkan ke label → halaman bin terbuka. Coba ketik `XX99` → pesan "bukan format bin". Pick melebihi stok → ditolak database.

### Fase 5 — 3D
File: `components/warehouse/*`, `app/(app)/warehouse/*`, `app/api/warehouse/route.ts`.
Uji: `/warehouse` → ganti mode warna → klik kotak → panel detail. Cari `CB12` (semua bin rak CB12) atau SKU `550070612`.

### Fase 6 — Dashboard & laporan
File: `app/(app)/dashboard/page.tsx`, `app/(app)/movements/page.tsx`, `app/api/movements/export/route.ts`, `lib/movement-query.ts`.
Uji: Dashboard → angka total bin 2.570. Mutasi → filter jenis `adjustment` → Export .xlsx.

---

### Fase 7 — Alokasi & wave (dari FEFO allocator)

File: `lib/allocator/*` (mesin FEFO, murni tanpa I/O), `app/(app)/allocate/*`, `app/(app)/waves/*`, `supabase/migrations/0004_allocation.sql`, `docs/ALLOCATOR.md`.

Alur harian:
```
File WMS (sheet "Schedule of the day") ─┐
                                         ├─▶ Alokasi FEFO (browser) ─▶ Simpan rencana ─▶ waves + pick_tasks + outbound
Stok database (inventory_detail) ───────┘        (supervisor)            (stok belum berubah)
                                                                                   │
            inventory ◀── trigger ◀── movements (picking / transfer) ◀── Posting tugas / Selesaikan wave (operator)
```

- **Alokasi** (supervisor/admin): unggah file WMS harian → tanggal & opsi → *Jalankan alokasi* → cek picklist, kekurangan, rencana mutasi, pickface, double pick → unduh PDF/Excel → *Simpan rencana*. Sumber stok *Sheet WMS di file* = simulasi, tidak bisa disimpan.
- **Stok untuk perencanaan = stok fisik − yang sudah dipesan tugas terbuka + yang akan masuk** (`planning_stock`). Rencana tanggal lain atau wave lain tidak bisa memakai karton yang sama.
- **Wave** (semua role): konfirmasi satu tugas atau satu wave. Stok di database berubah saat itu juga, lewat ledger `movements`.
  - *Posting → Sesuai rencana*: persis seperti rencana.
  - *Posting → Berbeda*: isi jumlah yang benar-benar diambil (boleh 0), bin/batch asal yang sebenarnya, dan alasan (wajib). Stok dipotong dari bin yang benar-benar dipakai; order mencatat *Terambil*.
  - *Selesaikan wave*: semua tugas tersisa sesuai rencana, dalam satu transaksi.
- **Hitung ulang wave tersisa** (supervisor): wave yang belum dikerjakan (masih *Menunggu*, belum ada tugas yang diposting/dibatalkan) dihitung ulang dari stok saat ini, tanpa file. Wave yang sudah berjalan, ditunda, atau dibatalkan tidak diubah. Menjalankan *Alokasi* lagi untuk tanggal yang sama juga hanya mengganti wave yang belum dikerjakan; shipment milik wave yang sudah berjalan dilewati.
- **Putaway** (supervisor/admin): unggah file WMS → sheet *data putaway* dipilih otomatis → setiap baris dibandingkan dengan isi bin sekarang. *Baru* (bin kosong) diposting sebagai mutasi putaway; *Sudah tercatat* (isi bin sudah sama) dilewati, jadi file yang sama aman diunggah ulang. *Konflik* ditampilkan dengan isi bin di sistem dan tidak diposting kecuali dipilih keputusannya: qty lain → *tambahkan* atau *samakan*; bin berisi stok lain → *taruh di samping*. Bin/SKU tidak dikenal, bin diblokir, dan baris duplikat hanya dilaporkan. Laporan konflik bisa diunduh (.xlsx).
- **Pickface** (supervisor/admin): satu bin pickface tetap per SKU (satu SKU per bin). Alokasi dan *Hitung ulang wave tersisa* memakai bin ini untuk replenishment. SKU tanpa pickface tetap memakai saran otomatis (bin level A paling awal di rute), yang tidak pernah memakai bin tetap SKU lain. *Isi saran untuk semua yang belum tetap* lalu *Simpan* mengunci pilihan hari ini.
- **Hitung stok** (semua peran): tugas hitung per bin. Dibuat manual oleh supervisor, dari halaman Kualitas data, atau otomatis saat posting putaway untuk konflik qty/isi bin yang tidak diputuskan (satu tugas terbuka per bin). Operator menghitung seluruh isi bin tanpa melihat qty sistem; supervisor melihat selisih lalu *Terapkan* (penyesuaian tercatat `HITUNG <bin>`) atau *Tutup tanpa perubahan* dengan alasan.
- **Kualitas data** (supervisor/admin): pemeriksaan langsung atas stok: stok rak tanpa batch, batch berupa tanggal (disarankan nomor asli dari angka seri Excel), tanpa expired, sudah expired di rak, bin rak berisi lebih dari 1 palet. Batch/expired dikoreksi dengan dua penyesuaian (`KOREKSI <bin>`, qty tetap); ditolak bila stok itu masih dipakai tugas wave terbuka. Expired dan kelebihan palet dikirim ke Hitung stok.
- **Stok yang dipesan terlindungi**: operator tidak bisa memindah/pick manual (halaman bin) stok yang dipesan tugas terbuka. Supervisor bisa; tugas yang jadi tidak cocok ditandai merah (*stok kurang*) di halaman Wave dengan tombol hitung ulang.
- **Scan bin**: halaman bin menampilkan tugas terencana yang mengambil dari / mengisi bin tersebut.
- **Ledger stok**: *Riwayat mutasi* = semua perubahan stok (jenis, SKU, batch, expired, qty, dari/ke bin, siapa, kapan, catatan; baris dari tugas wave mencatat penyimpangannya). Tidak bisa diedit/dihapus.
- CLI (tanpa browser): `npm run allocate:file -- data/file.xlsx --out out --as-of 2026-09-24 [--db] [--pdf]`.

Uji: `npm test` (mesin FEFO + paritas stok database vs workbook). SQL: lihat bagian 5.

### Fase 8 — Kontrol inventory

Cara kerja, aturan, dan rutinitas harian: **`docs/INVENTORY_CONTROL.md`**. Migrasi `0016`–`0023`:
aturan inventory + master item (barcode, umur simpan, sisa umur minimum per SKU) + dekode kode batch Shell;
hold / karantina; kode alasan + persetujuan orang lain untuk adjustment besar; cycle count buta dengan hitung
ulang oleh orang lain; penerimaan vs DO; rekonsiliasi stok SAP; laporan kepatuhan FEFO pada pick nyata;
nama picker + scan barcode saat posting pick. Halaman: **Inventory** (Stok, Expired & FEFO, Hold & karantina,
Akurasi & adjustment, Rekonsiliasi SAP, Persetujuan), **Penerimaan**, **Master item**.
Uji: `supabase/tests/09_inventory_control.sql`, `tests/batch-code.test.ts`, `tests/sap-stock.test.ts`,
`tests/min-shelf-life.test.ts`.

---

## 4. Keputusan desain (untuk laporan magang)

<details open>
<summary><b>🛡️ Data & integritas</b></summary>

- **Stok hanya berubah lewat tabel `movements`.** Trigger `apply_movement` di database memvalidasi dan mengubah `inventory`; tabel `inventory` tidak punya policy tulis sama sekali, jadi aplikasi, API, maupun user tidak bisa mengubah stok tanpa jejak.
- **Validasi stok di database, bukan di UI.** Dua operator yang pick bersamaan tetap aman karena baris stok dikunci (`FOR UPDATE`) sebelum dikurangi.
- **Ledger tidak bisa diedit/dihapus.** Koreksi dilakukan dengan mutasi baru (adjustment), sesuai praktik audit gudang.
- **Penulis mutasi dipaksa = akun sesi.** Trigger mengisi `user_id` dari sesi, sehingga user_id palsu dari klien diabaikan.
- **Saldo awal dan import dicatat sebagai `adjustment`.** Angka stok awal bisa ditelusuri ke file sumbernya.
- **Batch kosong disimpan sebagai `''`, bukan NULL.** Unique key (bin, SKU, batch) di Postgres tidak menganggap dua NULL sama; `''` mencegah duplikat.
- **Import mode snapshot tidak menyentuh bin yang barisnya error.** Tanpa ini, satu baris salah ketik akan menolkan stok fisik yang sebenarnya ada.
- **Tanggal expired tahun tidak masuk akal (mis. 1930) diimpor sebagai peringatan, bukan ditolak.** Barangnya ada secara fisik; menolak baris akan menghilangkan stok dari sistem.
- **Remain Qty dipakai, bukan Qty.** Remain Qty sudah memperhitungkan pick, putaway, dan transfer hari itu.

</details>

<details>
<summary><b>🔒 Keamanan (RLS)</b></summary>

- **Role disimpan di `profiles`, dicek lewat fungsi `has_role()` SECURITY DEFINER.** Policy tidak bisa rekursif membaca tabel yang sedang dilindungi.
- **Pengecekan ganda: RLS + cek role di fungsi/route.** Jika satu lapis salah konfigurasi, lapis lain tetap menolak.
- **Service role key hanya dipakai di server.** Key ini melewati RLS, jadi tidak pernah dikirim ke browser.
- **Pendaftaran publik dimatikan.** Hanya akun situs yang dipakai.

</details>

<details>
<summary><b>🏷️ Label</b></summary>

- **Strip tiang rak A–E, satu sel 80 × 85 mm per level**, mengikuti contoh foto. Operator menemukan semua level dari lantai tanpa naik.
- **QR + pita warna level, Code 128 opsional.** QR tetap terbaca meski label tertekuk di tiang; Code 128 untuk scanner laser lama.
- **Barcode dirender sebagai vektor**, bukan gambar PNG. Tepi modul tetap tajam di printer 203 dpi (diuji: semua kode terbaca zbar).
- **Quiet zone 3 mm dijaga di sekitar QR dan Code 128.** Scanner butuh ruang putih untuk mengenali awal/akhir kode.
- **Mode hitam-putih.** Printer direct thermal tidak bisa mencetak warna.
- **PDF dibuat di server.** Satu tempat untuk mencatat `print_logs` dan tidak bergantung kemampuan ponsel.

</details>

<details>
<summary><b>📱 Scan &amp; UI</b></summary>

- **Input scan selalu fokus dan submit saat Enter.** Scanner USB/Bluetooth bekerja sebagai keyboard, tanpa driver.
- **Scan dicatat hanya jika datang dari layar scan (`?scan=1`).** Refresh halaman tidak menggelembungkan jumlah scan.
- **Semua aksi punya langkah konfirmasi dengan kalimat ringkasan.** Salah tap di lantai gudang lebih mahal daripada satu tap ekstra.
- **Peringatan FEFO saat memilih batch yang bukan paling awal expired**, tanpa memblokir (kadang ada alasan operasional).
- **Tampilan kartu di ponsel, tabel di desktop.** Tabel 9 kolom tidak terbaca di layar 6 inci.
- **Kode bin ditampilkan seperti plat lokasi kuning.** Tampilan di layar sama dengan yang dilihat operator di rak.

</details>

<details>
<summary><b>🧊 3D</b></summary>

- **Satu instanced mesh untuk 2.570 bin** (satu draw call), sehingga ringan di laptop kantor.
- **Render on-demand (`frameloop="demand"`).** GPU hanya bekerja saat kamera bergerak atau data berubah, jadi baterai tablet lebih awet.
- **Koordinat dihitung di database dari konfigurasi layout.** Ubah ukuran rak sekali, semua bin ikut pindah.

</details>

<details>
<summary><b>🧠 Alokasi &amp; wave (gabungan)</b></summary>

- **Satu sumber kebenaran stok.** Tabel `stock`/`stock_transactions` milik allocator lama dihapus; allocator membaca `inventory` dan menulis lewat ledger `movements` yang sama. Tugas pick yang diposting muncul di riwayat mutasi, ABC, dan 3D seperti mutasi manual.
- **Rencana ≠ eksekusi.** Menyimpan rencana hanya menulis `waves`, `pick_tasks`, `outbound`. Stok berubah saat tugas diposting (`post_task` → satu baris `movements`).
- **Identitas stok = bin + SKU + batch + expired.** Aturan dari allocator: dua tanggal expired dalam satu batch di satu bin adalah dua baris stok, supaya FEFO tidak tertukar. Mutasi tanpa tanggal expired tetap berjalan jika batch itu hanya punya satu baris di bin.
- **Posting idempoten dan atomik.** Unique index `movements(task_id)` membuat posting ganda mustahil; *Selesaikan wave* berjalan dalam satu transaksi.
- **Rencana bergulir.** `save_plan` hanya mengganti wave yang belum dikerjakan; wave yang sudah berjalan tetap, sehingga tidak ada pick yang kehilangan rencananya.
- **Reservasi, bukan kunci.** Stok fisik tetap satu angka; tugas terbuka mengurangi stok *untuk perencanaan* saja. Pindahan manual atas stok yang dipesan ditolak untuk operator.
- **Aktual dicatat, bukan ditebak.** Konfirmasi yang berbeda dari rencana wajib beralasan dan memotong stok dari bin yang benar-benar dipakai.
- **Tabel rencana tanpa policy tulis.** Semua perubahan lewat RPC `SECURITY DEFINER` yang mengecek role; klien juga tidak bisa memalsukan `task_id` di ledger (RLS).
- **Mesin alokasi berjalan di browser**, sama persis dengan CLI (fungsi murni). Server hanya menyimpan hasilnya.

</details>

<details>
<summary><b>⚙️ Lainnya</b></summary>

- **Query list dipaginasi 1.000 baris.** Batas default Supabase 1.000 baris akan memotong 2.570 bin tanpa error.
- **Pembaca Excel hanya membaca sampai sel terakhir yang berisi.** Sheet WMS menyatakan range sampai baris 1.048.563; membaca manual memangkas waktu dari ±21 detik ke ±2 detik.

</details>

---

## 5. Yang sudah diuji / belum

**✅ Sudah** — di sandbox pengembangan:

- [x] Migrasi + seed di PostgreSQL 16 (dengan stub skema `auth` Supabase): 2.570 bin, 1.790 baris stok, total 52.078.
- [x] Aturan: pick melebihi stok ditolak; transfer mempertahankan tanggal expired; transfer ke bin diblokir ditolak; operator tidak bisa adjustment/import/ubah inventory/hapus mutasi; `user_id` palsu diabaikan; adjustment supervisor tercatat.
- [x] Import file WMS asli: 2.614 baris masuk, re-import setelah seed = 0 mutasi.
- [x] Label: ukuran halaman tepat (80 × 85 mm & 80 × 469 mm); QR dan Code 128 terbaca zbar pada render 203 dpi.
- [x] `tsc`, ESLint, dan `next build` lolos.
- [x] Mesin FEFO: `npm test` → 107 uji (termasuk rute pick back-to-back) (regresi sisa/FEFO, workflow harian, pickface, paritas stok database = workbook pada file 15 & 18 Sep).
- [x] SQL: `supabase/tests/05_pickfaces_counts_corrections.sql` (20 cek: pickface unik & tukar, alur hitung buta → terapkan/tutup, konflik putaway jadi tugas hitung, koreksi identitas). `supabase/tests/04_putaway_import.sql` (14 cek: klasifikasi baris, keputusan konflik, preview = posting, unggah ulang aman). `supabase/tests/03_rolling_execution.sql` (21 cek: reservasi, hitung ulang, aktual, guard). `supabase/tests/02_allocation_flow.sql` (17 cek: rencana tidak mengubah stok, posting idempoten, re-plan ditolak setelah eksekusi, wave kurang stok di-rollback, dua expired dalam satu batch).
- [x] End-to-end di Supabase lokal (Auth + PostgREST, akun supervisor & operator): file 24 Sep → 1.790 baris stok → alokasi 1.293 karton → 8 wave / 51 tugas → semua wave selesai oleh operator → stok 52.078 → 50.785, semua baris ledger atas nama operator.

**⬜ Belum:**

- [ ] Uji di project Supabase produksi (sudah diuji di Supabase lokal) dan UI di browser sungguhan.
- [ ] Tampilan 3D di browser (WebGL tidak tersedia di sandbox).
- [ ] Cetak fisik di printer gudang dan scan dengan ponsel operator.

---

## 6. Catatan teknis

- **SheetJS**: npm `xlsx@0.18.5` punya advisori keamanan (prototype pollution/ReDoS) yang diperbaiki di versi CDN resmi. Sebelum produksi: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- Label zona di lantai 3D (`<Text>` drei) memuat font dari CDN saat pertama dibuka.
- Tanggal filter mutasi memakai WIB (UTC+7).
- **Grant eksplisit (0005).** Project Supabase baru tidak lagi memberi hak SELECT/INSERT/EXECUTE ke `authenticated` secara default; tanpa 0005 semua query gagal "permission denied". Aman dijalankan di project lama.
- Dokumen audit allocator lama ada di `docs/archive/allocator/` (merujuk ke kode lama yang sudah diganti).
