import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { OWNER_LABEL, STATE_LABEL, stateOf, type BinState, type RackBin } from "@/lib/racks";
import { saveSheets } from "@/lib/save-xlsx";
import { cn, fmtNum } from "@/lib/utils";
import { CodePlate, OwnerBadge, StateBadge } from "./badges";

const PAGE = 200;
type Filters = { q: string; aisle: string; level: string; state: "" | BinState; owner: "" | "SHELL" | "CKB" | "FLOOR"; empty: boolean };
const NONE: Filters = { q: "", aisle: "", level: "", state: "", owner: "", empty: false };

function matches(b: RackBin, f: Filters): boolean {
  if (f.aisle && b.zone !== f.aisle) return false;
  if (f.level && b.level !== f.level) return false;
  if (f.state && stateOf(b) !== f.state) return false;
  if (f.owner === "FLOOR" ? b.rack !== null : f.owner && b.owner !== f.owner) return false;
  if (f.empty && Number(b.total_qty) > 0) return false;
  const q = f.q.trim().toUpperCase();
  if (q && !b.bin_code.startsWith(q) && !b.skus.some((s) => s.toUpperCase().includes(q))) return false;
  return true;
}

/**
 * Daftar bin: every bin as a row (a card on a phone), filterable, selectable for the same actions as the
 * floor plan, and downloadable as it is filtered.
 */
