"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Info, Plus, RefreshCw, RotateCcw, X, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePersonName } from "@/components/app/person-name";
import { fetchAll } from "@/lib/fetch-all";
import { cn, fmtNum } from "@/lib/utils";
import type { TaskRow } from "@/lib/allocator/picklist-from-tasks";
import { buildSheet, leftoverAfter, lineChanged, sheetNotes, sheetPayload, sheetSummary, type SheetIncoming, type SheetLine, type SheetSource, type SheetStock } from "@/lib/wave-sheet";

const REASONS = ["sesuai picklist cetak", "bin kosong / kurang", "palet terhalang", "karton rusak"];
type Auto = { kind: "correction"; bin: string; sku: string; batch: string; qty: number; had: number }
  | { kind: "relocation_posted"; wave_no: string; seq: number; to_bin: string; sku: string; qty: number };

/**
 * "Isi dari picklist" (0057): the wave as its printed picklist, every cell
 * editable — bin, batch, expiry, cartons, a second bin (+), the Bin To Bin and
 * its sisa — then one Simpan & posting for the whole wave. Nothing typed here
 * is refused except a bin that does not exist; what differs from the plan is
 * yellow, and the notes say what the database will do about it.
 *
 * It opens in place of the wave's table (Isi dari picklist on the wave) and
 * works on a snapshot taken when it opened: the page refreshing itself while
 * pickers post never overwrites what is being typed — it only says so.
 */
const signature = (tasks: TaskRow[]) => tasks.map((t) => `${t.id}:${t.status}:${t.quantity}:${t.from_bin}:${t.to_bin}`).sort().join("|");

