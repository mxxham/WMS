/**
 * Stock Take & Recounting mockup — five static slides recreating the printed concept PDF.
 * Pure server component, no client JS, no state, no handlers. All controls are inert.
 */
import { Input, Select, Label } from "@/components/ui/input";
import { Table, Th, Td } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Mail,
  Lock,
  Eye,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ChevronRight,
} from "lucide-react";

export default function StockTakeMockupPage() {
  return (
    <div className="space-y-8 pb-12">
      {/* Top mockup badge */}
      <div className="flex justify-center">
        <span className="rounded-plate bg-warn/10 px-3 py-1 text-xs font-medium text-warn">
          Mockup — tampilan saja, belum berfungsi
        </span>
      </div>

      {/* SLIDE 01 — Login Akun */}
      <section aria-labelledby="slide-01-heading" className="space-y-6">
        <header className="flex items-center justify-between border-b border-steel-100 pb-2">
          <div>
            <h2 id="slide-01-heading" className="font-cond text-2xl font-bold text-steel">
              Login Akun
            </h2>
            <p className="mt-1 text-sm text-steel-500">
              Akses form menggunakan akun perusahaan yang telah diberikan.
            </p>
          </div>
          <span className="text-xs font-medium text-steel-500 uppercase tracking-wide">
            MOCKUP · SLIDE 01 / 05
          </span>
        </header>

        <div className="bg-white border border-steel-100 rounded-xl p-6 shadow-sm max-w-md mx-auto">
          <div className="text-center mb-6">
            <h3 className="font-cond text-xl font-semibold text-steel">Analisis Stock Take</h3>
            <p className="mt-1 text-sm text-steel-500">
              Silakan login untuk melanjutkan pengisian form.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email perusahaan</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-500 size-4" />
                <Input
                  id="email"
                  type="email"
                  placeholder="nama@perusahaan.com"
                  disabled
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-500 size-4" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Masukkan password"
                  disabled
                  className="pl-10 pr-10"
                />
                <Eye className="absolute right-3 top-1/2 -translate-y-1/2 text-steel-500 size-4" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="remember" disabled className="size-4 border-steel-300" />
              <Label htmlFor="remember" className="text-sm text-steel-500 cursor-default mb-0">
                Ingat saya
              </Label>
            </div>

            <Button variant="default" size="lg" className="w-full" disabled>
              Masuk
            </Button>

            <p className="text-center text-xs text-steel-500">Lupa password?</p>
          </div>
        </div>
      </section>

      {/* SLIDE 02 — Stock Take */}
      <section aria-labelledby="slide-02-heading" className="space-y-6">
        <header className="flex items-center justify-between border-b border-steel-100 pb-2">
          <div>
            <h2 id="slide-02-heading" className="font-cond text-2xl font-bold text-steel">
              Stock Take
            </h2>
            <p className="mt-1 text-sm text-steel-500">
              Input data awal dan hasil hitung fisik untuk setiap item material.
            </p>
          </div>
          <span className="text-xs font-medium text-steel-500 uppercase tracking-wide">
            MOCKUP · SLIDE 02 / 05
          </span>
        </header>

        <div className="bg-white border border-steel-100 rounded-xl p-6 shadow-sm space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="date">Tanggal Stock Take</Label>
              <Input id="date" type="text" placeholder="dd/mm/yyyy" disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse">Gudang / Lokasi</Label>
              <Select id="warehouse" disabled>
                <option value="">Pilih lokasi gudang</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pic">Penanggung Jawab Gudang</Label>
              <Input id="pic" type="text" placeholder="Masukkan nama" disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team">Tim Stock Take</Label>
              <Select id="team" disabled>
                <option value="">Pilih tim</option>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-xs font-medium text-steel-500 uppercase tracking-wide">
              Periode Stock Take
            </Label>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-plate bg-ckb px-3 py-1.5 text-xs font-medium text-white">
                Bulanan
              </span>
              <span className="rounded-plate bg-steel-100 px-3 py-1.5 text-xs font-medium text-steel-500">
                Triwulanan
              </span>
              <span className="rounded-plate bg-steel-100 px-3 py-1.5 text-xs font-medium text-steel-500">
                Tahunan
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-cond text-lg font-semibold text-steel">Daftar Hasil Stock Take</h3>
            <Table>
              <thead>
                <tr>
                  <Th className="w-12">No</Th>
                  <Th>Kode Material</Th>
                  <Th>Nama Material</Th>
                  <Th className="tabular">Qty Sistem</Th>
                  <Th className="tabular">Qty Fisik</Th>
                  <Th>Catatan</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>1</Td>
                  <Td>MAT-001</Td>
                  <Td>Material A</Td>
                  <Td className="tabular">1.000</Td>
                  <Td className="tabular">1.000</Td>
                  <Td className="text-steel-500">-</Td>
                </tr>
                <tr className="bg-warn/10">
                  <Td>2</Td>
                  <Td>MAT-002</Td>
                  <Td>Material B</Td>
                  <Td className="tabular">500</Td>
                  <Td className="tabular">498</Td>
                  <Td>
                    <span className="rounded-plate bg-warn/20 px-2 py-0.5 text-xs font-medium text-warn">
                      Selisih
                    </span>
                  </Td>
                </tr>
                <tr>
                  <Td>3</Td>
                  <Td>MAT-003</Td>
                  <Td>Material C</Td>
                  <Td className="tabular">200</Td>
                  <Td className="tabular">200</Td>
                  <Td className="text-steel-500">-</Td>
                </tr>
              </tbody>
            </Table>
          </div>

          <div className="flex justify-end pt-4 border-t border-steel-100">
            <Button variant="outline" disabled>
              Simpan & Lihat Hasil
            </Button>
          </div>
        </div>
      </section>

      {/* SLIDE 03 — Hasil Stock Take & Discrepancy */}
      <section aria-labelledby="slide-03-heading" className="space-y-6">
        <header className="flex items-center justify-between border-b border-steel-100 pb-2">
          <div>
            <h2 id="slide-03-heading" className="font-cond text-2xl font-bold text-steel">
              Hasil Stock Take & Discrepancy
            </h2>
            <p className="mt-1 text-sm text-steel-500">
              Sistem membandingkan qty sistem dengan hasil hitung fisik secara otomatis.
            </p>
          </div>
          <span className="text-xs font-medium text-steel-500 uppercase tracking-wide">
            MOCKUP · SLIDE 03 / 05
          </span>
        </header>

        <div className="bg-white border border-steel-100 rounded-xl p-6 shadow-sm space-y-6">
          {/* Stat tiles */}
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
            <StatTile
              label="Total Item"
              value="5"
              color="text-steel"
              icon={<HelpCircle className="size-5 text-steel-500" />}
            />
            <StatTile
              label="Sesuai"
              value="3"
              color="text-ok"
              icon={<CheckCircle2 className="size-5 text-ok" />}
            />
            <StatTile
              label="Discrepancy"
              value="1"
              color="text-bad"
              icon={<XCircle className="size-5 text-bad" />}
            />
            <StatTile
              label="Belum Diperiksa"
              value="1"
              color="text-steel-500"
              icon={<AlertTriangle className="size-5 text-steel-500" />}
            />
          </div>

          {/* Results table */}
          <div className="space-y-3">
            <h3 className="font-cond text-lg font-semibold text-steel">Detail Hasil</h3>
            <Table>
              <thead>
                <tr>
                  <Th className="w-12">No</Th>
                  <Th>Kode Material</Th>
                  <Th>Nama Material</Th>
                  <Th className="tabular">Qty Sistem</Th>
                  <Th className="tabular">Qty Fisik</Th>
                  <Th className="tabular">Selisih</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>1</Td>
                  <Td>MAT-001</Td>
                  <Td>Material A</Td>
                  <Td className="tabular">1.000</Td>
                  <Td className="tabular">1.000</Td>
                  <Td className="tabular text-steel-500">0</Td>
                </tr>
                <tr className="bg-warn/10">
                  <Td>2</Td>
                  <Td>MAT-002</Td>
                  <Td>Material B</Td>
                  <Td className="tabular">500</Td>
                  <Td className="tabular">498</Td>
                  <Td className="tabular font-medium text-bad">-2</Td>
                </tr>
                <tr>
                  <Td>3</Td>
                  <Td>MAT-003</Td>
                  <Td>Material C</Td>
                  <Td className="tabular">200</Td>
                  <Td className="tabular">200</Td>
                  <Td className="tabular text-steel-500">0</Td>
                </tr>
                <tr>
                  <Td>4</Td>
                  <Td>MAT-004</Td>
                  <Td>Material D</Td>
                  <Td className="tabular">150</Td>
                  <Td className="tabular">150</Td>
                  <Td className="tabular text-steel-500">0</Td>
                </tr>
                <tr>
                  <Td>5</Td>
                  <Td>MAT-005</Td>
                  <Td>Material E</Td>
                  <Td className="tabular">300</Td>
                  <Td className="tabular">300</Td>
                  <Td className="tabular text-steel-500">0</Td>
                </tr>
              </tbody>
            </Table>
          </div>

          {/* Discrepancy banner */}
          <div className="rounded-md bg-warn/10 p-3 flex items-start gap-3">
            <AlertTriangle className="size-5 text-warn flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-warn">DISCREPANCY TERDETEKSI</p>
              <p className="text-sm text-warn mt-0.5">
                1 item memiliki selisih. Lakukan Recounting untuk item terkait.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-steel-100">
            <Button variant="default" disabled>
              Lanjut ke Form Recounting
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* SLIDE 04 — Recounting */}
      <section aria-labelledby="slide-04-heading" className="space-y-6">
        <header className="flex items-center justify-between border-b border-steel-100 pb-2">
          <div>
            <h2 id="slide-04-heading" className="font-cond text-2xl font-bold text-steel">
              Recounting
            </h2>
            <p className="mt-1 text-sm text-steel-500">
              Form ini hanya diisi untuk item yang terdeteksi discrepancy pada hasil stock take.
            </p>
          </div>
          <span className="text-xs font-medium text-steel-500 uppercase tracking-wide">
            MOCKUP · SLIDE 04 / 05
          </span>
        </header>

        <div className="bg-white border border-steel-100 rounded-xl p-6 shadow-sm space-y-6">
          {/* Data Item Discrepancy */}
          <div className="space-y-4 p-4 bg-paper rounded-lg border border-steel-100">
            <h3 className="font-cond text-lg font-semibold text-steel flex items-center gap-2">
              <AlertTriangle className="size-5 text-warn" />
              Data Item Discrepancy
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <span className="text-steel-500">Kode Material:</span>
                <span className="ml-2 font-medium text-steel">MAT-002</span>
              </div>
              <div>
                <span className="text-steel-500">Nama Material:</span>
                <span className="ml-2 font-medium text-steel">Material B</span>
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="bin">Lokasi / Bin</Label>
                <Input id="bin" type="text" placeholder="Masukkan lokasi" disabled />
              </div>
            </div>
            <div className="pt-3 border-t border-steel-100 flex flex-wrap gap-4 text-sm text-steel-500">
              <span>Qty Sistem: <span className="font-medium text-steel tabular">500</span></span>
              <span>Hasil Hitung Awal: <span className="font-medium text-steel tabular">498</span></span>
              <span>Selisih Awal: <span className="font-medium text-bad tabular">-2</span></span>
            </div>
          </div>

          {/* Hasil Recounting */}
          <div className="space-y-4">
            <h3 className="font-cond text-lg font-semibold text-steel">Hasil Recounting</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="recount-qty">Qty Hasil Hitung Ulang</Label>
                <Input id="recount-qty" type="number" placeholder="Masukkan jumlah aktual" disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recount-pic">Nama Petugas Recounting</Label>
                <Input id="recount-pic" type="text" placeholder="Masukkan nama petugas" disabled />
              </div>
            </div>
          </div>

          {/* Penyebab Selisih */}
          <div className="space-y-3">
            <Label className="text-xs font-medium text-steel-500 uppercase tracking-wide block">
              Penyebab Selisih
            </Label>
            <div className="flex flex-wrap gap-2">
              {[
                "Kesalahan pencatatan",
                "Barang tidak ditemukan",
                "Kerusakan barang",
                "Kesalahan penerimaan/pengeluaran",
                "Lainnya",
              ].map((cause) => (
                <span
                  key={cause}
                  className="rounded-plate bg-plate px-2.5 py-0.5 text-xs font-medium text-steel"
                >
                  {cause}
                </span>
              ))}
            </div>
          </div>

          {/* Catatan */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Catatan / Bukti Pendukung</Label>
            <Input
              id="notes"
              type="text"
              placeholder="Jelaskan hasil recounting dan unggah bukti pada form aktual"
              disabled
            />
          </div>

          <div className="flex justify-end pt-4 border-t border-steel-100">
            <Button variant="default" disabled>
              Kirim Recounting
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* SLIDE 05 — Hasil Akhir & Tindak Lanjut */}
      <section aria-labelledby="slide-05-heading" className="space-y-6">
        <header className="flex items-center justify-between border-b border-steel-100 pb-2">
          <div>
            <h2 id="slide-05-heading" className="font-cond text-2xl font-bold text-steel">
              Hasil Akhir & Tindak Lanjut
            </h2>
            <p className="mt-1 text-sm text-steel-500">
              Alur akhir berdasarkan hasil stock take dan recounting.
            </p>
          </div>
          <span className="text-xs font-medium text-steel-500 uppercase tracking-wide">
            MOCKUP · SLIDE 05 / 05
          </span>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Path A: Tidak Ada Discrepancy */}
          <div className="bg-white border border-ok/30 bg-ok/5 rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-ok" />
              <h3 className="font-cond text-xl font-bold text-ok">Tidak Ada Discrepancy</h3>
            </div>
            <p className="text-sm text-steel-500">
              Hasil stock take sesuai dengan data sistem.
            </p>
            <span className="inline-flex items-center gap-1 rounded-plate bg-ok/10 px-2.5 py-0.5 text-xs font-medium text-ok">
              Stock Take Selesai
            </span>
            <Button variant="outline" disabled className="w-full">
              Kembali ke Dashboard
            </Button>
          </div>

          {/* Path B: Discrepancy Ditemukan */}
          <div className="bg-white border border-warn/30 bg-warn/5 rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warn" />
              <h3 className="font-cond text-xl font-bold text-warn">Discrepancy Ditemukan</h3>
            </div>
            <ol className="space-y-2 text-sm text-steel-500 list-decimal list-inside">
              <li>Lakukan Recounting untuk item terkait.</li>
              <li>Catat qty hitung ulang dan penyebab selisih.</li>
              <li>Ajukan tindak lanjut / koreksi data.</li>
            </ol>
            <div className="flex items-center gap-2 pt-2 border-t border-warn/20">
              <span className="inline-flex items-center gap-1 rounded-plate bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">
                Menunggu Verifikasi
              </span>
            </div>
            <p className="text-xs text-steel-500">
              Hasil recounting ditinjau oleh penanggung jawab.
            </p>
            <Button variant="outline" disabled className="w-full">
              Kembali ke Dashboard
            </Button>
          </div>
        </div>
      </section>

      {/* Page footer */}
      <footer className="text-center text-xs text-steel-500 pt-8 border-t border-steel-100">
        ANALISIS STOCK TAKE · MOCKUP FORM 5 SLIDE — bukan formulir Google aktif · tidak tersimpan di
        database
      </footer>
    </div>
  );
}

function StatTile({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-paper p-4 flex flex-col items-center text-center">
      <div className={color}>{icon}</div>
      <div className="mt-2 font-cond text-3xl font-semibold tabular text-steel">{value}</div>
      <div className="mt-1 text-xs text-steel-500">{label}</div>
    </div>
  );
}