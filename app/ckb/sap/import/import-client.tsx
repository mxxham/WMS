"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Th, Td } from "@/components/ui/table";
import { Notice } from "@/components/ckb/ui";
import { SAP_FIELD_LABEL, type SapField, type SnapshotRow } from "@/lib/ckb/sap-import";
import { fmtNum } from "@/lib/utils";

type Preview = {
  name: string; size: number; sha256: string; sheet: string | null; sheets: string[]; headerLine: number | null;
  columns: Partial<Record<SapField, { index: number; header: string }>>; fileErrors: string[]; rowCount: number; totalQty: number;
  duplicateIdentities: number; errorCount: number; errors: { line: number; message: string }[]; sample: SnapshotRow[];
  duplicateOf: { ref_no: string; imported_at: string } | null; mappingVerified: boolean;
};

const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** Upload → preview (nothing written) → confirm import. The server parses the file both times. */
export function ImportClient({ customers }: { customers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [customer, setCustomer] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const form = () => {
    const fd = new FormData();
    if (file) fd.set("file", file);
    fd.set("customer", customer); fd.set("snapshot_date", date); fd.set("note", note);
    if (preview?.sheet) fd.set("sheet", preview.sheet);
    return fd;
  };
  async function post(url: string) {
    const res = await fetch(url, { method: "POST", body: form() });
    const body = await res.json().catch(() => ({ error: "Jawaban server tidak terbaca." }));
    return res.ok ? [body, null] as const : [null, String(body.error ?? "Gagal.")] as const;
  }
  async function runPreview() {
    if (!file || !customer) { setError("Pilih customer dan file."); return; }
    setBusy("preview"); setError(null); setDone(null); setPreview(null);
    const [body, err] = await post("/api/ckb/sap/preview");
    setBusy(null);
    if (err) setError(err); else setPreview(body as Preview);
  }
  async function runImport() {
    setBusy("import"); setError(null);
    const [body, err] = await post("/api/ckb/sap/import");
    setBusy(null);
    if (err) { setError(err); return; }
    const b = body as { id: string; rows: number; rejected: number };
    setDone(`Snapshot dibuat: ${fmtNum(b.rows)} baris${b.rejected ? `, ${fmtNum(b.rejected)} baris ditolak (tercatat)` : ""}. Aktifkan di halaman snapshot bila sudah benar.`);
    setPreview(null); setFile(null);
    router.push(`/ckb/sap/import/${b.id}`);
  }

  const canImport = preview && preview.fileErrors.length === 0 && preview.rowCount > 0 && !preview.duplicateOf;
  return (
    <Card>
      <CardHeader><CardTitle>Unggah snapshot</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label htmlFor="imp-c">Customer</Label>
            <Select id="imp-c" value={customer} onChange={(e) => { setCustomer(e.target.value); setPreview(null); }}>
              <option value="">Pilih customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="imp-d">Tanggal stok SAP</Label><Input id="imp-d" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label htmlFor="imp-f">File (.xlsx, .xls, .csv, maks 4,4 MB)</Label>
            <Input id="imp-f" type="file" accept=".xlsx,.xls,.csv" className="pt-2" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setDone(null); }} />
          </div>
          <div className="sm:col-span-2 lg:col-span-4"><Label htmlFor="imp-n">Catatan (opsional)</Label><Input id="imp-n" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. MB52 per 24 Okt, dari Pak Budi" /></div>
        </div>
        <Button onClick={runPreview} disabled={!file || !customer || busy !== null}><Upload className="h-4 w-4" />{busy === "preview" ? "Membaca…" : "Pratinjau"}</Button>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {done && <p role="status" className="text-sm text-ok">{done}</p>}

        {preview && (
          <div className="space-y-3 border-t border-steel-100 pt-4">
            <p className="text-sm">
              <span className="font-medium">{preview.name}</span> · sheet {preview.sheet ?? "–"}{preview.headerLine ? ` · judul di baris ${preview.headerLine}` : ""} ·
              <span className="font-mono text-xs"> sha256 {preview.sha256.slice(0, 12)}…</span>
            </p>
            {preview.duplicateOf && <Notice tone="bad">File yang sama persis sudah diimpor untuk customer ini sebagai {preview.duplicateOf.ref_no}. Snapshot tidak dibuat dua kali.</Notice>}
            {preview.fileErrors.map((e) => <Notice key={e} tone="bad">{e}</Notice>)}
            {!preview.mappingVerified && <Notice tone="warn">Pemetaan kolom belum diverifikasi: cocokkan contoh baris di bawah dengan file aslinya sebelum mengimpor.</Notice>}
            {Object.keys(preview.columns).length > 0 && (
              <p className="text-sm text-steel-500">Kolom dibaca: {Object.entries(preview.columns).map(([f, c]) => `${SAP_FIELD_LABEL[f as SapField]} ← "${c!.header}"`).join(" · ")}</p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md bg-paper p-3"><div className="text-xs text-steel-500">Baris valid</div><div className="font-cond text-2xl font-semibold">{fmtNum(preview.rowCount)}</div></div>
              <div className="rounded-md bg-paper p-3"><div className="text-xs text-steel-500">Baris ditolak</div><div className={`font-cond text-2xl font-semibold ${preview.errorCount ? "text-bad" : ""}`}>{fmtNum(preview.errorCount)}</div></div>
              <div className="rounded-md bg-paper p-3"><div className="text-xs text-steel-500">Total qty</div><div className="font-cond text-2xl font-semibold">{fmtNum(preview.totalQty, 3)}</div></div>
              <div className="rounded-md bg-paper p-3"><div className="text-xs text-steel-500">Identitas ganda</div><div className={`font-cond text-2xl font-semibold ${preview.duplicateIdentities ? "text-warn" : ""}`}>{preview.duplicateIdentities}</div></div>
            </div>
            {preview.duplicateIdentities > 0 && <p className="text-sm text-steel-500">Baris dengan identitas sama (material, bin, batch, expiry, satuan) disimpan apa adanya dan ditandai &quot;identitas ganda&quot; saat stock take; tidak dijumlahkan diam-diam.</p>}
            {preview.errors.length > 0 && (
              <details className="rounded-md border border-bad/30 p-3" open={preview.rowCount === 0}>
                <summary className="cursor-pointer text-sm font-medium text-bad">{preview.errorCount} baris ditolak — tidak diimpor</summary>
                <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto text-sm">
                  {preview.errors.map((e) => <li key={e.line}><span className="font-mono">Baris {e.line}</span>: {e.message}</li>)}
                  {preview.errorCount > preview.errors.length && <li className="text-steel-500">…dan {preview.errorCount - preview.errors.length} lagi</li>}
                </ul>
              </details>
            )}
            {preview.sample.length > 0 && (
              <div className="rounded-lg border border-steel-100">
                <Table>
                  <thead><tr><Th>Baris</Th><Th>Material</Th><Th>Deskripsi</Th><Th>Plant/SLoc</Th><Th>Bin</Th><Th>Batch</Th><Th>Expired</Th><Th>Satuan</Th><Th className="text-right">Qty</Th></tr></thead>
                  <tbody>
                    {preview.sample.map((r) => (
                      <tr key={r.line}><Td>{r.line}</Td><Td>{r.material_code}</Td><Td className="max-w-[12rem] truncate">{r.description}</Td><Td>{r.plant}/{r.storage_location}</Td>
                        <Td>{r.storage_bin || "–"}</Td><Td>{r.batch || "–"}</Td><Td>{r.expiry_date ?? "–"}</Td><Td>{r.uom}</Td><Td className="text-right">{fmtNum(r.quantity, 3)}</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
            <Button onClick={runImport} disabled={!canImport || busy !== null}>
              {busy === "import" ? "Mengimpor…" : `Impor ${fmtNum(preview.rowCount)} baris sebagai snapshot ${date}`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
