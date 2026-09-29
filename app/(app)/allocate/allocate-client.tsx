"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, FileSpreadsheet, FileText, Play, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { ConfirmButton } from "@/components/app/confirm-button";
import { cn, fmtNum } from "@/lib/utils";
import { expiryText, withConfig } from "@/lib/allocator/config";
import { loadWorkbookFromBuffer } from "@/lib/allocator/browser/browser-input";
import { inventoryToStock } from "@/lib/allocator/adapters/inventory-stock";
import { keptShipments, loadDispatchRules, loadPickfaceOverrides, loadPlanContext, loadPlanningStock, savePlan, type PlanContext } from "@/lib/allocator/browser/plan-client";
import { runPipeline, type PipelineResult } from "@/lib/allocator/pipeline";
import { buildPlan } from "@/lib/allocator/plan";
import { binToBin, sisaPrinted, uomLabel } from "@/lib/allocator/picklist";
import { parseLocation } from "@/lib/allocator/pickpath";
import { matchParked, type CarryMatch, type ParkedOrder } from "@/lib/allocator/carry-over";

type Source = "db" | "file";
type Tab = "picklist" | "shortage" | "movement" | "pickface" | "double" | "warning";

const REASON: Record<string, string> = { ALREADY_STAGED: "Sudah di staging", BLOCKED_SHELF_LIFE: "Terblokir umur simpan", NO_STOCK: "Stok tidak ada" };
const todayIso = () => new Date().toLocaleDateString("sv-SE");

/**
 * Upload the day's WMS workbook (for its "Schedule of the day" sheet), run the
 * FEFO allocator against live database stock, review, then save the plan as
 * waves + pick tasks. The workbook's own stock sheet can be used instead for a
 * what-if run; that plan cannot be saved because it is not the ledger's stock.
 */
