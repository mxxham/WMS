"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { auditWorkbookRows, moveRows, type ExportAttempt, type ExportLine, type ExportMove } from "@/lib/sheet-audit-export";
import { fetchAll } from "@/lib/fetch-all";
import { saveSheets } from "@/lib/save-xlsx";

type LineRow = {
  task_id: string; shipment_number: string; wave_no: string; seq: number; from_bin: string; zone: string; sku: string;
  description: string; uom: string | null; batch_lot: string; expiry_date: string | null; picked_qty: number; line_state: ExportLine["line_state"];
  volume_l: number | null;
};

type MoveLineRow = {
  task_id: string; wave_no: string; seq: number;
  from_bin: string; zone: string | null; to_bin: string; to_zone: string | null;
  sku: string; description: string; uom: string | null;
  batch_lot: string; expiry_date: string | null;
  planned_qty: number; moved_qty: number; line_state: "TODO" | "OK" | "MISMATCH" | "RESOLVED" | "AUTO_PASS";
  from_state: "TODO" | "OK" | "MISMATCH" | "AUTO_PASS"; from_system: number | null; from_counted: number | null;
  from_checker: string | null; from_found_sku: string | null; from_note: string | null; from_audited_at: string | null;
  from_correction: boolean | null;
};

/** Downloads the day's picking audit as .xlsx: picked bins and Bin To Bin bins together in Per bin. */
export function DownloadPickAudit({ date, zone }: { date: string; zone?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true); setError(null);
    try {
      const db = createClient();

      // ---- Pick audit (existing) ----
      let pickQ = db.from("pick_audit_line")
        .select("task_id, shipment_number, wave_no, seq, from_bin, zone, sku, description, uom, batch_lot, expiry_date, picked_qty, line_state, volume_l")
        .eq("planned_date", date).neq("wave_status", "CANCELLED");
      if (zone) pickQ = pickQ.eq("zone", zone);
      const { data: pickData, error: pickError } = await pickQ;
      if (pickError) throw pickError;
      const pickRows = (pickData ?? []) as LineRow[];

      // ---- Move audit (new) ----
      let moveQ = db.from("pick_audit_move")
        .select("*") // "*": works before 0114 too
        .eq("planned_date", date).neq("wave_status", "CANCELLED");
      // A move belongs to both racks it touches (source bin and destination bin), as on the rack page.
      if (zone) moveQ = moveQ.or(`zone.eq.${zone},to_zone.eq.${zone}`);
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

      // Remain Qty: stock of bin + SKU at day end, from the same report as `Laporan WMS harian`.
      let remain: Map<string, number> | undefined;
      let note: string | null = null;
      if (pickRows.length > 0 || moveRowsData.length > 0) {
        try {
          const rep = await fetchAll<{ bin_code: string; sku: string; remain: number | string }>(
            (a, b) => db.rpc("wms_day_report", { p_date: date }).range(a, b) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>);
          remain = new Map();
          for (const r of rep) {
            const k = `${r.bin_code}|${r.sku}`;
            remain.set(k, (remain.get(k) ?? 0) + Number(r.remain));
          }
        } catch (e) { note = `Remain Qty tidak bisa dibaca: ${(e as Error).message}`; }
      }

      // Build pick workbook sheets
      const pickLines: ExportLine[] = pickRows.map((l) => ({
        id: l.task_id, shipment_number: l.shipment_number, wave_no: l.wave_no, picklist: null, seq: l.seq, bin_code: l.from_bin,
        sku: l.sku, description: l.description, uom: l.uom, batch: l.batch_lot, expiry: l.expiry_date, qty: Number(l.picked_qty),
        bin_remaining: null, line_state: l.line_state, volume_l: l.volume_l,
      }));

      // Bin To Bin lines go into Per bin with the picked bins: a row for the source bin, one for the destination.
      const moves: ExportMove[] = moveRowsData.map((l) => ({
        task_id: l.task_id, wave_no: l.wave_no, seq: l.seq,
        from_bin: l.from_bin, from_zone: l.zone, to_bin: l.to_bin, to_zone: l.to_zone,
        sku: l.sku, description: l.description, uom: l.uom,
        moved_qty: Number(l.moved_qty), line_state: l.line_state,
        from_state: l.from_state, from_system: l.from_system == null ? null : Number(l.from_system),
        from_counted: l.from_counted == null ? null : Number(l.from_counted), from_checker: l.from_checker,
        from_found_sku: l.from_found_sku, from_note: l.from_note, from_correction: l.from_correction, from_audited_at: l.from_audited_at,
      }));
      const out = auditWorkbookRows(pickLines, attempts, "Sisa sistem", remain, { rows: moves, zone });
      const moveHistory = moveRows(moveRowsData.map((l) => ({
        task_id: l.task_id, wave_no: l.wave_no, seq: l.seq, from_bin: l.from_bin, from_zone: l.zone, to_bin: l.to_bin, to_zone: l.to_zone,
        sku: l.sku, description: l.description, uom: l.uom, batch: l.batch_lot, expiry: l.expiry_date,
        planned_qty: Number(l.planned_qty), moved_qty: Number(l.moved_qty), line_state: l.line_state,
      })), attempts).history;

      const sheets: Record<string, Row[]> = {
        "Per bin": out.bins,
        "Per baris": pickRows.length ? out.lines : [],
        Riwayat: [...out.history, ...moveHistory],
      };

      saveSheets(sheets, `Audit picking ${date}${zone ? ` rak ${zone}` : ""}.xlsx`, "belum ada audit");
      if (note) setError(note);
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