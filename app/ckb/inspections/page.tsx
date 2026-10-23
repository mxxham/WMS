/** Cargo Inspection Mockup — static white-themed concept page (no client JS, no state). */
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";

/** Render a checklist item row with three static result pills: OK / NG / N/A. */
function ChecklistItem({ label }: { label: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3 border-b border-steel-100 last:border-0">
      <span className="text-sm text-steel-700">{label}</span>
      <div className="flex items-center gap-2" role="group" aria-label={`Hasil untuk ${label}`}>
        <span className="rounded-plate bg-ok/10 px-2.5 py-1 text-xs font-medium text-ok">OK</span>
        <span className="rounded-plate bg-bad/10 px-2.5 py-1 text-xs font-medium text-bad">NG</span>
        <span className="rounded-plate bg-steel-100 px-2.5 py-1 text-xs font-medium text-steel-500">N/A</span>
      </div>
    </div>
  );
}

/** Render a numbered step card for the process flow. */
function StepCard({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-ckb/10 text-ckb font-cond font-bold text-sm">
        {number}
      </span>
      <div>
        <h4 className="font-cond text-base font-semibold text-steel">{title}</h4>
        <p className="text-xs text-steel-500">{desc}</p>
      </div>
    </div>
  );
}

/** Render a photo guide step. */
function PhotoGuideStep({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-ckb/10 text-ckb font-cond font-bold text-sm">
        {number}
      </span>
      <div>
        <h4 className="font-cond text-base font-semibold text-steel">{title}</h4>
        <p className="text-xs text-steel-500">{desc}</p>
      </div>
    </div>
  );
}

/** Render an upload drop zone (static, non-interactive). */
function UploadZone({ caption, advice }: { caption: string; advice: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-steel-300 bg-paper/50 text-steel-500 p-6 text-center">
      <Camera className="h-10 w-10" aria-hidden="true" />
      <span className="font-cond text-lg font-semibold text-steel">KLIK / UNGGAH FOTO EVIDENCE</span>
      <p className="text-xs text-steel-500">{caption}</p>
      <p className="text-[11px] text-steel-500">{advice}</p>
    </div>
  );
}

/** Render a disabled form field wrapper with label. */
function DisabledField({
  label,
  children,
  required = false,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}{required && <span className="text-bad ml-1">*</span>}</Label>
      <div className="opacity-50">{children}</div>
    </div>
  );
}