export function AllocateClient() {
  const [file, setFile] = useState<{ name: string; buf: ArrayBuffer } | null>(null);
  const [asOf, setAsOf] = useState(todayIso());
  const [source, setSource] = useState<Source>("db");
  const [minShelfLife, setMinShelfLife] = useState("0");
  // Per-SKU minimums from the item master; the global one starts at the policy's value.
  const [minBySku, setMinBySku] = useState<Record<string, number>>({});
  useEffect(() => {
    loadDispatchRules(createClient()).then((r) => { setMinShelfLife(String(r.minRemainingShelfLifeDays)); setMinBySku(r.minRemainingShelfLifeDaysBySku); })
      .catch((e: Error) => setError(`Aturan sisa umur tidak terbaca (${e.message}); isi minimum secara manual.`));
  }, []);
  const [target, setTarget] = useState("upp");
  const [split, setSplit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [run, setRun] = useState<(PipelineResult & {
    source: Source; asOf: string; demand: ReturnType<typeof loadWorkbookFromBuffer>["demand"];
    ctx: PlanContext | null; skipped: string[];
    /** parked (Tunda) orders of earlier days found again on this schedule: carried over on save (0036) */
    carry: CarryMatch[];
  }) | null>(null);
  const [tab, setTab] = useState<Tab>("picklist");

  async function execute() {
    if (!file) return;
    setBusy(true); setError(null); setSaved(null);
    try {
      const config = withConfig({
        asOf: new Date(`${asOf}T00:00:00Z`),
        // Fixed pickfaces apply to both stock sources: they describe the warehouse, not the file.
        pickfaceOverrides: await loadPickfaceOverrides(createClient()),
        minRemainingShelfLifeDays: Number(minShelfLife) || 0,
        minRemainingShelfLifeDaysBySku: minBySku,
        splitPalletAndCaseTasks: split,
        pickfaceTargetQty: target === "upp" ? "upp" : Number(target),
      });
      const wb = loadWorkbookFromBuffer(file.buf, config);
      if (wb.demand.length === 0) throw new Error('Sheet "Schedule of the day" kosong atau tidak ditemukan.');
      let stock = wb.stock, staged = wb.stagedBySku, warnings = wb.warnings, demand = wb.demand;
      let ctx: PlanContext | null = null;
      let skipped: string[] = [];
      let carry: CarryMatch[] = [];
      if (source === "db") {
        const supabase = createClient();
        // Stock net of what open tasks of other waves will still take or bring in.
        ctx = await loadPlanContext(supabase, asOf);
        const db = inventoryToStock(await loadPlanningStock(supabase, asOf), config);
        // The workbook's warnings are all about its stock sheet, which is not used here.
        stock = db.stock; staged = db.stagedBySku; warnings = db.warnings;
        // Shipments of waves already worked on / paused / cancelled are not planned again.
        const kept = keptShipments(ctx);
        skipped = [...new Set(demand.filter((d) => kept.has(d.shipmentNumber)).map((d) => d.shipmentNumber))];
        demand = demand.filter((d) => !kept.has(d.shipmentNumber));
        // Orders parked on an earlier day, back on today's schedule (maybe under a new shipment
        // number): their old wave still holds their stock, so it is carried over, not planned again.
        const { data: parked, error: pe } = await supabase.rpc("parked_orders", { p_date: asOf });
        if (pe) throw new Error(pe.message);
        const found = matchParked(demand, ((parked ?? []) as ParkedOrder[]).filter((p) => p.planned_date < asOf));
        carry = found.matches;
        demand = demand.filter((d) => !found.matchedDemand.has(d));
      }
      setRun({ ...runPipeline(stock, demand, staged, config, warnings), source, asOf, demand, ctx, skipped, carry });
      setTab("picklist");
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function save(): Promise<string | null> {
    if (!run) return null;
    try {
      const db = createClient();
      const r = await savePlan(db, run.asOf, run, run.demand);
      // After save_plan (which replaces the date's untouched waves): move the parked waves in.
      const carried: string[] = [];
      for (const m of run.carry) {
        const { data, error } = await db.rpc("carry_over_wave", {
          p_wave_id: m.wave_id, p_date: run.asOf, p_shipments: m.shipments, p_reason: `order muncul lagi di jadwal ${run.asOf}`,
        });
        if (error) throw new Error(`Rencana tersimpan, tapi wave NO ${m.wave_no} (${m.planned_date}) gagal dilanjutkan: ${error.message}`);
        carried.push((data as { wave_no: string }).wave_no);
      }
      setSaved(`${fmtNum(r.waves)} wave, ${fmtNum(r.tasks)} tugas, ${fmtNum(r.outbound)} baris order disimpan`
        + (r.replaced ? `, ${r.replaced} wave lama yang belum dikerjakan diganti` : "")
        + (r.kept ? `, ${r.kept} wave yang sudah berjalan tetap` : "")
        + (carried.length ? `, ${carried.length} wave yang ditunda dilanjutkan (${carried.join(", ")})` : "") + ".");
      return null;
    } catch (e) { return (e as Error).message; }
  }

  const s = run?.allocation.stats;
  const plan = useMemo(() => (run ? buildPlan(run.allocation, run.demand, run.pickfaces) : null), [run]);

  return (
    <div className="space-y-4 p-4 lg:p-8">
      <Card>
        <CardHeader><CardTitle>1. Jadwal & opsi</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-3">
            <Label htmlFor="wb">File WMS harian (.xlsx) — dipakai sheet &ldquo;Schedule of the day&rdquo;</Label>
            <label htmlFor="wb" className="mt-1 flex cursor-pointer items-center gap-3 rounded-md border-2 border-dashed border-steel-300 bg-paper p-4 hover:border-ckb">
              <FileSpreadsheet className="h-6 w-6 text-steel-500" />
              <span className="text-sm">{file ? file.name : "Pilih atau seret file"}</span>
            </label>
            <input id="wb" type="file" accept=".xlsx,.xlsm" className="sr-only"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFile({ name: f.name, buf: await f.arrayBuffer() }); setRun(null); } }} />
          </div>
          <div><Label htmlFor="asof">Tanggal alokasi</Label><Input id="asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
          <div>
            <Label htmlFor="src">Sumber stok</Label>
            <Select id="src" value={source} onChange={(e) => setSource(e.target.value as Source)}>
              <option value="db">Database (stok sistem, dikurangi tugas terbuka)</option>
              <option value="file">Sheet WMS di file (simulasi, tidak bisa disimpan)</option>
            </Select>
          </div>
          <div><Label htmlFor="msl" title="Standar dari aturan inventory; SKU dengan aturan sendiri di Master item memakai aturannya">Sisa umur minimum (hari){Object.keys(minBySku).length > 0 && ` · ${Object.keys(minBySku).length} SKU punya aturan sendiri`}</Label><Input id="msl" type="number" min={0} value={minShelfLife} onChange={(e) => setMinShelfLife(e.target.value)} /></div>
          <div>
            <Label htmlFor="tq">Target isi pickface</Label>
            <Select id="tq" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="upp">1 palet penuh (UPP)</option>
              {[24, 48, 96].map((n) => <option key={n} value={n}>{n} karton</option>)}
            </Select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
            Pisahkan picklist forklift (palet) & handpick (karton)
          </label>
          <div className="self-end">
            <Button onClick={execute} disabled={!file || busy} className="w-full"><Play className="h-4 w-4" />{busy ? "Menghitung…" : "Jalankan alokasi"}</Button>
          </div>
          {error && <p role="alert" className="text-sm text-bad md:col-span-3">{error}</p>}
        </CardContent>
      </Card>

      {run && s && plan && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Fill rate" value={`${s.fillRatePct.toFixed(1)}%`} sub={`${fmtNum(s.cartonsAllocated)} / ${fmtNum(s.cartonsRequested)} karton`} />
            <Kpi label="Picklist" value={fmtNum(run.allocation.picklists.length)} sub={`${s.palletPicks} palet · ${s.casePicks} karton`} />
            <Kpi label="Kekurangan" value={fmtNum(run.allocation.shortages.length)} sub="baris order kurang" tone={run.allocation.shortages.length ? "warn" : undefined} />
            <Kpi label="Palet dibuka" value={fmtNum(s.palletsBroken)} sub={`${plan.tasks.filter((t) => t.task_type === "REPLENISH").length} relokasi ke pickface`} />
          </div>

          {run.skipped.length > 0 && (
            <p role="status" className="rounded-md border border-steel-300 bg-white p-3 text-sm">
              {run.skipped.length} shipment dilewati karena wave-nya sudah dikerjakan, ditunda, atau dibatalkan: {run.skipped.join(", ")}.
              Stok yang dipakai sudah dikurangi tugas yang masih terbuka.
            </p>
          )}
          {run.carry.length > 0 && (
            <CarryPanel matches={run.carry} asOf={run.asOf} onReplan={async (m) => {
              const { error } = await createClient().rpc("set_wave_status", {
                p_wave_id: m.wave_id, p_status: "CANCELLED", p_reason: `direncanakan ulang di jadwal ${run.asOf}`,
              });
              if (error) return error.message;
              await execute();
              return null;
            }} />
          )}
          {run.doubles.total > 0 && (
            <p role="alert" className="flex items-center gap-2 rounded-md bg-bad p-3 text-sm font-semibold text-white">
              <AlertTriangle className="h-5 w-5" />
              Double pick: {run.doubles.total} bin cadangan diambil lebih dari sekali ({run.doubles.pickDoubles.map((d) => d.location).join(", ")})
            </p>
          )}

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>2. Hasil</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={async () => (await import("@/lib/allocator/browser/downloads")).downloadPicklistPdf(run.allocation.picklists, run.pickfaces, `picklist_${run.asOf}.pdf`)}><FileText className="h-4 w-4" />PDF picklist</Button>
                <Button variant="outline" size="sm" onClick={async () => (await import("@/lib/allocator/browser/downloads")).downloadAllocationWorkbook(run.allocation, run.movement, run.pickfaces, `picklist_${run.asOf}.xlsx`)}><FileSpreadsheet className="h-4 w-4" />Excel</Button>
                {run.source === "db" ? (
                  <ConfirmButton size="sm" variant="plate" title="Simpan rencana"
                    summary={`Simpan ${plan.waves.length} wave dan ${plan.tasks.length} tugas untuk ${run.asOf}.`
                      + (run.ctx?.replaceable.length ? ` ${run.ctx.replaceable.length} wave tanggal ini yang belum dikerjakan akan diganti.` : "")
                      + (run.ctx?.kept.length ? ` ${run.ctx.kept.length} wave yang sudah berjalan tidak diubah.` : "")
                      + " Stok belum berubah sampai tugas diposting."}
                    onConfirm={save}><Save className="h-4 w-4" />Simpan rencana</ConfirmButton>
                ) : (
                  <span className="self-center text-xs text-steel-500">Simulasi dari file — pilih sumber stok Database untuk menyimpan.</span>
                )}
              </div>
            </CardHeader>
            {saved && (
              <p role="status" className="border-b border-steel-100 bg-ok/10 px-4 py-2 text-sm">
                {saved} <Link href={`/waves?date=${run.asOf}`} className="font-semibold underline">Buka wave →</Link>
              </p>
            )}
            <nav className="flex gap-1 overflow-x-auto border-b border-steel-100 px-2" role="tablist">
              {([
                ["picklist", `Picklist (${run.allocation.picklists.length})`],
                ["shortage", `Kekurangan (${run.allocation.shortages.length})`],
                ["movement", `Rencana mutasi (${run.movement.length})`],
                ["pickface", `Pickface (${run.pickfaces.size})`],
                ["double", `Double pick (${run.doubles.total})`],
                ["warning", `Peringatan (${run.allocation.warnings.length})`],
              ] as [Tab, string][]).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === k ? "border-ckb font-semibold text-ckb" : "border-transparent text-steel-500")}>{label}</button>
              ))}
            </nav>
            <CardContent className="p-0">
              {tab === "picklist" && <PicklistTab run={run} />}
              {tab === "shortage" && (
                <Rows empty="Tidak ada kekurangan — semua order terpenuhi."
                  head={["Shipment", "SKU", "Deskripsi", "Diminta", "Teralokasi", "Kurang", "Alasan"]}
                  rows={run.allocation.shortages.map((x) => [x.shipmentNumber, x.sku, x.description, fmtNum(x.qtyRequested), fmtNum(x.qtyAllocated), fmtNum(x.qtyShort), REASON[x.reason] ?? x.reason])} />
              )}
              {tab === "movement" && (
                <Rows head={["#", "Jenis", "SKU", "Batch", "Exp", "Qty", "Dari", "Ke", "Shipment", "Sisa"]}
                  rows={run.movement.map((m) => [m.seq, m.type, m.sku, m.batch ?? "–", expiryText(m.expiryDate), `${fmtNum(m.qty)} ${uomLabel(m.uom)}`, m.fromLocation, m.toLocation, m.shipmentNumber ?? "–", fmtNum(m.qtyRemainingAtFrom)])} />
              )}
              {tab === "pickface" && (
                <Rows head={["SKU", "Deskripsi", "Bin pickface", "Target", "Sumber"]}
                  rows={[...run.pickfaces.values()].sort((a, b) => a.sku.localeCompare(b.sku)).map((p) => [p.sku, p.description, p.location, fmtNum(p.targetQtyCartons), p.isAuto ? "Otomatis (bin terdekat)" : "Ditetapkan"])} />
              )}
              {tab === "double" && (
                <Rows empty="Tidak ada double pick — setiap bin cadangan hanya diambil sekali."
                  head={["Bin", "SKU", "Batch", "Exp", "Total qty", "Pick"]}
                  rows={run.doubles.pickDoubles.map((d) => [d.location, d.sku, d.batch ?? "–", expiryText(d.expiryDate), fmtNum(d.totalQty), d.movements.map((m) => `#${m.seq} ${m.qty} → ${m.toLocation}`).join(" · ")])} />
              )}
              {tab === "warning" && (
                <Rows empty="Tidak ada peringatan." head={["Level", "Kode", "Pesan"]}
                  rows={run.allocation.warnings.map((w) => [w.level, w.code, w.message])} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "warn" }) {
  return (
    <div className={cn("rounded-lg border border-steel-100 bg-white p-4", tone === "warn" && "border-warn")}>
      <p className="text-xs text-steel-500">{label}</p>
      <p className="font-cond text-3xl font-semibold tabular">{value}</p>
      <p className="text-xs text-steel-500">{sub}</p>
    </div>
  );
}

