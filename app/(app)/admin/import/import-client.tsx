"use client";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/app/confirm-button";
import { StaleWavesNotice } from "@/components/app/stale-waves";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { readSheet, type SheetRows } from "@/lib/read-sheet";
import { FIELDS, FIELD_LABELS, binsWithErrors, detectHeader, toPayload, validateRows, type ImportRow, type Mapping, type RowStatus } from "@/lib/import-validate";
import { cn, fmtNum } from "@/lib/utils";

type Step = "upload" | "map" | "review" | "done";
/** replace: the file is the whole warehouse, stock missing from it is zeroed. update: only the file's rows change. */
type Mode = "replace" | "update";
const tone: Record<RowStatus, string> = { ok: "", warning: "bg-warn/10", error: "bg-bad/10" };

/** Upload -> choose sheet & map columns -> validate & preview -> upsert. */
export function ImportClient() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [sheet, setSheet] = useState("");
  const [data, setData] = useState<SheetRows | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [filter, setFilter] = useState<RowStatus | "all">("all");
  const [mode, setMode] = useState<Mode>("replace");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadSheet(book: XLSX.WorkBook, name: string) {
    const d = readSheet(book, name);
    const h = detectHeader(d.rows);
    setSheet(name); setData(d); setHeaderRow(h.headerRow); setMapping(h.mapping);
  }

  async function onFile(f: File) {
    setError(null); setBusy(true); setFileName(f.name);
    try {
      // cellDates: real Date objects for date cells; formula cells use cached values.
      const book = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      setWb(book);
      loadSheet(book, book.SheetNames.includes("WMS") ? "WMS" : book.SheetNames[0]);
      setStep("map");
    } catch {
      setError("File tidak bisa dibaca. Gunakan .xlsx atau .csv.");
    } finally { setBusy(false); }
  }

  function validate() {
    if (!data) return;
    if (mapping.bin_code === undefined) return setError("Kolom kode bin wajib dipetakan.");
    setError(null);
    setRows(validateRows(data.rows, data.lines, headerRow, mapping).rows);
    setStep("review");
  }

  const counts = useMemo(() => rows.reduce((a, r) => ({ ...a, [r.status]: a[r.status] + 1 }), { ok: 0, warning: 0, error: 0 } as Record<RowStatus, number>), [rows]);
  const shown = useMemo(() => (filter === "all" ? rows : rows.filter((r) => r.status === filter)).slice(0, 500), [rows, filter]);

  function downloadReport() {
    const issues = rows.filter((r) => r.status !== "ok").map((r) => ({
      "Baris Excel": r.line, Status: r.status === "error" ? "ERROR (tidak diimpor)" : "PERINGATAN (diimpor)",
      "Kode bin": r.bin_code, SKU: r.sku, Batch: r.batch_lot, Qty: r.quantity, Expired: r.expiry_date, Masalah: r.messages.join("; "),
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(issues), "Laporan");
    XLSX.writeFile(book, `laporan-import-${fileName.replace(/\.\w+$/, "")}.xlsx`);
  }

  async function commit(): Promise<string | null> {
    setBusy(true); setError(null);
    const supabase = createClient();
    // Units of items already in the system are never changed by an import.
    const { data: items, error: itemsError } = await supabase.from("items").select("sku");
    if (itemsError) { setBusy(false); setError(itemsError.message); return itemsError.message; }
    const existing = new Set((items ?? []).map((i) => i.sku as string));
    const { data: res, error } = await supabase.rpc("import_snapshot", {
      rows: toPayload(rows, existing), full_sync: mode === "replace", source_name: fileName, keep_bins: binsWithErrors(rows),
    });
    setBusy(false);
    if (error) { setError(error.message); return error.message; }
    setResult(`${mode === "replace" ? "Stok diganti dengan isi file" : "Stok diperbarui"}: ${fmtNum(res.rows)} baris diproses, ${fmtNum(res.movements)} mutasi penyesuaian dibuat. ${counts.error} baris error tidak diimpor.`);
    setStep("done");
    return null;
  }

  const importCount = counts.ok + counts.warning;
  const keptBins = binsWithErrors(rows).length;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      {error && <p role="alert" className="rounded-md bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      {step === "upload" && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-steel-300 bg-white p-10 text-center hover:bg-steel-100">
          <FileSpreadsheet className="h-10 w-10 text-steel-500" />
          <span className="font-cond text-xl font-semibold">{busy ? "Membaca file…" : "Pilih file WMS (.xlsx / .csv)"}</span>
          <span className="max-w-md text-sm text-steel-500">Sheet <b>WMS</b> dipilih otomatis. Stok hanya berubah lewat mutasi penyesuaian, jadi setiap import tercatat di riwayat.</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      )}

      {step === "map" && wb && data && (
        <Card>
          <CardHeader><CardTitle>Pemetaan kolom · {fileName}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="sheet">Sheet</Label>
                <Select id="sheet" value={sheet} onChange={(e) => loadSheet(wb, e.target.value)}>{wb.SheetNames.map((s) => <option key={s}>{s}</option>)}</Select></div>
              <div><Label htmlFor="hdr">Baris judul kolom</Label>
                <Select id="hdr" value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
                  {data.rows.slice(0, 15).map((r, i) => <option key={i} value={i}>Baris {data.lines[i]}: {r.filter(Boolean).slice(0, 4).join(" | ")}</option>)}
                </Select></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {FIELDS.map((f) => (
                <div key={f}><Label htmlFor={f}>{FIELD_LABELS[f]}</Label>
                  <Select id={f} value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                    <option value="">— tidak dipakai —</option>
                    {(data.rows[headerRow] ?? []).map((h, i) => h !== null && <option key={i} value={i}>{XLSX.utils.encode_col(i)}: {String(h)}</option>)}
                  </Select></div>
              ))}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Pratinjau 5 baris pertama</p>
              <Table><thead><tr>{FIELDS.filter((f) => mapping[f] !== undefined).map((f) => <Th key={f}>{FIELD_LABELS[f]}</Th>)}</tr></thead>
                <tbody>{data.rows.slice(headerRow + 1, headerRow + 6).map((r, i) => (
                  <tr key={i}>{FIELDS.filter((f) => mapping[f] !== undefined).map((f) => { const v = r[mapping[f]!]; return <Td key={f}>{v instanceof Date ? v.toLocaleDateString("id-ID") : String(v ?? "")}</Td>; })}</tr>
                ))}</tbody></Table>
            </div>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep("upload")}>Ganti file</Button><Button onClick={validate}>Validasi data</Button></div>
          </CardContent>
        </Card>
      )}

      {step === "review" && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {([["ok", "Siap diimpor", "border-ok"], ["warning", "Peringatan (tetap diimpor)", "border-warn"], ["error", "Error (tidak diimpor)", "border-bad"]] as const).map(([k, l, b]) => (
              <button key={k} onClick={() => setFilter(filter === k ? "all" : k)} className={cn("rounded-lg border-l-4 bg-white p-3 text-left", b, filter === k && "ring-2 ring-ckb")}>
                <div className="font-cond text-3xl font-semibold tabular">{fmtNum(counts[k])}</div><div className="text-xs text-steel-500">{l}</div>
              </button>
            ))}
          </div>
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Hasil validasi {filter !== "all" && `· ${filter}`}</CardTitle>
              <Button variant="outline" size="sm" onClick={downloadReport} disabled={counts.warning + counts.error === 0}><Download className="h-4 w-4" />Unduh laporan masalah (.xlsx)</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <thead><tr><Th>Baris</Th><Th>Bin</Th><Th>SKU</Th><Th>Batch</Th><Th className="text-right">Qty</Th><Th>Expired</Th><Th>Masalah</Th></tr></thead>
                <tbody>{shown.map((r) => (
                  <tr key={r.line} className={tone[r.status]}>
                    <Td>{r.line}</Td><Td className="font-semibold">{r.bin_code}</Td><Td>{r.sku}</Td><Td>{r.batch_lot}</Td>
                    <Td className="text-right">{r.quantity ?? "–"}</Td><Td>{r.expiry_date ?? "–"}</Td><Td className="text-xs">{r.messages.join("; ")}</Td>
                  </tr>
                ))}</tbody>
              </Table>
              {rows.length > 500 && <p className="mt-2 text-xs text-steel-500">Menampilkan 500 baris pertama dari filter ini. Laporan unduhan berisi semua baris bermasalah.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3">
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-medium">Cara impor</legend>
                {([
                  ["replace", "Ganti seluruh stok", "Isi database diganti dengan file ini. Stok di sistem yang tidak ada di file dinolkan."],
                  ["update", "Perbarui saja", "Hanya baris yang ada di file yang diubah. Stok lain di sistem tetap."],
                ] as const).map(([k, l, d]) => (
                  <label key={k} className={cn("flex cursor-pointer gap-2 rounded-lg border bg-white p-3 text-sm", mode === k ? "border-ckb ring-2 ring-ckb" : "border-steel-300")}>
                    <input type="radio" name="mode" value={k} checked={mode === k} onChange={() => setMode(k)} className="mt-0.5" />
                    <span><b>{l}</b><br /><span className="text-steel-500">{d}</span></span>
                  </label>
                ))}
              </fieldset>
              <p className="text-xs text-steel-500">Semua perubahan tercatat sebagai mutasi penyesuaian di riwayat.{keptBins > 0 && ` ${fmtNum(keptBins)} bin dengan baris error tidak disentuh.`}</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep("map")}>Ubah pemetaan</Button>
                {mode === "replace" ? (
                  <ConfirmButton variant="danger" disabled={busy || importCount === 0} title="Ganti seluruh stok?"
                    summary={`Stok di database akan disamakan dengan ${fileName}: ${fmtNum(importCount)} baris diimpor, dan semua stok lain yang tidak ada di file dinolkan${keptBins > 0 ? ` (kecuali ${fmtNum(keptBins)} bin dengan baris error)` : ""}.`}
                    confirmLabel="Ganti stok" onConfirm={commit}>
                    <Upload className="h-4 w-4" />{busy ? "Mengimpor…" : `Ganti stok dengan ${fmtNum(importCount)} baris`}
                  </ConfirmButton>
                ) : (
                  <Button onClick={commit} disabled={busy || importCount === 0}><Upload className="h-4 w-4" />{busy ? "Mengimpor…" : `Impor ${fmtNum(importCount)} baris`}</Button>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {step === "done" && (
        <Card><CardContent className="space-y-3">
          <p className="font-cond text-xl font-semibold">Import selesai</p><p className="text-sm">{result}</p>
          {mode === "replace" && (
            <StaleWavesNotice before={new Date().toLocaleDateString("sv-SE")}
              intro="Stok sekarang sama dengan file WMS, yang sudah memuat barang yang diambil. Tugas terbuka wave lama ini tetap menahan stok dan Bin To Bin-nya dihitung sebagai stok masuk, jadi rencana hari ini akan salah sampai wave ini diselesaikan atau dibatalkan." />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadReport}>Unduh laporan masalah</Button>
            <Button onClick={() => { setStep("upload"); setRows([]); setResult(null); }}>Import file lain</Button>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
