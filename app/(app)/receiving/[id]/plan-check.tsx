"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ItemScanInput } from "@/components/app/item-scan-input";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { LEFTOVER_LEVELS, LEVELS, packOf, planPutaway } from "@/lib/inbound/putaway-plan";
import type { PutawaySetup } from "@/lib/inbound/load";
import { cn, fmtNum } from "@/lib/utils";
import { applyLot, lotFromBatch, lotFromMfg, type Lot } from "@/lib/inbound/lot";
import type { Actual } from "./receipt-detail";

/** One SKU of the container; its batch / production date / expiry fill every pallet of it. */
type Count = Lot & { sku: string; good: string; damaged: string; planned: number };
type Row = { key: string; sku: string; quantity: number; damaged: number; bin: string; batch: string; expiry: string; mfg: string; why: string | null; full: boolean | null };

/**
 * A planned receipt (0118): 1. what really arrived, per SKU, next to the plan; 2. the pallets with a bin each,
 * proposed by the auto putaway (full pallets: carton B-E, drum B-C, pail A, fluidbag / IBC A–B; leftovers to the pickface, level A),
 * changeable by hand; batch and expiry may wait until posting. Batch, production date and expiry are typed once
 * per SKU and copied to its pallets; a single pallet can still be changed.
 */
