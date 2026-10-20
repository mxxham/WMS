"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { unitOf } from "@/lib/pick-line";
import type { SheetRow } from "@/lib/wave-sheet";
import { fmtNum } from "@/lib/utils";
import { StatusIcon } from "@/components/ui/status-icon";

export type LineRequest = {
  id: string; wave_id: string; pick_id: string | null; move_id: string | null; row: SheetRow; by_name: string; kind: string;
  message: string; created_at: string; wave_no: string; seq: number | null; shipment_number: string | null;
  sku: string | null; description: string | null; uom: string | null; from_bin: string | null;
};

const KIND: Record<string, string> = {
  correction_over_limit: "Stok sistem jauh kurang", other_picker: "Baris picker lain", audited: "Sudah diaudit",
  loaded: "Sudah dimuat", wave_not_pending: "Wave Tunda / selesai",
};

/** Perlu ditangani · Minta supervisor (0067): picker lines the picking screen could not post. */
export function EscalationsPanel({ rows, supervisor, person, onOpenSheet, layout = "desktop" }: {
  rows: LineRequest[]; supervisor: boolean; person: string; onOpenSheet: (r: LineRequest) => void;
  /** Isi dari picklist is desktop only: on the phone a request offers only Tutup. */
  layout?: "desktop" | "phone";
}) {
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (!rows.length) return null;

  async function close(r: LineRequest): Promise<string | null> {
    setError(null);
    const { error } = await createClient().rpc("close_pick_line_request", { p_id: r.id, p_by_name: person, p_note: (note[r.id] ?? "").trim() });
    if (error) return error.message;
    router.refresh();
    return null;
  }

  return (
    <Card className="bg-warn/5 ring-1 ring-warn/30">
      <CardHeader><CardTitle className="flex items-center gap-2"><StatusIcon tone="warn" />Perlu ditangani · Minta supervisor · {fmtNum(rows.length)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {rows.map((r) => {
          const unit = unitOf(r.sku ?? "", r.uom);
          const took = (r.row?.sources ?? []).map((s) => `${fmtNum(s.qty)} ${unit} dari ${s.bin}`).join(" + ");
          return (
            <div key={r.id} className="space-y-2 rounded-md border border-steel-200 p-3 text-sm">
              <p><b>NO {r.wave_no} #{r.seq ?? "–"}</b> · {r.sku} {r.description} · {KIND[r.kind] ?? r.kind}</p>
              <p className="text-steel-500">{r.by_name}, {new Date(r.created_at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}: ambil {took}{r.row?.move_to && `, sisa ${fmtNum(r.row.move_qty ?? 0)} ${unit} ke ${r.row.move_to}`}</p>
              <p className="text-warn">{r.message}</p>
              {supervisor && (
                <div className="flex flex-wrap items-center gap-2">
                  {layout === "desktop" && <Button size="sm" onClick={() => onOpenSheet(r)}>Isi dari picklist</Button>}
                  <Input aria-label={`Catatan tutup ${r.wave_no} #${r.seq}`} className="h-8 w-56" placeholder="catatan (wajib untuk Tutup)"
                    value={note[r.id] ?? ""} onChange={(e) => { const v = e.target.value; setNote((n) => ({ ...n, [r.id]: v })); }} />
                  <ConfirmButton size="sm" variant="outline" disabled={!(note[r.id] ?? "").trim() || person.trim().length < 2}
                    title={`Tutup permintaan NO ${r.wave_no} #${r.seq ?? "–"}`} confirmLabel="Tutup permintaan"
                    summary={`Tutup permintaan NO ${r.wave_no} #${r.seq ?? "–"} dari ${r.by_name} tanpa posting: ${(note[r.id] ?? "").trim()}.`}
                    onConfirm={() => close(r)}>Tutup</ConfirmButton>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
