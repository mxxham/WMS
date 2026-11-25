import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ChevronRight, Lock, ScanLine } from "lucide-react";
import { callRpc } from "@/components/ckb/rpc-button";
import { offlineFetch } from "@/lib/net";
import { Input } from "@/components/ui/input";
import { listOrder } from "@/lib/ckb/count-rules";
import { stockTypeTag } from "@/lib/ckb/stocktake";
import type { TaskRow } from "@/lib/ckb/stocktake-data";
import { cn, fmtNum } from "@/lib/utils";

type Filter = "todo" | "again" | "done";
const WAITING = new Set(["OPEN", "RECOUNT_REQUESTED"]);

/**
 * Screen 1: my lines. Asked-again first, then by location. The search box is also the scanner input:
 * a scanner types the location + Enter, and the single match opens.
 */
export function CountList({ tasks, openId, onOpen, lead, found, sessionId, binGate, bins }: {
  tasks: TaskRow[]; openId: string | null; onOpen: (id: string) => void; lead: boolean;
  sessionId: string;
  /** 0163: a line of a bin without a photo cannot be opened for counting */
  binGate: boolean; bins: { storage_bin: string; bin_id: string | null; photos: number; lines: number }[];
  /** the "+ Barang tidak ada di daftar" control, when counting is open */
  found?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const binPhotos = useMemo(() => new Map(bins.map((b) => [b.storage_bin.toUpperCase(), b.photos])), [bins]);
  const needsPhoto = (bin: string) => binGate && (binPhotos.get(bin.toUpperCase()) ?? 0) === 0 && binPhotos.has(bin.toUpperCase());
  const again = tasks.filter((t) => t.status === "RECOUNT_REQUESTED").length;
  const todo = tasks.filter((t) => WAITING.has(t.status)).length;
  const [filter, setFilter] = useState<Filter>(again ? "again" : "todo");
  const term = q.trim().toUpperCase();
  const shown = useMemo(() => listOrder(tasks.filter((t) =>
    (filter === "done" ? !WAITING.has(t.status) : filter === "again" ? t.status === "RECOUNT_REQUESTED" : WAITING.has(t.status))
    && (!term || t.storage_bin.toUpperCase().includes(term) || t.material_code.toUpperCase().includes(term) || t.description.toUpperCase().includes(term)))),
  [tasks, filter, term]);

  const tabs: [Filter, string, number][] = [["todo", "Belum", todo], ["again", "Hitung lagi", again], ["done", "Selesai", tasks.length - todo]];
  return (
    <div className="space-y-3">
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ckb" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Scan atau ketik lokasi / material" placeholder="Scan atau ketik lokasi / material"
          className="h-12 rounded-xl border-2 border-ckb pl-10 text-base" autoCapitalize="characters" enterKeyHint="search"
          onKeyDown={(e) => { if (e.key === "Enter" && shown.length === 1) onOpen(shown[0].id); }} />
      </div>
      <div className="flex rounded-xl bg-steel-100 p-1 text-sm" role="tablist" aria-label="Saring baris">
        {tabs.map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={cn("flex-1 rounded-lg py-2", filter === k ? "bg-white font-semibold shadow-sm" : "text-steel-700")}>
            {l} <span className="tabular">({n})</span>
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="rounded-xl bg-white py-8 text-center text-sm text-steel-500">
          {filter === "todo" && todo === 0 ? "Semua baris Anda sudah dihitung." : filter === "again" ? "Tidak ada yang diminta hitung lagi." : "Tidak ada baris yang cocok."}
        </p>
      )}
      <ul className="space-y-2">
        {shown.map((t, i) => (
          <li key={t.id}>
            {binGate && binPhotos.has(t.storage_bin.toUpperCase()) && (i === 0 || shown[i - 1].storage_bin !== t.storage_bin) && (
              <BinPhoto sessionId={sessionId} bin={t.storage_bin} photos={binPhotos.get(t.storage_bin.toUpperCase()) ?? 0} />
            )}
            <button type="button" onClick={() => !needsPhoto(t.storage_bin) && onOpen(t.id)} aria-current={openId === t.id ? "true" : undefined}
              aria-disabled={needsPhoto(t.storage_bin) || undefined} title={needsPhoto(t.storage_bin) ? "Foto bin dulu" : undefined}
              className={cn("flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb",
                openId === t.id && "ring-2 ring-ckb", needsPhoto(t.storage_bin) && "opacity-50")}>
              <span className="shrink-0 rounded-plate bg-plate px-2 py-1 font-cond text-base font-bold leading-none text-steel">{t.storage_bin || "–"}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t.material_code}{t.origin === "FOUND" && <span className="ml-1.5 text-xs font-normal text-warn">temuan</span>}
                  {stockTypeTag(t.stock_type) && <span className="ml-1.5 rounded-plate bg-warn/15 px-1.5 py-0.5 font-cond text-xs font-bold text-[#8a5a00]">{stockTypeTag(t.stock_type)}</span>}</span>
                <span className="block truncate text-xs text-steel-500">{t.description} · {t.uom}</span>
              </span>
              {t.status === "RECOUNT_REQUESTED" && <span className="shrink-0 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-[#8a5a00]">hitung lagi</span>}
              {!WAITING.has(t.status) && (
                <span className="shrink-0 rounded-full bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">
                  {t.latest_qty !== null ? `${fmtNum(Number(t.latest_qty), 3)} ${t.uom}` : "selesai"}
                </span>
              )}
              {lead && t.baseline_qty !== null && <span className="shrink-0 text-xs text-steel-500 tabular">SAP {fmtNum(Number(t.baseline_qty), 3)}</span>}
              {needsPhoto(t.storage_bin) ? <Lock className="h-4 w-4 shrink-0 text-steel-500" aria-label="Foto bin dulu" /> : <ChevronRight className="h-4 w-4 shrink-0 text-steel-300" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
      {found}
    </div>
  );
}

/**
 * One photo per bin (0163): above the first line of a bin. The counter photographs the whole bin once; until then the bin's lines
 * stay shut. The bin row is made on the first photo (ckb_stocktake_bin), then the file goes through the evidence route.
 */
function BinPhoto({ sessionId, bin, photos }: { sessionId: string; bin: string; photos: number }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(null);
    const [id, err] = await callRpc<string>("ckb_stocktake_bin", { p_stocktake: sessionId, p_bin: bin });
    if (err || !id) { setBusy(false); setError(err ?? "Bin tidak bisa dibuka."); return; }
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.set("entity_type", "STOCKTAKE_BIN"); fd.set("entity_id", id); fd.set("kind", "COUNT"); fd.set("description", `Foto bin ${bin}`); fd.set("file", f);
        const res = await offlineFetch("/api/ckb/evidence", { method: "POST", body: fd });
        if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error ?? "Foto gagal diunggah"); break; }
      }
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
    if (file.current) file.current.value = "";
    router.refresh();
  }
  const id = `binph-${bin}`;
  return (
    <div className={cn("mb-1 mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2", photos ? "bg-ok/10" : "bg-warn/10")}>
      <span className="font-cond text-lg font-bold tracking-tight">{bin}</span>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" id={id} onChange={(e) => upload(e.target.files)} />
      <label htmlFor={id} className={cn("flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium", photos ? "text-ok" : "bg-white text-[#8a5a00] ring-1 ring-warn")}>
        {photos ? <Check className="h-4 w-4" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
        {busy ? "Mengunggah…" : photos ? `Foto bin (${photos}) · tambah` : "Foto bin dulu"}
      </label>
      {error && <p role="alert" className="basis-full text-xs text-bad">{error}</p>}
    </div>
  );
}
