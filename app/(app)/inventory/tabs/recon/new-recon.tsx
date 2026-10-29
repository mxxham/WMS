"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkBook } from "xlsx";
import { Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { cutoffIso, defaultCutoff, isFuture, mvtLabel, nowWib } from "@/lib/sap-compare";
import type { Mb51Parse, Mb52Parse, PendingRow } from "@/lib/sap-stock";
import { fetchAll } from "@/lib/fetch-all";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const sap = () => import("@/lib/sap-stock");
async function readBook(f: File) { const XLSX = await import("xlsx"); return XLSX.read(await f.arrayBuffer(), { cellDates: false }); }

function FilePick({ label, onFile, accept = ".xlsx,.xls" }: { label: string; onFile: (f: File | undefined) => void; accept?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-steel-300 bg-white px-3 py-2 text-sm hover:bg-paper">
      <Upload className="h-4 w-4 shrink-0" /><span className="truncate">{label}</span>
      <input type="file" accept={accept} className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}

/**
 * Upload Shell's SAP export and snapshot our stock against it. One workbook
 * may carry MB52 (one sheet per storage location) and MB51; MB51 can also
 * come as its own file.
 */
export function NewRecon() {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [asOf, setAsOf] = useState(today());
  const [book, setBook] = useState<{ name: string; wb: WorkBook; stockSheets: string[] } | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [mb52, setMb52] = useState<Mb52Parse | null>(null);
  const [slocs, setSlocs] = useState<string[]>([]);
  const [mb51, setMb51] = useState<(Mb51Parse & { file: string }) | null>(null);
  const [gi, setGi] = useState<PendingRow[]>([]);
  const [gr, setGr] = useState<PendingRow[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Our side of the comparison (0113): the on hand of the SAP date as in Laporan WMS harian
  // (default), our stock at a WIB time (0112), or our stock now (0111).
  const [mode, setMode] = useState<"day" | "at" | "now">("day");
  const [cutoffEdit, setCutoffEdit] = useState<string | null>(null);
  const cutoff = cutoffEdit ?? defaultCutoff(asOf);
  const dayFuture = asOf > nowWib().slice(0, 10);
  const future = mode === "day" ? dayFuture : mode === "at" && isFuture(cutoff);
  const [later, setLater] = useState<{ all: number; picks: number } | null>(null);
  const [onHand, setOnHand] = useState<{ day: string; bySku: Map<string, number>; total: number } | null>(null);
  const [onHandErr, setOnHandErr] = useState<string | null>(null);

  // The day's on hand, summed per SKU from the same function as the daily report, so the
  // match with SAP is visible before Buat.
  useEffect(() => {
    if (mode !== "day" || dayFuture) return;
    let live = true;
    setOnHandErr(null);
    void (async () => {
      const db = createClient();
      try {
        const rows = await fetchAll<{ sku: string; on_hand: number }>((a, b) =>
          db.rpc("wms_day_report", { p_date: asOf }).select("sku, on_hand").range(a, b) as unknown as PromiseLike<{ data: { sku: string; on_hand: number }[] | null; error: { message: string } | null }>);
        const bySku = new Map<string, number>();
        for (const r of rows) bySku.set(r.sku, (bySku.get(r.sku) ?? 0) + Number(r.on_hand));
        if (live) setOnHand({ day: asOf, bySku, total: [...bySku.values()].reduce((x, y) => x + y, 0) });
      } catch (e) { if (live) setOnHandErr((e as Error).message); }
    })();
    return () => { live = false; };
  }, [mode, asOf, dayFuture]);

  // How much of our ledger a cut-off time leaves out.
  useEffect(() => {
    if (mode !== "at" || future) { setLater(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const sb = createClient();
      const since = cutoffIso(cutoff);
      const [a, p] = await Promise.all([
        sb.from("movements").select("id", { count: "exact", head: true }).gt("created_at", since),
        sb.from("movements").select("id", { count: "exact", head: true }).gt("created_at", since).eq("type", "picking"),
      ]);
      if (live && !a.error && !p.error) setLater({ all: a.count ?? 0, picks: p.count ?? 0 });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [mode, cutoff, future]);

  async function onSap(f: File | undefined) {
    setError(null); setMb52(null); setBook(null);
    if (!f) return;
    try {
      const wb = await readBook(f);
      const lib = await sap();
      const p = lib.parseMb52(wb);
      setBook({ name: f.name, wb, stockSheets: p.sheets });
      setSheets(p.sheets); setMb52(p); setSlocs(lib.defaultSlocs(p.slocs.map((s) => s.sloc)));
      const d = lib.dateFromFileName(f.name);
      if (d) setAsOf(d);
      try { setMb51({ ...lib.parseMb51(wb), file: f.name }); } catch { /* MB51 is optional; it may come as its own file */ }
    } catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
  }
  async function toggleSheet(name: string) {
    if (!book) return;
    const next = sheets.includes(name) ? sheets.filter((s) => s !== name) : [...sheets, name];
    setSheets(next);
    if (!next.length) { setMb52(null); return; }
    const lib = await sap();
    try {
      const p = lib.parseMb52(book.wb, next);
      setMb52(p);
      const found = p.slocs.map((s) => s.sloc);
      setSlocs((cur) => { const kept = cur.filter((s) => found.includes(s)); return kept.length ? kept : lib.defaultSlocs(found); });
    } catch (e) { setMb52(null); setError((e as Error).message); }
  }
  async function onMb51(f: File | undefined) {
    setError(null);
    if (!f) return;
    try { setMb51({ ...(await sap()).parseMb51(await readBook(f)), file: f.name }); } catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
  }
  async function onPending(f: File | undefined, set: (r: PendingRow[]) => void) {
    setError(null);
    if (!f) return set([]);
    try { set((await sap()).parsePendingList(await readBook(f))); } catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
  }

  const split = useMemo(() => {
    if (!mb52) return null;
    const keep = new Set(slocs);
    const counted = mb52.rows.filter((r) => !r.sloc || keep.has(r.sloc));
    return {
      skus: new Set(counted.map((r) => r.sku)).size,
      unrestricted: counted.reduce((s, r) => s + r.unrestricted, 0), blocked: counted.reduce((s, r) => s + r.blocked, 0),
      otherSkus: new Set(mb52.rows.filter((r) => r.sloc && !keep.has(r.sloc)).map((r) => r.sku)).size,
    };
  }, [mb52, slocs]);
  const mvtSummary = useMemo(() => {
    const m = new Map<string, { lines: number; qty: number }>();
    for (const r of mb51?.rows ?? []) { const e = m.get(r.mvt_type) ?? { lines: 0, qty: 0 }; e.lines++; e.qty += r.quantity; m.set(r.mvt_type, e); }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [mb51]);

  async function create(): Promise<string | null> {
    if (!mb52 || !book) return "Upload file MB52 dulu";
    if (!slocs.length && mb52.slocs.some((s) => s.sloc)) return "Pilih minimal satu storage location";
    const { splitBySloc } = await sap();
    const { sap: counted, other } = splitBySloc(mb52.rows, slocs);
    if (!counted.length) return "Tidak ada stok SAP di storage location yang dipilih";
    const pending = new Map<string, { sku: string; pending_gi: number; pending_gr: number }>();
    for (const r of gi) pending.set(r.sku, { sku: r.sku, pending_gi: r.qty, pending_gr: pending.get(r.sku)?.pending_gr ?? 0 });
    for (const r of gr) pending.set(r.sku, { sku: r.sku, pending_gi: pending.get(r.sku)?.pending_gi ?? 0, pending_gr: r.qty });
    const files = [book.name, mb51 && mb51.file !== book.name ? mb51.file : null].filter(Boolean).join(" + ");
    const { data, error } = await createClient().rpc("create_stock_recon_mb52", {
      p_as_of: asOf, p_file_name: `${files} · ${slocs.filter(Boolean).join(", ") || "semua lokasi"}`, p_note: note || null,
      p_sap: counted, p_other: other, p_slocs: slocs.filter(Boolean), p_moves: mb51?.rows ?? [], p_pending: [...pending.values()], p_by_name: person,
      p_wms_at: mode === "at" ? cutoffIso(cutoff) : null, p_wms_day: mode === "day" ? asOf : null,
    });
    if (error) return error.message;
    router.push(`/inventory?tab=rekonsiliasi&recon=${data}`);
    return null;
  }

  const summary = split
    ? `Bandingkan ${fmtNum(split.skus)} SKU stok SAP ${slocs.filter(Boolean).join(" + ")} per ${fmtDate(asOf)} (bebas ${fmtNum(split.unrestricted)}, blok ${fmtNum(split.blocked)}) dengan ${mode === "day" ? `on hand WMS ${fmtDate(asOf)} (Laporan WMS harian)` : mode === "at" ? `stok WMS per ${fmtDateTime(cutoffIso(cutoff))} WIB` : "stok WMS saat ini"}.`
      + (mb51 ? ` ${fmtNum(mb51.rows.length)} transaksi MB51 ikut disimpan.` : "")
    : "";

  return (
    <Card>
      <CardHeader><CardTitle>Bandingkan stok dengan SAP</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-steel-500">
          SAP adalah acuan. Upload export MB52 (boleh satu file dengan sheet MB51). Stok WMS yang dibandingkan: on hand hari itu, sama dengan kolom Qty (on hand) di Laporan WMS harian (setelah putaway, sebelum pick hari itu), jadi barang yang keluar hari ini tidak terbaca kurang. Stok fisik tidak berubah.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <FilePick label={book ? book.name : "File MB52 (.xlsx)"} onFile={onSap} />
          <FilePick label={mb51 ? `MB51: ${mb51.file}` : "MB51 terpisah (opsional)"} onFile={onMb51} />
          <div><Label htmlFor="asof">Stok SAP per tanggal</Label><Input id="asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
        </div>
        <div className="space-y-2 rounded-md border border-steel-200 bg-white p-3">
          <div className="text-sm font-medium">Stok WMS yang dibandingkan</div>
          <div className="flex flex-wrap gap-1">
            {([["day", `On hand harian ${fmtDate(asOf)}`], ["at", "Jam tertentu"], ["now", "Sekarang"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setMode(k)}
                className={cn("rounded-md border px-3 py-2 text-sm", mode === k ? "border-ckb bg-ckb/10 font-semibold" : "border-steel-300")}>{l}</button>
            ))}
          </div>
          {mode === "day" && (
            <p className="text-sm">
              {dayFuture ? <span className="font-semibold text-bad">Tanggal ini belum tiba.</span>
                : onHandErr ? <span className="text-bad">{onHandErr}</span>
                : !onHand || onHand.day !== asOf ? <span className="text-steel-500">Menghitung on hand {fmtDate(asOf)}…</span>
                : <OnHandCheck onHand={onHand.bySku} total={onHand.total} mb52={mb52} slocs={slocs} />}
            </p>
          )}
          {mode === "at" && (
            <div className="flex flex-wrap items-end gap-3">
              <div><Label htmlFor="cutoff">Stok WMS per (WIB)</Label>
                <Input id="cutoff" type="datetime-local" value={cutoff} max={nowWib()} onChange={(e) => setCutoffEdit(e.target.value || null)} /></div>
              <p className="min-w-60 flex-1 pb-2 text-xs text-steel-500">
                {future ? <span className="font-semibold text-bad">Jam ini belum lewat.</span>
                  : later ? <>{fmtNum(later.all)} mutasi WMS sesudah jam ini tidak dihitung{later.picks > 0 && <>, termasuk {fmtNum(later.picks)} pick</>}. Putaway sesudah jam ini juga tidak dihitung.</>
                  : "Menghitung mutasi sesudah jam ini…"}
              </p>
            </div>
          )}
          {mode === "now" && <p className="text-xs text-steel-500">Pick hari ini ikut mengurangi stok WMS: hanya cocok bila MB52 ditarik barusan dan SAP sudah GI semua pengiriman hari ini.</p>}
        </div>

        {book && book.stockSheets.length > 1 && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Sheet stok yang dibaca</legend>
            <div className="flex flex-wrap gap-2">
              {book.stockSheets.map((s) => (
                <label key={s} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm", sheets.includes(s) ? "border-ckb bg-ckb/10" : "border-steel-300")}>
                  <input type="checkbox" checked={sheets.includes(s)} onChange={() => toggleSheet(s)} />{s}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {mb52 && mb52.slocs.some((s) => s.sloc) && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Storage location yang dihitung sebagai stok gudang</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {mb52.slocs.map((s) => {
                const on = slocs.includes(s.sloc);
                return (
                  <label key={s.sloc} className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm", on ? "border-ckb bg-ckb/10" : "border-steel-300 bg-white")}>
                    <input type="checkbox" className="mt-1" checked={on} onChange={() => setSlocs((c) => (on ? c.filter((x) => x !== s.sloc) : [...c, s.sloc]))} />
                    <span><b>{s.sloc || "(tanpa lokasi)"}</b> · {fmtNum(s.skus)} SKU
                      <span className="block text-xs text-steel-500">bebas {fmtNum(s.unrestricted)} · blok {fmtNum(s.blocked)}</span></span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-steel-500">Dicentang: dibandingkan dengan stok WMS. Tidak dicentang (mis. INBD = belum masuk gudang di SAP, RETN = lokasi retur): ditampilkan terpisah per SKU, untuk menjelaskan selisih.</p>
          </fieldset>
        )}

        {split && (
          <p className="rounded-md bg-paper p-2 text-sm">
            Dibandingkan: <b>{fmtNum(split.skus)} SKU</b> · bebas {fmtNum(split.unrestricted)} · blok {fmtNum(split.blocked)}
            {split.otherSkus > 0 && <> · {fmtNum(split.otherSkus)} SKU di lokasi lain</>}
            {mb52!.skipped.length > 0 && <span className="text-steel-500"> · {mb52!.skipped.length} baris dilewati (mis. {mb52!.skipped[0].sheet} baris {mb52!.skipped[0].line}: {mb52!.skipped[0].why})</span>}
          </p>
        )}
        {mb52 && mb52.warnings.length > 0 && (
          <ul className="list-disc space-y-0.5 rounded-md bg-warn/10 p-2 pl-6 text-sm">{mb52.warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}
            {mb52.warnings.length > 8 && <li>… {mb52.warnings.length - 8} lagi</li>}</ul>
        )}
        {mb51 && (
          <div className="rounded-md bg-paper p-2 text-sm">
            MB51 <b>{mb51.sheet}</b>: {fmtNum(mb51.rows.length)} transaksi{mb51.from && <> · posting {fmtDate(mb51.from)}{mb51.to !== mb51.from && <> – {fmtDate(mb51.to)}</>}</>}
            <div className="mt-1 flex flex-wrap gap-1">{mvtSummary.map(([t, v]) => (
              <span key={t} className="rounded bg-white px-2 py-0.5 text-xs">{t} {mvtLabel(t)}: {v.lines} baris, {v.qty > 0 ? "+" : ""}{fmtNum(v.qty)}</span>
            ))}</div>
          </div>
        )}

        <details className="rounded-md border border-steel-200 p-2">
          <summary className="cursor-pointer text-sm">Pending GI / GR manual (opsional)</summary>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <FilePick label={`Pending GI${gi.length ? ` · ${gi.length} SKU` : ""}`} onFile={(f) => onPending(f, setGi)} />
            <FilePick label={`Pending GR${gr.length ? ` · ${gr.length} SKU` : ""}`} onFile={(f) => onPending(f, setGr)} />
            <p className="pb-2 text-xs text-steel-500">Pending GI: sudah keluar gudang, belum GI di SAP. Pending GR: sudah diterima di sini, belum GR di SAP. Kolom Material + Delivery quantity. Kalau ada MB51, bagian Pengiriman vs GI SAP bisa menghitungnya otomatis.</p>
          </div>
        </details>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1"><Label htmlFor="rnote">Catatan</Label><Input id="rnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="opsional, mis. MB52 ditarik jam 09:45" /></div>
          <PersonNameField id="rperson" value={person} onChange={setPerson} />
          <ConfirmButton title="Buat rekonsiliasi" summary={summary} confirmLabel="Buat" onConfirm={create}
            disabled={!split || future || person.trim().length < 2}>Buat rekonsiliasi</ConfirmButton>
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** On hand of the day vs the counted MB52 locations, before anything is saved. */
function OnHandCheck({ onHand, total, mb52, slocs }: { onHand: Map<string, number>; total: number; mb52: Mb52Parse | null; slocs: string[] }) {
  if (!mb52) return <>On hand WMS: <b className="tabular">{fmtNum(total)}</b> karton, {fmtNum(onHand.size)} SKU. Upload MB52 untuk melihat kecocokannya.</>;
  const keep = new Set(slocs);
  const sap = new Map<string, number>();
  for (const r of mb52.rows) if (!r.sloc || keep.has(r.sloc)) sap.set(r.sku, (sap.get(r.sku) ?? 0) + r.unrestricted + r.blocked);
  const skus = new Set([...sap.keys(), ...[...onHand].filter(([, q]) => q !== 0).map(([k]) => k)]);
  let same = 0;
  for (const k of skus) if ((sap.get(k) ?? 0) === (onHand.get(k) ?? 0)) same++;
  const sapTotal = [...sap.values()].reduce((a, b) => a + b, 0);
  const d = total - sapTotal;
  return (
    <>On hand WMS <b className="tabular">{fmtNum(total)}</b> · SAP {slocs.filter(Boolean).join(" + ") || "semua"} <b className="tabular">{fmtNum(sapTotal)}</b>
      {" · "}<span className={cn("font-semibold", d === 0 ? "text-ok" : "text-warn")}>{d === 0 ? "total sama" : `beda ${d > 0 ? "+" : ""}${fmtNum(d)}`}</span>
      {" · "}<b>{fmtNum(same)}</b> dari {fmtNum(skus.size)} SKU sama persis (bebas + blok).</>
  );
}
