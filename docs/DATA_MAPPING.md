# Pemetaan kolom WMS → database

Sumber utama: sheet **`WMS`** (judul kolom di baris 4, data mulai baris 5). Nilai yang dipakai adalah hasil rumus yang tersimpan di file, bukan rumusnya.

## Format kode bin

`CA01C01` = **Aisle** `CA` · **Rak** `01` · **Level** `C` · **Posisi** `01`

| Bagian | Isi di data | Catatan |
|---|---|---|
| Aisle (2 huruf) | CA, CB, CC, CD, CE, CF, CG | CA hanya 19 rak; CC tanpa rak 19–20; CE tanpa rak 33 |
| Rak (2 digit) | 01–40 | |
| Level (1 huruf) | A–E | 5 level per rak |
| Posisi (2 digit) | 01, 02 | 2 palet per level |

Judul kolom bantu di sheet WMS menyesatkan: kolom `level` (E) sebenarnya nomor **rak**, kolom `gg` (F) adalah **level**. Sistem memakai kode bin langsung, bukan kolom bantu itu.

Lokasi non-rak: `STAGING` (34 baris), `STG_01`–`STG_08`, `Quarantine` (13 baris, diimpor sebagai bin **diblokir**).

## Kolom → tabel

| Kolom WMS | Nama | → Tabel.kolom | Catatan |
|---|---|---|---|
| H | Lokasi | `bins.bin_code` (+ zone/rack/level/position diurai) | wajib |
| L | item | `items.sku` | nomor material SAP |
| M | Description | `items.description` | hasil VLOOKUP ke MASTER DATA |
| I | Batch | `inventory.batch_lot` | kosong → `''` |
| J | GR date | `inventory.received_date` | |
| K | Expired Date | `inventory.expiry_date` | |
| V | Remain Qty | `inventory.quantity` | = Qty + b in + putaway − pick − b out. Dipakai, bukan kolom N (Qty awal) |
| Q | UPP | `items.upp` | unit per palet → utilisasi bin |
| AL | uom | tidak dipakai | 981 baris kosong; UoM diambil dari sheet **Master SKU** (Base Unit of Measure) |
| AI | status | tidak dipakai | #N/A untuk aisle CG |
| lainnya | PICK, b out, b in', putaway, Aging, Volume, cek… | tidak diimpor | kolom hitungan/cek Excel |

Sheet pendukung:

| Sheet | Dipakai untuk |
|---|---|
| MASTER DATA | `items.upp`, `items.volume_l` |
| Master SKU | `items.uom` |
| K_ONE | kelas ABC sementara (frekuensi baris picking) |
| sheet lain (SAP vs fisik, discrepancy, pending GI, schedule…) | tidak diimpor: rekonsiliasi & order, bukan data lokasi |

## Data yang tidak ada di sheet (dan cara menanganinya)

| Dibutuhkan | Status | Penanganan |
|---|---|---|
| Koordinat rak (pos_x/y/z) | tidak ada | dihitung dari kode bin + konfigurasi layout (Admin → Pengaturan). Nilai awal adalah **placeholder** |
| Kelas ABC | tidak ada | dihitung dari baris picking K_ONE (Pareto 80/15/5). Sementara: basisnya hanya 91 baris |
| Kapasitas bin | tidak ada | diasumsikan 1 palet per bin rak (kolom Palet = 1). Lantai = tanpa batas |
