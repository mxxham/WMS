"use client";
import { useRef, useState, useCallback } from "react";
import { Upload, Printer, CheckCircle, AlertTriangle, X, FileText, RefreshCw, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusIcon } from "@/components/ui/status-icon";
import { PALLET_CARD } from "@/config/warehouse";

type Summary = {
  cards: number; shipments: number; itemCodes: number;
  shipmentsList: string[]; shipmentCounts: Record<string, number>;
  months: string[]; users: string[]; masterMissing: number;
  shipmentRows: Record<string, string>;
};

type CardPreviewData = {
  itemCode: number; actQty: number | null; actUom: string;
  batchNo: string | null; binLocation: string | null;
  expDate: string | null; grNo: string | null; putawayNo: string | null;
};

const PREVIEW_SAMPLE: CardPreviewData = {
  itemCode: 550074326, actQty: 48, actUom: "CAR",
  batchNo: "BATCH-20260615", binLocation: "CA01C01",
  expDate: "31/01/2027", grNo: "GR-20260610", putawayNo: "PUT-00123",
};

function FileDropZone({
  onFileSelect,
  disabled,
  file,
  busy,
}: {
  onFileSelect: (f: File) => void;
  disabled: boolean;
  file: File | null;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent, active: boolean) => {
    e.preventDefault(); e.stopPropagation();
    if (!disabled) setDragActive(active);
  }, [disabled]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith(".xlsx") || f.name.endsWith(".xls"))) onFileSelect(f);
  }, [disabled, onFileSelect]);

  const handleClick = useCallback(() => {
    if (!disabled && !busy) inputRef.current?.click();
  }, [disabled, busy]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFileSelect(f);
  }, [onFileSelect]);

  return (
    <div
      onDragOver={(e) => handleDrag(e, true)}
      onDragLeave={(e) => handleDrag(e, false)}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`
        relative rounded-xl border-2 border-dashed transition-all duration-200
        ${dragActive ? "border-ckb bg-ckb/5" : "border-steel-200 hover:border-steel-300"}
        ${disabled || busy ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
      role="button"
      tabIndex={disabled || busy ? -1 : 0}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !disabled && !busy) handleClick(); }}
      aria-label={disabled || busy ? "Sedang memproses, tidak bisa memilih berkas" : "Pilih berkas Form Checker"}
    >
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" disabled={disabled || busy} onChange={handleChange} />
      <div className="p-8 lg:p-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-ckb/10 text-ckb">
          <Upload className="h-8 w-8" aria-hidden />
        </div>
        <h3 className="font-cond text-xl font-semibold text-steel-900">
          {file ? "Berkas dipilih" : "Seret berkas Form Checker ke sini"}
        </h3>
        <p className="mt-1 text-sm text-steel-500">
          {file
            ? `${file.name} (${(file.size / 1024).toFixed(1)} KB) — klik untuk ganti`
            : "Atau klik untuk pilih .xlsx / .xls"}
        </p>
        <p className="mt-3 text-xs text-steel-400">
          Sheet <b>FORM CHECKER</b>: shipment → item → satu baris per palet (Act. Qty / UoM / Pallet ID)
        </p>
        {busy && (
          <div className="mt-4 flex items-center justify-center gap-2 text-ckb">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            <span className="font-medium">Menganalisis berkas…</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyzingSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="h-6 w-3/12 animate-pulse rounded bg-steel-100" aria-hidden />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-full animate-pulse rounded bg-steel-100" />
              <div className="h-10 w-full animate-pulse rounded bg-steel-100" />
            </div>
          ))}
        </div>
        <div className="h-4 w-1/2 animate-pulse rounded bg-steel-100" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-steel-100" />
        <div className="h-14 w-full animate-pulse rounded bg-steel-100 mt-2" />
      </CardContent>
    </Card>
  );
}

function ShipmentPrintList({ shipmentsList, counts, shipmentRows, onPrint, busy }: {
  shipmentsList: string[]; counts: Record<string, number>;
  shipmentRows: Record<string, string>;
  onPrint: (shipment: string) => void; busy: boolean;
}) {
  return (
    <div className="rounded-lg border border-steel-100 divide-y divide-steel-100 max-h-64 overflow-y-auto" role="list" aria-label="Daftar shipment">
      {shipmentsList.map((s) => (
        <div key={s} className="flex flex-col items-start gap-1 px-3 py-2" role="listitem">
          <div className="flex items-center gap-3 w-full">
            <span className="font-mono text-sm text-steel-900 flex-1 truncate">{s}</span>
            <span className="text-xs text-steel-500 shrink-0">{counts[s] ?? 0} kartu</span>
            <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => onPrint(s)} disabled={busy}>
              <Printer className="h-3.5 w-3.5" aria-hidden /> Cetak
            </Button>
          </div>
          {shipmentRows[s] && (
            <span className="font-mono text-[11px] text-steel-400 ml-2">Baris {shipmentRows[s]}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone = "ok" }: {
  label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone?: "ok" | "warn" | "ckb";
}) {
  const toneClass = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-ckb";
  return (
    <div className="flex flex-col items-center gap-1.5 p-4 rounded-xl bg-steel-50 border border-steel-100">
      <div className={`p-2 rounded-lg bg-white shadow-sm ${toneClass}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="font-cond text-2xl font-bold text-steel-900">{value}</div>
      <div className="text-xs text-steel-500 text-center">{label}</div>
    </div>
  );
}

