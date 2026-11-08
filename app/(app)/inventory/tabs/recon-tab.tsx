"use client";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { NewRecon } from "./recon/new-recon";
import { ReconDetail } from "./recon/recon-detail";
import type { PrevGap, ReconLine, ReconSummary, SapMove, ShipMatch } from "./recon/types";

export type { ReconLine, ReconSummary, SapMove, ShipMatch, PrevGap } from "./recon/types";

const n = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Shell's SAP stock (MB52) is the reference; our stock is compared with it
 * per SKU (Rekonsiliasi SAP, migrations 0021 + 0111). Inside one
 * reconciliation: the stock comparison, shipments vs SAP goods issue, and
 * the MB51 transactions that came with the file.
 */
export function ReconTab({ runs, selected, lines, moves, ships, shipError, prev, prevAsOf, view, inv }: {
  runs: ReconSummary[]; selected: string | null; lines: ReconLine[] | null; moves: SapMove[]; ships: ShipMatch[]; shipError: string | null;
  prev: PrevGap | null; prevAsOf: string | null; view?: string; inv?: string;
}) {
  const run = runs.find((r) => r.id === selected) ?? null;
  if (selected) {
    return (
      <div className="p-4 lg:p-8">
        {run && lines
          ? <ReconDetail run={run} lines={lines} moves={moves} ships={ships} shipError={shipError} prev={prev} prevAsOf={prevAsOf} initialView={view} initialInv={inv} />
          : <p className="text-sm text-bad">Rekonsiliasi tidak ditemukan. <Link className="underline" href="/inventory?tab=rekonsiliasi">Kembali</Link></p>}
      </div>
    );
  }
  const trend = [...runs].filter((r) => r.accuracy_pct !== null).reverse().slice(-12);
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <NewRecon />
      <Card>
        <CardHeader><CardTitle>Riwayat rekonsiliasi</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {trend.length > 1 && (
            <div>
              <div className="mb-1 text-xs text-steel-500">Akurasi SKU per rekonsiliasi (lama → baru)</div>
              <div className="flex h-20 items-end gap-1" role="img" aria-label="Tren akurasi SKU">
                {trend.map((r) => (
                  <Link key={r.id} href={`/inventory?tab=rekonsiliasi&recon=${r.id}`} title={`${fmtDate(r.as_of)}: ${n(r.accuracy_pct).toFixed(1)}%`}
                    className="flex h-full flex-1 flex-col justify-end">
                    <div className={cn("rounded-t", n(r.accuracy_pct) >= 98 ? "bg-ok" : n(r.accuracy_pct) >= 90 ? "bg-warn" : "bg-bad")} style={{ height: `${Math.max(4, n(r.accuracy_pct))}%` }} />
                    <div className="mt-0.5 truncate text-center text-[10px] text-steel-500">{fmtDate(r.as_of).slice(0, 6)}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {runs.length === 0 ? <p className="text-sm text-steel-500">Belum ada. Upload MB52 di atas.</p> : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead><tr><Th>Per tanggal</Th><Th>File</Th><Th className="text-right">SKU</Th><Th className="text-right">Cocok</Th><Th className="text-right">Akurasi</Th>
                    <Th className="text-right">WMS lebih</Th><Th className="text-right">WMS kurang</Th><Th className="text-right">Belum ditangani</Th><Th>Status</Th><Th /></tr></thead>
                  <tbody>{runs.map((r) => (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap">{fmtDate(r.as_of)}<div className="text-xs text-steel-500">WMS {r.wms_day ? `on hand ${fmtDate(r.wms_day)}` : r.wms_at ? fmtDateTime(r.wms_at) : "saat dibuat"}</div></Td><Td className="text-xs">{r.file_name}<div>{r.created_by_name} · {fmtDateTime(r.created_at)}</div></Td>
                      <Td className="text-right tabular">{fmtNum(r.skus)}</Td><Td className="text-right tabular">{fmtNum(r.skus_match)}</Td>
                      <Td className="text-right font-semibold tabular">{r.accuracy_pct === null ? "–" : `${n(r.accuracy_pct).toFixed(1)}%`}</Td>
                      <Td className="text-right tabular text-ckb-dark">{r.skus_wms_more === null ? "–" : <>{fmtNum(n(r.skus_wms_more))} <span className="text-xs">(+{fmtNum(n(r.qty_wms_more))})</span></>}</Td>
                      <Td className="text-right tabular text-bad">{r.skus_wms_less === null ? "–" : <>{fmtNum(n(r.skus_wms_less))} <span className="text-xs">(−{fmtNum(n(r.qty_wms_less))})</span></>}</Td>
                      <Td className={cn("text-right tabular", r.open_diffs > 0 && "font-semibold text-warn")}>{fmtNum(r.open_diffs)}</Td>
                      <Td className="text-xs">{r.status === "OPEN" ? "Terbuka" : `Ditutup ${fmtDate(r.closed_at)}`}</Td>
                      <Td><Link className="text-sm underline" href={`/inventory?tab=rekonsiliasi&recon=${r.id}`}>Buka</Link></Td>
                    </tr>
                  ))}</tbody>
                </Table>
              </div>
              <div className="space-y-2 md:hidden">
                {runs.map((r) => (
                  <Link key={r.id} href={`/inventory?tab=rekonsiliasi&recon=${r.id}`} className="block rounded-lg border border-steel-200 bg-white p-3 text-sm">
                    <div className="flex justify-between"><b>{fmtDate(r.as_of)}</b><span className="font-semibold tabular">{r.accuracy_pct === null ? "–" : `${n(r.accuracy_pct).toFixed(1)}%`}</span></div>
                    <div className="text-xs text-steel-500">{fmtNum(r.skus_match)} / {fmtNum(r.skus)} SKU cocok · lebih {fmtNum(n(r.skus_wms_more))} · kurang {fmtNum(n(r.skus_wms_less))} · {r.status === "OPEN" ? "Terbuka" : "Ditutup"}</div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
