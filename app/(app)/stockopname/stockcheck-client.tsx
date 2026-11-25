"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Plus, RotateCcw, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { MANUAL_REASONS, REASON_CODES, type ReasonCode } from "@/lib/inventory-control";
import { cn, fmtNum } from "@/lib/utils";
import {
  bayOf, buildCheckRows, changesOf, diffOf, multiSkuBins, payloadOf, reportPayload, summarize,
  type Added, type CheckRow, type Edit, type StockLine,
} from "@/lib/stockcheck";
import { loadAisle } from "@/lib/stockcheck-data";
import { DiffChips, ReviewSummary } from "./review-summary";


type Item = { sku: string; description: string };
type Warn = { bin_code: string; sku: string; qty: number; reserved: number; waves: string };

// Phone: a card per line (labels above the inputs). md and up: one table row (header row above).
const GRID = "md:grid-cols-[6.5rem_minmax(0,1fr)_9.5rem_10rem_4.5rem_6.5rem_9rem]";
const FIELD = "h-9 px-2 text-sm";
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/**
 * One aisle, bin by bin. Every stock line has its quantity, batch and expiry as inputs, filled with what
 * the system holds: change what the shelf shows and the line lights up. Nothing is saved until Simpan:
 * all changes go to the database in one save (apply_rack_check), all or none.
 */