export function PlanCheck({ receiptId, setup, actuals, shelfLife, defaultShelfLife, onDone }: {
  receiptId: string; setup: PutawaySetup; actuals: Actual[]; shelfLife: Record<string, number>; defaultShelfLife: number; onDone: () => void;
}) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [counts, setCounts] = useState<Count[]>(() => setup.items.map((i) => {
    // A saved check: the SKU's lot is its first pallet that has one.
    const a = actuals.find((x) => x.items?.sku === i.sku && (x.batch_lot || x.mfg_date || x.expiry_date));
    return { sku: i.sku, good: String(i.expected), damaged: "0", planned: i.expected, batch: a?.batch_lot ?? "", mfg: a?.mfg_date ?? "", expiry: a?.expiry_date ?? "" };
  }));
  const [rows, setRows] = useState<Row[] | null>(() => actuals.length ? actuals.map((a) => ({
    key: `a${a.line_no}`, sku: a.items?.sku ?? "", quantity: Number(a.quantity), damaged: Number(a.damaged_qty), bin: a.bins?.bin_code ?? "",
    batch: a.batch_lot ?? "", expiry: a.expiry_date ?? "", mfg: a.mfg_date ?? "", why: null, full: null,
  })) : null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = (sku: string) => setup.allItems[sku];
  const months = (sku: string) => shelfLife[sku.trim()] ?? defaultShelfLife;
  /** Only drum / pail / IBC / fluidbag need a production date: the pallet card prints it (0119). Cartons never carry one. */
  const needsMfg = (sku: string) => { const it = item(sku.trim()); const p = it ? packOf(sku.trim(), it.uom, it.description) : null; return !!p && p !== "Carton"; };
  const mfgFor = <T extends Lot>(sku: string, lot: T): T => (needsMfg(sku) ? lot : { ...lot, mfg: "" });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const setCount = (i: number, p: Partial<Count>) => setCounts((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const setRow = (k: string, p: Partial<Row>) => setRows((rs) => rs && rs.map((r) => (r.key === k ? { ...r, ...p } : r)));
  /** The SKU's lot changed: it goes to every pallet of the SKU already proposed. */
  function setLot(i: number, next: Lot) {
    const sku = counts[i].sku.trim();
    const lot: Lot = mfgFor(sku, { batch: next.batch, mfg: next.mfg, expiry: next.expiry });
    setCount(i, lot);
    setRows((rs) => rs && applyLot(rs, sku, lot));
  }

  function allocate() {
    setError(null);
    const lotOf = (sku: string): Lot => { const c = counts.find((x) => x.sku.trim() === sku); return mfgFor(sku, { batch: c?.batch ?? "", mfg: c?.mfg ?? "", expiry: c?.expiry ?? "" }); };
    const bad = counts.find((c) => c.sku.trim() && (!item(c.sku.trim()) || !(Number(c.good) >= 0) || !(Number(c.damaged) >= 0)));
    if (bad) return setError(`SKU ${bad.sku}: tidak ada di Master item atau qty tidak valid.`);
    const lines = counts.filter((c) => c.sku.trim() && Number(c.good) > 0).map((c, i) => {
      const it = item(c.sku.trim());
      return { line: i + 1, sku: c.sku.trim(), uom: it.uom, description: it.description, quantity: Number(c.good), upp: it.upp };
    });
    const r = planPutaway({ lines, emptyBins: setup.emptyBins, pickfaces: new Map(Object.entries(setup.pickfaces)), occupied: setup.occupied });
    const out: Row[] = r.pallets.map((p) => ({ key: `${p.sku}-${p.pallet_no}`, sku: p.sku, quantity: p.quantity, damaged: 0, bin: p.bin ?? "",
      ...lotOf(p.sku), why: p.why, full: p.full }));
    for (const c of counts) if (c.sku.trim() && Number(c.damaged) > 0) {
      out.push({ key: `${c.sku}-rusak`, sku: c.sku.trim(), quantity: 0, damaged: Number(c.damaged), bin: "", ...lotOf(c.sku.trim()), why: null, full: null });
    }
    setRows(out); setWarnings(r.warnings); setConfirming(false);
  }

  async function save() {
    if (!rows) return;
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("record_receipt_check", {
      p_receipt_id: receiptId, p_by_name: person,
      p_lines: rows.map((r) => ({ sku: r.sku, quantity: r.quantity, damaged_qty: r.damaged, to_bin_code: r.quantity > 0 ? r.bin.trim().toUpperCase() : null,
        batch_lot: r.batch.trim() || null, expiry_date: r.expiry || null, mfg_date: r.mfg || null })),
    });
    setBusy(false);
    if (error) return setError(error.message);
    setConfirming(false); onDone(); router.refresh();
  }

  const good = rows?.reduce((n, r) => n + r.quantity, 0) ?? 0, dmg = rows?.reduce((n, r) => n + r.damaged, 0) ?? 0;
  const noBin = rows?.filter((r) => r.quantity > 0 && !r.bin.trim()).length ?? 0;
  const planned = counts.reduce((n, c) => n + c.planned, 0);

  return (
    <Card>
      <CardHeader><CardTitle>Periksa vs rencana · putaway otomatis</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-steel-500">1. Isi yang benar-benar datang per SKU (qty baik dan rusak; tambah SKU bila ada barang lain di kontainer).
          Isi batch (dan tanggal produksi untuk drum, pail, IBC, fluidbag) <b>sekali per SKU</b>: expired terisi otomatis (dari kode batch Shell, atau tanggal produksi + masa simpan) dan semua palet SKU itu ikut.
          2. Tekan <b>Hitung putaway</b>: sistem membagi per palet dan memilih bin (palet penuh: karton B–E, drum B–C, pail A, fluidbag / IBC A–B;
          sisa di bawah 1 palet ke pickface level A). Bin bisa diganti, dan satu palet yang berbeda batch bisa diubah sendiri. Batch dan expired boleh diisi nanti (expired wajib sebelum posting).
          Karton tidak perlu tanggal produksi.</p>
        <Table>
          <thead><tr><Th>SKU</Th><Th>Kemasan</Th><Th className="text-right">Rencana</Th><Th className="text-right">Datang (baik)</Th><Th className="text-right">Rusak</Th><Th className="text-right">Selisih</Th><Th>Batch</Th><Th>Tgl produksi</Th><Th>Expired</Th><Th /></tr></thead>
          <tbody>{counts.map((c, i) => {
            const it = item(c.sku.trim()), diff = Number(c.good || 0) + Number(c.damaged || 0) - c.planned;
            const pack = it ? packOf(c.sku.trim(), it.uom, it.description) : null;
            return (
              <tr key={i} className={cn(diff !== 0 && "bg-warn/10")}>
                <Td className="min-w-48">{c.planned > 0 ? <span className="font-semibold">{c.sku}</span>
                  : <ItemScanInput value={c.sku} onChange={(v) => setCount(i, { sku: v })} />}
                  <div className="text-xs text-steel-500">{it?.description ?? (c.sku ? "tidak ada di Master item" : "")}{it?.upp ? ` · ${fmtNum(it.upp)}/palet` : ""}</div></Td>
                <Td className="text-xs">{pack ? <>{pack}<div className="text-steel-500">penuh: {LEVELS[pack].join(", ")} · sisa: {LEFTOVER_LEVELS[pack].join(", ")}</div></> : "–"}</Td>
                <Td className="text-right tabular">{c.planned ? fmtNum(c.planned) : <span className="text-xs text-warn">tidak di rencana</span>}</Td>
                <Td className="text-right"><Input aria-label={`Datang ${c.sku}`} className="ml-auto w-24 text-right" inputMode="numeric" value={c.good}
                  onChange={(e) => setCount(i, { good: e.target.value.replace(/[^\d]/g, "") })} /></Td>
                <Td className="text-right"><Input aria-label={`Rusak ${c.sku}`} className="ml-auto w-20 text-right" inputMode="numeric" value={c.damaged}
                  onChange={(e) => setCount(i, { damaged: e.target.value.replace(/[^\d]/g, "") })} /></Td>
                <Td className={cn("text-right font-semibold tabular", diff < 0 ? "text-bad" : diff > 0 && "text-warn")}>{diff === 0 ? "–" : (diff > 0 ? "+" : "") + fmtNum(diff)}</Td>
                <Td><Input aria-label={`Batch ${c.sku}`} className="w-28 uppercase" value={c.batch} placeholder="nanti"
                  onChange={(e) => setLot(i, lotFromBatch(c, e.target.value, months(c.sku)))} /></Td>
                <Td>{needsMfg(c.sku) ? <Input aria-label={`Tanggal produksi ${c.sku}`} type="date" className="w-40" value={c.mfg} max={today}
                  onChange={(e) => setLot(i, lotFromMfg(c, e.target.value, months(c.sku)))} /> : <span className="text-xs text-steel-500">–</span>}</Td>
                <Td><Input aria-label={`Expired ${c.sku}`} type="date" className="w-40" value={c.expiry}
                  onChange={(e) => setLot(i, { batch: c.batch, mfg: c.mfg, expiry: e.target.value })} /></Td>
                <Td>{c.planned === 0 && <Button size="icon" variant="ghost" aria-label="Hapus" onClick={() => setCounts((cs) => cs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}</Td>
              </tr>
            );
          })}</tbody>
        </Table>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setCounts([...counts, { sku: "", good: "", damaged: "0", planned: 0, batch: "", mfg: "", expiry: "" }])}><Plus className="h-4 w-4" />Tambah SKU (tidak di rencana)</Button>
          <Button onClick={allocate}><Wand2 className="h-4 w-4" />Hitung putaway</Button>
        </div>
        {warnings.map((w) => <p key={w} className="rounded-md bg-warn/10 p-2 text-sm">{w}</p>)}

        {rows && (
          <>
            <Table>
              <thead><tr><Th>#</Th><Th>SKU</Th><Th className="text-right">Qty</Th><Th>Bin</Th><Th>Batch</Th><Th>Tgl produksi</Th><Th>Expired</Th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={r.key} className={cn(r.quantity > 0 && !r.bin.trim() && "bg-bad/5")}>
                  <Td className="tabular">{i + 1}</Td>
                  <Td><span className="font-semibold">{r.sku}</span><div className="text-xs text-steel-500">{r.damaged > 0 ? "rusak → karantina saat posting" : r.full === false ? "sisa → pickface" : r.full ? "palet penuh" : ""}</div></Td>
                  <Td className="text-right tabular">{r.damaged > 0 ? <span className="text-bad">{fmtNum(r.damaged)} rusak</span> : fmtNum(r.quantity)}</Td>
                  <Td>{r.quantity > 0 ? <><Input aria-label={`Bin palet ${i + 1}`} className="w-32 font-cond font-semibold uppercase" value={r.bin}
                    onChange={(e) => setRow(r.key, { bin: e.target.value.toUpperCase(), why: null })} />
                    {r.why && <div className="text-xs text-bad">{r.why}</div>}</> : "KARANTINA"}</Td>
                  <Td><Input aria-label={`Batch palet ${i + 1}`} className="w-28 uppercase" value={r.batch} placeholder="nanti"
                    onChange={(e) => setRow(r.key, mfgFor(r.sku, lotFromBatch(r, e.target.value, months(r.sku))))} /></Td>
                  <Td>{needsMfg(r.sku) ? <Input aria-label={`Tanggal produksi palet ${i + 1}`} type="date" className="w-40" value={r.mfg} max={today}
                    onChange={(e) => setRow(r.key, lotFromMfg(r, e.target.value, months(r.sku)))} /> : <span className="text-xs text-steel-500">–</span>}</Td>
                  <Td><Input aria-label={`Expired palet ${i + 1}`} type="date" className="w-40" value={r.expiry} onChange={(e) => setRow(r.key, { expiry: e.target.value })} /></Td>
                </tr>
              ))}</tbody>
            </Table>
            {!confirming ? (
              <Button size="lg" disabled={noBin > 0 || rows.length === 0} onClick={() => setConfirming(true)}>
                {noBin > 0 ? `${noBin} palet belum punya bin` : "Simpan pemeriksaan…"}</Button>
            ) : (
              <div className="space-y-3 rounded-md bg-ckb-tint/40 p-3 ring-1 ring-ckb/30">
                <p className="text-sm"><b>{fmtNum(rows.filter((r) => r.quantity > 0).length)} palet</b>, {fmtNum(good)} baik ke bin
                  {dmg > 0 && `, ${fmtNum(dmg)} rusak ke karantina`}; rencana {fmtNum(planned)}, selisih {fmtNum(good + dmg - planned)}.
                  Setelah disimpan, kartu palet bisa dicetak di Kartu palet. Simpan?</p>
                <PersonNameField id="plan-person" value={person} onChange={setPerson} label="Nama pemeriksa" />
                <div className="flex gap-2">
                  <Button disabled={busy || person.trim().length < 2} onClick={save}>{busy ? "Menyimpan…" : "Ya, simpan"}</Button>
                  <Button variant="outline" onClick={() => setConfirming(false)}>Batal</Button>
                </div>
              </div>
            )}
          </>
        )}
        {error && <p role="alert" className="rounded-md bg-bad/10 p-2 text-sm text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}
