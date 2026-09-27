"use client";
import { useEffect, useMemo, useState } from "react";
import { Lock, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { withConfig } from "@/lib/allocator/config";
import { inventoryToStock, type InventoryRow } from "@/lib/allocator/adapters/inventory-stock";
import { derivePickfaces } from "@/lib/allocator/pickface";
import { loadPickfaceOverrides } from "@/lib/allocator/browser/plan-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtNum } from "@/lib/utils";

const COLUMNS = "bin_code, bin_status, sku, description, uom, upp, batch_lot, quantity, expiry_date, received_date";

type Row = { sku: string; description: string; fixed: string; suggestion: string | null; draft: string };

/**
 * Fixed pickface per SKU (migration 0009). The "Saran" column is what the
 * allocator would choose on its own today; "Kunci" copies it into the draft.
 */
export function PickfacesClient() {
  const [inv, setInv] = useState<InventoryRow[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [onlyUnfixed, setOnlyUnfixed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setBusy(true); setError(null);
    try {
      const db = createClient();
      const [stockRows, fixed] = await Promise.all([
        fetchAll<InventoryRow>((from, to) => db.from("inventory_detail").select(COLUMNS).order("bin_code").order("sku").order("batch_lot").range(from, to)),
        loadPickfaceOverrides(db),
      ]);
      const config = withConfig({ pickfaceOverrides: fixed });
      const stock = inventoryToStock(stockRows, config).stock;
      // Suggestion = the automatic choice if this SKU had no fixed bin (other SKUs' fixed bins still respected).
      const auto = derivePickfaces(stock, config);
      const suggest = (sku: string) => {
        if (!fixed[sku]) return auto.get(sku)?.location ?? null;
        const others = { ...fixed }; delete others[sku];
        return derivePickfaces(stock, withConfig({ pickfaceOverrides: others })).get(sku)?.location ?? null;
      };
      const desc = new Map(stockRows.map((r) => [r.sku, r.description ?? ""]));
      const skus = [...new Set([...stockRows.map((r) => r.sku), ...Object.keys(fixed)])].sort();
      setInv(stockRows);
      setRows(skus.map((sku) => ({ sku, description: desc.get(sku) ?? "", fixed: fixed[sku] ?? "", suggestion: suggest(sku), draft: fixed[sku] ?? "" })));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);

  const binContents = useMemo(() => {
    const m = new Map<string, { sku: string; qty: number }[]>();
    for (const r of inv) {
      const list = m.get(r.bin_code) ?? [];
      const hit = list.find((x) => x.sku === r.sku);
      if (hit) hit.qty += Number(r.quantity); else list.push({ sku: r.sku, qty: Number(r.quantity) });
      m.set(r.bin_code, list);
    }
    return m;
  }, [inv]);

  const draftOwners = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of rows) if (r.draft) m.set(r.draft.toUpperCase(), [...(m.get(r.draft.toUpperCase()) ?? []), r.sku]);
    return m;
  }, [rows]);

  const changed = rows.filter((r) => r.draft.trim().toUpperCase() !== r.fixed);
  const shown = rows.filter((r) => (!onlyUnfixed || !r.fixed) && (!q || `${r.sku} ${r.description} ${r.draft}`.toLowerCase().includes(q.toLowerCase())));
  const setDraft = (sku: string, draft: string) => setRows((rs) => rs.map((r) => (r.sku === sku ? { ...r, draft } : r)));

  function lockSuggestions() {
    setRows((rs) => rs.map((r) => (!r.fixed && !r.draft && r.suggestion ? { ...r, draft: r.suggestion } : r)));
  }

  async function save() {
    setBusy(true); setError(null); setNotice(null);
    const { data, error } = await createClient().rpc("set_pickfaces", {
      p_rows: changed.map((r) => ({ sku: r.sku, bin_code: r.draft.trim().toUpperCase() || null })),
    });
    if (error) { setBusy(false); return setError(error.message); }
    setNotice(`${fmtNum(data.set)} pickface disimpan, ${fmtNum(data.cleared)} dihapus. Berlaku untuk alokasi dan hitung ulang berikutnya.`);
    await load();
  }

  function warning(r: Row): string | null {
    const bin = r.draft.trim().toUpperCase();
    if (!bin) return null;
    if ((draftOwners.get(bin)?.length ?? 0) > 1) return `Dipakai juga oleh ${draftOwners.get(bin)!.filter((s) => s !== r.sku).join(", ")}`;
    const others = (binContents.get(bin) ?? []).filter((c) => c.sku !== r.sku);
    if (others.length) return `Bin berisi SKU lain: ${others.map((o) => `${o.sku} (${fmtNum(o.qty)})`).join(", ")}`;
    return null;
  }

  const fixedCount = rows.filter((r) => r.fixed).length;
  return (
    <div className="space-y-4 p-4 lg:p-8">
      {error && <p role="alert" className="rounded-md bg-bad/10 p-3 text-sm text-bad">{error}</p>}
      {notice && <p className="rounded-md bg-ok/10 p-3 text-sm">{notice}</p>}
      <p className="max-w-3xl text-sm text-steel-500">
        SKU dengan pickface tetap selalu di-replenish ke bin yang sama. SKU tanpa pickface tetap memakai saran otomatis (bin level A paling awal di rute), yang bisa berpindah setiap kali stok bergerak.
        {" "}{fmtNum(fixedCount)} dari {fmtNum(rows.length)} SKU sudah punya pickface tetap.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Cari SKU, deskripsi, bin" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyUnfixed} onChange={(e) => setOnlyUnfixed(e.target.checked)} />Hanya yang belum tetap</label>
        <Button variant="outline" onClick={lockSuggestions} disabled={busy}><Lock className="h-4 w-4" />Isi saran untuk semua yang belum tetap</Button>
        <Button onClick={save} disabled={busy || changed.length === 0}><Save className="h-4 w-4" />{busy ? "Memproses…" : `Simpan ${fmtNum(changed.length)} perubahan`}</Button>
      </div>
      <Card><CardContent>
        <Table>
          <thead><tr><Th>SKU</Th><Th>Deskripsi</Th><Th>Pickface tetap</Th><Th>Saran otomatis</Th><Th>Isi bin pickface</Th></tr></thead>
          <tbody>{shown.map((r) => {
            const bin = r.draft.trim().toUpperCase(); const w = warning(r); const dirty = bin !== r.fixed;
            const own = (binContents.get(bin) ?? []).find((c) => c.sku === r.sku);
            return (
              <tr key={r.sku} className={cn(dirty && "bg-plate/20", w && "bg-warn/10")}>
                <Td className="font-semibold">{r.sku}</Td><Td className="text-xs">{r.description}</Td>
                <Td><Input aria-label={`Pickface ${r.sku}`} className="h-8 w-32 font-semibold uppercase" value={r.draft} placeholder="otomatis" onChange={(e) => setDraft(r.sku, e.target.value)} /></Td>
                <Td>{r.suggestion ? (
                  <button className="text-sm underline decoration-dotted disabled:no-underline" disabled={bin === r.suggestion} onClick={() => setDraft(r.sku, r.suggestion!)}>{r.suggestion}</button>
                ) : <span className="text-xs text-steel-500">tidak ada slot level A kosong</span>}</Td>
                <Td className="text-xs">{w ?? (bin ? (own ? `${fmtNum(own.qty)} ctn SKU ini` : "Kosong") : "")}</Td>
              </tr>
            );
          })}</tbody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