function SummaryCard({
  summary,
  onPrint,
  onNewFile,
  busy,
  error,
  retryShipment,
}: {
  summary: Summary;
  onPrint: (shipment: string | null) => void;
  onNewFile: () => void;
  busy: boolean;
  error: string | null;
  retryShipment: string | null;
}) {
  const { cards, shipments, itemCodes, shipmentsList, shipmentCounts, months, users, masterMissing, shipmentRows } = summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b border-steel-100 px-4 py-3">
          <CardTitle className="flex items-center gap-2">
            <StatusIcon tone="ok" word="Siap cetak" className="h-5 w-5" />
            Ringkasan berkas
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onNewFile} disabled={busy}>
            <RefreshCw className="h-4 w-4" /> Ganti berkas
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 p-4 lg:p-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard label="Kartu palet" value={cards} icon={FileText} tone="ckb" />
            <StatCard label="Shipment" value={shipments} icon={FileText} tone="ok" />
            <StatCard label="Item unik" value={itemCodes} icon={FileText} tone="ok" />
          </div>

          <div className="space-y-3 pt-2 border-t border-steel-100">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-steel-700 mb-2">
                <span className="w-20">Bulan</span>
                <span className="font-mono text-ckb">{months.join(" · ") || "–"}</span>
              </div>
              <div className="flex items-center gap-2 text-sm font-medium text-steel-700 mb-2">
                <span className="w-20">Operator</span>
                <span className="font-mono text-ckb">{users.join(" · ") || "–"}</span>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-steel-700 mb-2">Shipment — cetak per shipment</div>
              <ShipmentPrintList shipmentsList={shipmentsList} counts={shipmentCounts} shipmentRows={shipmentRows} onPrint={onPrint} busy={busy} />
            </div>
          </div>

          {masterMissing > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn/5 p-4 flex items-start gap-3" role="alert">
              <AlertTriangle className="h-5 w-5 text-warn shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="font-medium text-warn">{masterMissing} item tidak terdaftar di master data</p>
                <p className="text-sm text-steel-600 mt-0.5">
                  Satuan (UoM) diambil dari berkas saja. Pastikan master item lengkap sebelum cetak ulang.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CardPreview sample={PREVIEW_SAMPLE} />

      {error && (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-bad shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1">
            <p className="font-medium text-bad">Gagal membuat PDF</p>
            <p className="text-sm text-steel-600 mt-0.5">{error}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onPrint(retryShipment)} disabled={busy}>
            <RefreshCw className="h-4 w-4" /> Coba lagi
          </Button>
        </div>
      )}

      <Button
        size="lg"
        className="w-full justify-center gap-3"
        onClick={() => onPrint(null)}
        disabled={busy}
        variant="accent"
      >
        {busy ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            Membuat PDF…
          </>
        ) : (
          <>
            <Printer className="h-5 w-5" aria-hidden />
            <span>Cetak semua {cards} kartu palet, satu kartu penuh per lembar A4 landscape</span>
          </>
        )}
      </Button>

      <PrintScaleWarning />
    </div>
  );
}

