"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, GitCompareArrows } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAll } from "@/lib/fetch-all";
import { binsWithErrors, type ImportRow } from "@/lib/import-validate";
import { compareWms, type CompareKind, type CompareResult } from "@/lib/wms-compare";
import { cn, fmtNum } from "@/lib/utils";

const KIND: Record<CompareKind, { label: string; help: string; dot: string }> = {
  qty: { label: "Jumlah beda", help: "Hitung bin ini: salah satu catatan keliru.", dot: "bg-bad" },
  only_system: { label: "Hanya di sistem", help: "Sistem masih mencatat stok yang tidak ada di file (mis. palet sudah kosong di lantai).", dot: "bg-bad" },
  only_file: { label: "Hanya di file", help: "File mencatat stok yang tidak ada di sistem.", dot: "bg-bad" },
  moved: { label: "Pindah bin", help: "Total SKU sama, kartonnya di bin lain: Bin To Bin di lantai ke bin lain dari yang diposting. Betulkan dengan Mutasi.", dot: "bg-warn" },
  batch: { label: "Nama batch / exp beda", help: "Jumlah sama, nama batch atau expired lain. Sheet WMS menyimpan satu batch per bin; cek label karton.", dot: "bg-plate-dark" },
  same: { label: "Sama", help: "", dot: "bg-ok" },
};

/**
 * Bandingkan dengan WMS: the validated file against the system's stock now,
 * nothing imported. The way to run the system next to the WMS sheet until
 * the two agree every morning, then without it.
 */
