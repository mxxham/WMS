"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { auditWorkbookRows, type ExportAttempt, type ExportLine } from "@/lib/sheet-audit-export";
import { saveSheets } from "@/lib/save-xlsx";

type LineRow = {
  task_id: string; shipment_number: string; wave_no: string; seq: number; from_bin: string; zone: string; sku: string;
  description: string; uom: string | null; batch_lot: string; expiry_date: string | null; picked_qty: number; line_state: ExportLine["line_state"];
};

/** Downloads the day's picking audit of the system's pick tasks (one rack, or all) as .xlsx, as it stands now. */
export function DownloadPickAudit({ date, zone }: { date: string; zone?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true); setError(null);
    try {
      const db = createClient();
      let q = db.from("pick_audit_line")
        .select("task_id, shipment_number, wave_no, seq, from_bin, zone, sku, description, uom, batch_lot, expiry_date, picked_qty, line_state")
        .eq("planned_date", date).neq("wave_status", "CANCELLED");
      if (zone) q = q.eq("zone", zone);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as LineRow[];
      if (!rows.length) throw new Error("Belum ada baris untuk diunduh.");
      const attempts: ExportAttempt[] = [];
      const ids = rows.map((l) => l.task_id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data: a, error: e } = await db.from("pick_audits")
          .select("task_id, attempt_no, checker_name, method, result, errors, counted_qty, found_sku, found_batch, rack_system, rack_counted, note, correction, created_at")
          .in("task_id", ids.slice(i, i + 200));
        if (e) throw e;
        attempts.push(...((a ?? []) as (Omit<ExportAttempt, "line_id"> & { task_id: string })[]).map((x) => ({ ...x, line_id: x.task_id })));
      }
      const lines: ExportLine[] = rows.map((l) => ({
        id: l.task_id, shipment_number: l.shipment_number, wave_no: l.wave_no, picklist: null, seq: l.seq, bin_code: l.from_bin,
        sku: l.sku, description: l.description, uom: l.uom, batch: l.batch_lot, expiry: l.expiry_date, qty: Number(l.picked_qty),
        bin_remaining: null, line_state: l.line_state,
      }));
      const out = auditWorkbookRows(lines, attempts, "Sisa sistem");
      saveSheets({ "Per bin": out.bins, "Per baris": out.lines, Riwayat: out.history },
        `Audit picking ${date}${zone ? ` rak ${zone}` : ""}.xlsx`, "belum ada audit");
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