export function BinList({ bins, aisles, selected, onToggle }: {
  bins: RackBin[]; aisles: string[]; selected: Set<string>; onToggle: (codes: string[], on: boolean) => void;
}) {
  const [f, setF] = useState<Filters>(NONE);
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => bins.filter((b) => matches(b, f)), [bins, f]);
  const page = rows.slice(0, shown);
  const allOn = page.length > 0 && page.every((b) => selected.has(b.bin_code));
  const set = (patch: Partial<Filters>) => { setF((x) => ({ ...x, ...patch })); setShown(PAGE); };

  function download() {
    saveSheets({
      "Daftar bin": rows.map((b) => ({
        "Kode": b.bin_code, "Aisle": b.zone, "Rak": b.rack ?? "", "Level": b.level ?? "", "Posisi": b.position ?? "",
        "Status": STATE_LABEL[stateOf(b)], "Pemilik": b.owner ? OWNER_LABEL[b.owner] : "lantai (bersama)",
        "Karton": Number(b.total_qty), "SKU": b.skus.join(", "), "Kelas ABC": b.abc_class ?? "", "Alasan status": b.block_reason ?? "",
      })),
    }, `Rak dan lokasi ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" })}.xlsx`, "tidak ada bin");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-white p-3">
        <Input aria-label="Cari kode bin atau SKU" placeholder="Kode bin (CE32) atau SKU" value={f.q} onChange={(e) => set({ q: e.target.value })}
          className="w-full sm:w-56" autoCapitalize="characters" />
        <Select aria-label="Aisle" value={f.aisle} onChange={(e) => set({ aisle: e.target.value })} className="w-auto">
          <option value="">Semua aisle</option>
          {aisles.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Select aria-label="Level" value={f.level} onChange={(e) => set({ level: e.target.value })} className="w-auto">
          <option value="">Semua level</option>
          {["A", "B", "C", "D", "E"].map((l) => <option key={l} value={l}>Level {l}</option>)}
        </Select>
        <Select aria-label="Status" value={f.state} onChange={(e) => set({ state: e.target.value as Filters["state"] })} className="w-auto">
          <option value="">Semua status</option>
          {(Object.keys(STATE_LABEL) as BinState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
        </Select>
        <Select aria-label="Pemilik" value={f.owner} onChange={(e) => set({ owner: e.target.value as Filters["owner"] })} className="w-auto">
          <option value="">Semua pemilik</option>
          <option value="SHELL">Shell</option><option value="CKB">CKB 3PL</option><option value="FLOOR">Lokasi lantai</option>
        </Select>
        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" checked={f.empty} onChange={(e) => set({ empty: e.target.checked })} className="h-4 w-4 accent-ckb" />Kosong saja
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-steel-500 tabular">{fmtNum(rows.length)} bin</span>
          <Button variant="outline" size="sm" onClick={download} disabled={!rows.length}><Download className="h-4 w-4" />Unduh Excel</Button>
        </div>
      </div>

      {rows.length === 0 && (
        <p className="rounded-lg bg-white p-6 text-center text-sm text-steel-500">
          Tidak ada bin yang cocok. <button className="underline" onClick={() => set(NONE)}>Hapus filter</button>
        </p>
      )}

      {/* Desktop: one table */}
      {rows.length > 0 && (
        <div className="hidden overflow-hidden rounded-lg bg-white md:block">
          <Table sticky>
            <thead><tr>
              <Th className="w-10"><input type="checkbox" aria-label="Pilih semua yang tampil" checked={allOn} className="h-4 w-4 accent-ckb"
                onChange={(e) => onToggle(page.map((b) => b.bin_code), e.target.checked)} /></Th>
              <Th>Bin</Th><Th>Aisle · rak · level</Th><Th>Status</Th><Th className="text-right">Karton</Th><Th>SKU</Th><Th>ABC</Th><Th>Alasan</Th>
            </tr></thead>
            <tbody>{page.map((b) => {
              const on = selected.has(b.bin_code);
              const gone = b.block_kind === "NOT_PRESENT";
              return (
                <tr key={b.id} className={cn(on && "bg-ckb-tint/40")}>
                  <Td><input type="checkbox" aria-label={`Pilih ${b.bin_code}`} checked={on} className="h-4 w-4 accent-ckb"
                    onChange={(e) => onToggle([b.bin_code], e.target.checked)} /></Td>
                  <Td><CodePlate code={b.bin_code} dim={gone} /></Td>
                  <Td className="text-sm text-steel-500">{b.rack ? `${b.zone} · ${b.rack} · ${b.level}` : "lokasi lantai"}</Td>
                  <Td><span className="flex flex-wrap gap-1"><StateBadge bin={b} /><OwnerBadge owner={b.owner} />
                    {stateOf(b) === "ACTIVE" && b.owner !== "CKB" && <span className="text-xs text-steel-500">Aktif</span>}</span></Td>
                  <Td className="text-right tabular">{Number(b.total_qty) ? fmtNum(Number(b.total_qty)) : <span className="text-steel-300">kosong</span>}</Td>
                  <Td className="max-w-48 truncate text-xs">{b.skus.join(", ")}</Td>
                  <Td className="text-xs">{b.abc_class ?? ""}</Td>
                  <Td className="max-w-64 truncate text-xs text-steel-500">{b.block_reason ?? ""}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        </div>
      )}

      {/* Phone: one card per bin */}
      <ul className="space-y-2 md:hidden">
        {page.map((b) => {
          const on = selected.has(b.bin_code);
          return (
            <li key={b.id}>
              <label className={cn("flex items-start gap-3 rounded-lg bg-white p-3", on && "ring-2 ring-ckb")}>
                <input type="checkbox" checked={on} onChange={(e) => onToggle([b.bin_code], e.target.checked)} className="mt-1 h-5 w-5 accent-ckb" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5"><CodePlate code={b.bin_code} dim={b.block_kind === "NOT_PRESENT"} />
                    <StateBadge bin={b} /><OwnerBadge owner={b.owner} /></span>
                  <span className="mt-1 block text-sm">
                    {Number(b.total_qty) ? `${fmtNum(Number(b.total_qty))} karton · ${b.skus.join(", ")}` : <span className="text-steel-500">kosong</span>}
                  </span>
                  {b.block_reason && <span className="block text-xs text-steel-500">{b.block_reason}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {rows.length > shown && (
        <div className="text-center">
          <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>Tampilkan {fmtNum(Math.min(PAGE, rows.length - shown))} lagi</Button>
        </div>
      )}
    </div>
  );
}
