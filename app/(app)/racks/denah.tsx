import { useCallback, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LEGENDS } from "@/components/warehouse/colors";
import { bayKey, selectBayRange, type Bay, type FloorPlan as Plan } from "@/lib/racks";
import { cn } from "@/lib/utils";
import { FloorPlan, GONE, STATUS_COLOR, type PlanMode } from "./floor-plan";
import { RackPanel } from "./rack-panel";

const MODES: { id: PlanMode; label: string }[] = [
  { id: "fill", label: "Utilisasi" }, { id: "abc", label: "Kelas ABC" }, { id: "expiry", label: "Expired" }, { id: "status", label: "Status & pemilik" },
];
const HATCH = "repeating-linear-gradient(45deg, #C0392B 0 2px, #f3c4bf 2px 4px)";

/** Bays a search hits: a bin code or rack (CE32, CE32A02), a whole aisle (CE), or bays holding a SKU. */
function search(plan: Plan, raw: string): string[] {
  const q = raw.trim().toUpperCase();
  if (!q) return [];
  const bays = plan.aisles.flatMap((a) => a.faces.flat()).filter((b) => b.bins.length);
  if (/^C[A-Z]$/.test(q)) return bays.filter((b) => b.zone === q).map((b) => bayKey(b.zone, b.rack));
  const byCode = bays.filter((b) => q.startsWith(bayKey(b.zone, b.rack)) || bayKey(b.zone, b.rack).startsWith(q));
  if (byCode.length) return byCode.map((b) => bayKey(b.zone, b.rack));
  return bays.filter((b) => b.bins.some((x) => x.skus.some((s) => s.toUpperCase() === q))).map((b) => bayKey(b.zone, b.rack));
}

export function Denah({ plan, selected, onToggle, onSet, onClear }: {
  plan: Plan; selected: Set<string>;
  onToggle: (codes: string[], on: boolean) => void;
  onSet: (codes: string[]) => void;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<PlanMode>("fill");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const byKey = useMemo(() => new Map(plan.aisles.flatMap((a) => a.faces.flat()).map((b) => [bayKey(b.zone, b.rack), b])), [plan]);
  const open = openKey ? byKey.get(openKey) ?? null : null;
  const behind = useMemo(() => {
    if (!open) return null;
    const aisle = plan.aisles.find((a) => a.zone === open.zone);
    return aisle?.faces[open.face === 0 ? 1 : 0][open.slot] ?? null;
  }, [open, plan]);

  // A bay counts as picked when any of its bins is selected.
  const picked = useMemo(() => {
    const s = new Set<string>();
    for (const [k, b] of byKey) if (b.bins.some((x) => selected.has(x.bin_code))) s.add(k);
    return s;
  }, [byKey, selected]);

  const codesOf = (bays: Bay[]) => bays.flatMap((b) => b.bins.map((x) => x.bin_code));
  const onOpen = useCallback((bay: Bay) => setOpenKey(bayKey(bay.zone, bay.rack)), []);
  const onRange = useCallback((from: Bay, to: Bay) => onSet(codesOf(selectBayRange(plan, from, to))), [plan, onSet]);
  const onToggleBay = useCallback((bay: Bay) => {
    const codes = bay.bins.map((b) => b.bin_code);
    onToggle(codes, !codes.every((c) => selected.has(c)));
  }, [onToggle, selected]);
  const onAisle = useCallback((zone: string) => {
    const a = plan.aisles.find((x) => x.zone === zone);
    if (a) onSet(codesOf(a.faces.flat()));
  }, [plan, onSet]);

  function find(e: React.FormEvent) {
    e.preventDefault();
    const keys = search(plan, query);
    setFound(new Set(keys));
    setNote(query.trim() && !keys.length ? `Tidak ada rak atau SKU "${query.trim().toUpperCase()}".` : keys.length > 1 ? `${keys.length} rak cocok.` : null);
    if (keys.length) {
      document.getElementById(`bay-${keys[0]}`)?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      if (keys.length === 1) setOpenKey(keys[0]);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md bg-white p-1 text-sm" role="group" aria-label="Warna">
          {MODES.map((m) => (
            <button key={m.id} type="button" onClick={() => setMode(m.id)} aria-pressed={mode === m.id}
              className={cn("rounded px-2.5 py-1.5", mode === m.id ? "bg-ckb text-white" : "hover:bg-steel-100")}>{m.label}</button>
          ))}
        </div>
        <form onSubmit={find} className="ml-auto flex items-center gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rak (CE32), bin, aisle, atau SKU"
            aria-label="Cari di denah" className="w-60 bg-white" autoCapitalize="characters" />
          <button type="submit" aria-label="Cari" className="rounded-md bg-ckb p-2 text-white hover:bg-ckb-dark"><Search className="h-4 w-4" /></button>
        </form>
      </div>
      {note && <p className="text-sm text-steel-500" role="status">{note}</p>}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <FloorPlan plan={plan} mode={mode} picked={picked} found={found} open={openKey}
            onOpen={onOpen} onRange={onRange} onToggleBay={onToggleBay} onAisle={onAisle}
            onClear={() => { onClear(); setFound(new Set()); setOpenKey(null); }} />
          <Legend mode={mode} />
        </div>
        {open && (
          <div className="xl:sticky xl:top-4 xl:w-80">
            <RackPanel bay={open} behind={behind} selected={selected} onToggle={onToggle} onClose={() => setOpenKey(null)} />
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ mode }: { mode: PlanMode }) {
  const colours = mode === "status"
    ? [{ label: "Shell", color: STATUS_COLOR.SHELL }, { label: "CKB 3PL", color: STATUS_COLOR.CKB }]
    : LEGENDS[mode];
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-steel-500">
      {colours.map((l) => (
        <li key={l.label} className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-sm ring-1 ring-inset ring-steel/10" style={{ background: l.color }} />{l.label}</li>
      ))}
      <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-sm" style={{ background: HATCH }} />Diblokir</li>
      <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-sm" style={{ background: GONE }} />Tidak ada</li>
      <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-sm bg-paper outline outline-1 outline-dotted outline-ckb" />Rencana</li>
      {mode !== "status" && <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 border-t-[3px] border-jeir-teal bg-white" />Dipinjam CKB 3PL</li>}
      <li>Satu kotak = satu rak (bay), dua posisi; warna = level paling penuh. Buka rak untuk tiap level.</li>
    </ul>
  );
}
