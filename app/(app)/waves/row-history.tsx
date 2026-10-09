"use client";
import { useState } from "react";
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn, fmtDateTime, fmtNum } from "@/lib/utils";
import { pgrstList } from "@/lib/postgrest";

type Entry = { at: string; kind: "event" | "move"; text: string; tone?: "ok" | "bad" };

const STATUS: Record<string, string> = { PLANNED: "rencana", COMPLETED: "diposting", CANCELLED: "dibatalkan", RESCHEDULED: "ditunda" };

/**
 * "Riwayat" of one wave row (a pick and its Bin To Bin): every status change
 * and correction from execution_events (who, why) and every stock movement
 * the row wrote or undid, in time order — 5 Oct: CE30A02 was posted, undone,
 * posted and undone again, and nobody could tell from the row.
 */
export function RowHistory({ ids, label }: { ids: string[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setEntries(null); setError(null);
    const db = createClient();
    const list = pgrstList(ids);
    const [{ data: ev, error: e1 }, { data: mv, error: e2 }] = await Promise.all([
      db.from("execution_events").select("entity_id, from_status, to_status, reason, occurred_at").eq("entity_type", "TASK").in("entity_id", ids).order("occurred_at"),
      db.from("movements").select("type, quantity, created_at, note, by_name, task_id, ref_id, from_bin:bins!movements_from_bin_id_fkey(bin_code), to_bin:bins!movements_to_bin_id_fkey(bin_code)")
        .or(`task_id.in.(${list}),ref_id.in.(${list})`).order("created_at"),
    ]);
    if (e1 || e2) return setError((e1 ?? e2)!.message);
    const out: Entry[] = [];
    for (const e of (ev ?? []) as { from_status: string | null; to_status: string; reason: string | null; occurred_at: string }[]) {
      const change = e.from_status && e.from_status !== e.to_status ? `${STATUS[e.from_status] ?? e.from_status} → ${STATUS[e.to_status] ?? e.to_status}` : STATUS[e.to_status] ?? e.to_status;
      out.push({ at: e.occurred_at, kind: "event", text: `${change}${e.reason ? `: ${e.reason}` : ""}` });
    }
    for (const m of (mv ?? []) as unknown as { type: string; quantity: number; created_at: string; note: string | null; by_name: string | null;
      from_bin: { bin_code: string } | null; to_bin: { bin_code: string } | null }[]) {
      const q = Number(m.quantity);
      const where = m.type === "transfer" ? `${m.from_bin?.bin_code} → ${m.to_bin?.bin_code}` : m.type === "picking" ? `${m.from_bin?.bin_code} → truk` : `${m.to_bin?.bin_code}`;
      out.push({ at: m.created_at, kind: "move", tone: m.type === "adjustment" ? "ok" : undefined,
        text: `stok: ${m.type === "adjustment" ? (q >= 0 ? "+" : "−") : ""}${fmtNum(Math.abs(q))} ${where}${m.by_name ? ` · ${m.by_name}` : ""}${m.note ? ` · ${m.note}` : ""}` });
    }
    setEntries(out.sort((a, b) => a.at.localeCompare(b.at)));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) void load(); }}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 text-xs text-steel-500 underline"><History className="h-3 w-3" />Riwayat</button>
      </DialogTrigger>
      <DialogContent title={`Riwayat ${label}`}>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {!entries && !error && <p className="text-sm text-steel-500">Memuat…</p>}
        {entries && entries.length === 0 && <p className="text-sm text-steel-500">Belum ada perubahan sejak rencana disimpan.</p>}
        {entries && entries.length > 0 && (
          <ol className="space-y-2 border-l-2 border-steel-100 pl-3 text-sm">
            {entries.map((e, i) => (
              <li key={i}>
                <span className="tabular text-xs text-steel-500">{fmtDateTime(e.at)}</span>
                <p className={cn(e.kind === "move" && "text-steel-700", e.tone === "ok" && "text-ok")}>{e.text}</p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
