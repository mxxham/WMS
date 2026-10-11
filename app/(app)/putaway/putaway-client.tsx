"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { readSheet } from "@/lib/read-sheet";
import { ACTIONS, KIND_LABELS, PUTAWAY_SHEET, fixLinesFor, fixPayload, fixProblem, fixSummary, parsePutawaySheet, type FixLine, type PutawayAction, type PutawayKind, type PutawayRow, type PutawayVerdict } from "@/lib/putaway-sheet";
import { masterFromWorkbook } from "@/lib/master-from-workbook";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import { PutawayFixPanel } from "./putaway-fix-panel";
import { PutawayHistory } from "./putaway-history";

type Step = "upload" | "review" | "done";
type Status = PutawayVerdict["status"] | "error";
type Result = { rows: PutawayVerdict[]; movements: number; count_tasks?: number; set_over_limit?: number[]; requests?: number };

const STATUS: Record<Status, { label: string; card: string; row: string }> = {
  new: { label: "Baru (akan diposting)", card: "border-ok", row: "" },
  same: { label: "Sudah tercatat (dilewati)", card: "border-steel-300", row: "text-steel-500" },
  conflict: { label: "Konflik (perlu keputusan)", card: "border-warn", row: "bg-warn/10" },
  error: { label: "Error baris (tidak dikirim)", card: "border-bad", row: "bg-bad/10" },
};

function actionLabel(kind: PutawayKind, a: PutawayAction) {
  if (a === "set") return "Samakan qty bin dengan sheet";
  if (a === "fix") return "Sheet benar: betulkan isi bin";
  if (kind === "moved_in") return "Palet baru: tetap posting";
  return kind === "bin_occupied" ? "Taruh di samping stok lain" : "Tambahkan qty sheet ke bin";
}

