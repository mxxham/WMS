import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { loadLedgerDay } from "@/lib/ledger/load";
import { addDays, jakartaDay } from "@/lib/ledger/dates";
import type { Totals } from "@/lib/ledger/compare";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { UploadSap } from "../upload-sap";
import { DayView } from "./day-view";

export const dynamic = "force-dynamic";

/** One day of Buku stok: the summary (the workbook's SUMMARY sheet), warnings, and the BOOK TO BOOK table. */
export default async function LedgerDayPage({ params }: { params: Promise<{ date: string }> }) {
  await requirePage("/ledger");
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > jakartaDay()) notFound();
  const d = await loadLedgerDay(await createClient(), date);
  const s = d.summary;
  const identity = d.lines.filter((l) => !l.wms_identity_ok).map((l) => l.sku);

  return (
    <main>
      <PageHeader title={`Buku stok · ${fmtDate(date)}`} live={["ledger_days", "ledger_notes"]}>
        <UploadSap />
      </PageHeader>
      <div className="space-y-4 p-4 lg:p-8">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href={`/ledger?month=${date.slice(0, 7)}`} className="inline-flex items-center gap-1 underline"><ArrowLeft className="h-4 w-4" />Semua hari</Link>
          <Link href={`/ledger/${addDays(date, -1)}`} className="underline">‹ {fmtDate(addDays(date, -1))}</Link>
          {addDays(date, 1) <= jakartaDay() && <Link href={`/ledger/${addDays(date, 1)}`} className="underline">{fmtDate(addDays(date, 1))} ›</Link>}
        </div>

        {!d.day ? (
          <p className="rounded-lg bg-white p-4 text-sm">
            Belum ada file SAP untuk {fmtDate(date)}. Upload file SAP yang MB51-nya berisi posting tanggal ini
            (biasanya file bernama tanggal {fmtDate(addDays(date, 1))}).
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-white p-3">
                <div className={cn("font-cond text-2xl font-semibold tabular", s.qtyAccuracy === 100 ? "text-ok" : "text-bad")}>{pct(s.qtyAccuracy)}</div>
                <div className="text-xs text-steel-500">Akurasi qty stok akhir</div>
                <div className="mt-1 text-xs tabular">Unrest {pct(s.qtyAccuracyUnrest)} · Blok {pct(s.qtyAccuracyBlock)}</div>
              </div>
              <div className="rounded-lg bg-white p-3">
                <div className={cn("font-cond text-2xl font-semibold tabular", s.accuracy === 100 ? "text-ok" : "text-bad")}>{pct(s.accuracy)}</div>
                <div className="text-xs text-steel-500">Akurasi SKU</div>
                <div className="mt-1 text-xs tabular">{fmtNum(s.differing)} dari {fmtNum(s.skus)} SKU selisih</div>
              </div>
              <Stat label="Total selisih" value={`${fmtNum(s.absDiff)} · ${fmtNum(s.absDiffLitres, 1)} L`} tone={s.absDiff ? "bad" : "ok"} />
              <Stat label="Status" value={d.waiting ? "Menunggu putaway" : "Selesai"} tone={d.waiting ? "warn" : "ok"} />
            </div>

            <Card><CardContent className="overflow-x-auto">
              <table className="w-full text-sm tabular">
                <thead><tr className="text-left text-xs text-steel-500">
                  <th className="py-1 pr-3" />
                  <th className="py-1 pr-3 text-right">Stok awal unrest</th><th className="py-1 pr-3 text-right">Stok awal block</th>
                  <th className="py-1 pr-3 text-right">Inbound</th><th className="py-1 pr-3 text-right">Outbound</th>
                  <th className="py-1 pr-3 text-right">Stok akhir unrest</th><th className="py-1 pr-3 text-right">Stok akhir block</th>
                </tr></thead>
                <tbody>
                  <SummaryRow label="SAP" t={s.sap} />
                  <SummaryRow label="WMS" t={s.wms} />
                </tbody>
              </table>
              <p className="mt-2 text-xs text-steel-500">Angka kecil di bawah: liter. File {d.day.file_name} · versi {d.day.version} ·
                diupload {d.day.by_name ?? "–"} {fmtDateTime(d.day.created_at)} · MB51 {fmtNum(d.day.mb51_count)} transaksi · INBD {fmtNum(d.day.inbd_total)}</p>
            </CardContent></Card>

            <div className="space-y-1 text-sm">
              {s.sap.akhir_block > 0 && s.wms.akhir_block === 0 && (
                <Warn>SAP mencatat {fmtNum(s.sap.akhir_block)} karton blok, WMS belum punya stok karantina. Barang blok yang fisiknya di
                  karantina belum dicatat di WMS, jadi selisih blok ini belum tentu barang hilang.</Warn>
              )}
              {d.waiting && <Warn>Putaway barang yang datang tanggal ini biasanya diinput besok: angka WMS bisa masih berubah.</Warn>}
              {s.inboundAssumed > 0 && <Warn>{fmtNum(s.inboundAssumed)} karton inbound WMS diasumsikan datang H-1 dari tanggal putaway (tanggal barang datang belum dicatat).</Warn>}
              {d.chain.length > 0 && <Warn>Awal SAP tidak sama dengan akhir kemarin: {fmtNum(d.chain.length)} SKU ({d.chain.slice(0, 8).join(", ")}{d.chain.length > 8 ? ", …" : ""}). Cek file kemarin dan hari ini.</Warn>}
              {d.day && !d.previousUploaded && <Warn>File SAP kemarin belum diupload: awal SAP tidak bisa dicek.</Warn>}
              {identity.length > 0 && <Warn>Buku WMS tidak seimbang untuk {fmtNum(identity.length)} SKU ({identity.slice(0, 8).join(", ")}). Lapor admin.</Warn>}
              {s.missingVolume.length > 0 && <Warn>{fmtNum(s.missingVolume.length)} SKU tanpa volume di Master item: liternya tidak dihitung ({s.missingVolume.slice(0, 8).join(", ")}{s.missingVolume.length > 8 ? ", …" : ""}).</Warn>}
            </div>

            <DayView date={date} lines={d.lines} summary={s} />
          </>
        )}
      </div>
    </main>
  );
}

const pct = (v: number | null) => (v === null ? "–" : `${fmtNum(v, 2)}%`);

function Stat({ label, value, tone }: { label: string; value: string; tone: "ok" | "bad" | "warn" }) {
  return (
    <div className="rounded-lg bg-white p-3">
      <div className={cn("font-cond text-2xl font-semibold tabular", { "text-ok": tone === "ok", "text-bad": tone === "bad", "text-warn": tone === "warn" })}>{value}</div>
      <div className="text-xs text-steel-500">{label}</div>
    </div>
  );
}

function SummaryRow({ label, t }: { label: string; t: Totals }) {
  const keys = ["awal_unrest", "awal_block", "inbound", "outbound", "akhir_unrest", "akhir_block"] as const;
  return (
    <tr className="border-t border-steel-100">
      <td className="py-1.5 pr-3 font-semibold">{label}</td>
      {keys.map((k) => (
        <td key={k} className="py-1.5 pr-3 text-right">{fmtNum(t[k])}<div className="text-xs text-steel-500">{fmtNum(t.litres[k], 1)} L</div></td>
      ))}
    </tr>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-warn/10 p-2 text-steel-700">{children}</p>;
}