export function WaveSheetPanel({ wave: w, tasks, onClose }: { wave: { id: string; wave_no: string }; tasks: TaskRow[]; onClose: () => void }) {
  const router = useRouter();
  const loadedAs = useRef<string | null>(null);
  const [sent, setSent] = useState(0);
  const [lines, setLines] = useState<SheetLine[]>([]);
  const [initial, setInitial] = useState<Map<string, SheetLine>>(new Map());
  const [cancelled, setCancelled] = useState<TaskRow[]>([]);
  const [stock, setStock] = useState<SheetStock[]>([]);
  const [bins, setBins] = useState<Set<string> | null>(null);
  const [incoming, setIncoming] = useState<SheetIncoming[]>([]);
  const [reason, setReason] = useState(REASONS[0]);
  const [person, setPerson] = usePersonName();
  const [step, setStep] = useState<"edit" | "confirm" | "done">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState<Auto[]>([]);

  async function load() {
    loadedAs.current = signature(tasks);
    const sheet = buildSheet(tasks);
    setLines(sheet.lines);
    setInitial(new Map(sheet.lines.map((l) => [l.key, structuredClone(l)])));
    setCancelled(sheet.cancelled);
    setStep("edit"); setError(null); setAuto([]); setReason(REASONS[0]);
    const db = createClient();
    const skus = [...new Set(tasks.map((t) => t.sku))];
    try {
      const [inv, all, moves] = await Promise.all([
        fetchAll<{ bin_code: string; sku: string; batch_lot: string; expiry_date: string | null; quantity: number }>((a, b) =>
          db.from("inventory_detail").select("bin_code, sku, batch_lot, expiry_date, quantity").in("sku", skus).order("bin_code").range(a, b)),
        fetchAll<{ bin_code: string }>((a, b) => db.from("bins").select("bin_code").order("bin_code").range(a, b)),
        // Open Bin To Bins of every open wave for these SKUs: the database posts them first when the paper needs their stock.
        fetchAll<{ id: string; to_bin: string; sku: string; batch_lot: string; expiry_date: string | null; quantity: number; wave_no: string; seq: number }>((a, b) =>
          db.from("pick_task_detail").select("id, to_bin, sku, batch_lot, expiry_date, quantity, wave_no, seq").in("sku", skus)
            .neq("task_type", "PICK").eq("status", "PLANNED").in("wave_status", ["PENDING", "RESCHEDULED"]).order("planned_date").order("seq").range(a, b)),
      ]);
      setIncoming(moves.map((m) => ({ id: m.id, to: m.to_bin, sku: m.sku, batch: m.batch_lot, expiry: m.expiry_date, qty: Number(m.quantity), label: `NO ${m.wave_no} #${m.seq}` })));
      setStock(inv.map((r) => ({ bin: r.bin_code, sku: r.sku, batch: r.batch_lot, expiry: r.expiry_date, qty: Number(r.quantity) })));
      setBins(new Set(all.map((b) => b.bin_code)));
    } catch (e) { setError((e as Error).message); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a snapshot: loaded once when the panel opens, again only on Muat ulang
  useEffect(() => { void load(); }, []);
  const stale = step !== "done" && loadedAs.current !== null && loadedAs.current !== signature(tasks);

  const notes = useMemo(() => sheetNotes(lines, initial, stock, bins, incoming), [lines, initial, stock, bins, incoming]);
  const summary = useMemo(() => sheetSummary(lines, initial, notes), [lines, initial, notes]);
  // Bins and batches of each SKU, for the suggestions under the inputs.
  const bySku = useMemo(() => {
    const m = new Map<string, SheetStock[]>();
    for (const s of stock) m.set(s.sku, [...(m.get(s.sku) ?? []), s]);
    return m;
  }, [stock]);

  const update = (key: string, f: (l: SheetLine) => SheetLine) => setLines((ls) => ls.map((l) => (l.key === key ? f(structuredClone(l)) : l)));
  function setSource(l: SheetLine, i: number, patch: Partial<SheetSource>) {
    update(l.key, (x) => {
      const s = { ...x.sources[i], ...patch };
      // A bin holding one batch of this SKU fills batch and expiry; a batch with one expiry there fills the expiry.
      const here = (bySku.get(x.sku) ?? []).filter((r) => r.bin === s.bin.trim().toUpperCase() && r.qty > 0);
      if (patch.bin !== undefined && here.length === 1) { s.batch = here[0].batch; s.expiry = (here[0].expiry ?? "").slice(0, 10); }
      if (patch.batch !== undefined) {
        const exp = here.filter((r) => r.batch === s.batch.trim());
        if (exp.length === 1) s.expiry = (exp[0].expiry ?? "").slice(0, 10);
      }
      x.sources[i] = s;
      return x;
    });
  }

  async function submit() {
    setBusy(true); setError(null);
    const rows = sheetPayload(lines, initial);
    const { data, error } = await createClient().rpc("post_wave_sheet", {
      p_wave_id: w.id, p_rows: rows, p_by_name: person, p_reason: reason.trim(),
    });
    setSent(rows.length);
    setBusy(false);
    if (error) { setStep("edit"); return setError(error.message); }
    setAuto(((data as { auto?: Auto[] } | null)?.auto ?? []));
    setStep("done");
    router.refresh();
  }

  const ready = summary.send > 0 && summary.errors === 0 && reason.trim().length > 0 && person.trim().length >= 2 && bins !== null;
  const [onlyDiff, setOnlyDiff] = useState(false);
  const plan = (l: SheetLine, i: number, k: keyof SheetSource) => initial.get(l.key)?.sources[i]?.[k];
  const diff = (l: SheetLine, i: number, k: keyof SheetSource) => {
    const a = plan(l, i, k);
    return a === undefined || String(a).trim().toUpperCase() !== String(l.sources[i][k]).trim().toUpperCase();
  };
  // Enter moves down a column, like the paper is read: same field, next line.
  function onEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const el = e.currentTarget, r = Number(el.dataset.r), c = el.dataset.c ?? "";
    const base = c.replace(/\d+$/, "");
    const next = document.querySelector<HTMLInputElement>(`[data-sheet="${w.id}"][data-r="${r + 1}"][data-c="${base}"]`);
    next?.focus(); next?.select();
  }
  const shown = onlyDiff
    ? lines.filter((l) => lineChanged(l, initial.get(l.key) ?? l) || (!l.posted && !l.done) || (notes.get(l.key) ?? []).some((n) => n.tone !== "info"))
    : lines;

  // One input of the sheet: a changed value keeps the plan visible, struck through, as on corrected paper.
  const field = (l: SheetLine, r: number, i: number, k: keyof SheetSource, o: { width: string; plate?: boolean; type?: string; list?: string; right?: boolean }) => {
    const changed = diff(l, i, k);
    const was = plan(l, i, k);
    return (
      <div key={`${k}${i}`} className="min-h-[2.75rem]">
        <input value={l.sources[i][k]} type={o.type ?? "text"} list={o.list} inputMode={k === "qty" ? "numeric" : undefined} min={k === "qty" ? 0 : undefined}
          data-sheet={w.id} data-r={r} data-c={`${k}${i || ""}`} onKeyDown={onEnter}
          aria-label={`${k === "bin" ? "bin" : k === "qty" ? "qty" : k} baris ${l.seq}`}
          onChange={(e) => setSource(l, i, { [k]: o.plate ? e.target.value.toUpperCase() : e.target.value })}
          className={cn("h-9 rounded-md border px-2 text-sm outline-none transition-colors focus-visible:border-ckb focus-visible:ring-2 focus-visible:ring-ckb/30",
            o.width, o.right && "text-right tabular", o.plate && "font-cond font-semibold uppercase tracking-wide",
            changed ? "border-warn bg-warn/15" : o.plate ? "border-plate-dark/40 bg-plate/25" : "border-steel-100 bg-white hover:border-steel-300")} />
        {changed && (was !== undefined || k === "bin") && (
          <div className={cn("mt-0.5 truncate text-[11px] leading-tight text-steel-500", o.right && "text-right")}>
            {was === undefined ? "bin tambahan" : <>rencana <span className="line-through">{was || "–"}</span></>}
          </div>
        )}
      </div>
    );
  };

  const tally: [number, string, string][] = [
    [summary.asPlanned, "sesuai rencana", "bg-ok"],
    [summary.changed, "berbeda", "bg-warn"],
    [summary.reposted, "dibetulkan", "bg-warn"],
    [summary.left, "belum", "bg-steel-300"],
    [summary.corrections, "koreksi stok", "bg-plate-dark"],
    [summary.errors, "perlu dibetulkan", "bg-bad"],
  ];

  return (
    <section aria-label={`Isi dari picklist NO ${w.wave_no}`} className="border-t border-steel-100 bg-paper">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-4">
        <div className="space-y-1">
          <h3 className="font-cond text-xl font-semibold">Isi dari picklist</h3>
          <p className="max-w-2xl text-sm text-steel-500">
            Salin dari kertas, ubah hanya yang berbeda. Nilai rencana tetap terlihat dicoret di bawah isian. Enter pindah ke baris berikutnya.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lines.some((l) => !l.posted) && <>
            <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.map((l) => (l.posted ? l : { ...l, done: true })))}>Centang semua</Button>
            <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.map((l) => (l.posted ? l : { ...l, done: false })))}>Hapus centang</Button>
          </>}
          <label className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm", onlyDiff ? "border-ckb bg-ckb-tint" : "border-steel-100 bg-white hover:bg-steel-100")}>
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />Hanya yang berbeda
          </label>
          <Button size="sm" variant="outline" onClick={onClose}><X className="h-4 w-4" />Tutup</Button>
        </div>
      </div>
      {stale && (
        <p className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-md bg-warn/10 p-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-warn" />
          Wave ini berubah sejak lembar dibuka, mungkin ada yang posting dari HP. Isian Anda tetap.
          <Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Muat ulang (isian dibuang)</Button>
        </p>
      )}

      {step === "done" ? (
        <div className="space-y-3 px-4 pb-4 text-sm">
          <p className="flex items-center gap-2 rounded-md bg-ok/10 p-3 text-base font-semibold text-ok"><Check className="h-5 w-5" />{fmtNum(sent)} baris diposting sesuai picklist.</p>
          {auto.length > 0 && (
            <div className="space-y-1 rounded-md bg-white p-3">
              <p className="font-semibold">Ikut dikerjakan otomatis</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {auto.map((a, i) => a.kind === "correction"
                  ? <li key={i}>Koreksi picklist <b className="font-cond">{a.bin}</b> SKU {a.sku} batch {a.batch || "–"}: sistem {fmtNum(a.had)}, ditambah {fmtNum(a.qty)}. {a.bin} masuk Cycle count.</li>
                  : <li key={i}>Bin To Bin NO {a.wave_no} #{a.seq} ke <b className="font-cond">{a.to_bin}</b> ({fmtNum(a.qty)}) ikut diposting.</li>)}
              </ul>
            </div>
          )}
          <Button onClick={onClose}>Tutup</Button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[54rem] border-separate border-spacing-0 text-sm">
              <thead className="text-left text-xs text-steel-500">
                <tr>
                  <th colSpan={2} />
                  <th colSpan={4} className="border-b-2 border-ckb pb-1 font-cond text-sm font-semibold text-steel">Ambil dari</th>
                  <th colSpan={2} className="border-b-2 border-steel-300 pb-1 font-cond text-sm font-semibold text-steel">Sisa palet</th>
                  <th />
                </tr>
                <tr className="[&>th]:px-1.5 [&>th]:py-2 [&>th]:font-medium">
                  <th className="w-9">#</th><th>Barang</th>
                  <th>Lokasi</th><th>Batch</th><th>Exp</th><th className="text-right">Qty</th>
                  <th>Bin To Bin</th><th className="text-right">Sisa</th>
                  <th className="w-32 text-right">Dikerjakan</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const r = lines.indexOf(l);
                  const ns = notes.get(l.key) ?? [];
                  const init = initial.get(l.key) ?? l;
                  const changed = lineChanged(l, init);
                  const bad = ns.some((n) => n.tone === "bad");
                  const toDiff = init.moveTo !== l.moveTo.trim().toUpperCase();
                  const mqDiff = init.moveQty !== l.moveQty.trim();
                  // Ticked rows turn green: the progress through the paper is visible at a glance.
                  const rowTone = bad ? "bg-bad/5" : !l.posted && l.done ? "bg-ok/5" : changed ? "bg-white" : "bg-white/60";
                  return (
                    <Fragment key={l.key}>
                      <tr className={cn("align-top [&>td]:px-1.5 [&>td]:pt-2.5", rowTone)}>
                        <td className="pl-2">
                          <span className="font-cond text-lg font-semibold tabular">{l.seq}</span>
                          {changed && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-warn align-middle" title="berbeda dari rencana" />}
                        </td>
                        <td className="max-w-[11rem]">
                          <div className="font-cond font-semibold tabular">{l.sku}</div>
                          <div className="truncate text-xs text-steel-500" title={l.description}>{l.description}</div>
                          <div className="text-xs text-steel-500">{l.pick ? `SH ${l.shipment ?? "–"}` : "Bin To Bin saja"}</div>
                        </td>
                        <td>{l.sources.map((_, i) => field(l, r, i, "bin", { width: "w-[6.5rem]", plate: true, list: `sheet-bins-${l.sku}` }))}</td>
                        <td>
                          {l.sources.map((_, i) => field(l, r, i, "batch", { width: "w-[5.75rem]", list: `sheet-batch-${l.key}-${i}` }))}
                          {l.sources.map((s, i) => (
                            <datalist key={i} id={`sheet-batch-${l.key}-${i}`}>
                              {(bySku.get(l.sku) ?? []).filter((x) => x.bin === s.bin.trim().toUpperCase())
                                .map((x) => <option key={`${x.batch}|${x.expiry}`} value={x.batch}>{`exp ${(x.expiry ?? "–").slice(0, 10)} · stok ${x.qty}`}</option>)}
                            </datalist>
                          ))}
                        </td>
                        <td>{l.sources.map((_, i) => field(l, r, i, "expiry", { width: "w-[8.25rem]", type: "date" }))}</td>
                        <td className="text-right">
                          {l.pick ? l.sources.map((_, i) => (
                            <div key={i} className="flex items-start justify-end gap-1">
                              {field(l, r, i, "qty", { width: "w-14", type: "number", right: true })}
                              {i > 0 && (
                                <button type="button" aria-label="Hapus bin ini" className="mt-1.5 rounded p-1 text-steel-500 hover:bg-steel-100 hover:text-bad"
                                  onClick={() => update(l.key, (x) => ({ ...x, sources: x.sources.filter((_, j) => j !== i) }))}><X className="h-3.5 w-3.5" /></button>
                              )}
                            </div>
                          )) : <span className="inline-block pt-2 text-steel-300">–</span>}
                          {l.pick && (
                            <button type="button" className="mt-0.5 inline-flex items-center gap-0.5 rounded px-1 text-xs text-ckb hover:bg-ckb-tint"
                              onClick={() => update(l.key, (x) => ({ ...x, sources: [...x.sources, { bin: "", batch: x.sources[0].batch, expiry: x.sources[0].expiry, qty: "" }] }))}>
                              <Plus className="h-3 w-3" />bin lain
                            </button>
                          )}
                        </td>
                        <td>
                          <div className="flex items-start gap-1">
                            <div className="min-h-[2.75rem]">
                              <input value={l.moveTo} list={`sheet-bins-${l.sku}`} placeholder="tetap" aria-label={`Bin To Bin baris ${l.seq}`}
                                data-sheet={w.id} data-r={r} data-c="moveTo" onKeyDown={onEnter}
                                onChange={(e) => update(l.key, (x) => {
                                  const moveTo = e.target.value.toUpperCase();
                                  // A new Bin To Bin starts with what the pallet holds after the pick; the number stays editable.
                                  const fill = !x.moveTo && !x.moveQty.trim() && moveTo ? leftoverAfter(x, stock) : 0;
                                  return { ...x, moveTo, moveQty: fill > 0 ? String(fill) : x.moveQty };
                                })}
                                className={cn("h-9 w-[6.5rem] rounded-md border px-2 font-cond text-sm font-semibold uppercase tracking-wide outline-none transition-colors placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-steel-300 focus-visible:border-ckb focus-visible:ring-2 focus-visible:ring-ckb/30",
                                  toDiff ? "border-warn bg-warn/15" : l.moveTo ? "border-plate-dark/40 bg-plate/25" : "border-dashed border-steel-300 bg-white")} />
                              {toDiff && <div className="mt-0.5 text-[11px] leading-tight text-steel-500">rencana <span className="line-through">{init.moveTo || "tetap"}</span></div>}
                            </div>
                            {l.moveTo && (
                              <button type="button" aria-label="Sisa tidak dipindah" title="Sisa tetap di bin" className="mt-1.5 rounded p-1 text-steel-500 hover:bg-steel-100 hover:text-bad"
                                onClick={() => update(l.key, (x) => ({ ...x, moveTo: "" }))}><X className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                        </td>
                        <td className="text-right">
                          <div className="min-h-[2.75rem]">
                            <input value={l.moveQty} type="number" inputMode="numeric" min={0} disabled={!l.moveTo} aria-label={`sisa baris ${l.seq}`}
                              data-sheet={w.id} data-r={r} data-c="moveQty" onKeyDown={onEnter}
                              onChange={(e) => update(l.key, (x) => ({ ...x, moveQty: e.target.value }))}
                              className={cn("ml-auto h-9 w-14 rounded-md border px-2 text-right text-sm tabular outline-none transition-colors focus-visible:border-ckb focus-visible:ring-2 focus-visible:ring-ckb/30 disabled:border-transparent disabled:bg-transparent",
                                l.moveTo && mqDiff ? "border-warn bg-warn/15" : "border-steel-100 bg-white hover:border-steel-300")} />
                            {l.moveTo && mqDiff && init.moveQty && <div className="mt-0.5 text-[11px] leading-tight text-steel-500">rencana <span className="line-through">{init.moveQty}</span></div>}
                            {l.moveTo && !init.moveTo && <div className="mt-0.5 text-[11px] leading-tight text-steel-500">sisa di bin {fmtNum(leftoverAfter(l, stock))}</div>}
                          </div>
                        </td>
                        <td className="pr-2 text-right">
                          {l.posted ? (
                            <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold", changed ? "bg-warn/15 text-warn" : "bg-ok/10 text-ok")}>
                              {changed ? <><RotateCcw className="h-3.5 w-3.5" />Dibetulkan</> : <><Check className="h-3.5 w-3.5" />Diposting</>}
                            </span>
                          ) : (
                            <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold transition-colors",
                              l.done ? "border-ckb bg-ckb text-white hover:bg-ckb-dark" : "border-steel-300 bg-white text-steel-500 hover:bg-steel-100")}>
                              <input type="checkbox" checked={l.done} aria-label={`Baris ${l.seq} sudah dicek dan dikerjakan`}
                                onChange={(e) => update(l.key, (x) => ({ ...x, done: e.target.checked }))} className="h-4 w-4 accent-white" />
                              {l.done ? "Sudah dikerjakan" : "Belum dicek"}
                            </label>
                          )}
                          {changed && (
                            <button type="button" title="Kembalikan baris ini ke rencana" className="ml-auto mt-1 flex items-center gap-1 text-[11px] text-steel-500 underline hover:text-steel"
                              onClick={() => update(l.key, (x) => ({ ...structuredClone(init), done: x.done }))}>
                              <RotateCcw className="h-3 w-3" />ke rencana
                            </button>
                          )}
                        </td>
                      </tr>
                      <tr className={rowTone}>
                        <td colSpan={9} className="border-b border-steel-100 px-2 pb-2.5">
                          {ns.length > 0 && (
                            <div className="ml-9 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                              {ns.map((n, i) => {
                                const Icon = n.tone === "bad" ? XCircle : n.tone === "warn" ? AlertTriangle : Info;
                                return (
                                  <span key={i} className={cn("inline-flex items-start gap-1", n.tone === "bad" && "font-semibold text-bad", n.tone === "warn" && "text-warn", n.tone === "info" && "text-steel-500")}>
                                    <Icon className="mt-px h-3.5 w-3.5 shrink-0" />{n.text}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {onlyDiff && shown.length === 0 && <p className="py-6 text-center text-sm text-steel-500">Semua baris sesuai rencana. Matikan &quot;Hanya yang berbeda&quot; untuk melihat semuanya.</p>}
            {[...new Set(lines.map((l) => l.sku))].map((sku) => (
              <datalist key={sku} id={`sheet-bins-${sku}`}>
                {[...new Set((bySku.get(sku) ?? []).filter((x) => x.qty > 0).map((x) => x.bin))].map((b) => <option key={b} value={b} />)}
              </datalist>
            ))}
            {cancelled.length > 0 && (
              <p className="py-2 text-xs text-steel-500">Dibatalkan, tidak ikut: {cancelled.map((t) => `#${t.seq} ${t.from_bin} ${t.sku} ${fmtNum(Number(t.quantity))}`).join(", ")}</p>
            )}
          </div>

          <div className="z-10 space-y-3 border-t border-steel-100 bg-white px-4 py-3 lg:sticky lg:bottom-0 lg:bg-white/95 lg:shadow-[0_-4px_12px_-8px_rgba(27,43,37,0.25)] lg:backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              {tally.filter(([n]) => n > 0).map(([n, label, dot]) => (
                <span key={label} className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", dot)} /><b className="font-cond text-base tabular">{fmtNum(n)}</b>{label}</span>
              ))}
              {summary.fefo > 0 && <span className="inline-flex items-center gap-1.5 text-warn"><AlertTriangle className="h-4 w-4" /><b className="font-cond text-base tabular">{fmtNum(summary.fefo)}</b>tidak FEFO</span>}
              {bins === null && <span className="text-steel-500">Memuat stok…</span>}
            </div>
            {step === "confirm" ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-ckb-tint p-3">
                <p className="max-w-3xl text-base">
                  Posting <b>{fmtNum(summary.send)}</b> baris NO {w.wave_no} atas nama <b>{person.trim()}</b>, alasan &ldquo;{reason.trim()}&rdquo;.
                  {summary.corrections > 0 && <> Stok {fmtNum(summary.corrections)} bin dikoreksi dan bin-nya masuk Cycle count.</>}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep("edit")}>Kembali</Button>
                  <Button onClick={submit} disabled={busy || !ready}>{busy ? "Memposting…" : "Ya, posting"}</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[16rem] flex-1 space-y-1">
                  <span className="text-xs font-medium text-steel-500">Alasan untuk baris yang berbeda</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {REASONS.map((x) => (
                      <button key={x} type="button" onClick={() => setReason(x)}
                        className={cn("rounded-md border px-2.5 py-1 text-xs", reason === x ? "border-ckb bg-ckb text-white" : "border-steel-100 bg-white hover:bg-steel-100")}>{x}</button>
                    ))}
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Alasan" className="h-8 w-56 text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`sheet-person-${w.id}`} className="text-xs font-medium text-steel-500">Nama Anda</label>
                  <Input id={`sheet-person-${w.id}`} value={person} onChange={(e) => setPerson(e.target.value)} placeholder="nama lengkap" className="h-9 w-48" />
                </div>
                <div className="ml-auto flex flex-col items-end gap-1">
                  <span className={cn("text-xs", ready ? "text-steel-500" : "font-semibold text-warn")}>
                    {bins === null ? "Memuat stok…" : summary.errors > 0 ? "Betulkan isian bertanda merah."
                      : summary.send === 0 ? "Belum ada baris untuk diposting."
                      : person.trim().length < 2 ? "Isi Nama Anda dulu."
                      : !reason.trim() ? "Isi alasan dulu." : `${fmtNum(summary.send)} baris siap diposting`}
                  </span>
                  <Button size="lg" disabled={!ready} onClick={() => setStep("confirm")}>Simpan &amp; posting</Button>
                </div>
              </div>
            )}
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          </div>
        </>
      )}
    </section>
  );
}
