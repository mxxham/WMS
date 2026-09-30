"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { allMasterSkus, masterFromWorkbook, type MasterItem } from "@/lib/master-from-workbook";
import { fmtNum } from "@/lib/utils";

async function addItems(items: MasterItem[]): Promise<{ added: number; skipped: number }> {
  const { data, error } = await createClient().rpc("add_items", { p_items: items });
  if (error) throw new Error(error.message);
  return data as { added: number; skipped: number };
}

/**
 * New SKUs into the item master (add_items, 0040): one typed by hand, or
 * every SKU of a WMS file's MASTER DATA / Master SKU sheets that the system
 * does not have yet. Existing items are never changed.
 */
export function AddItems({ existing }: { existing: string[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ManualItem existing={existing} />
      <ImportFromFile existing={existing} />
    </div>
  );
}

function ManualItem({ existing }: { existing: string[] }) {
  const router = useRouter();
  const [sku, setSku] = useState(""); const [description, setDescription] = useState("");
  const [uom, setUom] = useState("CAR"); const [upp, setUpp] = useState(""); const [volume, setVolume] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const s = sku.trim();
  const exists = existing.includes(s);
  const valid = /^\d{6,12}$/.test(s) && !exists && description.trim().length > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setMsg(null);
    try {
      const r = await addItems([{ sku: s, description: description.trim(), uom: uom.trim() || null,
        upp: upp ? Number(upp) : null, volume_l: volume ? Number(volume) : null }]);
      setMsg(r.added ? { ok: true, text: `SKU ${s} ditambahkan.` } : { ok: false, text: `SKU ${s} sudah ada di master.` });
      if (r.added) { setSku(""); setDescription(""); setUpp(""); setVolume(""); router.refresh(); }
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />Tambah SKU</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="n-sku">SKU (nomor material)</Label>
            <Input id="n-sku" value={sku} onChange={(e) => setSku(e.target.value)} inputMode="numeric" placeholder="mis. 550027044" />
            {exists && <p className="mt-1 text-xs text-bad">SKU ini sudah ada di master.</p>}</div>
          <div><Label htmlFor="n-uom">UOM</Label><Input id="n-uom" value={uom} onChange={(e) => setUom(e.target.value.toUpperCase())} placeholder="CAR / EA" /></div>
          <div className="col-span-2"><Label htmlFor="n-desc">Deskripsi</Label><Input id="n-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="mis. Gadus S3 V220C 3_1*18kg_A227" /></div>
          <div><Label htmlFor="n-upp">UPP (per palet)</Label><Input id="n-upp" type="number" min={1} value={upp} onChange={(e) => setUpp(e.target.value)} /></div>
          <div><Label htmlFor="n-vol">Volume (liter per unit)</Label><Input id="n-vol" type="number" min={0} step="any" value={volume} onChange={(e) => setVolume(e.target.value)} /></div>
          <div className="col-span-2 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || !valid}>{busy ? "Menyimpan…" : "Tambah ke master"}</Button>
            {msg && <span className={msg.ok ? "text-sm text-ok" : "text-sm text-bad"}>{msg.text}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ImportFromFile({ existing }: { existing: string[] }) {
  const router = useRouter();
  const [file, setFile] = useState("");
  const [items, setItems] = useState<MasterItem[] | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function read(f: File) {
    setMsg(null); setItems(null); setFile(f.name);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const have = new Set(existing);
      const missing = allMasterSkus(wb).filter((s) => !have.has(s));
      const found = masterFromWorkbook(wb, missing);
      setItems(found); setPick(new Set(found.map((i) => i.sku)));
      if (!allMasterSkus(wb).length) setMsg({ ok: false, text: "Sheet MASTER DATA / Master SKU tidak ditemukan di file ini." });
    } catch { setMsg({ ok: false, text: "File tidak bisa dibaca." }); }
  }

  async function add() {
    if (!items) return;
    setBusy(true); setMsg(null);
    try {
      const r = await addItems(items.filter((i) => pick.has(i.sku)));
      setMsg({ ok: true, text: `${fmtNum(r.added)} SKU ditambahkan${r.skipped ? `, ${fmtNum(r.skipped)} sudah ada` : ""}.` });
      setItems(null); router.refresh();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" />Impor SKU baru dari file WMS</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-steel-500">Dibaca dari sheet MASTER DATA dan Master SKU. Hanya SKU yang belum ada yang ditampilkan; item yang sudah ada tidak diubah.</p>
        <Input type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} aria-label="File WMS" />
        {items && items.length === 0 && <p className="text-sm text-ok">{file}: semua SKU di sheet master sudah ada di sistem.</p>}
        {items && items.length > 0 && (
          <>
            <p className="text-sm">{file}: <b>{fmtNum(items.length)}</b> SKU belum ada di sistem.</p>
            <div className="max-h-72 overflow-y-auto">
              <Table>
                <thead><tr><Th /><Th>SKU</Th><Th>Deskripsi</Th><Th>UOM</Th><Th>UPP</Th><Th>Liter</Th></tr></thead>
                <tbody>{items.map((i) => (
                  <tr key={i.sku}>
                    <Td><input type="checkbox" aria-label={`Tambah ${i.sku}`} checked={pick.has(i.sku)}
                      onChange={(e) => setPick((p) => { const n = new Set(p); if (e.target.checked) n.add(i.sku); else n.delete(i.sku); return n; })} /></Td>
                    <Td className="font-semibold">{i.sku}</Td><Td>{i.description}</Td><Td>{i.uom ?? "–"}</Td><Td>{i.upp ?? "–"}</Td><Td>{i.volume_l ?? "–"}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            </div>
            <Button onClick={add} disabled={busy || pick.size === 0}>{busy ? "Menambahkan…" : `Tambahkan ${fmtNum(pick.size)} SKU`}</Button>
          </>
        )}
        {msg && <p className={msg.ok ? "text-sm text-ok" : "text-sm text-bad"}>{msg.text}</p>}
      </CardContent>
    </Card>
  );
}
