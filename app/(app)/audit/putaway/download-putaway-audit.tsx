"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { putawayWorkbookRows, type PutawayExport, type PutawayHistory } from "@/lib/putaway-audit-export";
import { saveSheets } from "@/lib/save-xlsx";

type Detail = {
  movement_id: string; type: "putaway" | "inbound"; created_at: string; created_by_name: string | null; by_name: string | null;
  sku: string; description: string; uom: string | null; from_bin: string | null; to_bin: string; zone: string;
  batch_lot: string; expiry_date: string | null; quantity: number; audit_id: string | null; counted_qty: number | null;
  result: "OK" | "MISMATCH" | null; audit_note: string | null; audited_at: string | null; audited_by_name: string | null;
  checker_name: string | null; found_sku: string | null; found_batch: string | null; attempts: number;
};

/** Downloads the day's putaway audit (Jakarta day; one rack, or all) as .xlsx, as it stands now. */
export function DownloadPutawayAudit({ date, zone }: { date: string; zone?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true); setError(null);
    try {
      const db = createClient();
      const start = new Date(`${date}T00:00:00+07:00`);
      const end = new Date(start.getTime() + 86_400_000);
      let q = db.from("putaway_audit_detail").select("*").gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
      if (zone) q = q.eq("zone", zone);
      const { data, error } = await q.range(0, 9999);
      if (error) throw error;
      const d = (data ?? []) as Detail[];
      if (!d.length) throw new Error("Belum ada putaway untuk diunduh.");
      const rows: PutawayExport[] = d.map((m) => ({
        movement_id: m.movement_id, created_at: m.created_at, by: m.by_name ?? m.created_by_name, type: m.type, from_bin: m.from_bin,
        to_bin: m.to_bin, sku: m.sku, description: m.description, uom: m.uom, batch_lot: m.batch_lot, expiry_date: m.expiry_date,
        quantity: Number(m.quantity),
        audit: m.audit_id ? { result: m.result!, counted: Number(m.counted_qty), foundSku: m.found_sku, foundBatch: m.found_batch,
          checker: m.checker_name ?? m.audited_by_name, note: m.audit_note, at: m.audited_at!, attempts: m.attempts } : null,
      }));
      const history: PutawayHistory[] = [];
      const ids = d.filter((m) => m.audit_id).map((m) => m.movement_id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data: a, error: e } = await db.from("audits").select("movement_id, history").in("movement_id", ids.slice(i, i + 200));
        if (e) throw e;
        for (const x of (a ?? []) as { movement_id: string; history: PutawayHistory["entries"] }[]) history.push({ movement_id: x.movement_id, entries: x.history ?? [] });
      }
      const out = putawayWorkbookRows(rows, history);
      saveSheets({ Putaway: out.putaway, Riwayat: out.history }, `Audit putaway ${date}${zone ? ` rak ${zone}` : ""}.xlsx`, "belum ada audit");
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
