"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { Download, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { RECON_STATUS } from "@/lib/inventory-control";
import { parsePendingList, parseSapStock, type PendingRow, type SapParse } from "@/lib/sap-stock";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

export type ReconSummary = {
  id: string; as_of: string; file_name: string | null; note: string | null; status: "OPEN" | "CLOSED"; created_by_name: string; created_at: string;
  closed_by_name: string | null; closed_at: string | null; close_note: string | null;
  skus: number; skus_match: number; accuracy_pct: number | null; abs_diff: number; sap_total: number; open_diffs: number;
};
export type ReconLine = {
  id: string; recon_id: string; item_id: string | null; sku: string; description: string | null; sap_uom: string | null; wms_uom: string | null;
  sap_unrestricted: number; sap_blocked: number; wms_unrestricted: number; wms_blocked: number; pending_gi: number; pending_gr: number;
  diff_unrestricted: number; diff_blocked: number; status: keyof typeof RECON_STATUS; remark: string | null; updated_by_name: string | null; updated_at: string | null;
};

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/**
 * Shell's SAP book stock vs ours, per SKU (SAP keeps no real batch here:
 * batch "UT"). Unrestricted vs our free stock, Blocked vs our held +
 * quarantined stock; pending GI / GR explain timing. The layout follows the
 * manual "SAP vs fisik" sheet.
 */
