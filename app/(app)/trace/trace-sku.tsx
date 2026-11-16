"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ClipboardCopy, Download, FileUp, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpiryBadge } from "@/components/ui/badge";
import { Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { expiryStatus } from "@/config/warehouse";
import { fetchAll } from "@/lib/fetch-all";
import { parsePolicy } from "@/lib/inventory-control";
import { jakartaDate } from "@/lib/inventory-view";
import { createClient } from "@/lib/supabase/client";
import {
  MFG_SOURCE_LABEL, binText, buildSkuReport, parseSkuRequest, skuReplyTsv, skuReportSheets, skuReportTotals,
  type SkuItem, type SkuReportRow, type SkuStock,
} from "@/lib/trace-sku";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import { traceHref } from "./trace-client";

const MAX_SKUS = 500;
const signed = (v: number) => `${v > 0 ? "+" : ""}${fmtNum(v)}`;

/**
 * Daftar batch per SKU: paste a request (an e-mail table, rows from Excel, or
 * a plain list of material numbers) or upload it as a file, and get every batch
 * on hand of each material with production date, expiry date and quantity,
 * compared with the stock the request quoted. Reads only; nothing is posted.
 */
export function SkuBatchReport() {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<SkuReportRow[] | null>(null);
  const [asOf, setAsOf] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const requests = useMemo(() => parseSkuRequest(text), [text]);
  const quoted = requests.filter((r) => r.sap !== null).length;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      let content: string;
      if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
        // Loaded on use: the Excel library (~140 kB) is not part of the page.
        const XLSX = await import("xlsx");
        const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
        // Raw values: a material number or a stock figure must not arrive as "5.5E+08" or "3,474.00".
        content = book.SheetNames.map((n) => XLSX.utils.sheet_to_csv(book.Sheets[n], { FS: "\t", rawNumbers: true })).join("\n");
      } else {
        content = await file.text();
      }
      if (parseSkuRequest(content).length === 0) { setError(`Tidak ada nomor material (9 angka) di ${file.name}.`); return; }
      setText(content); setFileName(file.name); setRows(null);
    } catch (err) { setError(`File tidak bisa dibaca: ${(err as Error).message}`); }
  }

  async function run() {
    if (requests.length === 0) return;
    if (requests.length > MAX_SKUS) { setError(`Terlalu banyak material (${fmtNum(requests.length)}). Paling banyak ${MAX_SKUS} sekali cek.`); return; }
    setBusy(true); setError(null);
    try {
      const db = createClient();
      const skus = requests.map((r) => r.sku);
      // .in() goes into the URL: ask in groups so a long list stays within its length.
      const groups: string[][] = [];
      for (let i = 0; i < skus.length; i += 100) groups.push(skus.slice(i, i + 100));
      const [stock, items, policyRes] = await Promise.all([
        Promise.all(groups.map((g) => fetchAll<SkuStock>((a, b) => db.from("inventory_detail")
          .select("bin_code, zone, sku, description, uom, batch_lot, quantity, expiry_date, days_remaining, held")
          .in("sku", g).gt("quantity", 0).order("id").range(a, b)))).then((x) => x.flat()),
        Promise.all(groups.map((g) => fetchAll<SkuItem>((a, b) => db.from("items")
          .select("sku, description, uom, shelf_life_months").in("sku", g).order("sku").range(a, b)))).then((x) => x.flat()),
        db.rpc("inventory_policy"),
      ]);
      setRows(buildSkuReport(requests, stock, items, parsePolicy(policyRes.data).default_shelf_life_months));
      setAsOf(new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }));
    } catch (err) { setError(`Stok tidak bisa dibaca: ${(err as Error).message}`); }
    finally { setBusy(false); }
  }

  async function excel() {
    if (!rows) return;
    const { saveSheets } = await import("@/lib/save-xlsx");
    saveSheets(skuReportSheets(rows), `batch-per-material_${jakartaDate()}.xlsx`, "Tidak ada data");
  }
  async function copy() {
    if (!rows) return;
    try { await navigator.clipboard.writeText(skuReplyTsv(rows)); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setError("Tidak bisa menyalin ke clipboard di perangkat ini. Pakai Unduh Excel."); }
  }

  const totals = rows ? skuReportTotals(rows) : null;
  const shown = rows ? (onlyDiff ? rows.filter((r) => r.diff !== null && r.diff !== 0) : rows) : [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-steel-100 bg-white p-4">
        <Label htmlFor="sku-req">Tempel permintaan (isi e-mail, baris dari Excel, atau daftar nomor material)</Label>
        <textarea id="sku-req" value={text} onChange={(e) => { setText(e.target.value); setFileName(null); setRows(null); }}
          rows={7} spellCheck={false} placeholder={"550058593\tAdv4TAX515W40SLMA2_12*0.8L_A04W\tAdvance\t3,474\n550058592\tAdv4TAX515W40SLMA2_12*1L_A04W\tAdvance\t3,595\n…"}
          className="block w-full rounded-md border border-steel-300 bg-white px-3 py-2 font-mono text-xs placeholder:text-steel-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => void run()} disabled={busy || requests.length === 0}>
            <ListChecks className="h-4 w-4" />{busy ? "Membaca stok…" : "Buat daftar batch"}
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt" className="hidden" onChange={(e) => void onFile(e)} />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" />Unggah file</Button>
          {text && <Button type="button" variant="ghost" onClick={() => { setText(""); setRows(null); setFileName(null); setError(null); }}>Kosongkan</Button>}
          <span className="text-sm text-steel-500" aria-live="polite">
            {requests.length === 0
              ? (text.trim() ? "Belum ada nomor material (9 angka) yang terbaca." : "Tidak perlu membuat file: tempel saja isi e-mailnya.")
              : <>Terbaca <b className="text-steel">{fmtNum(requests.length)} material</b>{quoted > 0 ? `, ${fmtNum(quoted)} dengan angka stok` : ", tanpa angka stok"}{fileName ? ` dari ${fileName}` : ""}.</>}
          </span>
        </div>
        <p className="mt-2 text-xs text-steel-500">Yang dibaca: nomor material 9 angka, nama produk di sebelahnya, dan angka stok pertama sesudahnya (mis. kolom Stock I003). Baris lain diabaikan.</p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-bad/40 bg-bad/5 p-3 text-sm text-bad">{error}</p>}

      {rows && totals && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Material diminta" value={fmtNum(totals.skus)} sub={totals.unknown ? `${fmtNum(totals.unknown)} tidak ada di master item` : "semua dikenal"} tone={totals.unknown ? "warn" : undefined} />
            <Tile label="Ada stok" value={fmtNum(totals.withStock)} sub={`${fmtNum(totals.skus - totals.withStock)} tanpa stok`} />
            <Tile label="Batch" value={fmtNum(totals.batches)} sub="batch + tanggal expired" />
            <Tile label="Stok WMS" value={fmtNum(totals.wms)} sub={`per ${asOf}`} />
            <Tile label="Stok di permintaan" value={totals.sap === null ? "–" : fmtNum(totals.sap)} sub={totals.sap === null ? "permintaan tanpa angka stok" : "jumlah yang dikutip"} />
            <Tile label="Selisih (WMS − permintaan)" value={totals.diff === null ? "–" : signed(totals.diff)}
              sub={totals.diff === null ? "tidak dibandingkan" : totals.differing ? `${fmtNum(totals.differing)} material berbeda` : "semua cocok"}
              tone={totals.differing ? "warn" : undefined} />
          </div>

          <div className="rounded-lg border border-steel-100 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="font-cond text-lg font-semibold">Batch, tanggal produksi dan expired per material</h2>
              {totals.sap !== null && (
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />Hanya yang berbeda dari permintaan</label>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void copy()}>{copied ? <Check className="h-4 w-4 text-ok" /> : <ClipboardCopy className="h-4 w-4" />}{copied ? "Tersalin" : "Salin tabel"}</Button>
                <Button variant="accent" onClick={() => void excel()}><Download className="h-4 w-4" />Unduh Excel</Button>
              </div>
            </div>

            {shown.length === 0 ? <p className="text-sm text-steel-500">Tidak ada material yang berbeda dari permintaan.</p> : (
              <>
                <div className="space-y-3 md:hidden">
                  {shown.map((r) => (
                    <div key={r.sku} className="rounded-lg border border-steel-100">
                      <div className="border-b border-steel-100 bg-paper p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div><div className="font-semibold">{r.sku}</div><div className="text-xs text-steel-500">{r.name ?? r.description ?? "–"}</div></div>
                          <div className="text-right"><div className="font-cond text-xl font-semibold tabular">{fmtNum(r.wms)}</div><Diff r={r} /></div>
                        </div>
                      </div>
                      {r.batches.length === 0
                        ? <p className="p-3 text-sm text-steel-500">{r.known ? "Tidak ada stok di gudang." : "Material tidak ada di master item."}</p>
                        : r.batches.map((b) => (
                          <div key={`${b.batch}|${b.expiry}`} className="border-b border-steel-100 p-3 text-sm last:border-b-0">
                            <div className="flex items-start justify-between gap-2">
                              {b.batch ? <Link className="font-mono font-semibold text-ckb underline" href={traceHref(b.batch, r.sku)}>{b.batch}</Link> : <span className="text-steel-500">(tanpa batch)</span>}
                              <span className="font-semibold tabular">{fmtNum(b.qty)} <span className="text-xs font-normal text-steel-500">{r.uom}</span></span>
                            </div>
                            <div className="mt-1 text-xs">Produksi <b>{b.mfg ? fmtDate(b.mfg) : "–"}</b>{b.mfgSource === "shelf_life" && <span className="text-steel-500"> (perkiraan)</span>}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">Expired <b>{b.expiry ? fmtDate(b.expiry) : "–"}</b><ExpiryBadge status={expiryStatus(b.expiry)} /></div>
                            {b.note && <div className="mt-1 text-xs text-bad">{b.note}</div>}
                            <div className="mt-1 font-mono text-[11px] text-steel-500">{binText(b)}</div>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>

                <div className="hidden md:block">
                  <Table sticky>
                    <thead><tr>
                      <Th>Material</Th><Th>Product</Th><Th>Batch number</Th><Th>Production date</Th><Th>Expired date</Th><Th className="text-right">Qty</Th>
                      <Th className="text-right">Stok WMS</Th><Th className="text-right">Permintaan</Th><Th className="text-right">Selisih</Th><Th>Bin</Th>
                    </tr></thead>
                    <tbody>{shown.map((r) => {
                      const span = Math.max(r.batches.length, 1);
                      const lead = (
                        <>
                          <Td rowSpan={span} className="font-semibold">{r.sku}</Td>
                          <Td rowSpan={span} className="max-w-56 text-xs">{r.name ?? r.description ?? "–"}{r.name && r.description && r.description !== r.name && <span className="block text-steel-500">{r.description}</span>}</Td>
                        </>
                      );
                      const tail = (
                        <>
                          <Td rowSpan={span} className="text-right font-semibold tabular">{fmtNum(r.wms)} <span className="text-xs font-normal text-steel-500">{r.uom}</span></Td>
                          <Td rowSpan={span} className="text-right tabular">{r.sap === null ? "–" : fmtNum(r.sap)}</Td>
                          <Td rowSpan={span} className="text-right"><Diff r={r} /></Td>
                        </>
                      );
                      if (r.batches.length === 0) {
                        return (
                          <tr key={r.sku} className="border-t-2 border-steel-100">
                            {lead}
                            <Td colSpan={4} className={cn("text-sm", r.known ? "text-steel-500" : "text-bad")}>{r.known ? "Tidak ada stok di gudang" : "Material tidak ada di master item"}</Td>
                            {tail}<Td />
                          </tr>
                        );
                      }
                      return r.batches.map((b, i) => (
                        <tr key={`${r.sku}|${b.batch}|${b.expiry}`} className={cn("hover:bg-paper", i === 0 && "border-t-2 border-steel-100")}>
                          {i === 0 && lead}
                          <Td>{b.batch ? <Link className="font-mono font-semibold text-ckb underline" href={traceHref(b.batch, r.sku)} title="Lacak batch ini">{b.batch}</Link> : <span className="text-steel-500">(tanpa batch)</span>}</Td>
                          <Td className="whitespace-nowrap text-xs">{b.mfg ? fmtDate(b.mfg) : "–"}{b.mfgSource === "shelf_life" && <span className="block text-steel-500">perkiraan: {MFG_SOURCE_LABEL.shelf_life}</span>}</Td>
                          <Td className="whitespace-nowrap text-xs"><span className="font-semibold">{b.expiry ? fmtDate(b.expiry) : "–"}</span> <ExpiryBadge status={expiryStatus(b.expiry)} />
                            {b.note && <span className="block whitespace-normal text-bad">{b.note}</span>}</Td>
                          <Td className="text-right tabular">{fmtNum(b.qty)}{b.held > 0 && <span className="block text-[11px] text-warn">{fmtNum(b.held)} ditahan</span>}</Td>
                          {i === 0 && tail}
                          <Td className="max-w-64 font-mono text-[11px] text-steel-500">{binText(b)}</Td>
                        </tr>
                      ));
                    })}</tbody>
                  </Table>
                </div>
              </>
            )}
            <p className="mt-3 text-xs text-steel-500">
              Tanggal produksi dibaca dari kode batch Shell (mis. 14H26JJ = 14 Agu 2026). Batch tanpa kode tanggal (nomor lot SAP) memakai perkiraan: expired dikurangi umur simpan item.
              Stok WMS mencakup semua lokasi (rak, staging, karantina). Excel berisi tiga sheet: balasan per batch, ringkasan per material, dan rincian per bin.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Diff({ r }: { r: SkuReportRow }) {
  if (r.diff === null) return <span className="text-steel-500">–</span>;
  if (r.diff === 0) return <span className="text-xs font-semibold text-ok">cocok</span>;
  return <span className="font-semibold tabular text-bad">{signed(r.diff)}</span>;
}
function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "warn" }) {
  return (
    <div className={cn("rounded-lg border bg-white p-3", tone === "warn" ? "border-warn/60" : "border-steel-100")}>
      <div className="text-xs text-steel-500">{label}</div>
      <div className="mt-1 font-cond text-2xl font-semibold tabular">{value}</div>
      <div className="mt-0.5 text-xs text-steel-500">{sub}</div>
    </div>
  );
}