export default function InspectionsPage() {
  return (
    <div className="space-y-10">
      {/* Mockup disclaimer chip */}
      <div className="flex items-center justify-between">
        <span className="rounded-plate bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">
          Mockup — tampilan saja, belum berfungsi
        </span>
      </div>

      {/* SLIDE 01 */}
      <section aria-labelledby="slide1-title" className="space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 id="slide1-title" className="font-cond text-2xl font-bold text-steel">
              Cargo Inspection — Online Evidence Form
            </h1>
            <p className="mt-1 text-sm text-steel-500">
              Mockup alur input data inspeksi cargo dan dokumentasi kondisi pallet, wrapping, marking & labelling
            </p>
          </div>
          <span className="flex-shrink-0 rounded-plate bg-steel-100 px-2.5 py-0.5 text-xs font-medium text-steel-500 uppercase tracking-wide">
            MOCKUP · SLIDE 01 / 03
          </span>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left card: Form Input */}
          <article className="bg-white border border-steel-100 rounded-xl p-6 shadow-sm">
            <header className="flex items-start justify-between gap-4">
              <h2 className="font-cond text-xl font-bold text-steel">FORM INPUT INSPEKSI CARGO</h2>
              <span className="flex-shrink-0 rounded-plate bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">
                Konsep
              </span>
            </header>
            <p className="mt-3 text-sm text-steel-500">
              Lengkapi identitas cargo sebelum pemeriksaan dan unggah foto evidence.
            </p>

            <form className="mt-6 space-y-4" aria-label="Form input inspeksi cargo">
              <DisabledField label="Tanggal inspeksi" required>
                <Input type="date" placeholder="Pilih tanggal inspeksi" disabled />
              </DisabledField>

              <DisabledField label="Shift / jam inspeksi" required>
                <Input type="text" placeholder="Contoh: Day Shift / 08:00–16:00" disabled />
              </DisabledField>

              <DisabledField label="Lokasi / Warehouse" required>
                <Select disabled>
                  <option value="">Pilih lokasi kerja</option>
                  <option value="ws5">Warehouse 5 — Surabaya</option>
                  <option value="other">Lainnya</option>
                </Select>
              </DisabledField>

              <DisabledField label="Nomor referensi / DO / WO">
                <Input type="text" placeholder="Masukkan nomor dokumen" disabled />
              </DisabledField>

              <DisabledField label="Nama inspector / PIC" required>
                <Input type="text" placeholder="Nama petugas inspeksi" disabled />
              </DisabledField>

              <DisabledField label="Checker / Supervisor">
                <Input type="text" placeholder="Nama pemeriksa" disabled />
              </DisabledField>

              <DisabledField label="Nama cargo / deskripsi material" required>
                <Input type="text" placeholder="Nama material, kode item, atau deskripsi" disabled />
              </DisabledField>

              <div className="pt-2">
                <Button type="button" disabled className="w-full" variant="default">
                  SUBMIT LAPORAN
                </Button>
              </div>
            </form>

            {/* Output chip */}
            <div className="mt-6 pt-4 border-t border-steel-100">
              <span className="inline-flex items-center gap-1.5 rounded-plate bg-ckb/10 px-2.5 py-1 text-xs font-medium text-ckb">
                Output: Record inspeksi + foto evidence
              </span>
            </div>
          </article>

          {/* Right card: Alur Inspeksi */}
          <article className="bg-white border border-steel-100 rounded-xl p-6 shadow-sm">
            <header className="flex items-start justify-between gap-4">
              <h2 className="font-cond text-xl font-bold text-steel">ALUR INSPEKSI</h2>
              <span className="flex-shrink-0 rounded-plate bg-ckb/10 px-2.5 py-0.5 text-xs font-medium text-ckb">
                5 Tahap
              </span>
            </header>

            <div className="mt-4 space-y-4" role="list" aria-label="Alur inspeksi cargo">
              <StepCard
                number="01"
                title="Input identitas"
                desc="Tanggal, lokasi, cargo, dan PIC."
              />
              <StepCard
                number="02"
                title="Cek kondisi pallet"
                desc="Periksa struktur, kerusakan, dan kestabilan."
              />
              <StepCard
                number="03"
                title="Cek wrapping"
                desc="Periksa kekencangan, robekan, dan perlindungan."
              />
              <StepCard
                number="04"
                title="Marking & labelling"
                desc="Pastikan tanda dan label terbaca."
              />
              <StepCard
                number="05"
                title="Foto & submit"
                desc="Unggah evidence untuk review supervisor."
              />
            </div>
          </article>
        </div>
      </section>

      {/* SLIDE 02 */}
      <section aria-labelledby="slide2-title" className="space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 id="slide2-title" className="font-cond text-2xl font-bold text-steel">
              Inspection Checklist — Cargo Condition
            </h1>
            <p className="mt-1 text-sm text-steel-500">
              Periksa kondisi pallet, wrapping, marking dan labelling sebelum cargo dipindahkan atau disimpan
            </p>
          </div>
          <span className="flex-shrink-0 rounded-plate bg-steel-100 px-2.5 py-0.5 text-xs font-medium text-steel-500 uppercase tracking-wide">
            MOCKUP · SLIDE 02 / 03
          </span>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left card: Checklist */}
          <article className="bg-white border border-steel-100 rounded-xl p-6 shadow-sm">
            <header className="flex items-start justify-between gap-4">
              <h2 className="font-cond text-xl font-bold text-steel">CHECKLIST KONDISI CARGO</h2>
              <span className="flex-shrink-0 rounded-plate bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">
                Konsep
              </span>
            </header>
            <p className="mt-3 text-sm text-steel-500">
              Pilih status setiap item berdasarkan hasil pemeriksaan aktual.
            </p>

            <div className="mt-6 space-y-6" role="list" aria-label="Checklist kondisi cargo">
              {/* A. KONDISI PALLET */}
              <div className="space-y-2">
                <h3 className="font-cond text-xs font-semibold uppercase tracking-wide text-steel-500">
                  A. KONDISI PALLET
                </h3>
                <ChecklistItem label="Pallet utuh, tidak patah / retak" />
                <ChecklistItem label="Papan dan kaki pallet tidak longgar" />
                <ChecklistItem label="Cargo tersusun stabil dan tidak miring" />
              </div>

              {/* B. KONDISI WRAPPING */}
              <div className="space-y-2">
                <h3 className="font-cond text-xs font-semibold uppercase tracking-wide text-steel-500">
                  B. KONDISI WRAPPING
                </h3>
                <ChecklistItem label="Wrapping terpasang rapat dan cukup kuat" />
                <ChecklistItem label="Tidak ada sobekan / wrapping terbuka" />
                <ChecklistItem label="Cargo terlindungi dari debu atau kelembapan" />
              </div>

              {/* C. MARKING & LABELLING */}
              <div className="space-y-2">
                <h3 className="font-cond text-xs font-semibold uppercase tracking-wide text-steel-500">
                  C. MARKING & LABELLING
                </h3>
                <ChecklistItem label="Marking cargo terlihat dan terbaca" />
                <ChecklistItem label="Label / shipping mark terpasang dengan baik" />
                <ChecklistItem label="Informasi label sesuai dokumen bila tersedia" />
              </div>
            </div>
          </article>

          {/* Right card: Panduan Foto Evidence */}
          <article className="bg-white border border-steel-100 rounded-xl p-6 shadow-sm">
            <header className="flex items-start justify-between gap-4">
              <h2 className="font-cond text-xl font-bold text-steel">PANDUAN FOTO EVIDENCE</h2>
              <span className="flex-shrink-0 rounded-plate bg-ckb/10 px-2.5 py-0.5 text-xs font-medium text-ckb">
                3 Kategori
              </span>
            </header>

            <div className="mt-4 space-y-4" role="list" aria-label="Panduan foto evidence">
              <PhotoGuideStep
                number="01"
                title="Foto pallet"
                desc="Tampilkan seluruh pallet dan detail kerusakan bila ada."
              />
              <PhotoGuideStep
                number="02"
                title="Foto wrapping"
                desc="Tampilkan sisi cargo dan kondisi wrapping."
              />
              <PhotoGuideStep
                number="03"
                title="Foto marking & label"
                desc="Pastikan shipping mark / label terbaca."
              />
            </div>

            <div className="mt-6 pt-4 border-t border-steel-100">
              <p className="text-xs text-steel-500">
                Foto jelas, fokus, pencahayaan cukup (JPG / PNG)
              </p>
            </div>
          </article>
        </div>
      </section>

      {/* SLIDE 03 */}
      <section aria-labelledby="slide3-title" className="space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 id="slide3-title" className="font-cond text-2xl font-bold text-steel">
              Photo Evidence — Inspection & Submit
            </h1>
            <p className="mt-1 text-sm text-steel-500">
              Dokumentasikan hasil inspeksi akhir, catatan temuan, dan status tindak lanjut
            </p>
          </div>
          <span className="flex-shrink-0 rounded-plate bg-steel-100 px-2.5 py-0.5 text-xs font-medium text-steel-500 uppercase tracking-wide">
            MOCKUP · SLIDE 03 / 03
          </span>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left card: Upload Foto */}
          <article className="bg-white border border-steel-100 rounded-xl p-6 shadow-sm">
            <header className="flex items-start justify-between gap-4">
              <h2 className="font-cond text-xl font-bold text-steel">UPLOAD FOTO INSPEKSI CARGO</h2>
              <span className="flex-shrink-0 rounded-plate bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">
                Konsep
              </span>
            </header>
            <p className="mt-3 text-sm text-steel-500">
              Unggah foto aktual yang mewakili kondisi pallet, wrapping, marking dan labelling.
            </p>

            <UploadZone
              caption="Foto pallet · wrapping · marking & labelling"
              advice="Disarankan: minimal 1 foto per kategori dan foto detail untuk setiap temuan."
            />
          </article>

          {/* Right card: Hasil Pemeriksaan */}
          <article className="bg-white border border-steel-100 rounded-xl p-6 shadow-sm">
            <header className="flex items-start justify-between gap-4">
              <h2 className="font-cond text-xl font-bold text-steel">HASIL PEMERIKSAAN</h2>
              <span className="flex-shrink-0 rounded-plate bg-warn/10 px-2.5 py-0.5 text-xs font-medium text-warn">
                Konsep
              </span>
            </header>

            <div className="mt-6 space-y-4" role="form" aria-label="Hasil pemeriksaan cargo">
              <DisabledField label="Status kondisi pallet" required>
                <Select disabled>
                  <option value="">Pilih: OK / NG / N/A</option>
                  <option value="ok">OK</option>
                  <option value="ng">NG</option>
                  <option value="na">N/A</option>
                </Select>
              </DisabledField>

              <DisabledField label="Status wrapping" required>
                <Select disabled>
                  <option value="">Pilih: OK / NG / N/A</option>
                  <option value="ok">OK</option>
                  <option value="ng">NG</option>
                  <option value="na">N/A</option>
                </Select>
              </DisabledField>

              <DisabledField label="Status marking & labelling" required>
                <Select disabled>
                  <option value="">Pilih: OK / NG / N/A</option>
                  <option value="ok">OK</option>
                  <option value="ng">NG</option>
                  <option value="na">N/A</option>
                </Select>
              </DisabledField>

              <DisabledField label="Catatan temuan / tindakan">
                <textarea
                  className="h-24 w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm placeholder:text-steel-500 disabled:opacity-50 resize-none"
                  placeholder="Tuliskan kerusakan atau tindak lanjut…"
                  disabled
                />
              </DisabledField>

              {/* Verification status chip */}
              <div className="pt-2">
                <span className="inline-flex items-center gap-1.5 rounded-plate bg-warn/10 px-2.5 py-1.5 text-xs font-medium text-warn">
                  STATUS VERIFIKASI: MENUNGGU REVIEW SUPERVISOR
                </span>
              </div>

              <div className="pt-2">
                <Button type="button" disabled className="w-full" variant="default">
                  SUBMIT LAPORAN
                </Button>
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* Page footer */}
      <footer className="pt-8 border-t border-steel-100">
        <p className="text-xs text-steel-500 text-center">
          CARGO INSPECTION · ONLINE EVIDENCE & REPORTING CONCEPT MOCKUP — bukan formulir Google aktif
          · tidak tersimpan di database
        </p>
      </footer>
    </div>
  );
}