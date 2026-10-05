"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { DEFAULT_CONFIG, withConfig } from "@/lib/allocator/config";
import { inventoryToStock } from "@/lib/allocator/adapters/inventory-stock";
import { loadDispatchRules, loadPickfaceOverrides, loadPlanningStock } from "@/lib/allocator/browser/plan-client";
import { runPipeline } from "@/lib/allocator/pipeline";
import { buildPlan, type PlanPayload } from "@/lib/allocator/plan";
import { binToBin } from "@/lib/allocator/picklist";
import type { AllocationResult, DemandLine, StockBin } from "@/lib/allocator/types";
import { binDistance, distanceLabel, parseBin, type BinParts } from "@/lib/bin-distance";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import { applyLineEdits, optionKey, OTHER_BIN, type BinOption, type EditResult, type LineEdit } from "@/lib/wave-edits";
import { PersonNameField, usePersonName } from "@/components/app/person-name";

type Line = { sku: string; qty: string; orderNo: string };
/** pickfaces: `${sku}|${bin}` of every pickface the run used, so a move out of one is warned. */
type Plan = { payload: PlanPayload; allocation: AllocationResult; binsBySku: Map<string, BinOption[]>; pickfaces: Set<string> };
const NEW_WAVE = "BARU";
const EMPTY_LINE: Line = { sku: "", qty: "", orderNo: "" };

/**
 * Allocates order lines FEFO from the stock no wave has claimed yet
 * (planning_stock p_keep_all): every open task keeps its stock, also those
 * of the day's untouched waves. Shared by Tambah order and Tambah item.
 */
async function planLines(date: string, shipment: string, lines: Line[],
  meta: { waveNo: string; destination: string; truck: string | null; slot: string | null }): Promise<Plan> {
  const filled = lines.filter((l) => l.sku.trim() && Number(l.qty) > 0);
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
  const stock = inventoryToStock(await loadPlanningStock(db, date, [], true), config);
  const bySku = new Map<string, DemandLine>();
  for (const l of filled) {
    const sku = l.sku.trim(), it = known.get(sku)!;
    const d = bySku.get(sku);
    if (d) { d.qtyCartons += Number(l.qty); if (l.orderNo.trim()) d.orderNos.push(l.orderNo.trim()); continue; }
    bySku.set(sku, {
      shipmentNumber: shipment.trim(), waveNo: meta.waveNo, orderNos: l.orderNo.trim() ? [l.orderNo.trim()] : [], sku,
      description: it.description, qtyCartons: Number(l.qty), upp: Number(it.upp) || 1, destination: meta.destination,
      shipToLocation: meta.destination, transport: null, truckType: meta.truck, slotTime: meta.slot, deliveryDate: null,
    });
  }
  const demand = [...bySku.values()];
  const run = runPipeline(stock.stock, demand, stock.stagedBySku, config, stock.warnings);
  return {
    payload: buildPlan(run.allocation, demand, run.pickfaces),
    allocation: run.allocation,
    binsBySku: groupBinsBySku(stock.stock),
    pickfaces: new Set([...run.pickfaces.values()].map((p) => `${p.sku}|${p.location}`)),
  };
}

/** The same planning-stock bins the allocation drew from, grouped per SKU for the override Select. */
function groupBinsBySku(stock: StockBin[]): Map<string, BinOption[]> {
  const bySku = new Map<string, BinOption[]>();
  for (const b of stock) {
    const expiryDate = b.expiryDate.toISOString().slice(0, 10);
    const batch = b.batch ?? "";
    const opt: BinOption = { key: optionKey(b.location, batch, expiryDate), location: b.location, batch, expiryDate, qtyCartons: b.qtyCartons };
    const list = bySku.get(b.sku);
    if (list) list.push(opt);
    else bySku.set(b.sku, [opt]);
  }
  for (const list of bySku.values()) list.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.location.localeCompare(b.location));
  return bySku;
}

type MoveTargets = { pickfaces: Map<string, string[]>; emptyA: (BinParts & { bin_code: string })[] };
type DestSuggestion = { bin: string; note: string };