export function StockCheckClient({ aisle, aisles, bins, lines, items }: {
  aisle: string; aisles: string[]; bins: string[]; lines: StockLine[]; items: Item[];
}) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [added, setAdded] = useState<Added[]>([]);
  const [reason, setReason] = useState<ReasonCode>("COUNT_VARIANCE");
  const [query, setQuery] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [result, setResult] = useState<{ text: string; warnings: Warn[] } | null>(null);
  const [busy, setBusy] = useState<"aisle" | "all" | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const rows = useMemo(() => buildCheckRows(bins, lines), [bins, lines]);
  const skus = useMemo(() => new Map(items.map((i) => [i.sku, i.description])), [items]);
  const { changes, problems, stale } = useMemo(() => changesOf(rows, edits, added, skus), [rows, edits, added, skus]);
  const changeOf = useMemo(() => new Map(changes.map((c) => [c.row, c])), [changes]);
  const problemOf = useMemo(() => new Map(problems.map((p) => [p.row, p.text])), [problems]);
  const newMulti = useMemo(() => multiSkuBins(rows, changes, true), [rows, changes]);
  const summary = useMemo(() => summarize(rows, changes, skus), [rows, changes, skus]);
  const stats = useMemo(() => {
    const withStock = rows.filter((r) => r.line);
    return { bins: new Set(rows.map((r) => r.bin)).size, lines: withStock.length, empty: rows.length - withStock.length,
      cartons: withStock.reduce((n, r) => n + Number(r.line!.quantity), 0) };
  }, [rows]);

  const q = query.trim().toUpperCase();
  const visible = rows.filter((r) => {
    if (q) return [r.bin, r.line?.sku, r.line?.batch_lot, r.line?.description].some((v) => (v ?? "").toUpperCase().includes(q));
    if (hideEmpty && !r.line && !added.some((a) => a.bin === r.bin)) return false;
    return true;
  });
  const lastOfBin = (i: number) => visible[i + 1]?.bin !== visible[i].bin;
  const pending = changes.length + problems.length + stale.length;

  // ---- editing ----------------------------------------------------------------------------------
  function setField(r: CheckRow, field: "sku" | "qty" | "batch" | "expiry", value: string) {
    const l = r.line;
    if (!l) return;
    setResult(null);
    setEdits((all) => {
      const next: Edit = { ...(all[r.key] ?? { base: Number(l.quantity) }), [field]: value };
      // A field typed back to what the system holds is not an edit.
      if (next.sku !== undefined && next.sku.trim() === l.sku) delete next.sku;
      if (next.qty !== undefined && next.qty.trim() === String(l.quantity)) delete next.qty;
      if (next.batch !== undefined && next.batch.trim().toUpperCase() === l.batch_lot) delete next.batch;
      if (next.expiry !== undefined && next.expiry === (l.expiry_date ?? "")) delete next.expiry;
      const { [r.key]: _drop, ...rest } = all;
      return next.sku === undefined && next.qty === undefined && next.batch === undefined && next.expiry === undefined ? rest : { ...rest, [r.key]: next };
    });
  }
  const resetRow = (key: string) => setEdits(({ [key]: _drop, ...rest }) => rest);
  const addLine = (bin: string) => { setResult(null); setAdded((a) => [...a, { id: `add|${bin}|${Date.now()}|${a.length}`, bin, sku: "", qty: "", batch: "", expiry: "" }]); };
  const setAdd = (id: string, p: Partial<Added>) => setAdded((a) => a.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const dropAdd = (id: string) => setAdded((a) => a.filter((x) => x.id !== id));
  const resetAll = () => { setEdits({}); setAdded([]); };

  // ---- save -----------------------------------------------------------------------------------------
  async function save(): Promise<string | null> {
    if (person.trim().length < 2) return "Isi nama Anda dulu.";
    const { data, error } = await createClient().rpc("apply_rack_check", {
      p_aisle: aisle, p_lines: payloadOf(changes), p_reason_code: reason, p_by_name: person.trim(),
      p_report: reportPayload(summary, changes),
    });
    if (error) return error.message;
    const r = data as { lines: number; added: number; movements: number; warnings: Warn[] };
    setResult({
      text: `Tersimpan: ${fmtNum(r.lines)} baris diperbarui, ${fmtNum(r.added)} baris ditambah, ${fmtNum(r.movements)} mutasi tercatat.`,
      warnings: r.warnings ?? [],
    });
    resetAll();
    router.refresh();
    return null;
  }

  // ---- excel ---------------------------------------------------------------------------------------
  async function download(all: boolean) {
    setBusy(all ? "all" : "aisle"); setFileError(null);
    try {
      const { downloadStockCheck } = await import("@/lib/stockcheck-workbook");
      const date = today();
      if (!all) {
        await downloadStockCheck([{ aisle, rows }], { date }, `cek_stok_rak_${aisle}_${date}.xlsx`);
      } else {
        const db = createClient();
        const sheets = [];
        for (const a of aisles) {
          const d = a === aisle ? { bins, lines } : await loadAisle(db, a);
          const sheetRows = buildCheckRows(d.bins, d.lines);
          if (sheetRows.length) sheets.push({ aisle: a, rows: sheetRows });
        }
        await downloadStockCheck(sheets, { date }, `cek_stok_semua_rak_${date}.xlsx`);
      }
    } catch (e) { setFileError((e as Error).message); } finally { setBusy(null); }
  }

  const noSave = changes.length === 0 || problems.length > 0 || stale.length > 0 || newMulti.length > 0;
  let bay: number | null = null;

  return (
    <>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Pilih rak">
            <span className="text-sm font-medium text-steel-700">Rak</span>
            {aisles.map((a) => (
              <a key={a} href={`/stockopname?aisle=${a}`} aria-current={a === aisle ? "page" : undefined}
                onClick={(e) => { if (a !== aisle && pending > 0 && !window.confirm("Ada perubahan yang belum disimpan. Pindah rak dan buang perubahan itu?")) e.preventDefault(); }}
                className={cn("inline-flex h-10 min-w-12 items-center justify-center rounded-md border px-3 font-cond text-lg font-semibold",
                  a === aisle ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white text-steel hover:bg-steel-100")}>
                {a}
              </a>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-72 max-w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-500" />
              <Input aria-label="Cari bin, SKU, batch" placeholder="Cari bin, SKU, batch" value={query} className="pl-9"
                onChange={(e) => setQuery(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />Sembunyikan bin kosong
            </label>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void download(false)}>
                <Download className="h-4 w-4" />{busy === "aisle" ? "Menyiapkan…" : `Excel rak ${aisle}`}</Button>
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void download(true)}>
                <Download className="h-4 w-4" />{busy === "all" ? "Menyiapkan…" : "Excel semua rak"}</Button>
            </div>
          </div>
          <p className="text-sm text-steel-500 tabular">
            Rak {aisle}: {fmtNum(stats.bins)} bin · {fmtNum(stats.lines)} baris stok · {fmtNum(stats.cartons)} karton menurut sistem · {fmtNum(stats.empty)} bin kosong.
            Ubah jumlah, batch atau expired di baris; simpan sekali di bawah.
          </p>
          {fileError && <p role="alert" className="text-sm text-bad">{fileError}</p>}
        </CardContent>
      </Card>

      {result && (
        <div role="status" className="space-y-1 rounded-md border border-ok bg-ok/10 p-3 text-sm">
          <p className="font-semibold">{result.text}</p>
          <p>
            Laporan sebelum dan sesudah tersimpan tetap di tab{" "}
            <a href={`/stockopname?tab=laporan&aisle=${aisle}`} className="font-semibold underline">Laporan</a>: tidak bisa diubah atau dihapus.
          </p>
          {result.warnings.map((w) => (
            <p key={`${w.bin_code}|${w.sku}`} className="text-bad">
              {w.bin_code} · {w.sku}: tinggal {fmtNum(w.qty)}, tapi dipesan {fmtNum(w.reserved)} untuk wave NO {w.waves}. Baris wave itu tampil stok kurang sampai diperbaiki atau dihitung ulang.
            </p>
          ))}
        </div>
      )}

      <datalist id="stockcheck-skus">{items.map((i) => <option key={i.sku} value={i.sku}>{i.description}</option>)}</datalist>

      <Card>
        <div role="table" aria-label={`Stok rak ${aisle}`}>
          <div role="row" className={cn("hidden border-b border-steel-100 bg-steel-100/60 px-3 py-2 text-xs font-semibold text-steel-700 md:grid md:gap-x-2", GRID)}>
            <span>Bin</span><span>SKU fisik</span><span>Batch</span><span>Expired</span><span className="text-right">Qty sistem</span><span>Qty fisik</span><span>Status</span>
          </div>
          {visible.length === 0 && <p className="p-4 text-sm text-steel-500">{rows.length === 0 ? `Tidak ada bin di rak ${aisle}.` : "Tidak ada baris yang cocok."}</p>}
          {visible.map((r, i) => {
            const l = r.line;
            const b = bayOf(r.bin);
            const header = b !== null && b !== bay;
            if (b !== null) bay = b;
            const e = edits[r.key];
            const change = changeOf.get(r.key);
            const bad = problemOf.get(r.key);
            const isStale = stale.includes(r.key);
            const locked = !!l && l.reserved > 0;
            const swapped = !!l && e?.sku !== undefined && e.sku.trim() !== l.sku;
            const newDesc = swapped ? skus.get(e!.sku!.trim()) : undefined;
            const mine = added.filter((a) => a.bin === r.bin);
            const end = lastOfBin(i);
            return (
              <Fragment key={r.key}>
                {header && <div className="border-b border-t border-steel-100 bg-paper px-3 py-1 font-cond text-sm font-semibold text-steel-700 first:border-t-0">Bay {String(b).padStart(2, "0")}</div>}
                <div role="row" className={cn("grid grid-cols-6 items-center gap-x-2 gap-y-1 border-b border-steel-100 px-3 py-2 md:gap-y-0", GRID,
                  change && "bg-warn/10", (bad || isStale) && "bg-bad/10")}>
                  <div className="col-span-2 font-cond text-lg font-semibold tabular md:col-span-1">{r.bin}</div>
                  {l ? (
                    <>
                      <div className="col-span-4 min-w-0 text-sm md:col-span-1">
                        {/* Type the SKU that is physically on the shelf: the whole bin line is then booked as that SKU. */}
                        <Input aria-label={`SKU fisik ${r.bin} ${l.sku}`} list="stockcheck-skus" inputMode="numeric" className={cn(FIELD, "tabular font-semibold", swapped && "border-warn bg-warn/10")}
                          value={e?.sku ?? l.sku} disabled={locked} onFocus={(ev) => ev.target.select()}
                          title={locked ? `Dipakai wave NO ${l.waves.join(", ")}: SKU tidak bisa diubah sebelum wave selesai` : "Ketik SKU barang yang sebenarnya ada di bin ini"}
                          onChange={(ev) => setField(r, "sku", ev.target.value)} />
                        <span className={cn("block truncate text-xs", swapped && !newDesc ? "font-semibold text-bad" : "text-steel-700")}>
                          {swapped ? (newDesc ?? "SKU tidak dikenal") : l.description}
                          {swapped && <span className="text-steel-500"> · sistem: {l.sku}</span>}
                          {l.held > 0 && <span className="ml-1 rounded bg-warn px-1 font-semibold text-ink">hold {fmtNum(l.held)}</span>}
                        </span>
                      </div>
                      <label className="col-span-3 md:col-span-1">
                        <span className="text-xs text-steel-500 md:sr-only">Batch</span>
                        <Input aria-label={`Batch ${r.bin} ${l.sku}`} className={cn(FIELD, "uppercase")} value={e?.batch ?? l.batch_lot} disabled={locked}
                          title={locked ? `Dipakai wave NO ${l.waves.join(", ")}: batch dan expired tidak bisa diubah sebelum wave selesai` : undefined}
                          onChange={(ev) => setField(r, "batch", ev.target.value)} />
                      </label>
                      <label className="col-span-3 md:col-span-1">
                        <span className="text-xs text-steel-500 md:sr-only">Expired</span>
                        <Input aria-label={`Expired ${r.bin} ${l.sku}`} type="date" className={FIELD} value={e?.expiry ?? (l.expiry_date ?? "")} disabled={locked}
                          onChange={(ev) => setField(r, "expiry", ev.target.value)} />
                      </label>
                      <div className="col-span-2 text-sm tabular md:col-span-1 md:text-right">
                        <span className="text-xs text-steel-500 md:hidden">Sistem </span><b>{fmtNum(l.quantity)}</b>
                      </div>
                      <label className="col-span-2 md:col-span-1">
                        <span className="text-xs text-steel-500 md:sr-only">Qty fisik</span>
                        <Input aria-label={`Qty fisik ${r.bin} ${l.sku}`} inputMode="numeric" className={cn(FIELD, "text-right tabular")}
                          value={e?.qty ?? String(l.quantity)} onChange={(ev) => setField(r, "qty", ev.target.value)} />
                      </label>
                      <div className="col-span-2 flex flex-wrap items-center gap-x-2 text-xs md:col-span-1">
                        {bad && <span role="alert" className="font-semibold text-bad">{bad.replace(`${r.bin}: `, "")}</span>}
                        {isStale && <span role="alert" className="font-semibold text-bad">Stok berubah di sistem (kini {fmtNum(l.quantity)})</span>}
                        {change && !bad && !isStale && (
                          <span className="font-semibold text-steel-700">
                            {change.to.qty !== change.from!.qty && <span className={change.to.qty < change.from!.qty ? "text-bad" : "text-ok"}>{change.to.qty - change.from!.qty > 0 ? "+" : ""}{fmtNum(change.to.qty - change.from!.qty)} </span>}
                            {change.fromSku && "SKU diganti "}
                            {(change.to.batch !== change.from!.batch || change.to.expiry !== change.from!.expiry) && "identitas diubah"}
                          </span>
                        )}
                        {locked && <span className="text-steel-500" title={`Wave NO ${l.waves.join(", ")}`}>dipesan {fmtNum(l.reserved)} · NO {l.waves.join(", ")}</span>}
                        {e && <button type="button" aria-label={`Kembalikan ${r.bin} ${l.sku}`} className="inline-flex h-7 items-center gap-1 rounded px-1 text-steel-700 underline" onClick={() => resetRow(r.key)}><RotateCcw className="h-3 w-3" />kembalikan</button>}
                      </div>
                    </>
                  ) : (
                    <div className="col-span-4 text-sm italic text-steel-500 md:col-span-6">Kosong menurut sistem</div>
                  )}
                </div>
                {change && !bad && !isStale && (
                  <div role="row" className="flex flex-wrap items-center gap-x-2 border-b border-steel-100 bg-warn/5 px-3 py-1 text-xs tabular">
                    <span className="font-semibold text-steel-700">Sistem → fisik</span>
                    <DiffChips diffs={diffOf(change)} />
                  </div>
                )}
                {mine.map((a) => (
                  <div key={a.id} role="row" className={cn("grid grid-cols-6 items-center gap-x-2 gap-y-1 border-b border-steel-100 bg-ok/5 px-3 py-2 md:gap-y-0", GRID, problemOf.get(a.id) && "bg-bad/10")}>
                    <div className="col-span-2 font-cond text-lg font-semibold tabular md:col-span-1">{a.bin}<span className="block text-xs font-normal text-steel-500">stok ditemukan</span></div>
                    <label className="col-span-4 min-w-0 md:col-span-1">
                      <span className="text-xs text-steel-500 md:sr-only">SKU</span>
                      <Input aria-label={`SKU tambahan ${a.bin}`} list="stockcheck-skus" className={cn(FIELD, "tabular")} placeholder="SKU" value={a.sku}
                        onChange={(ev) => setAdd(a.id, { sku: ev.target.value })} />
                      {skus.get(a.sku.trim()) && <span className="block truncate text-xs text-steel-500">{skus.get(a.sku.trim())}</span>}
                    </label>
                    <label className="col-span-3 md:col-span-1">
                      <span className="text-xs text-steel-500 md:sr-only">Batch</span>
                      <Input aria-label={`Batch tambahan ${a.bin}`} className={cn(FIELD, "uppercase")} placeholder="Batch" value={a.batch} onChange={(ev) => setAdd(a.id, { batch: ev.target.value })} />
                    </label>
                    <label className="col-span-3 md:col-span-1">
                      <span className="text-xs text-steel-500 md:sr-only">Expired</span>
                      <Input aria-label={`Expired tambahan ${a.bin}`} type="date" className={FIELD} value={a.expiry} onChange={(ev) => setAdd(a.id, { expiry: ev.target.value })} />
                    </label>
                    <div className="hidden md:block" />
                    <label className="col-span-2 md:col-span-1">
                      <span className="text-xs text-steel-500 md:sr-only">Qty</span>
                      <Input aria-label={`Qty tambahan ${a.bin}`} inputMode="numeric" className={cn(FIELD, "text-right tabular")} placeholder="Qty" value={a.qty} onChange={(ev) => setAdd(a.id, { qty: ev.target.value })} />
                    </label>
                    <div className="col-span-2 flex items-center gap-2 text-xs md:col-span-1">
                      {problemOf.get(a.id) && <span role="alert" className="font-semibold text-bad">{problemOf.get(a.id)!.replace(`${a.bin} (tambah): `, "")}</span>}
                      <button type="button" aria-label={`Batal tambah ${a.bin}`} className="inline-flex h-9 w-9 items-center justify-center rounded text-steel-700 hover:bg-steel-100" onClick={() => dropAdd(a.id)}><X className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
                {end && (
                  <div className="border-b border-steel-100 px-3 py-1">
                    <button type="button" className="inline-flex h-8 items-center gap-1 rounded px-1 text-xs font-medium text-steel-700 hover:bg-steel-100" onClick={() => addLine(r.bin)}>
                      <Plus className="h-3 w-3" />{l ? `Tambah stok lain di ${r.bin}` : `Ada stok di ${r.bin}`}
                    </button>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </Card>

      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 rounded-lg border border-steel-300 bg-white/95 p-3 shadow-lg backdrop-blur md:bottom-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm tabular" role="status">
            <b>{fmtNum(changes.length)}</b> perubahan
            {changes.length > 0 && (
              <span className="ml-2" title="Karton di rak ini menurut sistem, dan sesudah perubahan disimpan">
                · {fmtNum(summary.before)} → <b>{fmtNum(summary.after)}</b> karton{" "}
                <span className={summary.after - summary.before < 0 ? "font-semibold text-bad" : summary.after - summary.before > 0 ? "font-semibold text-ok" : "text-steel-500"}>
                  ({summary.after - summary.before > 0 ? "+" : summary.after - summary.before < 0 ? "−" : ""}{fmtNum(Math.abs(summary.after - summary.before))})
                </span>
              </span>
            )}
            {problems.length > 0 && <span className="ml-2 font-semibold text-bad">{fmtNum(problems.length)} perlu diperbaiki</span>}
            {stale.length > 0 && <span className="ml-2 font-semibold text-bad">{fmtNum(stale.length)} baris stoknya berubah di sistem: kembalikan dulu</span>}
          </p>
          {newMulti.length > 0 && (
            <p role="alert" className="text-sm font-semibold text-bad">
              {newMulti.map((m) => `${m.bin} jadi berisi ${m.skus.length} SKU`).join("; ")}: satu bin satu SKU. Kosongkan SKU lama (qty 0) atau pindah.
            </p>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" disabled={Object.keys(edits).length === 0 && added.length === 0} onClick={resetAll}>Buang semua</Button>
            <ConfirmButton size="sm" disabled={noSave} title={`Simpan cek stok rak ${aisle}`} confirmLabel="Simpan"
              summary={`Simpan ${changes.length} perubahan di rak ${aisle}: stok di sistem disamakan dengan hasil cek. Semua berhasil sekaligus atau tidak ada yang tersimpan. Setiap perubahan tercatat sebagai mutasi penyesuaian.`}
              extra={(
                <div className="space-y-3">
                  <div className="max-h-72 overflow-y-auto">
                    <ReviewSummary summary={summary} changes={changes} aisle={aisle} />
                  </div>
                  <div>
                    <label htmlFor="rc-reason" className="mb-1 block text-sm font-medium text-steel-700">Alasan</label>
                    <Select id="rc-reason" value={reason} onChange={(ev) => setReason(ev.target.value as ReasonCode)}>
                      {MANUAL_REASONS.map((c) => <option key={c} value={c}>{REASON_CODES[c]}</option>)}
                    </Select>
                  </div>
                  <PersonNameField id="rc-name" value={person} onChange={setPerson} label="Nama Anda" />
                </div>
              )}
              onConfirm={save}>Simpan perubahan</ConfirmButton>
          </div>
        </div>
      </div>
      <p className="px-1 text-xs text-steel-500">
        Barang di bin beda dengan sistem? Ketik SKU yang benar di kolom SKU fisik: SKU lama dikosongkan dan SKU baru dibukukan dengan jumlah, batch dan expired di baris itu, dalam satu simpan.
        Baris yang dipesan wave terbuka tidak bisa ganti SKU, batch atau expired. Jumlah boleh diubah: wave yang kekurangan stok akan tampil stok kurang.
      </p>
    </>
  );
}