export function ReconTab({ runs, selected, lines }: { runs: ReconSummary[]; selected: string | null; lines: ReconLine[] | null }) {
  const run = runs.find((r) => r.id === selected) ?? null;
  return (
    <div className="space-y-6 p-4 lg:p-8">
      {!selected && <NewRecon />}
      {!selected && (
        <Card>
          <CardHeader><CardTitle>Riwayat rekonsiliasi</CardTitle></CardHeader>
          <CardContent>
            {runs.length === 0 ? <p className="text-sm text-steel-500">Belum ada. Upload stok SAP di atas.</p> : (
              <Table>
                <thead><tr><Th>Per tanggal</Th><Th>File</Th><Th className="text-right">SKU</Th><Th className="text-right">Cocok</Th><Th className="text-right">Akurasi</Th><Th className="text-right">Total selisih</Th><Th className="text-right">Belum dijelaskan</Th><Th>Status</Th><Th /></tr></thead>
                <tbody>{runs.map((r) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap">{fmtDate(r.as_of)}</Td><Td className="text-xs">{r.file_name}<div>{r.created_by_name} · {fmtDateTime(r.created_at)}</div></Td>
                    <Td className="text-right tabular">{fmtNum(r.skus)}</Td><Td className="text-right tabular">{fmtNum(r.skus_match)}</Td>
                    <Td className="text-right font-semibold tabular">{r.accuracy_pct === null ? "–" : `${Number(r.accuracy_pct).toFixed(1)}%`}</Td>
                    <Td className="text-right tabular">{fmtNum(Number(r.abs_diff))}</Td>
                    <Td className={cn("text-right tabular", r.open_diffs > 0 && "font-semibold text-warn")}>{fmtNum(r.open_diffs)}</Td>
                    <Td className="text-xs">{r.status === "OPEN" ? "Terbuka" : `Ditutup ${fmtDate(r.closed_at)}`}</Td>
                    <Td><Link className="text-sm underline" href={`/inventory?tab=rekonsiliasi&recon=${r.id}`}>Buka</Link></Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
      {selected && run && lines && <ReconDetail run={run} lines={lines} />}
      {selected && !run && <p className="text-sm text-bad">Rekonsiliasi tidak ditemukan. <Link className="underline" href="/inventory?tab=rekonsiliasi">Kembali</Link></p>}
    </div>
  );
}

function NewRecon() {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [asOf, setAsOf] = useState(today());
  const [file, setFile] = useState<{ name: string; wb: XLSX.WorkBook } | null>(null);
  const [sheet, setSheet] = useState("");
  const [parsed, setParsed] = useState<SapParse | null>(null);
  const [gi, setGi] = useState<PendingRow[]>([]);
  const [gr, setGr] = useState<PendingRow[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function readBook(f: File) { return XLSX.read(await f.arrayBuffer(), { cellDates: false }); }
  async function onSap(f: File | undefined) {
    setError(null); setParsed(null);
    if (!f) return;
    try {
      const wb = await readBook(f);
      setFile({ name: f.name, wb });
      const p = parseSapStock(wb);
      setParsed(p); setSheet(p.sheet);
    } catch (e) { setError((e as Error).message); }
  }
  function pickSheet(name: string) {
    setSheet(name); setError(null);
    try { setParsed(parseSapStock(file!.wb, name)); } catch (e) { setParsed(null); setError((e as Error).message); }
  }
  async function onPending(f: File | undefined, set: (r: PendingRow[]) => void) {
    setError(null);
    if (!f) return set([]);
    try { set(parsePendingList(await readBook(f))); } catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
  }

  async function create() {
    if (!parsed || !file) return;
    setBusy(true); setError(null);
    const pending = new Map<string, { sku: string; pending_gi: number; pending_gr: number }>();
    for (const r of gi) pending.set(r.sku, { sku: r.sku, pending_gi: r.qty, pending_gr: pending.get(r.sku)?.pending_gr ?? 0 });
    for (const r of gr) pending.set(r.sku, { sku: r.sku, pending_gi: pending.get(r.sku)?.pending_gi ?? 0, pending_gr: r.qty });
    const { data, error } = await createClient().rpc("create_stock_recon", {
      p_as_of: asOf, p_file_name: `${file.name} · ${parsed.sheet}`, p_note: note || null,
      p_sap: parsed.rows.map(({ sku, description, uom, unrestricted, blocked }) => ({ sku, description, uom, unrestricted, blocked })),
      p_pending: [...pending.values()], p_by_name: person,
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.push(`/inventory?tab=rekonsiliasi&recon=${data}`);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Rekonsiliasi baru</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-steel-500">Upload stok SAP (MB52 / sheet &quot;SAP vs fisik&quot;: kolom Material atau SKU CODE, Unrestricted, Blocked). Stok WMS diambil saat tombol Buat ditekan, jadi upload file SAP dari jam yang sama.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="asof">Stok SAP per tanggal</Label><Input id="asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-steel-300 bg-white px-3 py-2 text-sm hover:bg-paper">
            <Upload className="h-4 w-4" />{file ? file.name : "File stok SAP (.xlsx)"}
            <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => onSap(e.target.files?.[0])} />
          </label>
          {file && file.wb.SheetNames.length > 1 && (
            <div><Label htmlFor="sheet">Sheet</Label>
              <Select id="sheet" value={sheet} onChange={(e) => pickSheet(e.target.value)}>{file.wb.SheetNames.map((n) => <option key={n} value={n}>{n}</option>)}</Select></div>
          )}
        </div>
        {parsed && (
          <p className="rounded-md bg-paper p-2 text-sm">Sheet <b>{parsed.sheet}</b> (judul di baris {parsed.headerLine}): {fmtNum(parsed.rows.length)} baris SKU · Unrestricted {fmtNum(parsed.rows.reduce((s, r) => s + r.unrestricted, 0))} · Blocked {fmtNum(parsed.rows.reduce((s, r) => s + r.blocked, 0))}
            {parsed.skipped.length > 0 && <span className="text-steel-500"> · {parsed.skipped.length} baris dilewati (mis. baris {parsed.skipped[0].line}: {parsed.skipped[0].why})</span>}</p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-steel-300 bg-white px-3 py-2 text-sm hover:bg-paper">
            <Upload className="h-4 w-4" />Pending GI (opsional){gi.length > 0 && ` · ${gi.length} SKU`}
            <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => onPending(e.target.files?.[0], setGi)} />
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-steel-300 bg-white px-3 py-2 text-sm hover:bg-paper">
            <Upload className="h-4 w-4" />Pending GR (opsional){gr.length > 0 && ` · ${gr.length} SKU`}
            <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => onPending(e.target.files?.[0], setGr)} />
          </label>
          <p className="pb-2 text-xs text-steel-500">Pending GI: sudah keluar gudang, belum GI di SAP (Material + Delivery quantity). Pending GR: sudah diterima di sini, belum GR di SAP.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1"><Label htmlFor="rnote">Catatan</Label><Input id="rnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="opsional" /></div>
          <PersonNameField id="rperson" value={person} onChange={setPerson} />
          <Button onClick={create} disabled={!parsed || busy || person.trim().length < 2}>{busy ? "Membuat…" : "Buat rekonsiliasi"}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}

type Filter = "diff" | "open" | "all";

function ReconDetail({ run, lines }: { run: ReconSummary; lines: ReconLine[] }) {
  const router = useRouter();
  const [person, setPerson] = usePersonName();
  const [filter, setFilter] = useState<Filter>("diff");
  const [closeNote, setCloseNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasDiff = (l: ReconLine) => Number(l.diff_unrestricted) !== 0 || Number(l.diff_blocked) !== 0;
  const shown = useMemo(() => lines.filter((l) => filter === "all" || (hasDiff(l) && (filter === "diff" || l.status === "OPEN" || l.status === "COUNT_REQUESTED")))
    .sort((a, b) => Math.abs(Number(b.diff_unrestricted)) + Math.abs(Number(b.diff_blocked)) - Math.abs(Number(a.diff_unrestricted)) - Math.abs(Number(a.diff_blocked)) || a.sku.localeCompare(b.sku)), [lines, filter]);
  const open = run.status === "OPEN";

  function exportXlsx() {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(lines.map((l) => ({
      "SKU CODE": l.sku, "Material Description": l.description ?? "", "Base Unit of Measure": l.sap_uom || l.wms_uom || "",
      "SAP Unrestricted": Number(l.sap_unrestricted), "SAP Blocked": Number(l.sap_blocked),
      "FISIK Unrestricted": Number(l.wms_unrestricted), "FISIK Blocked": Number(l.wms_blocked),
      "Pending GI": Number(l.pending_gi), "Pending GR": Number(l.pending_gr),
      "Unrest Diff (SAP vs fisik)": Number(l.diff_unrestricted), "Blok Diff (SAP vs fisik)": Number(l.diff_blocked),
      Status: RECON_STATUS[l.status], Remark: l.remark ?? "", "Diisi oleh": l.updated_by_name ?? "",
    }))), "SAP vs fisik");
    XLSX.writeFile(book, `SAP_vs_fisik_${run.as_of}.xlsx`);
  }

  async function close() {
    const { error } = await createClient().rpc("close_stock_recon", { p_id: run.id, p_note: closeNote, p_by_name: person });
    if (error) return setError(error.message);
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="text-sm underline" href="/inventory?tab=rekonsiliasi">← Semua rekonsiliasi</Link>
        <Button variant="outline" size="sm" onClick={exportXlsx}><Download className="h-4 w-4" />Excel (format SAP vs fisik)</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {([["Per tanggal", fmtDate(run.as_of)], ["SKU", fmtNum(run.skus)], ["SKU cocok", fmtNum(run.skus_match)],
          ["Akurasi SAP vs fisik", run.accuracy_pct === null ? "–" : `${Number(run.accuracy_pct).toFixed(1)}%`], ["Belum dijelaskan", fmtNum(run.open_diffs)]] as const).map(([l, v]) => (
          <div key={l} className="rounded-lg bg-white p-3"><div className="text-xs text-steel-500">{l}</div><div className="font-cond text-2xl font-semibold tabular">{v}</div></div>
        ))}
      </div>
      <p className="text-xs text-steel-500">Selisih Unrestricted = SAP − (fisik bebas + pending GI − pending GR). Selisih Blocked = SAP Blocked − (stok ditahan + karantina). {run.file_name} · dibuat {run.created_by_name} {fmtDateTime(run.created_at)}{run.note && ` · ${run.note}`}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-md border border-steel-300 text-sm">
          {([["diff", "Ada selisih"], ["open", "Belum ditangani"], ["all", "Semua SKU"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={cn("px-3 py-2 first:rounded-l-md last:rounded-r-md", filter === k ? "bg-ckb text-white" : "hover:bg-steel-100")}>{l}</button>
          ))}
        </div>
        <PersonNameField id="lperson" value={person} onChange={setPerson} />
      </div>
      <Card>
        <CardContent>
          {shown.length === 0 ? <p className="text-sm text-ok">Tidak ada selisih untuk filter ini.</p> : (
            <Table>
              <thead><tr><Th>SKU</Th><Th className="text-right">SAP unrest</Th><Th className="text-right">Fisik unrest</Th><Th className="text-right">GI / GR</Th><Th className="text-right">Selisih unrest</Th>
                <Th className="text-right">SAP blok</Th><Th className="text-right">Fisik blok</Th><Th className="text-right">Selisih blok</Th><Th>Penanganan</Th></tr></thead>
              <tbody>{shown.map((l) => <LineRow key={l.id} l={l} open={open} person={person} />)}</tbody>
            </Table>
          )}
        </CardContent>
      </Card>
      {open ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-72 flex-1"><Label htmlFor="cnote">Catatan penutupan {run.open_diffs > 0 && "(wajib: masih ada selisih belum dijelaskan)"}</Label><Input id="cnote" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} /></div>
          <Button variant="outline" onClick={close} disabled={person.trim().length < 2}>Tutup rekonsiliasi</Button>
          {error && <p role="alert" className="w-full text-sm text-bad">{error}</p>}
        </div>
      ) : <p className="text-sm">Ditutup {fmtDateTime(run.closed_at)} oleh {run.closed_by_name}{run.close_note && `: ${run.close_note}`}</p>}
    </>
  );
}

function LineRow({ l, open, person }: { l: ReconLine; open: boolean; person: string }) {
  const router = useRouter();
  const [remark, setRemark] = useState(l.remark ?? "");
  const [status, setStatus] = useState(l.status);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const du = Number(l.diff_unrestricted), db = Number(l.diff_blocked);
  const uomDiffers = !!l.sap_uom && !!l.wms_uom && l.sap_uom !== l.wms_uom;

  async function save() {
    const { error } = await createClient().rpc("update_recon_line", { p_line_id: l.id, p_status: status, p_remark: remark, p_by_name: person });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Tersimpan" });
    if (!error) router.refresh();
  }
  async function recount() {
    const { data, error } = await createClient().rpc("request_recon_counts", { p_line_id: l.id, p_by_name: person });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: `${(data as { count_tasks: number }).count_tasks} tugas hitung dibuat` });
    if (!error) router.refresh();
  }
  const sign = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

  return (
    <tr className={cn((du !== 0 || db !== 0) && l.status === "OPEN" && "bg-warn/10")}>
      <Td className="font-semibold">{l.sku}<div className="text-xs font-normal">{l.description}</div>
        {!l.item_id && <div className="text-xs text-bad">tidak ada di master item</div>}
        {uomDiffers && <div className="text-xs text-bad">satuan SAP {l.sap_uom} ≠ WMS {l.wms_uom}</div>}</Td>
      <Td className="text-right tabular">{fmtNum(Number(l.sap_unrestricted))}</Td>
      <Td className="text-right tabular">{fmtNum(Number(l.wms_unrestricted))}</Td>
      <Td className="text-right text-xs tabular">{Number(l.pending_gi) || Number(l.pending_gr) ? `${fmtNum(Number(l.pending_gi))} / ${fmtNum(Number(l.pending_gr))}` : "–"}</Td>
      <Td className={cn("text-right font-semibold tabular", du !== 0 && "text-bad")}>{du === 0 ? "–" : sign(du)}</Td>
      <Td className="text-right tabular">{fmtNum(Number(l.sap_blocked))}</Td>
      <Td className="text-right tabular">{fmtNum(Number(l.wms_blocked))}</Td>
      <Td className={cn("text-right font-semibold tabular", db !== 0 && "text-bad")}>{db === 0 ? "–" : sign(db)}</Td>
      <Td className="min-w-80">
        {open ? (
          <div className="space-y-1">
            <div className="flex gap-1">
              <Select aria-label={`Status ${l.sku}`} className="h-8 w-40" value={status} onChange={(e) => setStatus(e.target.value as ReconLine["status"])}>
                {Object.entries(RECON_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Input aria-label={`Keterangan ${l.sku}`} className="h-8" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="mis. lebih 1 = indikasi kurang kirim" />
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={save} disabled={person.trim().length < 2}>Simpan</Button>
              {l.item_id && (du !== 0 || db !== 0) && <Button size="sm" variant="ghost" onClick={recount} disabled={person.trim().length < 2}>Minta hitung ulang</Button>}
            </div>
            {msg && <p className={cn("text-xs", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</p>}
          </div>
        ) : <span className="text-xs">{RECON_STATUS[l.status]}{l.remark && ` · ${l.remark}`}</span>}
      </Td>
    </tr>
  );
}