export function ComparePanel({ rows, fileName }: { rows: ImportRow[]; fileName: string }) {
  const [res, setRes] = useState<CompareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<CompareKind | "diff">("diff");

  async function run() {
    setBusy(true); setError(null);
    try {
      const db = createClient();
      const stock = await fetchAll<{ bin_code: string; sku: string; description: string | null; batch_lot: string; expiry_date: string | null; quantity: number }>((a, b) =>
        db.from("inventory_detail").select("bin_code, sku, description, batch_lot, expiry_date, quantity").order("bin_code").order("sku").order("id").range(a, b));
      const file = rows.filter((r) => r.status !== "error" && r.sku && r.quantity !== null)
        .map((r) => ({ bin: r.bin_code, sku: r.sku, batch: r.batch_lot, expiry: r.expiry_date, qty: Number(r.quantity), description: r.description }));
      setRes(compareWms(file, stock.map((s) => ({ bin: s.bin_code, sku: s.sku, batch: s.batch_lot, expiry: s.expiry_date, qty: Number(s.quantity), description: s.description })),
        binsWithErrors(rows)));
      setShow("diff");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const diffs = useMemo(() => (res?.lines ?? []).filter((l) => (show === "diff" ? l.kind !== "same" : l.kind === show)), [res, show]);

  async function download() {
    if (!res) return;
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(res.lines.filter((l) => l.kind !== "same").map((l) => ({
      Bin: l.bin, SKU: l.sku, Barang: l.description, Jenis: KIND[l.kind].label, "File WMS": l.file, Sistem: l.system, Selisih: l.system - l.file,
      "Batch di file": l.fileBatches, "Batch di sistem": l.systemBatches, Catatan: l.rejected ? "baris file ini error, bin tidak dinilai" : KIND[l.kind].help,
    }))), "Selisih");
    XLSX.writeFile(book, `bandingkan_wms_${fileName.replace(/\.\w+$/, "")}.xlsx`);
  }

  const totalDiff = res ? res.lines.length - res.counts.same : 0;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2"><GitCompareArrows className="h-5 w-5" />Bandingkan dengan sistem</CardTitle>
          <p className="max-w-3xl text-sm text-steel-500">
            File ini dibandingkan dengan stok sistem sekarang, per bin dan SKU. Tidak ada yang diubah. Pakai setiap pagi sebelum Alokasi: setelah beberapa hari
            berturut-turut tanpa selisih, sistem bisa berjalan tanpa impor file WMS.
          </p>
        </div>
        <div className="flex gap-2">
          {res && totalDiff > 0 && <Button variant="outline" size="sm" onClick={() => void download()}><Download className="h-4 w-4" />Unduh selisih</Button>}
          <Button size="sm" onClick={() => void run()} disabled={busy}>{busy ? "Membandingkan…" : res ? "Bandingkan lagi" : "Bandingkan saja"}</Button>
        </div>
      </CardHeader>
      {error && <CardContent><p role="alert" className="text-sm text-bad">{error}</p></CardContent>}
      {res && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-md bg-paper px-3 py-2 text-sm">
            <span>File <b className="font-cond text-lg tabular">{fmtNum(res.fileTotal)}</b></span>
            <span>Sistem <b className="font-cond text-lg tabular">{fmtNum(res.systemTotal)}</b></span>
            <span>Selisih <b className={cn("font-cond text-lg tabular", res.systemTotal !== res.fileTotal && "text-bad")}>{res.systemTotal - res.fileTotal > 0 ? "+" : ""}{fmtNum(res.systemTotal - res.fileTotal)}</b> karton</span>
            <span className="text-steel-500">{fmtNum(res.counts.same)} dari {fmtNum(res.lines.length)} bin·SKU sama</span>
          </div>
          {totalDiff === 0 ? (
            <p className="rounded-md bg-ok/10 p-3 text-base font-semibold text-ok">Sama persis: stok sistem sama dengan file WMS di setiap bin.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setShow("diff")}
                  className={cn("rounded-md border px-3 py-1.5 text-sm", show === "diff" ? "border-ckb bg-ckb-tint" : "border-steel-100 bg-white hover:bg-steel-100")}>
                  Semua selisih <b className="tabular">{fmtNum(totalDiff)}</b></button>
                {(["qty", "only_system", "only_file", "moved", "batch"] as const).filter((k) => res.counts[k] > 0).map((k) => (
                  <button key={k} type="button" onClick={() => setShow(k)} title={KIND[k].help}
                    className={cn("inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm", show === k ? "border-ckb bg-ckb-tint" : "border-steel-100 bg-white hover:bg-steel-100")}>
                    <span className={cn("h-2.5 w-2.5 rounded-full", KIND[k].dot)} />{KIND[k].label} <b className="tabular">{fmtNum(res.counts[k])}</b></button>
                ))}
              </div>
              {show !== "diff" && <p className="text-sm text-steel-500">{KIND[show].help}</p>}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-sm">
                  <thead className="text-left text-xs text-steel-500">
                    <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
                      <th>Bin</th><th>SKU</th><th>Jenis</th><th className="text-right">File</th><th className="text-right">Sistem</th><th className="text-right">Selisih</th><th>Batch file → sistem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.slice(0, 500).map((l) => (
                      <tr key={`${l.bin}|${l.sku}`} className="border-t border-steel-100 align-top [&>td]:px-2 [&>td]:py-2">
                        <td><Link href={`/bin/${encodeURIComponent(l.bin)}`} className="rounded-plate border border-plate-dark/40 bg-plate/25 px-2 py-0.5 font-cond font-semibold hover:bg-plate/50">{l.bin}</Link></td>
                        <td><div className="font-cond font-semibold tabular">{l.sku}</div><div className="max-w-[14rem] truncate text-xs text-steel-500" title={l.description}>{l.description}</div></td>
                        <td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={cn("h-2 w-2 rounded-full", KIND[l.kind].dot)} />{KIND[l.kind].label}</span>
                          {l.rejected && <div className="text-xs text-warn">baris file error</div>}</td>
                        <td className="text-right font-cond text-base tabular">{fmtNum(l.file)}</td>
                        <td className="text-right font-cond text-base tabular">{fmtNum(l.system)}</td>
                        <td className={cn("text-right font-cond text-base font-semibold tabular", l.system !== l.file && "text-bad")}>{l.system - l.file > 0 ? "+" : ""}{fmtNum(l.system - l.file)}</td>
                        <td className="text-xs text-steel-500">{l.fileBatches || "–"}<br />→ {l.systemBatches || "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {diffs.length > 500 && <p className="mt-2 text-xs text-steel-500">Menampilkan 500 dari {fmtNum(diffs.length)}. Unduh selisih untuk semuanya.</p>}
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
