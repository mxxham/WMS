"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { fetchAll } from "@/lib/fetch-all";

type DayRow = {
  bin_code: string; sku: string; description: string | null; uom: string | null; upp: number | null; batch_lot: string;
  expiry_date: string | null; received_date: string | null;
  on_hand: number; pick: number; b_out: number; b_in: number; putaway: number; adjust: number; remain: number;
};

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/**
 * "Laporan WMS harian" (0055): the WMS sheet's on hand and remain for one
 * date, rebuilt from the movements ledger, to compare with SAP. Sheet WMS per
 * bin (Qty = on hand after inbound/putaway, before picking; Remain Qty = after
 * picking, tomorrow's on hand), sheet SAP per SKU, sheet Catatan with the rule.
 */
export function WmsDayDownload() {
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true); setError(null);
    try {
      const db = createClient();
      const rows = await fetchAll<DayRow>((a, b) => db.rpc("wms_day_report", { p_date: date }).range(a, b) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>);
      const XLSX = await import("xlsx");
      const num = (v: number) => Number(v);
      const wms = rows.map((r) => ({
        Lokasi: r.bin_code, item: r.sku, Description: r.description ?? "", Batch: r.batch_lot, "GR date": r.received_date ?? "",
        "Expired Date": r.expiry_date ?? "", UPP: r.upp ?? "",
        "Qty (on hand)": num(r.on_hand), PICK: num(r.pick), "b out": num(r.b_out), "b in": num(r.b_in),
        "putaway (sudah di Qty)": num(r.putaway), "Adjust (sudah di Qty)": num(r.adjust), "Remain Qty": num(r.remain),
      }));
      const bySku = new Map<string, { item: string; Description: string; UOM: string; "On hand": number; PICK: number; "b out": number; "b in": number; Remain: number }>();
      for (const r of rows) {
        const e = bySku.get(r.sku) ?? { item: r.sku, Description: r.description ?? "", UOM: r.uom ?? "", "On hand": 0, PICK: 0, "b out": 0, "b in": 0, Remain: 0 };
        e["On hand"] += num(r.on_hand); e.PICK += num(r.pick); e["b out"] += num(r.b_out); e["b in"] += num(r.b_in); e.Remain += num(r.remain);
        bySku.set(r.sku, e);
      }
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(wms), "WMS");
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([...bySku.values()].sort((a, b) => a.item.localeCompare(b.item))), "SAP");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
        [`Laporan WMS harian ${date} (Asia/Jakarta), dari riwayat mutasi sistem`],
        ["Qty (on hand)", "stok setelah inbound/putaway selesai, sebelum picking hari itu"],
        ["PICK", "karton yang dipick hari itu dari bin ini (pick yang dibatalkan dikurangkan)"],
        ["b out / b in", "pindah keluar / masuk bin hari itu (Bin To Bin, Mutasi)"],
        ["Remain Qty", "stok setelah picking = Qty − PICK − b out + b in; jadi on hand besok"],
        ["putaway, Adjust", "jumlah hari itu, hanya informasi: sudah termasuk di Qty (impor pagi, hitung ulang)"],
        ["SAP", "total per SKU dari sheet WMS, untuk dibandingkan dengan stok SAP"],
      ]), "Catatan");
      XLSX.writeFile(book, `wms_harian_${date}.xlsx`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-steel-100 bg-white px-4 py-3 lg:px-8">
      <div>
        <Label htmlFor="wms-day">Laporan WMS harian (on hand & remain untuk SAP)</Label>
        <Input id="wms-day" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="w-44" />
      </div>
      <Button variant="outline" onClick={download} disabled={busy || !date}><Download className="h-4 w-4" />{busy ? "Menyiapkan…" : "Unduh Excel"}</Button>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}
