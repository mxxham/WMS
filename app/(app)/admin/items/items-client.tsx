"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtNum } from "@/lib/utils";
import { AddItems } from "./add-items";

export type ItemRow = {
  sku: string; description: string; uom: string | null; upp: number | null; volume_l: number | null; abc_class: string | null;
  ean: string | null; shelf_life_months: number | null; min_dispatch_days: number | null;
};

/**
 * Carton barcode (EAN, scanned to verify the right item at receiving,
 * counting and picking), shelf life (expiry = batch production date + this)
 * and the minimum days of life left to dispatch. Empty = the policy default.
 */
export function ItemsClient({ items, defaultShelfLife, defaultMinDispatch }: { items: ItemRow[]; defaultShelfLife: number; defaultMinDispatch: number }) {
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const shown = useMemo(() => items.filter((i) => (!q.trim() || `${i.sku} ${i.description} ${i.ean ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    && (!onlyMissing || !i.ean)), [items, q, onlyMissing]);
  const withEan = items.filter((i) => i.ean).length;
  return (
    <div className="space-y-4 p-4 lg:p-8">
      <p className="max-w-3xl text-sm text-steel-500">
        Barcode karton dipakai untuk memastikan barang yang benar saat penerimaan, cycle count dan picking. Umur simpan kosong = standar {defaultShelfLife} bulan;
        sisa umur minimum kosong = standar {defaultMinDispatch} hari (Pengaturan → Aturan inventory). {fmtNum(withEan)} dari {fmtNum(items.length)} SKU sudah punya barcode.
      </p>
      <AddItems existing={items.map((i) => i.sku)} />
      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4">
        <div className="min-w-64 flex-1"><Label htmlFor="q">Cari</Label><Input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, deskripsi, barcode" /></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />Belum punya barcode</label>
      </div>
      <Card>
        <CardContent>
          <Table sticky>
            <thead><tr><Th>SKU</Th><Th>Deskripsi</Th><Th>UOM</Th><Th>UPP</Th><Th>Liter</Th><Th>Barcode karton (EAN)</Th><Th>Umur simpan (bulan)</Th><Th>Sisa umur min. kirim (hari)</Th><Th /></tr></thead>
            <tbody>{shown.map((i) => <ItemLine key={i.sku} item={i} defaultShelfLife={defaultShelfLife} defaultMinDispatch={defaultMinDispatch} />)}</tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ItemLine({ item, defaultShelfLife, defaultMinDispatch }: { item: ItemRow; defaultShelfLife: number; defaultMinDispatch: number }) {
  const router = useRouter();
  const [ean, setEan] = useState(item.ean ?? "");
  const [life, setLife] = useState(item.shelf_life_months?.toString() ?? "");
  const [minDays, setMinDays] = useState(item.min_dispatch_days?.toString() ?? "");
  // Master data (update_item, 0041).
  const [desc, setDesc] = useState(item.description);
  const [uom, setUom] = useState(item.uom ?? "");
  const [upp, setUpp] = useState(item.upp?.toString() ?? "");
  const [vol, setVol] = useState(item.volume_l?.toString() ?? "");
  const masterDirty = desc !== item.description || uom !== (item.uom ?? "") || upp !== (item.upp?.toString() ?? "") || vol !== (item.volume_l?.toString() ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const controlDirty = ean !== (item.ean ?? "") || life !== (item.shelf_life_months?.toString() ?? "") || minDays !== (item.min_dispatch_days?.toString() ?? "");
  const dirty = controlDirty || masterDirty;
  async function save() {
    let error: { message: string } | null = null;
    if (masterDirty) {
      ({ error } = await createClient().rpc("update_item", {
        p_sku: item.sku, p_description: desc, p_uom: uom || null, p_upp: upp ? Number(upp) : null, p_volume_l: vol ? Number(vol) : null,
      }));
    }
    if (!error && controlDirty) {
      ({ error } = await createClient().rpc("set_item_control", {
        p_sku: item.sku, p_ean: ean || null, p_shelf_life_months: life ? Number(life) : null, p_min_dispatch_days: minDays ? Number(minDays) : null,
      }));
    }
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Tersimpan" });
    if (!error) router.refresh();
  }
  return (
    <tr>
      <Td className="font-semibold">{item.sku}</Td>
      <Td><Input aria-label={`Deskripsi ${item.sku}`} className="h-8 min-w-56 text-xs" value={desc} onChange={(e) => setDesc(e.target.value)} /></Td>
      <Td><Input aria-label={`UOM ${item.sku}`} className="h-8 w-16" value={uom} onChange={(e) => setUom(e.target.value.toUpperCase())} placeholder="CAR" /></Td>
      <Td><Input aria-label={`UPP ${item.sku}`} className="h-8 w-20" type="number" min={1} value={upp} onChange={(e) => setUpp(e.target.value)} /></Td>
      <Td><Input aria-label={`Liter ${item.sku}`} className="h-8 w-20" type="number" min={0} step="any" value={vol} onChange={(e) => setVol(e.target.value)} /></Td>
      <Td><Input aria-label={`Barcode ${item.sku}`} className="h-8 w-40" inputMode="numeric" value={ean} onChange={(e) => setEan(e.target.value)} placeholder="scan karton" /></Td>
      <Td><Input aria-label={`Umur simpan ${item.sku}`} className="h-8 w-24" type="number" min={1} max={240} value={life} onChange={(e) => setLife(e.target.value)} placeholder={String(defaultShelfLife)} /></Td>
      <Td><Input aria-label={`Sisa umur minimum ${item.sku}`} className="h-8 w-24" type="number" min={0} value={minDays} onChange={(e) => setMinDays(e.target.value)} placeholder={String(defaultMinDispatch)} /></Td>
      <Td className="whitespace-nowrap">
        <Button size="sm" variant="outline" onClick={save} disabled={!dirty}>Simpan</Button>
        {msg && <span className={cn("ml-2 text-xs", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</span>}
      </Td>
    </tr>
  );
}
