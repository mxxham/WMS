"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { auditWorkbookRows, moveRows, type ExportAttempt, type ExportLine } from "@/lib/sheet-audit-export";
import { saveSheets } from "@/lib/save-xlsx";

type LineRow = {
  task_id: string; shipment_number: string; wave_no: string; seq: number; from_bin: string; zone: string; sku: string;
  description: string; uom: string | null; batch_lot: string; expiry_date: string | null; picked_qty: number; line_state: ExportLine["line_state"];
};

type MoveLineRow = {
  task_id: string; wave_no: string; seq: number;
  from_bin: string; zone: string | null; to_bin: string; to_zone: string | null;
  sku: string; description: string; uom: string | null;
  batch_lot: string; expiry_date: string | null;
  planned_qty: number; moved_qty: number; line_state: "TODO" | "OK" | "MISMATCH" | "RESOLVED" | "AUTO_PASS";
};

/** Downloads the day's picking audit (system pick tasks + move tasks) as .xlsx. */
export function DownloadPickAudit({ date, zone }: { date: string; zone?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true); setError(null);
    try {
      const db = createClient();

      // ---- Pick audit (existing) ----
      let pickQ = db.from("pick_audit_line")
        .select("task_id, shipment_number, wave_no, seq, from_bin, zone, sku, description, uom, batch_lot, expiry_date, picked_qty, line_state")
        .eq("planned_date", date).neq("wave_status", "CANCELLED");
      if (zone) pickQ = pickQ.eq("zone", zone);
      const { data: pickData, error: pickError } = await pickQ;
      if (pickError) throw pickError;
      const pickRows = (pickData ?? []) as LineRow[];

      // ---- Move audit (new) ----
      let moveQ = db.from("pick_audit_move")
        .select("task_id, wave_no, seq, from_bin, zone, to_bin, to_zone, sku, description, uom, batch_lot, expiry_date, planned_qty, moved_qty, line_state")
        .eq("planned_date", date).neq("wave_status", "CANCELLED");
      if (zone) moveQ = moveQ.eq("zone", zone);
      const { data: moveData, error: moveError } = await moveQ;
      if (moveError) throw moveError;
      const moveRowsData = (moveData ?? []) as MoveLineRow[];

      if (!pickRows.length && !moveRowsData.length) throw new Error("Belum ada baris untuk diunduh.");

      // Fetch attempts for both pick and move (merged by task_id)
      const allTaskIds = [...new Set([
        ...pickRows.map((l) => l.task_id),
        ...moveRowsData.map((l) => l.task_id),
      ])];
      const attempts: ExportAttempt[] = [];
      for (let i = 0; i < allTaskIds.length; i += 200) {
        const { data: a, error: e } = await db.from("pick_audits")
          .select("task_id, attempt_no, checker_name, method, result, errors, counted_qty, found_sku, found_batch, rack_system, rack_counted, note, correction, created_at")
          .in("task_id", allTaskIds.slice(i, i + 200));
        if (e) throw e;
        attempts.push(...((a ?? []) as (Omit<ExportAttempt, "line_id"> & { task_id: string })[]).map((x) => ({ ...x, line_id: x.task_id })));
      }

      // Build pick workbook sheets
      const pickLines: ExportLine[] = pickRows.map((l) => ({
        id: l.task_id, shipment_number: l.shipment_number, wave_no: l.wave_no, picklist: null, seq: l.seq, bin_code: l.from_bin,
        sku: l.sku, description: l.description, uom: l.uom, batch: l.batch_lot, expiry: l.expiry_date, qty: Number(l.picked_qty),
        bin_remaining: null, line_state: l.line_state,
      }));

      // Build move workbook sheets
      const moveLines = moveRowsData.map((l) => ({
        task_id: l.task_id, wave_no: l.wave_no, seq: l.seq,
        from_bin: l.from_bin, from_zone: l.zone, to_bin: l.to_bin, to_zone: l.to_zone,
        sku: l.sku, description: l.description, uom: l.uom,
        batch: l.batch_lot, expiry: l.expiry_date,
        planned_qty: Number(l.planned_qty), moved_qty: Number(l.moved_qty),
        line_state: l.line_state,
      }));

      const pickOut = pickRows.length > 0 ? auditWorkbookRows(pickLines, attempts, "Sisa sistem") : { bins: [], lines: [], history: [] };
      const moveOut = moveRowsData.length > 0 ? moveRows(moveLines, attempts) : { lines: [], history: [] };

      const sheets: Record<string, Row[]> = {
        "Per bin": pickOut.bins,
        "Per baris": pickOut.lines,
        Riwayat: pickOut.history,
      };
      if (moveRowsData.length > 0) {
        sheets["Pindahan bin"] = moveOut.lines;
        // Append move history to Riwayat (or keep separate; here we append for one history sheet)
        sheets.Riwayat = [...pickOut.history, ...moveOut.history];
      }

      saveSheets(sheets, `Audit picking ${date}${zone ? ` rak ${zone}` : ""}.xlsx`, "belum ada audit");
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

// Type alias for internal use
type Row = Record<string, string | number | null>;