function Rows({ head, rows, empty = "Tidak ada data." }: { head: string[]; rows: (string | number)[][]; empty?: string }) {
  if (!rows.length) return <p className="p-4 text-sm text-steel-500">{empty}</p>;
  return (
    <Table>
      <thead><tr>{head.map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <Td key={j}>{c}</Td>)}</tr>)}</tbody>
    </Table>
  );
}

function PicklistTab({ run }: { run: PipelineResult }) {
  if (!run.allocation.picklists.length) return <p className="p-4 text-sm text-steel-500">Tidak ada picklist.</p>;
  return (
    <div className="divide-y divide-steel-100">
      {run.allocation.picklists.map((pl) => (
        <details key={pl.picklistId} className="group" open>
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 px-4 py-3">
            <span className="font-cond text-lg font-semibold">{pl.picklistId}</span>
            <span className="text-sm text-steel-500">NO {pl.waveNo} · {pl.destination} · slot {pl.slotTime ?? "–"} · DO {pl.orderNos.join(", ")} · {fmtNum(pl.totalCartons)} karton</span>
          </summary>
          <Table>
            <thead><tr>{["#", "Lokasi", "SKU", "Deskripsi", "Bin To Bin", "Batch", "Exp", "Qty", "Jenis", "Sisa"].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
            <tbody>{pl.lines.map((l) => {
              // The recorded move, same as the PDF and Excel picklists.
              const toPf = binToBin(l);
              return (
                <tr key={`${l.seq}-${l.location}`}>
                  <Td>{l.seq}</Td><Td className="font-semibold">{l.location}</Td><Td>{l.sku}</Td><Td>{l.description}</Td>
                  <Td className="font-semibold text-steel-700">{toPf}</Td><Td>{l.batch ?? "–"}</Td><Td>{expiryText(l.expiryDate)}</Td>
                  <Td className="text-right">{fmtNum(l.qtyPick)} {uomLabel(l.uom)}</Td><Td>{l.breaksPallet ? "CASE*" : l.pickType}</Td><Td className="text-right">{fmtNum(sisaPrinted(l))}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        </details>
      ))}
    </div>
  );
}

/**
 * Parked (Tunda) orders of earlier days found again on this schedule. By
 * default their old wave is carried over on save (same stock, same picks,
 * new shipment number); "Rencana baru" cancels it and plans them fresh.
 */
function CarryPanel({ matches, asOf, onReplan }: { matches: CarryMatch[]; asOf: string; onReplan: (m: CarryMatch) => Promise<string | null> }) {
  return (
    <div className="space-y-3 rounded-md border-2 border-warn bg-white p-3 text-sm">
      <p className="font-semibold">{matches.length} wave yang ditunda muncul lagi di jadwal ini (SKU dan shipment / Order No sama). Tidak direncanakan ulang:
        saat disimpan, wave lama dilanjutkan ke {asOf} dengan nomor shipment baru.</p>
      {matches.map((m) => (
        <div key={m.wave_id} className="space-y-1 rounded border border-steel-100 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p><b>NO {m.wave_no}</b> · {m.planned_date} · ditunda{m.posted_tasks > 0 ? ` · ${m.posted_tasks} tugas sudah diposting` : ""}
              {" → "}<b>T{m.wave_no.replace(/^T/, "")}</b> di {asOf}</p>
            <ConfirmButton size="sm" variant="outline" title={`Rencana baru untuk NO ${m.wave_no}`} confirmLabel="Batalkan wave lama & hitung ulang"
              summary={`Wave NO ${m.wave_no} (${m.planned_date}) dibatalkan dan stoknya dilepas, lalu order ini direncanakan baru dari stok sekarang.${m.posted_tasks > 0 ? ` Perhatian: ${m.posted_tasks} tugas sudah diposting; barangnya tidak kembali otomatis.` : ""}`}
              onConfirm={() => onReplan(m)}>Rencana baru</ConfirmButton>
          </div>
          <ul className="text-xs">
            {m.lines.map((l, i) => (
              <li key={i} className={cn(l.oldQty !== l.newQty && "font-semibold text-warn")}>
                SH {l.oldShipment}{l.newShipment !== l.oldShipment ? ` → ${l.newShipment}` : ""} · {l.sku} {l.description} · {fmtNum(l.newQty)}
                {l.oldQty !== l.newQty && ` (wave lama ${fmtNum(l.oldQty)}: sesuaikan dengan Ubah jumlah order setelah disimpan)`}
              </li>
            ))}
            {m.unmatched.map((u, i) => (
              <li key={`u${i}`} className="text-steel-500">SH {u.shipment} · {u.sku} · {fmtNum(u.qty)}: tidak ada di jadwal ini, ikut dipindah</li>
            ))}
          </ul>
          {m.ambiguous && <p className="text-xs font-semibold text-bad">Satu shipment lama cocok dengan beberapa shipment baru: dipakai yang pertama. Periksa sebelum menyimpan.</p>}
        </div>
      ))}
    </div>
  );
}
