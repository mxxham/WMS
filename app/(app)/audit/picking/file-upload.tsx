"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { withConfig } from "@/lib/allocator/config";
import { loadWorkbookFromBuffer } from "@/lib/allocator/browser/browser-input";
import { loadDispatchRules, loadPickfaceOverrides } from "@/lib/allocator/browser/plan-client";
import { runPipeline } from "@/lib/allocator/pipeline";
import { allocatorLines, K_ONE_SHEET, kOneLines, skuBatches, stagedLines, withBinRemaining, type SheetPickLine } from "@/lib/sheet-picklist";
import { fmtNum } from "@/lib/utils";

type Parsed = {
  file: string; source: "K_ONE" | "ALLOCATOR"; lines: SheetPickLine[];
  /** order lines the file has no stock for, as STAGING lines to add when the cartons are already at staging */
  short: SheetPickLine[];
};

/**
 * The day's picks from the WMS workbook: the K_ONE picklist when it has
 * rows, else the allocator's picklist from the WMS stock and Schedule of the
 * day. Saving replaces the date's lines that were not audited yet.
 */
export function FileUpload({ date, existing }: { date: string; existing: number }) {
  const router = useRouter();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [staged, setStaged] = useState<Set<number>>(new Set());

  async function read(file: File) {
    setBusy(true); setError(null); setDone(null); setParsed(null); setStaged(new Set());
    try {
      const buf = await file.arrayBuffer();
      const book = XLSX.read(buf, { type: "array", cellDates: true });
      const lines = kOneLines(book);
      if (lines.length) return setParsed({ file: file.name, source: "K_ONE", lines, short: [] });

      // K_ONE is empty: plan the picks the way the Alokasi page does, from this file's stock.
      const supabase = createClient();
      const config = withConfig({
        asOf: new Date(`${date}T00:00:00Z`),
        pickfaceOverrides: await loadPickfaceOverrides(supabase),
        ...(await loadDispatchRules(supabase)),
      });
      const wb = loadWorkbookFromBuffer(buf, config);
      if (!wb.demand.length) throw new Error(`Sheet ${K_ONE_SHEET} dan "Schedule of the day" kosong: tidak ada pick untuk diaudit.`);
      const { allocation } = runPipeline(wb.stock, wb.demand, wb.stagedBySku, config, wb.warnings);
      const waveOf = new Map(wb.demand.map((d) => [d.shipmentNumber, d.waveNo]));
      setParsed({ file: file.name, source: "ALLOCATOR", lines: allocatorLines(allocation), short: stagedLines(allocation.shortages, skuBatches(book), waveOf) });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function save() {
    if (!parsed) return;
    setBusy(true); setError(null);
    const { data, error } = await createClient().rpc("load_sheet_pick_lines", {
      p_date: date, p_source: parsed.source, p_file: parsed.file, p_lines: withBinRemaining([...parsed.lines, ...parsed.short.filter((_, i) => staged.has(i))]),
    });
    setBusy(false);
    if (error) return setError(error.message);
    const r = data as { added: number; kept: number; removed: number };
    setDone(`${fmtNum(r.added)} baris dimuat${r.kept ? `, ${fmtNum(r.kept)} baris yang sudah diaudit tetap` : ""}.`);
    setParsed(null); setStaged(new Set());
    router.refresh();
  }

  const shipments = parsed ? new Set(parsed.lines.map((l) => l.shipment_number)).size : 0;
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="wms-file">File WMS (.xlsx) untuk {date}</Label>
            <Input id="wms-file" type="file" accept=".xlsx,.xlsm,.xls" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} />
          </div>
          {parsed && (
            <Button onClick={save} disabled={busy}><Upload className="h-4 w-4" />{busy ? "Menyimpan…" : "Pakai file ini"}</Button>
          )}
        </div>
        {busy && !parsed && <p className="text-sm text-steel-500">Membaca file…</p>}
        {parsed && (
          <p className="flex items-start gap-2 rounded-md bg-plate/30 p-3 text-sm">
            <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {parsed.file}: {fmtNum(parsed.lines.length)} baris pick, {fmtNum(shipments)} shipment,{" "}
              {parsed.source === "K_ONE" ? `dari sheet ${K_ONE_SHEET}.` : `sheet ${K_ONE_SHEET} kosong, jadi dihitung dari stok WMS + Schedule of the day.`}
              {parsed.short.length > 0 && <span className="text-warn"> {fmtNum(parsed.short.length)} baris order tidak cukup stok.</span>}
              {existing > 0 && <span className="block text-steel-500">Baris tanggal ini yang belum diaudit akan diganti; yang sudah diaudit tetap.</span>}
            </span>
          </p>
        )}
        {parsed && parsed.short.length > 0 && (
          <div className="space-y-2 rounded-md border border-warn/40 p-3 text-sm">
            <p>Tidak ada stok di file untuk baris ini. Kalau barangnya sudah ada di staging, centang supaya ikut diaudit dari STAGING
              (batch dan expired diambil dari sheet WMS).</p>
            {parsed.short.map((l, i) => (
              <label key={`${l.shipment_number}|${l.sku}`} className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={staged.has(i)}
                  onChange={(e) => setStaged((prev) => { const next = new Set(prev); if (e.target.checked) next.add(i); else next.delete(i); return next; })} />
                <span>SH {l.shipment_number} · <span className="font-semibold">{l.sku}</span> {l.description} · {fmtNum(l.qty)}
                  <span className="text-steel-500"> · batch {l.batch || "tidak diketahui"}{l.expiry ? ` · exp ${l.expiry}` : ""}</span></span>
              </label>
            ))}
          </div>
        )}
        {done && <p role="status" className="rounded-md bg-ok/10 p-2 text-sm text-ok">{done}</p>}
        {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}
