"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { callRpc } from "@/components/ckb/rpc-button";
import { groupLocations } from "@/lib/ckb/count-rules";
import { cn, fmtNum } from "@/lib/utils";

export type OverviewRow = { storage_bin: string; lines: number; counted: number; assigned_to: string | null; assigned_name: string | null };

/**
 * Pick locations (one, a whole aisle/area, or by filter), pick a counter, Tugaskan. One confirmation with a
 * summary sentence. Per counter: lines and progress.
 */
export function AssignClient({ sessionId, rows, staff, editable }: {
  sessionId: string; rows: OverviewRow[]; staff: { user_id: string; name: string; role: string }[]; editable: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [counter, setCounter] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const term = filter.trim().toUpperCase();
  const shown = term ? rows.filter((r) => r.storage_bin.toUpperCase().includes(term)) : rows;
  const groups = useMemo(() => groupLocations(shown), [shown]);
  const byCounter = useMemo(() => {
    const m = new Map<string, { name: string; lines: number; counted: number; bins: number }>();
    for (const r of rows) {
      const k = r.assigned_to ?? "";
      const c = m.get(k) ?? { name: r.assigned_name ?? "Belum ditugaskan", lines: 0, counted: 0, bins: 0 };
      c.lines += r.lines; c.counted += r.counted; c.bins += 1;
      m.set(k, c);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : 0));
  }, [rows]);

  const toggle = (bins: string[], on: boolean) => setPicked((p) => { const n = new Set(p); for (const b of bins) { if (on) n.add(b); else n.delete(b); } return n; });
  const pickedRows = rows.filter((r) => picked.has(r.storage_bin));
  const lines = pickedRows.reduce((s, r) => s + r.lines, 0);
  const who = staff.find((p) => p.user_id === counter);
  const sorted = [...picked].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const range = sorted.length === 1 ? sorted[0] : `${sorted[0]}–${sorted[sorted.length - 1]}`;

  async function run() {
    setBusy(true); setError(null);
    const [, err] = await callRpc<number>("ckb_assign_count_tasks", { p_stocktake: sessionId, p_bins: sorted, p_counter: counter || null, p_by_name: null });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false); setPicked(new Set()); router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Per penghitung">
        {byCounter.map(([k, c]) => (
          <div key={k || "none"} className={cn("rounded-xl bg-white p-3", !k && "border border-dashed border-steel-300 bg-transparent")}>
            <p className="font-semibold">{c.name}</p>
            <p className="text-xs text-steel-500 tabular">{fmtNum(c.bins)} lokasi · {fmtNum(c.counted)} dari {fmtNum(c.lines)} baris selesai</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-steel-100"><div className="h-full bg-ckb" style={{ width: `${c.lines ? (c.counted / c.lines) * 100 : 0}%` }} /></div>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <div className="grow sm:grow-0"><Label htmlFor="as-filter">Cari lokasi</Label>
          <Input id="as-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="SIP-1" autoCapitalize="characters" className="sm:w-56" /></div>
        {term && shown.length > 0 && editable && <Button variant="outline" onClick={() => toggle(shown.map((r) => r.storage_bin), true)}>Pilih semua hasil ({shown.length})</Button>}
      </div>

      {groups.map((g) => {
        const bins = g.bins.map((b) => b.storage_bin);
        const all = bins.every((b) => picked.has(b));
        return (
          <section key={g.prefix} className="overflow-hidden rounded-xl bg-white">
            <div className="flex items-center gap-3 border-b border-steel-100 px-3 py-2">
              {editable && <input type="checkbox" className="h-5 w-5 accent-ckb" aria-label={`Pilih semua ${g.prefix}`} checked={all} onChange={(e) => toggle(bins, e.target.checked)} />}
              <p className="font-cond text-lg font-semibold">{g.prefix}</p>
              <p className="text-xs text-steel-500 tabular">{bins.length} lokasi · {fmtNum(g.counted)} dari {fmtNum(g.lines)} baris selesai</p>
            </div>
            <ul className="grid grid-cols-1 divide-y divide-steel-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
              {g.bins.map((b) => {
                const r = rows.find((x) => x.storage_bin === b.storage_bin)!;
                return (
                  <li key={b.storage_bin}>
                    <label className={cn("flex items-center gap-3 px-3 py-2", editable && "cursor-pointer hover:bg-paper", picked.has(b.storage_bin) && "bg-ckb-tint/30")}>
                      {editable && <input type="checkbox" className="h-5 w-5 accent-ckb" checked={picked.has(b.storage_bin)} onChange={(e) => toggle([b.storage_bin], e.target.checked)} />}
                      <span className="rounded-plate bg-plate px-1.5 font-cond text-sm font-bold">{b.storage_bin || "–"}</span>
                      <span className="min-w-0 flex-1 text-xs">
                        <span className={cn("block truncate", r.assigned_name ? "font-medium" : "text-steel-500")}>{r.assigned_name ?? "belum ditugaskan"}</span>
                        <span className="text-steel-500 tabular">{r.counted}/{r.lines} baris</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {groups.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-steel-500">Tidak ada lokasi yang cocok.</p>}

      {editable && picked.size > 0 && (
        <div className="sticky bottom-20 z-20 flex flex-wrap items-center gap-3 rounded-xl bg-jeir-navy px-4 py-3 text-white shadow-2xl lg:bottom-4">
          <p className="min-w-0 grow"><span className="font-cond text-lg font-semibold">{picked.size} lokasi dipilih</span>
            <span className="block text-xs text-white/70">{fmtNum(lines)} baris · {range}</span></p>
          <Select aria-label="Penghitung" value={counter} onChange={(e) => setCounter(e.target.value)} className="w-auto text-steel">
            <option value="">Lepas penugasan</option>
            {staff.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </Select>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
            <DialogTrigger asChild><Button variant="accent">{counter ? "Tugaskan" : "Lepas"}</Button></DialogTrigger>
            <DialogContent title={counter ? "Tugaskan" : "Lepas penugasan"}>
              <div className="space-y-4">
                <p className="rounded-md bg-plate/30 p-3 text-base">
                  {counter ? `Tugaskan ${fmtNum(lines)} baris di ${range} ke ${who?.name ?? "penghitung"}.` : `Lepas penugasan ${fmtNum(lines)} baris di ${range}; siapa pun di daftar penghitung sesi bisa menghitungnya.`}
                </p>
                {error && <p role="alert" className="text-sm text-bad">{error}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="lg" onClick={() => setOpen(false)}>Batal</Button>
                  <Button size="lg" onClick={run} disabled={busy}>{busy ? "Memproses…" : counter ? "Tugaskan" : "Lepas"}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setPicked(new Set())}>Batal pilih</Button>
        </div>
      )}
    </div>
  );
}