/** The two tables "Ubah Bin To Bin" reads (pickface_detail, empty_bins Level-A), fetched once per plan; ranking happens on render. */
async function loadMoveTargets(db: SupabaseClient): Promise<MoveTargets> {
  const [{ data: pf, error: e1 }, { data: empty, error: e2 }] = await Promise.all([
    db.from("pickface_detail").select("sku, bin_code"),
    db.from("empty_bins").select("bin_code, zone, rack, level, position").eq("level", "A").range(0, 2999),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  const pickfaces = new Map<string, string[]>();
  for (const r of (pf ?? []) as { sku: string; bin_code: string }[]) {
    const list = pickfaces.get(r.sku);
    if (list) list.push(r.bin_code);
    else pickfaces.set(r.sku, [r.bin_code]);
  }
  return { pickfaces, emptyA: (empty ?? []) as (BinParts & { bin_code: string })[] };
}

/** SKU / Qty / Order No rows. Any edit drops the calculated plan. */
function LinesEditor({ lines, setLines, onChange }: { lines: Line[]; setLines: (f: (ls: Line[]) => Line[]) => void; onChange: () => void }) {
  const setLine = (i: number, patch: Partial<Line>) => { onChange(); setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); };
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_6rem_1fr_auto] items-end gap-2">
          <div><Label htmlFor={`ao-sku-${i}`}>SKU</Label><Input id={`ao-sku-${i}`} value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })} inputMode="numeric" /></div>
          <div><Label htmlFor={`ao-qty-${i}`}>Qty</Label><Input id={`ao-qty-${i}`} type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></div>
          <div><Label htmlFor={`ao-ord-${i}`}>Order No (opsional)</Label><Input id={`ao-ord-${i}`} value={l.orderNo} onChange={(e) => setLine(i, { orderNo: e.target.value })} /></div>
          <Button variant="ghost" size="sm" aria-label="Hapus baris" disabled={lines.length === 1}
            onClick={() => { onChange(); setLines((ls) => ls.filter((_, j) => j !== i)); }}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => { onChange(); setLines((ls) => [...ls, { ...EMPTY_LINE }]); }}><Plus className="h-4 w-4" />Baris SKU</Button>
    </div>
  );
}

/** The bins the allocation chose, and what it could not find. */
function PlanPreview({ plan }: { plan: Plan }) {
  const picked = plan.allocation.picklists.flatMap((p) => p.lines);
  return (
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
        <p className="rounded-md bg-warn/10 p-2 text-sm">Kurang stok: {plan.allocation.shortages.map((s) => `${s.sku} kurang ${fmtNum(s.qtyShort)}`).join(", ")}. Tetap disimpan dengan kekurangannya.</p>
      )}
    </div>
  );
}

/** Destination bins for one line, ranked from its EFFECTIVE source so a Sumber change re-ranks without refetching. */
function moveSuggestions(from: string, sku: string, plannedTo: string, data: MoveTargets | null): DestSuggestion[] {
  const list: DestSuggestion[] = [];
  const seen = new Set<string>();
  const push = (bin: string, note: string) => {
    if (!bin || bin === from || seen.has(bin)) return;
    seen.add(bin);
    list.push({ bin, note });
  };
  push(plannedTo, "tujuan rencana");
  for (const pf of data?.pickfaces.get(sku) ?? []) push(pf, "pickface SKU ini");
  const src = parseBin(from);
  if (src && data) {
    const near = data.emptyA.filter((b) => !DEFAULT_CONFIG.blockedBins.includes(b.bin_code)).map((b) => ({ b, d: binDistance(src, b) })).sort((a, c) => a.d - c.d).slice(0, 5);
    for (const { b } of near) push(b.bin_code, `kosong · ${distanceLabel(src, b)}`);
  }
  return list;
}

/**
 * Tambah item only: every new PICK line can follow the printed picklist —
 * Sumber (any bin of this SKU, or one typed by hand) and Bin To Bin (any
 * destination and sisa, also on a line the engine gave none). Warnings
 * (FEFO, short stock, pickface) never block; only a malformed row does.
 */