/** Upload the "data putaway" sheet -> preview verdicts per row -> resolve conflicts -> post. */
export function PutawayClient() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [sheet, setSheet] = useState("");
  const [rows, setRows] = useState<PutawayRow[]>([]);
  const [verdicts, setVerdicts] = useState<Map<number, PutawayVerdict>>(new Map());
  const [actions, setActions] = useState<Record<number, PutawayAction | undefined>>({});
  const [filter, setFilter] = useState<Status | "all">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // "Pindah ke bin lain": the bin typed per line (0042).
  const [moveTo, setMoveTo] = useState<Record<number, string>>({});
  // "Sheet benar" (0066): a decision per line the bin holds, the name on the posting, the confirmation step.
  const [fixes, setFixes] = useState<Record<number, FixLine[]>>({});
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [limit, setLimit] = useState(20);
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    createClient().rpc("inventory_policy").then(({ data }) => setLimit(Number((data as { adjust_approval_qty?: number } | null)?.adjust_approval_qty ?? 20)));
  }, []);

  async function call(apply: boolean, acts: typeof actions, sheetRows = rows): Promise<Result | null> {
    const body = sheetRows.filter((r) => !r.error).map(({ error: _, ...r }) => ({
      ...r, action: acts[r.line] ?? null, fix: acts[r.line] === "fix" ? fixPayload(fixes[r.line] ?? []) : undefined,
    }));
    const { data, error } = await createClient().rpc("putaway_import", { p_rows: body, p_source: fileName, p_apply: apply, p_by_name: name.trim() || null });
    if (error) { setError(error.message); return null; }
    return data as Result;
  }

  async function loadSheet(book: XLSX.WorkBook, name: string) {
    setError(null); setBusy(true); setSheet(name);
    try {
      const parsed = parsePutawaySheet(readSheet(book, name));
      setRows(parsed); setActions({}); setFixes({}); setConfirming(false);
      const res = await call(false, {}, parsed);
      if (!res) return;
      setVerdicts(new Map(res.rows.map((v) => [v.line, v])));
      setFilter(res.rows.some((v) => v.status === "conflict") ? "conflict" : "all");
      setStep("review");
    } catch (e) {
      setError((e as Error).message); setRows([]); setStep("review");
    } finally { setBusy(false); }
  }

  async function onFile(f: File) {
    setError(null); setFileName(f.name);
    let book: XLSX.WorkBook;
    try { book = XLSX.read(await f.arrayBuffer(), { cellDates: true }); }
    catch { return setError("File tidak bisa dibaca. Gunakan .xlsx atau .csv."); }
    setWb(book);
    await loadSheet(book, book.SheetNames.find((n) => PUTAWAY_SHEET.test(n)) ?? book.SheetNames[0]);
  }

  /** Send a line to another bin (the one the pallet really went to), or back to the sheet's bin; then check again. */
  async function redirect(line: number, bin: string | null) {
    const next = rows.map((r) => {
      if (r.line !== line) return r;
      if (bin === null) return { ...r, bin_code: r.sheet_bin ?? r.bin_code, sheet_bin: undefined };
      return { ...r, bin_code: bin.trim().toUpperCase(), sheet_bin: r.sheet_bin ?? r.bin_code };
    });
    const acts = { ...actions, [line]: undefined };
    setBusy(true); setError(null);
    const res = await call(false, acts, next);
    setBusy(false);
    if (!res) return;
    setRows(next); setActions(acts); setMoveTo((m) => ({ ...m, [line]: "" }));
    setFixes(({ [line]: _, ...rest }) => rest);
    setVerdicts(new Map(res.rows.map((v) => [v.line, v])));
  }

  async function post() {
    setBusy(true); setError(null);
    const res = await call(true, actions);
    setBusy(false);
    if (!res) return;
    setResult(res); setVerdicts(new Map(res.rows.map((v) => [v.line, v])));
    setStep("done"); setConfirming(false); setHistoryKey((k) => k + 1);
  }

  /** Before the confirmation: the database checks every "Sheet benar" again (reserved, held, bin changed). */
  async function review() {
    setBusy(true); setError(null);
    const res = await call(false, actions);
    setBusy(false);
    if (!res) return;
    setVerdicts(new Map(res.rows.map((v) => [v.line, v])));
    if (!res.rows.some((v) => v.fix_error && actions[v.line] === "fix")) setConfirming(true);
  }

  function choose(r: PutawayRow, a: PutawayAction | undefined) {
    setActions({ ...actions, [r.line]: a });
    if (a === "fix" && !fixes[r.line]) setFixes({ ...fixes, [r.line]: fixLinesFor(verdicts.get(r.line)?.current ?? []) });
    setConfirming(false);
  }

  const statusOf = (r: PutawayRow): Status => (r.error ? "error" : verdicts.get(r.line)?.status ?? "error");
  const counts = { new: 0, same: 0, conflict: 0, error: 0 } as Record<Status, number>;
  for (const r of rows) counts[statusOf(r)]++;
  const resolved = rows.filter((r) => statusOf(r) === "conflict" && actions[r.line]).length;
  const toPost = counts.new + resolved;
  const fixRows = rows.filter((r) => statusOf(r) === "conflict" && actions[r.line] === "fix");
  const fixOpen = fixRows.filter((r) => fixProblem(r.bin_code, fixes[r.line] ?? [])).length;
  // Unresolved qty/occupied conflicts become count tasks when posted (0010).
  const toCount = rows.filter((r) => { const v = verdicts.get(r.line); return v?.status === "conflict" && !actions[r.line] && (v.kind === "qty_differs" || v.kind === "bin_occupied" || v.kind === "moved_in"); }).length;
  const shown = filter === "all" ? rows : rows.filter((r) => statusOf(r) === filter);
  // SKUs the item master does not have yet, with their data from this file's master sheets (0040).
  const unknownSkus = [...new Set(rows.filter((r) => verdicts.get(r.line)?.kind === "sku_unknown").map((r) => r.sku))];
  const fromFile = wb && unknownSkus.length ? masterFromWorkbook(wb, unknownSkus) : [];
  const notInFile = unknownSkus.filter((u) => !fromFile.some((m) => m.sku === u));

  async function addMissing() {
    if (!wb) return;
    setBusy(true); setError(null);
    const { error } = await createClient().rpc("add_items", { p_items: fromFile });
    setBusy(false);
    if (error) return setError(error.message);
    await loadSheet(wb, sheet); // the rows are checked again: they become new putaways
  }

  function problem(r: PutawayRow) {
    if (r.error) return r.error;
    const v = verdicts.get(r.line);
    if (v?.kind === "moved_in" && v.moved_in) {
      const m = v.moved_in;
      return `${KIND_LABELS.moved_in}. Bin To Bin ${m.quantity} dari ${m.from_bin ?? "?"} (batch ${m.batch_lot || "–"}, ${new Date(m.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" })}).`;
    }
    return v?.kind ? KIND_LABELS[v.kind] : "";
  }

  function downloadReport() {
    const issues = rows.filter((r) => ["conflict", "error"].includes(statusOf(r))).map((r) => {
      const v = verdicts.get(r.line);
      return {
        "Baris Excel": r.line, Status: statusOf(r) === "error" ? "ERROR" : "KONFLIK", "Kode bin": r.bin_code, SKU: r.sku, Batch: r.batch_lot,
        Qty: r.quantity, Expired: r.expiry_date, Masalah: problem(r),
        "Isi bin di sistem": v?.current.map((c) => `${c.sku} / ${c.batch_lot || "-"} / ${c.expiry_date ?? "-"} / ${c.quantity}`).join("; ") ?? "",
        Keputusan: v?.kind && actions[r.line] ? actionLabel(v.kind, actions[r.line]!) : "Dilewati",
      };
    });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(issues), "Konflik putaway");
    XLSX.writeFile(book, `konflik-putaway-${fileName.replace(/\.\w+$/, "")}.xlsx`);
  }

  function reset() { setStep("upload"); setRows([]); setVerdicts(new Map()); setActions({}); setFixes({}); setConfirming(false); setResult(null); setError(null); }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      {error && <p role="alert" className="rounded-md bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      {step === "upload" && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-steel-300 bg-white p-10 text-center hover:bg-steel-100">
          <FileSpreadsheet className="h-10 w-10 text-steel-500" />
          <span className="font-cond text-xl font-semibold">{busy ? "Memeriksa sheet…" : "Pilih file WMS (.xlsx)"}</span>
          <span className="max-w-md text-sm text-steel-500">Sheet <b>data putaway</b> dipilih otomatis. Setiap baris dibandingkan dengan isi bin sekarang. Belum ada yang diposting sampai Anda menekan tombol Posting.</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      )}

      {step !== "upload" && wb && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56"><Label htmlFor="sheet">Sheet · {fileName}</Label>
            <Select id="sheet" value={sheet} disabled={busy || step === "done"} onChange={(e) => loadSheet(wb, e.target.value)}>
              {wb.SheetNames.map((s) => <option key={s}>{s}</option>)}
            </Select></div>
          <Button variant="outline" onClick={reset} disabled={busy}>Ganti file</Button>
        </div>
      )}

      {step !== "upload" && rows.length > 0 && (
        <>
          {step === "done" && result && (
            <Card><CardContent className="space-y-2">
              <p className="font-cond text-xl font-semibold">Putaway diposting</p>
              <p className="text-sm">{fmtNum(result.movements)} mutasi dibuat dan tercatat di <Link className="underline" href="/movements">Riwayat mutasi</Link>. Konflik tanpa keputusan dan baris error tidak diposting.</p>
              {!!result.count_tasks && <p className="text-sm"><b>{fmtNum(result.count_tasks)}</b> bin dengan konflik qty/isi masuk daftar <Link className="underline" href="/counts">Hitung stok</Link> untuk dihitung ulang.</p>}
              {!!result.requests && <p className="text-sm"><b>{fmtNum(result.requests)}</b> adjustment di atas batas {fmtNum(limit)} karton menunggu persetujuan orang kedua di <Link className="underline" href="/adjust">Adjust stok</Link>.</p>}
              {!!result.set_over_limit?.length && <p className="text-sm">Baris {result.set_over_limit.join(", ")}: &quot;samakan dengan sheet&quot; melebihi batas adjustment, jadi tidak diposting dan dihitung ulang dulu.</p>}
              {result.rows.some((v) => v.expiry_expected) && <p className="text-sm text-warn">{fmtNum(result.rows.filter((v) => v.expiry_expected).length)} baris punya expired yang tidak cocok dengan kode batch: cek label, lalu perbaiki di <Link className="underline" href="/data-quality#expiry_vs_batch">Kualitas data</Link>.</p>}
              <p className="text-sm text-steel-500">Stok berubah: rencana wave yang belum dikerjakan bisa dihitung ulang di halaman <Link className="underline" href="/waves">Wave</Link> (Hitung ulang wave tersisa).</p>
            </CardContent></Card>
          )}

          {step === "review" && unknownSkus.length > 0 && (
            <Card className="border-l-4 border-warn"><CardContent className="space-y-2 text-sm">
              <p className="font-semibold">{fmtNum(unknownSkus.length)} SKU belum ada di master item, jadi barisnya belum bisa diposting.</p>
              {fromFile.length > 0 && (
                <>
                  <p>Data dari sheet MASTER DATA / Master SKU file ini:</p>
                  <ul className="list-disc pl-5">
                    {fromFile.map((m) => (
                      <li key={m.sku}><b>{m.sku}</b> · {m.description} · {m.uom ?? "UOM ?"} · UPP {m.upp ?? "?"} · {m.volume_l ?? "?"} L</li>
                    ))}
                  </ul>
                  <Button onClick={addMissing} disabled={busy}>{busy ? "Menambahkan…" : `Tambahkan ${fmtNum(fromFile.length)} SKU ke master item`}</Button>
                  <p className="text-xs text-steel-500">Setelah ditambahkan, sheet diperiksa ulang dan baris SKU ini jadi putaway baru. Item yang sudah ada tidak diubah.</p>
                </>
              )}
              {notInFile.length > 0 && <p className="text-bad">Tidak ada di sheet master file ini: {notInFile.join(", ")}. Lengkapi MASTER DATA dulu.</p>}
            </CardContent></Card>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(Object.keys(STATUS) as Status[]).map((k) => (
              <button key={k} onClick={() => setFilter(filter === k ? "all" : k)} className={cn("rounded-lg border-l-4 bg-white p-3 text-left", STATUS[k].card, filter === k && "ring-2 ring-ckb")}>
                <div className="font-cond text-3xl font-semibold tabular">{fmtNum(counts[k])}</div><div className="text-xs text-steel-500">{STATUS[k].label}</div>
              </button>
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{filter === "all" ? "Semua baris" : STATUS[filter].label} · {fmtNum(shown.length)}</CardTitle>
              <Button variant="outline" size="sm" onClick={downloadReport} disabled={counts.conflict + counts.error === 0}><Download className="h-4 w-4" />Unduh laporan konflik (.xlsx)</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <thead><tr><Th>Baris</Th><Th>Bin</Th><Th>SKU</Th><Th>Batch</Th><Th className="text-right">Qty</Th><Th>Expired</Th><Th>Masalah</Th><Th>{step === "done" ? "Isi bin saat diperiksa" : "Isi bin sekarang"}</Th><Th>Keputusan</Th></tr></thead>
                <tbody>{shown.map((r) => {
                  const st = statusOf(r); const v = verdicts.get(r.line); const opts = v?.kind ? ACTIONS[v.kind] : [];
                  return (
                    <tr key={r.line} className={STATUS[st].row}>
                      <Td>{r.line}</Td><Td className="font-semibold">{r.bin_code}
                        {r.sheet_bin && <span className="block text-xs font-normal text-warn">di sheet {r.sheet_bin}</span>}</Td><Td>{r.sku}</Td><Td>{r.batch_lot || "–"}</Td>
                      <Td className="text-right tabular">{r.quantity ?? "–"}</Td>
                      <Td>{fmtDate(r.expiry_date)}{v?.expiry_expected && <div className="text-xs font-semibold text-warn" title="Expired menurut kode batch">batch → {fmtDate(v.expiry_expected)}</div>}</Td>
                      <Td className="text-xs">{problem(r) || (st === "same" ? "Isi bin sudah sama" : "")}</Td>
                      <Td className="text-xs">{v?.current.length ? v.current.map((c, i) => <div key={i}>{c.sku} · {c.batch_lot || "–"} · {fmtDate(c.expiry_date)} · <b>{fmtNum(c.quantity)}</b></div>) : st === "new" ? "Kosong" : ""}</Td>
                      <Td>
                        {st === "conflict" && step === "review" && (opts.length ? (
                          <Select aria-label={`Keputusan baris ${r.line}`} value={actions[r.line] ?? ""} onChange={(e) => choose(r, (e.target.value || undefined) as PutawayAction | undefined)}>
                            <option value="">Lewati</option>
                            {opts.map((a) => <option key={a} value={a}>{actionLabel(v!.kind!, a)}</option>)}
                          </Select>
                        ) : v?.kind === "sku_unknown" ? <span className="text-xs text-steel-500">Tambahkan SKU ke master (di atas)</span> : null)}
                        {st === "conflict" && step === "review" && actions[r.line] === "fix" && (
                          <PutawayFixPanel bin={r.bin_code} lines={fixes[r.line] ?? []} limit={limit} error={v?.fix_error}
                            onChange={(lines) => {
                              setFixes({ ...fixes, [r.line]: lines }); setConfirming(false);
                              // A changed decision is checked again on the next Posting.
                              if (v?.fix_error) setVerdicts(new Map(verdicts).set(r.line, { ...v, fix_error: null }));
                            }} />
                        )}
                        {step === "review" && v?.fix_error && actions[r.line] !== "fix" && <p className="mt-1 text-xs text-bad">{v.fix_error}</p>}
                        {step === "review" && (st === "conflict" || r.sheet_bin) && v?.kind !== "sku_unknown" && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Input aria-label={`Bin sebenarnya baris ${r.line}`} className="h-8 w-28" placeholder="bin lain" value={moveTo[r.line] ?? ""}
                              onChange={(e) => setMoveTo((m) => ({ ...m, [r.line]: e.target.value.toUpperCase() }))} />
                            <Button size="sm" variant="outline" disabled={busy || !/^[A-Z0-9_]{3,20}$/.test((moveTo[r.line] ?? "").trim())}
                              onClick={() => redirect(r.line, moveTo[r.line])}>Pindah ke bin ini</Button>
                            {r.sheet_bin && <Button size="sm" variant="ghost" className="underline" disabled={busy} onClick={() => redirect(r.line, null)}>Kembali ke {r.sheet_bin}</Button>}
                          </div>
                        )}
                        {step === "done" && (v?.status === "new" || v?.action
                          ? <span className="text-xs font-semibold text-ok">{v?.action === "fix" ? "Diposting, isi bin dibetulkan" : "Diposting"}</span>
                          : <span className="text-xs text-steel-500">Tidak diposting{v?.fix_error && <span className="block text-bad">{v.fix_error}</span>}</span>)}
                      </Td>
                    </tr>
                  );
                })}</tbody>
              </Table>
            </CardContent>
          </Card>

          {step === "review" && !confirming && (
            <Card><CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">{fmtNum(counts.new)} baris baru{resolved > 0 && ` + ${fmtNum(resolved)} konflik yang diputuskan`} akan diposting sebagai mutasi putaway. {counts.conflict - resolved > 0 && `${fmtNum(counts.conflict - resolved)} konflik dilewati; yang qty/isinya berbeda masuk daftar Hitung stok.`}
                {fixOpen > 0 && <span className="block text-bad">{fmtNum(fixOpen)} baris &quot;Sheet benar&quot; belum lengkap.</span>}</p>
              <Button onClick={() => void review()} disabled={busy || toPost + toCount === 0 || fixOpen > 0}><Upload className="h-4 w-4" />{busy ? "Memeriksa…" : toPost ? `Posting ${fmtNum(toPost)} baris…` : `Buat ${fmtNum(toCount)} tugas hitung…`}</Button>
            </CardContent></Card>
          )}

          {step === "review" && confirming && (
            <Card className="border-l-4 border-ckb"><CardContent className="space-y-3 text-sm">
              <p className="font-cond text-lg font-semibold">Konfirmasi posting</p>
              <p>{fmtNum(toPost)} baris diposting sebagai putaway{toCount > 0 && `, ${fmtNum(toCount)} konflik menjadi tugas Hitung stok`}.</p>
              {fixRows.length > 0 && (
                <div className="space-y-1">
                  <p className="font-semibold">Isi bin dibetulkan (sheet benar):</p>
                  <ul className="list-disc pl-5">{fixRows.map((r) => <li key={r.line}>Baris {r.line} · {fixSummary(r, fixes[r.line] ?? [], limit)}</li>)}</ul>
                </div>
              )}
              <div className="max-w-xs"><Label htmlFor="putaway-name">Nama Anda{fixRows.length > 0 ? " (wajib)" : ""}</Label>
                <Input id="putaway-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="nama yang memposting" /></div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={post} disabled={busy || (fixRows.length > 0 && name.trim().length < 2)}><Upload className="h-4 w-4" />{busy ? "Memposting…" : "Ya, posting"}</Button>
                <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Batal</Button>
              </div>
            </CardContent></Card>
          )}
        </>
      )}

      {step === "done" && <Button onClick={reset}>Upload sheet lain</Button>}

      {step !== "review" && <PutawayHistory key={historyKey} />}
    </div>
  );
}
