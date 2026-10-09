"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { fetchAll } from "@/lib/fetch-all";
import type { WmsDayRow } from "@/lib/wms-day-workbook";


const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/**
 * "Laporan WMS harian" (0055): the WMS sheet's on hand and remain for one
 * date, rebuilt from the movements ledger, to compare with SAP. Sheet WMS per
 * bin (Qty = on hand after inbound/putaway, before picking; Remain Qty = after
 * picking, tomorrow's on hand), sheet SAP per SKU, sheet Catatan with the rule.
 * Built as Excel tables (filters, totals, frozen header) by lib/wms-day-workbook.
 */
export function WmsDayDownload() {
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true); setError(null);
    try {
      const db = createClient();
      const rows = await fetchAll<WmsDayRow>((a, b) => db.rpc("wms_day_report", { p_date: date }).range(a, b) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>);
      const { buildWmsDayWorkbook } = await import("@/lib/wms-day-workbook");
      const buf = await buildWmsDayWorkbook(rows, date).xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = `wms_harian_${date}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-steel-100 bg-white px-4 py-3 lg:px-8">
      <div>
        <Label htmlFor="wms-day">Laporan WMS harian (on hand & remain untuk SAP)</Label>
        <Input id="wms-day" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="w-44" />
      </div>
      <Button variant="outline" onClick={download} disabled={busy || !date}><Download className="h-4 w-4" />{busy ? "Menyiapkan…" : "Unduh Excel"}</Button>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}
