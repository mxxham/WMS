import { useMemo, useState } from "react";
import { ChevronRight, ScanLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { listOrder } from "@/lib/ckb/count-rules";
import type { TaskRow } from "@/lib/ckb/stocktake-data";
import { cn, fmtNum } from "@/lib/utils";

type Filter = "todo" | "again" | "done";
const WAITING = new Set(["OPEN", "RECOUNT_REQUESTED"]);

/**
 * Screen 1: my lines. Asked-again first, then by location. The search box is also the scanner input:
 * a scanner types the location + Enter, and the single match opens.
 */
export function CountList({ tasks, openId, onOpen, lead, found }: {
  tasks: TaskRow[]; openId: string | null; onOpen: (id: string) => void; lead: boolean;
  /** the "+ Barang tidak ada di daftar" control, when counting is open */
  found?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
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
        {shown.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => onOpen(t.id)} aria-current={openId === t.id ? "true" : undefined}
              className={cn("flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ckb",
                openId === t.id && "ring-2 ring-ckb")}>
              <span className="shrink-0 rounded-plate bg-plate px-2 py-1 font-cond text-base font-bold leading-none text-steel">{t.storage_bin || "–"}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t.material_code}{t.origin === "FOUND" && <span className="ml-1.5 text-xs font-normal text-warn">temuan</span>}</span>
                <span className="block truncate text-xs text-steel-500">{t.description} · {t.uom}</span>
              </span>
              {t.status === "RECOUNT_REQUESTED" && <span className="shrink-0 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-[#8a5a00]">hitung lagi</span>}
              {!WAITING.has(t.status) && (
                <span className="shrink-0 rounded-full bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">
                  {t.latest_qty !== null ? `${fmtNum(Number(t.latest_qty), 3)} ${t.uom}` : "selesai"}
                </span>
              )}
              {lead && t.baseline_qty !== null && <span className="shrink-0 text-xs text-steel-500 tabular">SAP {fmtNum(Number(t.baseline_qty), 3)}</span>}
              <ChevronRight className="h-4 w-4 shrink-0 text-steel-300" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {found}
    </div>
  );
}
