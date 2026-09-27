"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Search, X } from "lucide-react";
import { BinDetailView } from "@/components/bin/bin-detail-view";
import { LiveDot, useLiveTables } from "@/components/app/live-refresh";
import { LEGENDS } from "@/components/warehouse/colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BinDetail } from "@/lib/bin-data";
import type { Role } from "@/lib/types";
import type { BinSummary, ColorMode, Layout } from "@/lib/warehouse-types";
import { cn } from "@/lib/utils";

// three.js needs the browser (WebGL), so no server rendering for the scene.
const Scene = dynamic(() => import("@/components/warehouse/scene"), {
  ssr: false, loading: () => <p className="p-6 text-sm text-steel-500">Menyiapkan tampilan 3D…</p>,
});

const MODES: { id: ColorMode; label: string }[] = [
  { id: "abc", label: "Kelas ABC" }, { id: "fill", label: "Utilisasi" }, { id: "expiry", label: "Expired" },
];

export function WarehouseClient({ layout, role }: { layout: Layout; role: Role }) {
  const [bins, setBins] = useState<BinSummary[] | null>(null);
  const [mode, setMode] = useState<ColorMode>("expiry");
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<BinSummary | null>(null);
  const [detail, setDetail] = useState<BinDetail | null>(null);

  const loadBins = useCallback(async () => {
    const res = await fetch("/api/warehouse", { cache: "no-store" });
    if (res.ok) setBins((await res.json()).bins);
    else setMessage("Data gudang gagal dimuat.");
  }, []);
  useEffect(() => { loadBins(); }, [loadBins]);

  const loadDetail = useCallback(async (code: string) => {
    setDetail(null);
    const res = await fetch(`/api/bin/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  }, []);

  // Stock moved elsewhere: recolour the racks and reload the open panel in
  // place (no "Memuat…" flash). 3 s debounce: one /api/warehouse call per burst.
  const live = useLiveTables(["movements"], async () => {
    loadBins();
    const code = selected?.bin_code;
    if (!code) return;
    const res = await fetch(`/api/bin/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) return;
    const fresh: BinDetail = await res.json();
    // Only if the panel still shows that bin (the user may have clicked another).
    setDetail((d) => (d?.bin.bin_code === code ? fresh : d));
  }, 3000);

  const select = useCallback((b: BinSummary) => {
    setSelected(b); setHighlighted(new Set([b.id])); loadDetail(b.bin_code);
  }, [loadDetail]);

  /** Bin code (exact or prefix like "CB12") or SKU -> highlight + fly to all matches. */
  function search(e: React.FormEvent) {
    e.preventDefault();
    if (!bins) return;
    const q = query.trim().toUpperCase();
    if (!q) return;
    const byCode = bins.filter((b) => b.bin_code === q);
    const matches = byCode.length ? byCode : bins.filter((b) => b.bin_code.startsWith(q) || b.skus.includes(q));
    if (matches.length === 0) { setMessage(`Tidak ada bin atau SKU "${q}".`); setHighlighted(new Set()); return; }
    setMessage(matches.length === 1 ? null : `${matches.length} bin cocok dengan "${q}".`);
    setHighlighted(new Set(matches.map((m) => m.id)));
    setFocusKey((k) => k + 1);
    if (matches.length === 1) { setSelected(matches[0]); loadDetail(matches[0].bin_code); }
  }

  const unplaced = useMemo(() => (bins ?? []).filter((b) => b.pos_x === null).length, [bins]);

  return (
    <main className="relative h-[calc(100dvh-4.5rem)] lg:h-screen">
      {bins && <Scene bins={bins} layout={layout} mode={mode} highlighted={highlighted} focusKey={focusKey} onSelect={select} />}
      {!bins && <p className="p-6 text-sm text-steel-500">Memuat 2.500+ bin…</p>}

      {/* Controls overlay */}
      <div className="absolute left-3 right-3 top-3 flex flex-col gap-2 sm:right-auto sm:w-96">
        <form onSubmit={search} className="flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Kode bin, awalan (CB12), atau SKU" className="bg-white/95" autoCapitalize="characters" />
          <Button type="submit" size="icon" aria-label="Cari"><Search className="h-4 w-4" /></Button>
        </form>
        <div className="flex rounded-md bg-white/95 p-1 text-sm">
          {MODES.map((m) => (
            <button key={m.id} onClick={() => setMode(m.id)} className={cn("flex-1 rounded px-2 py-1.5", mode === m.id ? "bg-ckb text-white" : "hover:bg-steel-100")}>{m.label}</button>
          ))}
        </div>
        <span className="self-start rounded-md bg-white/95 px-2 py-1"><LiveDot status={live} /></span>
        {message && <p className="rounded-md bg-white/95 px-3 py-2 text-sm">{message}</p>}
        <ul className="rounded-md bg-white/95 p-2 text-xs">
          {LEGENDS[mode].map((l) => <li key={l.label} className="flex items-center gap-2 py-0.5"><span className="h-3 w-3 rounded-sm border border-steel-300" style={{ background: l.color }} />{l.label}</li>)}
          {unplaced > 0 && <li className="mt-1 text-warn">{unplaced} bin belum punya koordinat (atur di Pengaturan).</li>}
        </ul>
      </div>

      {/* Side panel with the same detail as the scan screen */}
      {selected && (
        <aside className="absolute inset-x-0 bottom-0 max-h-[70%] overflow-y-auto rounded-t-xl bg-paper p-4 shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[30rem] sm:rounded-none">
          <div className="mb-2 flex justify-end">
            <Button variant="ghost" size="icon" aria-label="Tutup panel" onClick={() => { setSelected(null); setDetail(null); setHighlighted(new Set()); }}><X className="h-5 w-5" /></Button>
          </div>
          {detail ? (
            <BinDetailView compact detail={detail} role={role} onChanged={() => { loadDetail(selected.bin_code); loadBins(); }} />
          ) : <p className="text-sm text-steel-500">Memuat {selected.bin_code}…</p>}
        </aside>
      )}
    </main>
  );
}