function CardPreview({ sample }: { sample: CardPreviewData }) {
  const { itemCode, actQty, actUom, batchNo, binLocation, expDate, grNo, putawayNo } = sample;
  const C = PALLET_CARD;
  // Every size inside the mock is a percentage of the card's width (cqw = 1% of
  // the container's inline size), so the preview keeps the printed card's
  // proportions — and stays inside the frame — at whatever width it is shown.
  // Sizes still come from PALLET_CARD; only the unit differs from the PDF's pt.
  const pagePt = C.pageWidthMm * 2.83465; // A4 landscape width in pt
  const cq = (pt: number) => `${((pt / pagePt) * 100).toFixed(2)}cqw`;
  const marginPct = `${((C.marginMm / C.pageWidthMm) * 100).toFixed(2)}%`;

  const qtyText = actQty === null ? "—" : String(actQty);
  const uomText = actUom || "—";
  const batchText = batchNo || "";
  const locationText = binLocation || "";
  const details: string[] = [];
  if (expDate) details.push(`Exp: ${expDate}`);
  if (grNo) details.push(`GR No: ${grNo}`);
  if (putawayNo) details.push(`Putaway: ${putawayNo}`);
  const detailText = details.join("    ·    ");

  return (
    <Card className="overflow-visible">
      <CardHeader className="flex flex-row items-center justify-between border-b border-steel-100 px-4 py-3">
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" aria-hidden />
          Pratinjau kartu palet (A4 landscape)
        </CardTitle>
        <span className="text-xs text-steel-400 font-mono">297 × 210 mm</span>
      </CardHeader>
      <CardContent className="p-4 lg:p-6">
        <div className="flex justify-center">
          <div
            className="relative border border-steel-200 bg-white shadow-xl"
            style={{ width: "min(100%, 330px)", aspectRatio: "297 / 210", containerType: "inline-size" }}
            role="img"
            aria-label="Pratinjau tampilan kartu palet A4 landscape"
          >
            <div
              className="absolute inset-[-2px] border border-dashed border-steel-300 pointer-events-none"
              aria-hidden
            />
            <div style={{ padding: marginPct }}>
              <div className="text-center text-steel-400" style={{ fontSize: cq(C.labelPt), marginTop: cq(9) }}>
                SKU
              </div>
              <div className="text-center font-bold text-steel-900" style={{ fontSize: cq(C.skuPt), lineHeight: 1.05, marginTop: cq(3) }}>
                {String(itemCode)}
              </div>
              <div className="border-t border-steel-200" style={{ marginTop: cq(9) }} />
              <div className="flex justify-center items-baseline gap-1" style={{ fontSize: cq(C.qtyPt), lineHeight: 1.05, marginTop: cq(6) }}>
                <span className="font-bold text-steel-900">{qtyText}</span>
                <span className="text-steel-400" style={{ fontSize: cq(C.uomPt) }}>{uomText}</span>
              </div>
              <div className="text-center text-steel-400" style={{ fontSize: cq(C.labelPt), marginTop: cq(9) }}>
                BATCH NO.
              </div>
              {batchText ? (
                <div className="text-center font-bold text-steel-900" style={{ fontSize: cq(C.batchPt), lineHeight: 1.05, marginTop: cq(3) }}>
                  {batchText}
                </div>
              ) : (
                <div className="border-t border-steel-900 mx-auto" style={{ width: "70%", marginTop: cq(C.batchPt * 0.7) }} />
              )}
              <div className="text-center text-steel-400" style={{ fontSize: cq(C.labelPt), marginTop: cq(9) }}>
                LOCATION
              </div>
              {locationText ? (
                <div className="text-center font-bold text-steel-900" style={{ fontSize: cq(C.locationPt), lineHeight: 1.05, marginTop: cq(3) }}>
                  {locationText}
                </div>
              ) : (
                <div className="border-t border-steel-900 mx-auto" style={{ width: "90%", marginTop: cq(C.locationPt * 0.7) }} />
              )}
              {detailText && (
                <div className="text-center text-steel-400" style={{ fontSize: cq(C.detailPt), lineHeight: 1.5, marginTop: cq(8) }}>
                  {detailText}
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-steel-500">
          Pratinjau ilustratif — kartu asli dicetak penuh A4 landscape, font besar terbaca dari lantai gudang
        </p>
      </CardContent>
    </Card>
  );
}

function PrintScaleWarning() {
  return (
    <div className="rounded-xl border-2 border-warn/30 bg-warn/5 p-4" role="note">
      <div className="flex items-center gap-2 font-semibold text-warn">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
        Cetak di skala 100% / Actual size
      </div>
      <p className="mt-1 text-sm text-steel-700">
        Pilih <b>&quot;Actual size&quot;</b> atau <b>&quot;100%&quot;</b> di dialog print, kertas <b>A4 landscape</b>.
        Jangan <b>&quot;Fit to page&quot;</b> / <b>&quot;Shrink oversized pages&quot;</b> — skala lain membuat huruf kecil dan susah dibaca dari bawah rak.
      </p>
    </div>
  );
}

function PrintedBanner({ job }: { job: { count: number; shipment: string | null } }) {
  return (
    <div className="rounded-xl border border-ok/30 bg-ok/5 p-4 flex items-start gap-3" role="status">
      <div className="p-2 rounded-lg bg-ok/10 text-ok shrink-0">
        <CheckCircle className="h-6 w-6" aria-hidden />
      </div>
      <div className="flex-1">
        <p className="font-semibold text-steel-900">{job.count} kartu palet dibuka di tab baru</p>
        <p className="text-sm text-steel-600 mt-0.5">
          {job.shipment
            ? <>Shipment {job.shipment} — pilih shipment lain dari daftar di bawah</>
            : <>Semua shipment tercetak — pilih satu shipment di daftar bawah kalau perlu</>}
        </p>
      </div>
    </div>
  );
}

export function PalletClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [printedJob, setPrintedJob] = useState<{ count: number; shipment: string | null } | null>(null);
  const [state, setState] = useState<"idle" | "analyzing" | "ready" | "printing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = state === "analyzing" || state === "printing";

  async function send(fd: FormData) {
    return fetch("/api/labels/pallet-cards", { method: "POST", body: fd });
  }

  // Print never leaves this page: after a print the view returns to the
  // summary (with a done banner), so the next shipment is one click away —
  // the file is not asked for again until the caller says "Ganti berkas".

  const readSummary = useCallback(async (f: File) => {
    setState("analyzing"); setError(null); setSummary(null); setPrintedJob(null);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("action", "summary");
    try {
      const res = await send(fd);
      if (!res.ok) {
        const err = (await res.json().catch(() => null))?.error ?? "Gagal membaca berkas.";
        throw new Error(err);
      }
      const data = (await res.json()) as Summary;
      setSummary(data);
      setState("ready");
    } catch (e) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setError((e as Error).message);
      setState("error");
    }
  }, []);

  const handleFileSelect = useCallback((f: File) => {
    if (!f.name.endsWith(".xlsx") && !f.name.endsWith(".xls")) {
      setError("Format tidak didukung. Pilih berkas .xlsx atau .xls");
      setState("error");
      return;
    }
    setFile(f);
    readSummary(f);
  }, [readSummary]);

  const handlePrint = useCallback(async (shipment: string | null) => {
    if (!file || !summary) return;
    const count = shipment ? summary.shipmentCounts[shipment] ?? 0 : summary.cards;
    setState("printing"); setError(null); setPrintedJob({ count, shipment });
    const fd = new FormData();
    fd.append("file", file);
    fd.append("action", "print");
    if (shipment) fd.append("shipment", shipment);
    try {
      const res = await send(fd);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Gagal membuat PDF.");
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
      setState("ready"); // back to the summary, ready for the next print
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }, [file, summary]);

  const handleNewFile = useCallback(() => {
    setFile(null); setSummary(null); setError(null); setPrintedJob(null); setState("idle");
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleRetry = useCallback(() => {
    if (file) readSummary(file);
    else setState("idle");
  }, [file, readSummary]);

  return (
    <div className="grid gap-6 p-4 lg:p-8 max-w-3xl mx-auto">
      <Card className={state === "ready" || state === "error" ? "border-steel-200" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-ckb" aria-hidden />
            Berkas Form Checker
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 lg:p-6">
          {state === "analyzing" ? (
            <AnalyzingSkeleton />
          ) : (
            <FileDropZone
              onFileSelect={handleFileSelect}
              disabled={busy}
              file={file}
              busy={busy}
            />
          )}
        </CardContent>
      </Card>

      {state === "ready" && printedJob && <PrintedBanner job={printedJob} />}

      {(state === "ready" || state === "error" || state === "printing") && summary && (
        <SummaryCard
          summary={summary}
          onPrint={handlePrint}
          onNewFile={handleNewFile}
          busy={busy}
          error={error}
          retryShipment={printedJob?.shipment ?? null}
        />
      )}

      {state === "idle" && (
        <div className="rounded-xl border border-steel-200 bg-steel-50 p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-steel-100 text-steel-400">
            <FileText className="h-6 w-6" aria-hidden />
          </div>
          <h3 className="font-cond text-lg font-semibold text-steel-900">Siap memulai</h3>
          <p className="mt-1 text-sm text-steel-500">
            Unggah berkas Form Checker untuk melihat ringkasan dan pratinjau kartu palet sebelum mencetak.
          </p>
        </div>
      )}

      {state === "error" && !summary && (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-bad shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1">
            <p className="font-medium text-bad">Gagal membaca berkas</p>
            <p className="text-sm text-steel-600 mt-0.5">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRetry}>
            <RefreshCw className="h-4 w-4" /> Coba lagi
          </Button>
        </div>
      )}
    </div>
  );
}