function LineEditPreview({ plan, edits, onEdit, result, moveData }: {
  plan: Plan; edits: Record<number, LineEdit>; onEdit: (taskIndex: number, patch: Partial<LineEdit> | null) => void;
  result: EditResult; moveData: MoveTargets | null;
}) {
  const picks = plan.payload.tasks.map((t, i) => ({ t, i })).filter((r) => r.t.task_type === "PICK");
  return (
    <div className="space-y-2">
      <div className="max-h-80 overflow-y-auto">
        <Table>
          <thead><tr><Th>#</Th><Th>SKU</Th><Th>Qty</Th><Th>Sumber</Th><Th>Bin To Bin</Th></tr></thead>
          <tbody>
            {picks.map(({ t, i }) => {
              const line = result.lines.get(i);
              if (!line) return null;
              const edit = edits[i] ?? {};
              const plannedKey = optionKey(t.from_bin, t.batch_lot, t.expiry_date);
              const opts = plan.binsBySku.get(t.sku) ?? [];
              const options = opts.some((o) => o.key === plannedKey)
                ? opts
                : [{ key: plannedKey, location: t.from_bin, batch: t.batch_lot, expiryDate: t.expiry_date, qtyCartons: t.quantity }, ...opts];
              const sourceValue = edit.sourceKey ?? plannedKey;
              const plannedTo = line.plannedMove?.to_bin ?? "";
              const toValue = edit.moveTo ?? plannedTo;
              const suggested = moveSuggestions(line.pick.from_bin, t.sku, plannedTo, moveData);
              const dests = toValue.trim() && !suggested.some((s) => s.bin === toValue)
                ? [{ bin: toValue, note: "diketik" }, ...suggested] : suggested;
              const qtyValue = edit.moveQty ?? (line.move ? String(line.move.quantity) : "");
              return (
                <Fragment key={i}>
                  <tr className={cn(line.changed && "bg-plate/30")}>
                    <Td className="tabular">{t.seq}</Td>
                    <Td>{t.sku}</Td>
                    <Td className="tabular">{fmtNum(t.quantity)}</Td>
                    <Td className="space-y-1">
                      <Select aria-label={`Bin sumber baris ${t.seq}`} className="h-8 min-w-[15rem]" value={sourceValue}
                        onChange={(e) => onEdit(i, { sourceKey: e.target.value === plannedKey ? undefined : e.target.value })}>
                        {options.map((o) => (
                          <option key={o.key} value={o.key}>
                            {`${o.location} · batch ${o.batch || "–"} · exp ${o.expiryDate} · bebas ${fmtNum(o.qtyCartons)}${o.key === plannedKey ? " · rencana" : ""}`}
                          </option>
                        ))}
                        <option value={OTHER_BIN}>Bin lain (ketik)…</option>
                      </Select>
                      {edit.sourceKey === OTHER_BIN && (
                        <Input aria-label={`Bin sumber lain baris ${t.seq}`} className="h-8" value={edit.typedBin ?? ""} autoCapitalize="characters"
                          onChange={(e) => onEdit(i, { typedBin: e.target.value.toUpperCase() })} placeholder="mis. CF19A01" />
                      )}
                    </Td>
                    <Td className="space-y-1 text-xs">
                      <Select aria-label={`Tujuan Bin To Bin baris ${t.seq}`} className="h-8 min-w-[13rem]"
                        value={toValue}
                        onChange={(e) => onEdit(i, { moveTo: e.target.value === plannedTo ? undefined : e.target.value })}>
                        <option value="">{plannedTo ? "tanpa Bin To Bin" : "tanpa Bin To Bin / ketik di bawah"}</option>
                        {dests.map((s) => <option key={s.bin} value={s.bin}>{`${s.bin} · ${s.note}`}</option>)}
                      </Select>
                      <div className="grid grid-cols-[1fr_5rem] gap-1">
                        <Input aria-label={`Tujuan Bin To Bin lain baris ${t.seq}`} className="h-8" value={toValue} autoCapitalize="characters"
                          onChange={(e) => { const v = e.target.value.toUpperCase(); onEdit(i, { moveTo: v === plannedTo ? undefined : v }); }}
                          placeholder="ketik bin tujuan" />
                        <Input aria-label={`Jumlah sisa baris ${t.seq}`} className="h-8" type="number" inputMode="numeric" min={0}
                          value={qtyValue} disabled={!toValue.trim()} placeholder="sisa"
                          onChange={(e) => onEdit(i, { moveQty: e.target.value })} />
                      </div>
                      {line.plannedMove && line.changed && (
                        <p className="text-steel-500">Rencana: {line.plannedMove.from_bin} → {plannedTo} ({fmtNum(line.plannedMove.quantity)})</p>
                      )}
                      {!line.move && !toValue && line.leftover !== null && line.leftover > 0 && t.breaks_pallet && (
                        <p className="text-steel-500">Sisa {fmtNum(line.leftover)} tetap di {line.pick.from_bin}.</p>
                      )}
                    </Td>
                  </tr>
                  {(line.warnings.length > 0 || line.error) && (
                    <tr><Td colSpan={5} className="space-y-1 text-xs">
                      {line.error && <p className="rounded-md bg-bad/10 p-2 text-bad">{line.error}</p>}
                      {line.warnings.map((w) => <p key={w} className="rounded-md bg-warn/10 p-2 text-warn">{w}</p>)}
                    </Td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      </div>
      {plan.allocation.shortages.length > 0 && (
        <p className="rounded-md bg-warn/10 p-2 text-sm">Kurang stok: {plan.allocation.shortages.map((s) => `${s.sku} kurang ${fmtNum(s.qtyShort)}`).join(", ")}. Tetap disimpan dengan kekurangannya.</p>
      )}
      <p className="text-xs text-steel-500">Samakan dengan picklist cetak: Sumber mengganti bin asal pick (batch/expired ikut bin yang dipilih), Bin To Bin mengganti atau menambah tujuan sisa palet beserta jumlahnya. Pilih &quot;rencana&quot; untuk mengembalikan. Jumlah pick dan baris order tidak berubah.</p>
    </div>
  );
}

/**
 * "Tambah order": a late order (new shipment number) straight onto the wave
 * page, without the Schedule of the day sheet or re-running the day's
 * Alokasi. Saved as one new wave (add_order_wave, 0044).
 */
export function AddOrder({ date }: { date: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shipment, setShipment] = useState(""); const [destination, setDestination] = useState("");
  const [truck, setTruck] = useState(""); const [slot, setSlot] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);

  async function calculate() {
    setBusy(true); setError(null); setPlan(null);
    try {
      setPlan(await planLines(date, shipment, lines,
        { waveNo: NEW_WAVE, destination: destination.trim(), truck: truck.trim() || null, slot: slot.trim() || null }));
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
    setOpen(false); setPlan(null); setShipment(""); setDestination(""); setTruck(""); setSlot(""); setLines([{ ...EMPTY_LINE }]);
    router.refresh();
    alert(`Order disimpan sebagai wave NO ${(data as { wave_no: string }).wave_no}.`);
  }

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
          <LinesEditor lines={lines} setLines={setLines} onChange={() => setPlan(null)} />
          {plan && <PlanPreview plan={plan} />}
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

/**
 * "Tambah item": more cartons of a SKU, or a new SKU, for a shipment already
 * on this wave. Allocated like Tambah order; the picks go after the wave's
 * last row and the order line is raised or added (add_wave_items, 0048).
 * Each new row can be changed to follow the printed picklist first (0051).
 */
export function AddItems({ date, wave }: {
  date: string; wave: { id: string; wave_no: string; shipment_numbers: string[]; truck: string | null; destination: string; planned_slot: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shipment, setShipment] = useState(wave.shipment_numbers[0] ?? "");
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [edits, setEdits] = useState<Record<number, LineEdit>>({});
  const [moveData, setMoveData] = useState<MoveTargets | null>(null);
  const [person, setPerson] = usePersonName();
  const [reason, setReason] = useState("");

  const resetEdits = () => { setEdits({}); setReason(""); };
  /** Merges a patch into one line's edit; undefined fields go back to the plan, an empty edit is dropped. */
  const onEdit = (taskIndex: number, patch: Partial<LineEdit> | null) => setEdits((all) => {
    const next = { ...all };
    const merged: LineEdit = patch === null ? {} : { ...next[taskIndex], ...patch };
    if (merged.sourceKey !== OTHER_BIN) delete merged.typedBin;
    for (const k of Object.keys(merged) as (keyof LineEdit)[]) if (merged[k] === undefined) delete merged[k];
    if (Object.keys(merged).length) next[taskIndex] = merged;
    else delete next[taskIndex];
    return next;
  });

  async function calculate() {
    setBusy(true); setError(null); setPlan(null); resetEdits(); setMoveData(null);
    try {
      const db = createClient();
      const [calculated, targets] = await Promise.all([
        planLines(date, shipment, lines,
          { waveNo: wave.wave_no, destination: wave.destination, truck: wave.truck, slot: wave.planned_slot }),
        loadMoveTargets(db),
      ]);
      setPlan(calculated);
      setMoveData(targets);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const pickfaces = new Set([...(plan?.pickfaces ?? []),
    ...[...(moveData?.pickfaces ?? new Map<string, string[]>())].flatMap(([sku, bins]) => bins.map((b) => `${sku}|${b}`))]);
  const result = plan ? applyLineEdits(plan.payload.tasks, edits, plan.binsBySku, pickfaces) : null;
  const changedLines = result ? [...result.lines.values()].filter((l) => l.changed) : [];
  const needsReason = changedLines.length > 0 && (person.trim().length < 2 || !reason.trim());

  async function save() {
    if (!plan || !result) return;
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("add_wave_items", {
      p_wave_id: wave.id, p_shipment: shipment, p_plan: { tasks: result.tasks, outbound: plan.payload.outbound },
      p_by_name: result.changed ? person : null, p_reason: result.changed ? reason.trim() : null,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false); setPlan(null); resetEdits(); setMoveData(null); setLines([{ ...EMPTY_LINE }]);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Plus className="h-4 w-4" />Tambah item</Button></DialogTrigger>
      <DialogContent title={`Tambah item · NO ${wave.wave_no}`} description="SKU baru atau tambahan jumlah untuk shipment di wave ini.">
        <div className="space-y-4">
          {wave.shipment_numbers.length > 1 && (
            <div>
              <Label htmlFor="ai-sh">Shipment</Label>
              <Select id="ai-sh" value={shipment} onChange={(e) => { setShipment(e.target.value); setPlan(null); resetEdits(); }}>
                {wave.shipment_numbers.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          )}
          <LinesEditor lines={lines} setLines={setLines} onChange={() => { setPlan(null); resetEdits(); }} />
          {plan && result && <LineEditPreview plan={plan} edits={edits} onEdit={onEdit} result={result} moveData={moveData} />}
          {changedLines.length > 0 && (
            <div className="space-y-3 rounded-md bg-plate/30 p-3 text-sm">
              <p>
                <b>{changedLines.length}</b> baris diubah mengikuti picklist cetak:{" "}
                {changedLines.map((l) => `#${l.pick.seq} ${l.pick.from_bin}${l.move ? ` → ${l.move.to_bin} (${fmtNum(l.move.quantity)})` : ""}`).join(", ")}.
                Perubahan dicatat dengan nama dan alasan.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <PersonNameField value={person} onChange={setPerson} label="Nama Anda" id="ai-person" />
                <div>
                  <Label htmlFor="ai-reason">Alasan (wajib)</Label>
                  <Input id="ai-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. ikut picklist cetak PL-109694907" />
                </div>
              </div>
            </div>
          )}
          {result?.error && <p role="alert" className="text-sm text-bad">{result.error}</p>}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={calculate} disabled={busy}>{busy && !plan ? "Menghitung…" : "Hitung"}</Button>
            <Button size="lg" onClick={save} disabled={busy || !plan || !!result?.error || needsReason}>{busy && plan ? "Menyimpan…" : `Simpan ke NO ${wave.wave_no}`}</Button>
          </div>
          <p className="text-xs text-steel-500">SKU yang sudah ada di order: jumlah order ditambah. Tugas baru muncul di bawah baris terakhir wave; picklist berubah, cetak ulang bila perlu.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
