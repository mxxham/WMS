"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { withConfig } from "@/lib/allocator/config";
import { inventoryToStock } from "@/lib/allocator/adapters/inventory-stock";
import { loadDispatchRules, loadPickfaceOverrides, loadPlanningStock } from "@/lib/allocator/browser/plan-client";
import { runPipeline } from "@/lib/allocator/pipeline";
import { buildPlan, type PlanPayload } from "@/lib/allocator/plan";
import { binToBin } from "@/lib/allocator/picklist";
import type { AllocationResult, DemandLine } from "@/lib/allocator/types";
import { fmtDate, fmtNum } from "@/lib/utils";

type Line = { sku: string; qty: string; orderNo: string };
const NEW_WAVE = "BARU";

/**
 * "Tambah order": a late order (new shipment number) straight onto the wave
 * page, without the Schedule of the day sheet or re-running the day's
 * Alokasi. It is allocated FEFO from the stock no wave has claimed yet
 * (planning_stock p_keep_all) and saved as one new wave (add_order_wave, 0044).
 */
export function AddOrder({ date }: { date: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shipment, setShipment] = useState(""); const [destination, setDestination] = useState("");
  const [truck, setTruck] = useState(""); const [slot, setSlot] = useState("");
  const [lines, setLines] = useState<Line[]>([{ sku: "", qty: "", orderNo: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ payload: PlanPayload; allocation: AllocationResult } | null>(null);

  const setLine = (i: number, patch: Partial<Line>) => { setPlan(null); setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); };
  const filled = lines.filter((l) => l.sku.trim() && Number(l.qty) > 0);

  async function calculate() {
    setBusy(true); setError(null); setPlan(null);
    try {
      if (!shipment.trim()) throw new Error("Isi nomor shipment.");
      if (!filled.length) throw new Error("Isi minimal satu SKU dengan jumlah.");
      const db = createClient();
      const skus = [...new Set(filled.map((l) => l.sku.trim()))];
      const { data: items, error: e1 } = await db.from("items").select("sku, description, upp").in("sku", skus);
      if (e1) throw new Error(e1.message);
      const known = new Map((items ?? []).map((i) => [i.sku as string, i as { sku: string; description: string; upp: number | null }]));
      const unknown = skus.filter((s) => !known.has(s));
      if (unknown.length) throw new Error(`SKU tidak ada di master item: ${unknown.join(", ")}`);
      const config = withConfig({
        asOf: new Date(`${date}T00:00:00Z`),
        pickfaceOverrides: await loadPickfaceOverrides(db),
        ...(await loadDispatchRules(db)),
      });
      // Every open task keeps its stock, also those of the day's untouched waves.
      const stock = inventoryToStock(await loadPlanningStock(db, date, [], true), config);
      const bySku = new Map<string, DemandLine>();
      for (const l of filled) {
        const sku = l.sku.trim(), it = known.get(sku)!;
        const d = bySku.get(sku);
        if (d) { d.qtyCartons += Number(l.qty); if (l.orderNo.trim()) d.orderNos.push(l.orderNo.trim()); continue; }
        bySku.set(sku, {
          shipmentNumber: shipment.trim(), waveNo: NEW_WAVE, orderNos: l.orderNo.trim() ? [l.orderNo.trim()] : [], sku,
          description: it.description, qtyCartons: Number(l.qty), upp: Number(it.upp) || 1, destination: destination.trim(),
          shipToLocation: destination.trim(), transport: null, truckType: truck.trim() || null, slotTime: slot.trim() || null, deliveryDate: null,
        });
      }
      const demand = [...bySku.values()];
      const run = runPipeline(stock.stock, demand, stock.stagedBySku, config, stock.warnings);
      setPlan({ payload: buildPlan(run.allocation, demand, run.pickfaces), allocation: run.allocation });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!plan) return;
    setBusy(true); setError(null);
    const { payload } = plan;
    const { data, error } = await createClient().rpc("add_order_wave", {
      p_date: date, p_plan: { wave: payload.waves[0], tasks: payload.tasks, outbound: payload.outbound },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false); setPlan(null); setShipment(""); setDestination(""); setTruck(""); setSlot(""); setLines([{ sku: "", qty: "", orderNo: "" }]);
    router.refresh();
    alert(`Order disimpan sebagai wave NO ${(data as { wave_no: string }).wave_no}.`);
  }

  const picked = plan?.allocation.picklists.flatMap((p) => p.lines) ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="h-4 w-4" />Tambah order</Button></DialogTrigger>
      <DialogContent title={`Tambah order · ${fmtDate(date)}`} description="Order baru langsung ke wave, tanpa sheet Schedule of the day.">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="ao-sh">Nomor shipment</Label><Input id="ao-sh" value={shipment} onChange={(e) => { setShipment(e.target.value); setPlan(null); }} inputMode="numeric" /></div>
            <div><Label htmlFor="ao-dest">Tujuan</Label><Input id="ao-dest" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="nama customer" /></div>
            <div><Label htmlFor="ao-truck">Truk</Label><Input id="ao-truck" value={truck} onChange={(e) => setTruck(e.target.value)} placeholder="mis. CDD" /></div>
            <div><Label htmlFor="ao-slot">Jam (slot)</Label><Input id="ao-slot" value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="mis. 09:30" /></div>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_1fr_auto] items-end gap-2">
                <div><Label htmlFor={`ao-sku-${i}`}>SKU</Label><Input id={`ao-sku-${i}`} value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })} inputMode="numeric" /></div>
                <div><Label htmlFor={`ao-qty-${i}`}>Qty</Label><Input id={`ao-qty-${i}`} type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></div>
                <div><Label htmlFor={`ao-ord-${i}`}>Order No (opsional)</Label><Input id={`ao-ord-${i}`} value={l.orderNo} onChange={(e) => setLine(i, { orderNo: e.target.value })} /></div>
                <Button variant="ghost" size="sm" aria-label="Hapus baris" disabled={lines.length === 1}
                  onClick={() => { setPlan(null); setLines((ls) => ls.filter((_, j) => j !== i)); }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => { setPlan(null); setLines((ls) => [...ls, { sku: "", qty: "", orderNo: "" }]); }}><Plus className="h-4 w-4" />Baris SKU</Button>
          </div>

          {plan && (
            <div className="space-y-2">
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <thead><tr><Th>Bin</Th><Th>SKU</Th><Th>Batch</Th><Th>Qty</Th><Th>Bin To Bin</Th></tr></thead>
                  <tbody>{picked.map((l, i) => (
                    <tr key={i}><Td className="font-semibold">{l.location}</Td><Td>{l.sku}</Td><Td>{l.batch ?? "–"}</Td>
                      <Td className="tabular">{fmtNum(l.qtyPick)}</Td><Td className="text-xs">{binToBin(l) ? `${binToBin(l)}${l.moveQty ? ` (${fmtNum(l.moveQty)})` : ""}` : "–"}</Td></tr>
                  ))}</tbody>
                </Table>
              </div>
              {plan.allocation.shortages.length > 0 && (
                <p className="rounded-md bg-warn/10 p-2 text-sm">Kurang stok: {plan.allocation.shortages.map((s) => `${s.sku} kurang ${fmtNum(s.qtyShort)}`).join(", ")}. Order tetap disimpan dengan kekurangannya.</p>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={calculate} disabled={busy}>{busy && !plan ? "Menghitung…" : "Hitung"}</Button>
            <Button size="lg" onClick={save} disabled={busy || !plan}>{busy && plan ? "Menyimpan…" : "Simpan jadi wave baru"}</Button>
          </div>
          <p className="text-xs text-steel-500">Stok diambil FEFO dari stok yang belum dipakai wave lain hari ini. Wave lain tidak berubah.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
