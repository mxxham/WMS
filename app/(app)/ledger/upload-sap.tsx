"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { readSapWorkbook, type SapBook } from "@/lib/ledger/sap-book";
import { fmtDate, fmtNum } from "@/lib/utils";

/**
 * Upload SAP's daily workbook (MB52 + MB51). The file is read here, the day is shown in one sentence, and
 * only on Simpan is it stored (ledger_save_day). The day is the MB51 posting date.
 */
export function UploadSap() {
  const router = useRouter();
  const [name, setName] = usePersonName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<{ book: SapBook; fileName: string; version: number } | null>(null);

  async function read(f: File | undefined) {
    if (!f) return;
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const book = readSapWorkbook(XLSX.read(await f.arrayBuffer(), { cellDates: false }), f.name);
      const { data } = await createClient().from("ledger_latest_days").select("version").eq("ledger_date", book.date).maybeSingle();
      setReady({ book, fileName: f.name, version: (data as { version: number } | null)?.version ?? 0 });
    } catch (e) { setError((e as Error).message); }
  }

  async function save() {
    if (!ready) return;
    if (name.trim().length < 2) return setError("Isi Nama Anda dulu.");
    setBusy(true); setError(null);
    const { book, fileName } = ready;
    const { error } = await createClient().rpc("ledger_save_day", {
      p_date: book.date, p_file_name: fileName, p_by_name: name, p_mb51_count: book.mb51Count,
      p_inbd_total: book.inbdTotal, p_lines: book.lines,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setReady(null);
    router.push(`/ledger/${book.date}`);
    router.refresh();
  }

  const skus = ready?.book.lines.filter((l) => l.akhir_unrest || l.akhir_block).length ?? 0;
  return (
    <div className="flex flex-col items-start gap-1">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-ckb px-4 py-2 text-sm font-semibold text-white">
        <Upload className="h-4 w-4" />Upload file SAP
        <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => { read(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {error && !ready && <p role="alert" className="max-w-sm text-xs text-bad">{error}</p>}
      {ready && (
        <Dialog open onOpenChange={(o) => !o && setReady(null)}>
          <DialogContent title="Simpan file SAP?" description={ready.fileName}>
            <div className="space-y-4">
              <p className="rounded-md bg-plate/30 p-3 text-sm">
                <b>{fmtDate(ready.book.date)}</b>: {fmtNum(skus)} SKU stok WHS1, {fmtNum(ready.book.mb51Count)} transaksi MB51,
                INBD {fmtNum(ready.book.inbdTotal)}. Simpan?
              </p>
              {ready.version > 0 && (
                <p className="rounded-md bg-warn/10 p-2 text-sm">
                  Tanggal ini sudah diupload (versi {ready.version}). Upload lagi membuat versi {ready.version + 1}; versi lama tetap tersimpan.
                </p>
              )}
              <PersonNameField value={name} onChange={setName} label="Nama Anda" id="ledger-upload-name" />
              {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
              <div className="flex gap-2">
                <Button size="lg" className="flex-1" disabled={busy} onClick={save}>{busy ? "Menyimpan…" : "Simpan"}</Button>
                <Button size="lg" variant="outline" onClick={() => setReady(null)}>Batal</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
