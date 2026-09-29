"use client";
import { useState } from "react";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { auditWorkbookRows, type ExportAttempt, type ExportLine } from "@/lib/sheet-audit-export";
import { sheetZone } from "./data";

/** Downloads the day's WMS-file picking audit (one rack, or all) as .xlsx, as it stands now. */
export function DownloadAudit({ date, zone }: { date: string; zone?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true); setError(null);
    try {
      const db = createClient();
      const { data, error } = await db.from("sheet_pick_line_state")
        .select("id, shipment_number, wave_no, picklist, seq, bin_code, sku, description, uom, batch, expiry, qty, bin_remaining, line_state")
        .eq("pick_date", date);
      if (error) throw error;
      const lines = ((data ?? []) as ExportLine[]).filter((l) => !zone || sheetZone(l.bin_code) === zone);
      if (!lines.length) throw new Error("Belum ada baris untuk diunduh.");
      const attempts: ExportAttempt[] = [];
      const ids = lines.map((l) => l.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data: a, error: e } = await db.from("sheet_pick_audits")
          .select("line_id, attempt_no, checker_name, method, result, errors, counted_qty, found_sku, found_batch, rack_system, rack_counted, note, correction, created_at")
          .in("line_id", ids.slice(i, i + 200));
        if (e) throw e;
        attempts.push(...((a ?? []) as ExportAttempt[]));
      }
      const rows = auditWorkbookRows(lines, attempts);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.bins), "Per bin");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.lines), "Per baris");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.history.length ? rows.history : [{ Waktu: "belum ada audit" }]), "Riwayat");
      XLSX.writeFile(wb, `Audit picking file WMS ${date}${zone ? ` rak ${zone}` : ""}.xlsx`);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button variant="outline" onClick={download} disabled={busy}>
        <Download className="h-4 w-4" />{busy ? "Menyiapkan…" : zone ? `Download Excel rak ${zone}` : "Download Excel semua rak"}
      </Button>
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </div>
  );
}
