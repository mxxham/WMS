"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ISSUES, type Issue, type IssueKind } from "@/lib/data-quality";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/utils";
import { PersonNameField, usePersonName } from "@/components/app/person-name";
import { StatusIcon } from "@/components/ui/status-icon";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export function DataQualityClient({ issues, countBins }: { issues: Issue[]; countBins: string[] }) {
  const kinds = Object.keys(ISSUES) as IssueKind[];
  const counting = new Set(countBins);
  const [person, setPerson] = usePersonName();
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PersonNameField className="max-w-xs" value={person} onChange={setPerson} label="Nama petugas (dicatat di setiap koreksi)" />
      <p className="max-w-3xl text-sm text-steel-500">
        Diperiksa langsung dari stok di sistem. Koreksi batch/expired memposting dua penyesuaian (identitas lama → baru) ke riwayat mutasi; qty tidak berubah.
        Baris WMS dengan Remain Qty 0 tidak pernah diimpor sebagai stok, jadi tidak ada yang perlu dibersihkan di sini untuk baris itu. Rapikan di file WMS.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {kinds.map((k) => (
          <a key={k} href={`#${k}`} className="rounded-lg bg-white p-3 hover:ring-2 hover:ring-ckb">
            <div className="flex items-start justify-between gap-2"><div className="font-cond text-3xl font-semibold tabular">{fmtNum(issues.filter((i) => i.kind === k).length)}</div>{issues.some((i) => i.kind === k) && <StatusIcon tone="warn" />}</div>
            <div className="text-xs text-steel-500">{ISSUES[k].title}</div>
          </a>
        ))}
      </div>
      {kinds.map((k) => {
        const list = issues.filter((i) => i.kind === k);
        if (list.length === 0) return null;
        return (
          <Card key={k} id={k}>
            <CardHeader><CardTitle>{ISSUES[k].title} · {fmtNum(list.length)}</CardTitle><p className="text-xs text-steel-500">{ISSUES[k].why}</p></CardHeader>
            <CardContent>
              <BulkFix kind={k} list={list} counting={counting} person={person} />
              <Table>
                <thead><tr><Th>Bin</Th><Th>SKU</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Qty</Th><Th>Catatan</Th><Th>Perbaikan</Th></tr></thead>
                <tbody>{list.map((i) => (
                  <tr key={`${i.row.bin_code}|${i.row.sku}|${i.row.batch_lot}|${i.row.expiry_date}|${k}`}>
                    <Td className="font-semibold"><Link className="underline" href={`/bin/${i.row.bin_code}`}>{i.row.bin_code}</Link></Td>
                    <Td>{i.row.sku}<div className="text-xs text-steel-500">{i.row.description}</div></Td>
                    <Td>{i.row.batch_lot || "–"}</Td><Td>{fmtDate(i.row.expiry_date)}</Td>
                    <Td className="text-right tabular">{fmtNum(i.row.quantity)}</Td><Td className="text-xs">{i.detail}</Td>
                    <Td><Fix issue={i} counting={counting.has(i.row.bin_code)} person={person} /></Td>
                  </tr>
                ))}</tbody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
      {issues.length === 0 && <p className="text-sm">Tidak ada masalah data yang terdeteksi.</p>}
    </div>
  );
}

function Fix({ issue, counting, person }: { issue: Issue; counting: boolean; person: string }) {
  const router = useRouter();
  const fix = ISSUES[issue.kind].fix;
  const [value, setValue] = useState(issue.suggestedBatch ?? issue.suggestedExpiry ?? "");
  const [reason, setReason] = useState(() => {
    if (issue.suggestedBatch) return "Batch terbaca sebagai tanggal oleh Excel";
    if (issue.kind === "expiry_vs_batch") return `Expired disamakan dengan kode batch ${issue.row.batch_lot} (cek label)`;
    if (issue.kind === "expired" && issue.suggestedExpiry) return "Expired dikoreksi dari kode batch (produksi + umur simpan)";
    return "";
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true); setError(null);
    const { error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  const r = issue.row;

  // For "expired" kind: expiry correction (prefilled from the batch when it
  // decodes; manual entry otherwise) AND count task button.
  if (issue.kind === "expired") {
    const hasSuggestion = (issue.suggestedExpiry?.trim() ?? "") !== "";
    return (
      <div className="flex min-w-72 flex-wrap items-center gap-1">
        {/* Expiry correction */}
        <>
          <Input aria-label="Expired benar" type="date" className="h-8 w-32" title={hasSuggestion ? undefined : "Batch tidak terdekode — isi tanggal dari label"}
            value={value} onChange={(e) => setValue(e.target.value)} />
          <Input aria-label="Alasan" className="h-8 w-40" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan (wajib)" />
          <Button size="sm" disabled={busy || !value.trim() || !reason.trim() || person.trim().length < 2}
            title={person.trim().length < 2 ? "Isi nama petugas di atas" : undefined}
            onClick={() => run("correct_stock_identity", {
              p_bin_code: r.bin_code, p_sku: r.sku, p_batch: r.batch_lot, p_expiry: r.expiry_date,
              p_new_batch: null, p_new_expiry: value, p_reason: reason, p_by_name: person,
            })}
          >Koreksi expired</Button>
        </>
        {/* Count task button (always shown) */}
        <Button size="sm" variant="outline" disabled={busy || counting}
          onClick={() => run("create_count_task", { p_bin_code: r.bin_code, p_reason: `${ISSUES[issue.kind].title}: ${issue.detail}`, p_source: "DATA_QUALITY" })}>
          {counting ? "Sudah di daftar hitung" : "Buat tugas hitung"}
        </Button>
        {error && <p role="alert" className="w-full text-xs text-bad">{error}</p>}
      </div>
    );
  }

  if (fix === "count") {
    if (counting) return <Link className="text-xs underline" href="/counts">Sudah di daftar hitung</Link>;
    return (
      <div>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => run("create_count_task", { p_bin_code: issue.row.bin_code, p_reason: `${ISSUES[issue.kind].title}: ${issue.detail}`, p_source: "DATA_QUALITY" })}>Buat tugas hitung</Button>
        {error && <p role="alert" className="text-xs text-bad">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex min-w-72 flex-wrap items-center gap-1">
      <Input aria-label={fix === "batch" ? "Batch benar" : "Expired benar"} type={fix === "expiry" ? "date" : "text"} className="h-8 w-32"
        value={value} onChange={(e) => setValue(e.target.value)} placeholder={fix === "batch" ? "Batch di label" : ""} />
      <Input aria-label="Alasan" className="h-8 w-40" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan (wajib)" />
      <Button size="sm" disabled={busy || !value.trim() || !reason.trim() || person.trim().length < 2}
        title={person.trim().length < 2 ? "Isi nama petugas di atas" : undefined} onClick={() => run("correct_stock_identity", {
        p_bin_code: r.bin_code, p_sku: r.sku, p_batch: r.batch_lot, p_expiry: r.expiry_date,
        p_new_batch: fix === "batch" ? value.trim() : null, p_new_expiry: fix === "expiry" ? value : null, p_reason: reason, p_by_name: person,
      })}>Koreksi</Button>
      {error && <p role="alert" className="w-full text-xs text-bad">{error}</p>}
    </div>
  );
}

function BulkFix({ kind, list, counting, person }: { kind: IssueKind; list: Issue[]; counting: Set<string>; person: string }) {
  const router = useRouter();
  const fix = ISSUES[kind].fix;
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, running: false });
  const [results, setResults] = useState<{ ok: number; fail: number; errors: string[] } | null>(null);

  // For "expired" kind: two bulk modes
  const isExpiredKind = kind === "expired";

  // For "count" kinds: collect distinct bins not already counting
  const targetBins = fix === "count" && !isExpiredKind
    ? Array.from(new Set(list.map((i) => i.row.bin_code))).filter((b) => !counting.has(b))
    : [];

  // For "batch"/"expiry" kinds: rows with a suggestion
  // For batch_multi_expiry, exclude rows where recorded expiry already equals the suggestion (no change needed)
  const autoRows = fix !== "count" && !isExpiredKind
    ? list.filter((i) => {
        const hasBatch = (i.suggestedBatch?.trim() ?? "") !== "";
        const hasExpiry = (i.suggestedExpiry?.trim() ?? "") !== "";
        if (!hasBatch && !hasExpiry) return false;
        if (kind === "batch_multi_expiry" && i.suggestedExpiry && i.row.expiry_date === i.suggestedExpiry) return false;
        return true;
      })
    : [];

  // For "expired" kind: rows with suggestedExpiry (decodable batch)
  const expiredAutoRows = isExpiredKind
    ? list.filter((i) => (i.suggestedExpiry?.trim() ?? "") !== "" && i.row.expiry_date !== i.suggestedExpiry)
    : [];

  // For "expired" kind bulk-apply-same: all rows in the card
  const expiredAllRows = isExpiredKind ? list : [];

  const canRun = person.trim().length >= 2;

  if (fix === "count" && !isExpiredKind) {
    if (targetBins.length === 0) return null;
    return (
      <div className="mb-3">
        <Button
          size="sm" variant="outline"
          disabled={!canRun}
          title={!canRun ? "Isi nama petugas di atas" : undefined}
          onClick={() => { setProgress({ done: 0, total: targetBins.length, running: true }); setResults(null); setOpen(true); }}
        >
          Buat tugas hitung ({targetBins.length} bin)
        </Button>
        <BulkDialog
          open={open} onClose={setOpen}
          title={ISSUES[kind].title} count={targetBins.length}
          summary={`Bin yang akan dibuatkan tugas hitung: ${targetBins.slice(0, 10).join(", ")}${targetBins.length > 10 ? " …" : ""}`}
          detail="Setiap bin mendapat satu tugas hitung (upsert aman — bin yang sudah terbuka hanya tambah alasan)."
          warning="Koreksi tidak diposting untuk baris yang dipakai wave terbuka atau sudah berubah; daftar gagal ditampilkan setelahnya."
          progress={progress} results={results}
          canRun={canRun}
          onConfirm={async () => {
            const errors: string[] = [];
            let ok = 0;
            for (let idx = 0; idx < targetBins.length; idx++) {
              const bin = targetBins[idx];
              try {
                const { error } = await createClient().rpc("create_count_task", {
                  p_bin_code: bin,
                  p_reason: `${ISSUES[kind].title}: bulk`,
                  p_source: "DATA_QUALITY",
                });
                if (error) errors.push(`${bin}: ${error.message}`);
                else ok++;
              } catch (e) {
                errors.push(`${bin}: ${(e as Error).message}`);
              }
              setProgress((p) => ({ ...p, done: idx + 1 }));
            }
            setResults({ ok, fail: errors.length, errors });
            setProgress((p) => ({ ...p, running: false }));
            router.refresh();
          }}
        />
      </div>
    );
  }

  // batch / expiry kinds (non-expired)
  if (!isExpiredKind) {
    if (autoRows.length === 0) {
      return (
        <div className="mb-3">
          <span className="text-xs text-steel-500">Tidak ada perbaikan otomatis — cek label fisik per baris</span>
        </div>
      );
    }

    const hasManual = list.length > autoRows.length;
    const sourceText = fix === "batch"
      ? "batch dikembalikan ke nomor asli dari angka seri Excel"
      : fix === "expiry" && kind === "expiry_missing"
      ? "expired diisi dari kode batch (cek label)"
      : "expired disamakan dengan kode batch (produksi + umur simpan item)";

    return (
      <div className="mb-3">
        <Button
          size="sm"
          disabled={!canRun}
          title={!canRun ? "Isi nama petugas di atas" : undefined}
          onClick={() => { setProgress({ done: 0, total: autoRows.length, running: true }); setResults(null); setOpen(true); }}
        >
          Perbaiki semua otomatis ({autoRows.length} baris)
        </Button>
        {hasManual && <p className="text-xs text-steel-500 mt-1">{list.length - autoRows.length} baris butuh cek label manual</p>}
        <BulkDialog
          open={open} onClose={setOpen}
          title={ISSUES[kind].title} count={autoRows.length}
          summary={`Baris yang akan dikoreksi: ${autoRows.length} dari ${list.length}`}
          detail={sourceText}
          warning="Koreksi tidak diposting untuk baris yang dipakai wave terbuka atau sudah berubah; daftar gagal ditampilkan setelahnya."
          progress={progress} results={results}
          canRun={canRun}
          onConfirm={async () => {
            const errors: string[] = [];
            let ok = 0;
            for (let idx = 0; idx < autoRows.length; idx++) {
              const i = autoRows[idx];
              const r = i.row;
              const newBatch = i.suggestedBatch?.trim() ?? null;
              const newExpiry = i.suggestedExpiry?.trim() ?? null;
              let reason = "";
              if (kind === "batch_is_date") reason = "Batch terbaca sebagai tanggal oleh Excel";
              else if (kind === "expiry_vs_batch") reason = `Expired disamakan dengan kode batch ${r.batch_lot}`;
              else if (kind === "batch_multi_expiry") reason = "Satu batch, dua expired; disamakan dengan kode batch";
              else if (kind === "expiry_missing") reason = "Expired diisi dari kode batch (cek label)";
              try {
                const { error } = await createClient().rpc("correct_stock_identity", {
                  p_bin_code: r.bin_code, p_sku: r.sku, p_batch: r.batch_lot, p_expiry: r.expiry_date,
                  p_new_batch: newBatch, p_new_expiry: newExpiry, p_reason: reason, p_by_name: person,
                });
                if (error) errors.push(`${r.bin_code}/${r.sku}/${r.batch_lot}: ${error.message}`);
                else ok++;
              } catch (e) {
                errors.push(`${r.bin_code}/${r.sku}/${r.batch_lot}: ${(e as Error).message}`);
              }
              setProgress((p) => ({ ...p, done: idx + 1 }));
            }
            setResults({ ok, fail: errors.length, errors });
            setProgress((p) => ({ ...p, running: false }));
            router.refresh();
          }}
        />
      </div>
    );
  }

  // expired kind: two bulk options
  return (
    <div className="mb-3 space-y-2">
      {/* Option 1: Isi dari kode batch */}
      {expiredAutoRows.length > 0 && (
        <div>
          <Button
            size="sm"
            disabled={!canRun}
            title={!canRun ? "Isi nama petugas di atas" : undefined}
            onClick={() => { setProgress({ done: 0, total: expiredAutoRows.length, running: true }); setResults(null); setOpen(true); }}
          >
            Isi dari kode batch ({expiredAutoRows.length} baris)
          </Button>
          <BulkDialog
            open={open} onClose={setOpen}
            title={ISSUES[kind].title} count={expiredAutoRows.length}
            summary={`Baris yang akan dikoreksi expired-nya dari kode batch: ${expiredAutoRows.length} dari ${list.length}`}
            detail="Setiap baris menggunakan expired yang didekode dari batch-nya sendiri (produksi + umur simpan item). Baris dengan batch tidak terdekode atau yang sudah cocok dilewati."
            warning="Koreksi tidak diposting untuk baris yang dipakai wave terbuka atau sudah berubah; daftar gagal ditampilkan setelahnya."
            progress={progress} results={results}
            canRun={canRun}
            onConfirm={async () => {
              const errors: string[] = [];
              let ok = 0;
              let skipped = 0;
              for (let idx = 0; idx < expiredAutoRows.length; idx++) {
                const i = expiredAutoRows[idx];
                const r = i.row;
                const newExpiry = i.suggestedExpiry?.trim() ?? null;
                if (!newExpiry) { skipped++; setProgress((p) => ({ ...p, done: idx + 1 })); continue; }
                const reason = `Expired dikoreksi dari kode batch ${r.batch_lot} (produksi + umur simpan)`;
                try {
                  const { error } = await createClient().rpc("correct_stock_identity", {
                    p_bin_code: r.bin_code, p_sku: r.sku, p_batch: r.batch_lot, p_expiry: r.expiry_date,
                    p_new_batch: null, p_new_expiry: newExpiry, p_reason: reason, p_by_name: person,
                  });
                  if (error) errors.push(`${r.bin_code}/${r.sku}/${r.batch_lot}: ${error.message}`);
                  else ok++;
                } catch (e) {
                  errors.push(`${r.bin_code}/${r.sku}/${r.batch_lot}: ${(e as Error).message}`);
                }
                setProgress((p) => ({ ...p, done: idx + 1 }));
              }
              const resultErrors = [...errors];
              if (skipped > 0) resultErrors.unshift(`${skipped} baris dilewati (batch tidak terdekode atau sudah cocok)`);
              setResults({ ok, fail: errors.length, errors: resultErrors });
              setProgress((p) => ({ ...p, running: false }));
              router.refresh();
            }}
          />
        </div>
      )}

      {/* Option 2: Terapkan sama ke semua */}
      {expiredAllRows.length > 0 && (
        <BulkExpirySame kind={kind} list={expiredAllRows} counting={counting} person={person} />
      )}

      {(expiredAutoRows.length === 0 && expiredAllRows.length === 0) && (
        <div className="mb-3">
          <span className="text-xs text-steel-500">Tidak ada perbaikan otomatis — cek label fisik per baris</span>
        </div>
      )}
    </div>
  );
}

// Separate component for "Terapkan sama ke semua" bulk expiry
function BulkExpirySame({ kind, list, counting, person }: { kind: IssueKind; list: Issue[]; counting: Set<string>; person: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, running: false });
  const [results, setResults] = useState<{ ok: number; fail: number; errors: string[] } | null>(null);
  const [bulkExpiry, setBulkExpiry] = useState("");
  const [bulkReason, setBulkReason] = useState("");

  const canRun = person.trim().length >= 2 && bulkExpiry.trim() !== "" && bulkReason.trim() !== "";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          className="h-8 w-36"
          value={bulkExpiry}
          onChange={(e) => setBulkExpiry(e.target.value)}
          placeholder="Expired baru"
          aria-label="Expired baru untuk semua baris"
        />
        <Input
          className="h-8 w-48"
          value={bulkReason}
          onChange={(e) => setBulkReason(e.target.value)}
          placeholder="Alasan (wajib)"
          aria-label="Alasan koreksi massal"
        />
        <Button
          size="sm"
          disabled={!canRun}
          title={!canRun ? "Isi nama petugas, expired, dan alasan di atas" : undefined}
          onClick={() => { setProgress({ done: 0, total: list.length, running: true }); setResults(null); setOpen(true); }}
        >
          Terapkan sama ke semua ({list.length} baris)
        </Button>
      </div>
      <BulkDialog
        open={open} onClose={setOpen}
        title={ISSUES[kind].title} count={list.length}
        summary={`Semua ${list.length} baris akan diberi expired ${bulkExpiry || "(belum diisi)"}`}
        detail={`Expired baru: ${bulkExpiry || "(belum diisi)"} — Alasan: ${bulkReason || "(belum diisi)"}`}
        warning="Koreksi tidak diposting untuk baris yang dipakai wave terbuka atau sudah berubah; daftar gagal ditampilkan setelahnya."
        progress={progress} results={results}
        canRun={canRun}
        onConfirm={async () => {
          const errors: string[] = [];
          let ok = 0;
          for (let idx = 0; idx < list.length; idx++) {
            const i = list[idx];
            const r = i.row;
            // Skip if already has this expiry (no change needed)
            if (r.expiry_date === bulkExpiry) {
              setProgress((p) => ({ ...p, done: idx + 1 }));
              continue;
            }
            const reason = bulkReason;
            try {
              const { error } = await createClient().rpc("correct_stock_identity", {
                p_bin_code: r.bin_code, p_sku: r.sku, p_batch: r.batch_lot, p_expiry: r.expiry_date,
                p_new_batch: null, p_new_expiry: bulkExpiry, p_reason: reason, p_by_name: person,
              });
              if (error) errors.push(`${r.bin_code}/${r.sku}/${r.batch_lot}: ${error.message}`);
              else ok++;
            } catch (e) {
              errors.push(`${r.bin_code}/${r.sku}/${r.batch_lot}: ${(e as Error).message}`);
            }
            setProgress((p) => ({ ...p, done: idx + 1 }));
          }
          setResults({ ok, fail: errors.length, errors });
          setProgress((p) => ({ ...p, running: false }));
          router.refresh();
        }}
      />
    </div>
  );
}

function BulkDialog({
  open, onClose,
  title, count, summary, detail, warning,
  progress, results,
  onConfirm,
  canRun,
}: {
  open: boolean; onClose: (v: boolean) => void;
  title: string; count: number;
  summary: string; detail: string; warning: string;
  progress: { done: number; total: number; running: boolean };
  results: { ok: number; fail: number; errors: string[] } | null;
  onConfirm: () => Promise<void>;
  canRun: boolean;
}) {
  if (!open) return null;
  const done = progress.done;
  const total = progress.total;
  const running = progress.running;
  const finished = results !== null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent title={`Perbaiki massal: ${title}`} description={`${count} item akan diproses.`} className="max-w-md sm:w-[36rem]">
        <div className="space-y-3 text-sm">
          <div><strong>Ringkasan:</strong> <span className="text-steel-700">{summary}</span></div>
          <div><strong>Sumber nilai:</strong> <span className="text-steel-700">{detail}</span></div>
          <div className="text-bad text-xs"><strong>Peringatan:</strong> {warning}</div>
        </div>

        {running && (
          <div className="mt-4 text-center text-lg font-cond tabular">
            Memproses… {done}/{total}
          </div>
        )}

        {finished && (
          <div className="mt-4 space-y-2">
            <div className="text-center text-lg font-cond">
              Selesai: <span className="text-good">{results.ok} berhasil</span>{results.fail > 0 ? `, <span className="text-bad">{results.fail} gagal</span>` : ""}
            </div>
            {results.fail > 0 && (
              <div className="max-h-40 overflow-auto text-xs text-bad border-t pt-2">
                {results.errors.slice(0, 8).map((e, idx) => <div key={idx} className="font-mono">{e}</div>)}
                {results.errors.length > 8 && <div>… dan {results.errors.length - 8} lagi</div>}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {running ? (
            <Button disabled>Diproses…</Button>
          ) : finished ? (
            <Button onClick={() => onClose(false)}>Tutup</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onClose(false)}>Batal</Button>
              <Button onClick={onConfirm} disabled={!canRun || count === 0}>Perbaiki {count}</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}