"use client";
import { Fragment, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import type { FefoLine } from "../page";

type StayLine = { bin: string; batch: string; expiry: string | null; qty: number; received: string | null };
type Stay = {
  sku: string; description: string; uom: string | null;
  qty: number; oldest: string | null; bins: string[]; batches: string[];
  datelessQty: number; lines: StayLine[];
};

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const AGE_BUCKETS: { label: string; min: number; max: number; color: string }[] = [
  { label: "0-30 hari", min: Number.NEGATIVE_INFINITY, max: 30, color: "bg-ok" },
  { label: "31-60 hari", min: 31, max: 60, color: "bg-ckb-light" },
  { label: "61-90 hari", min: 61, max: 90, color: "bg-plate" },
  { label: "91-180 hari", min: 91, max: 180, color: "bg-warn" },
  { label: "180+ hari", min: 181, max: Number.POSITIVE_INFINITY, color: "bg-bad" },
];
/** "3 thn 4 bln 10 hr" like the manual near-expiry summary. */
function ageText(fromIso: string, toIso: string): string {
  const d = Math.max(daysBetween(fromIso, toIso), 0);
  const y = Math.floor(d / 365), m = Math.floor((d % 365) / 30), r = d - y * 365 - m * 30;
  return [y && `${y} thn`, m && `${m} bln`, `${r} hr`].filter(Boolean).join(" ");
}

export function StayTab({ lines }: { lines: FefoLine[] }) {
  const t = today();
  const [bucketFilter, setBucketFilter] = useState<string | null>(null);
  const [skuFilter, setSkuFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const tableRef = useRef<HTMLDivElement>(null);

  const stays = useMemo(() => {
    const m = new Map<string, Stay>();
    for (const l of lines) {
      const g: Stay = m.get(l.sku) ?? { sku: l.sku, description: l.description, uom: l.uom, qty: 0, oldest: null, bins: [], batches: [], datelessQty: 0, lines: [] };
      g.qty += Number(l.quantity);
      g.lines.push({ bin: l.bin_code, batch: l.batch_lot, expiry: l.expiry_date, qty: Number(l.quantity), received: l.received_date });
      if (!g.bins.includes(l.bin_code)) g.bins.push(l.bin_code);
      if (l.batch_lot && !g.batches.includes(l.batch_lot)) g.batches.push(l.batch_lot);
      // A null received_date means the receipt cell never parsed: legacy stock with no known GR date.
      if (l.received_date) {
        if (!g.oldest || l.received_date < g.oldest) g.oldest = l.received_date;
      } else {
        g.datelessQty += Number(l.quantity);
      }
      m.set(l.sku, g);
    }
    return [...m.values()];
  }, [lines]);

  // Oldest receipt first. SKUs with no dated row at all never enter this ranking.
  const ranked = useMemo(() => stays.filter((s): s is Stay & { oldest: string } => s.oldest !== null)
    .sort((a, b) => a.oldest.localeCompare(b.oldest) || a.sku.localeCompare(b.sku)), [stays]);
  const dateless = useMemo(() => stays.filter((s) => s.oldest === null)
    .sort((a, b) => a.sku.localeCompare(b.sku)), [stays]);

  const longest = ranked[0] ?? null;
  const datelessQty = dateless.reduce((s, g) => s + g.qty, 0);
  const totalQty = stays.reduce((s, g) => s + g.qty, 0);

  const oldest15 = ranked.slice(0, 15);
  const maxAgeDays = oldest15.reduce((m, g) => Math.max(m, daysBetween(g.oldest, t)), 0);
  const rankedQty = ranked.reduce((s, g) => s + g.qty, 0);
  const buckets = AGE_BUCKETS.map((b) => {
    const rows = ranked.filter((g) => { const age = daysBetween(g.oldest, t); return age >= b.min && age <= b.max; });
    const qty = rows.reduce((s, g) => s + g.qty, 0);
    return { ...b, skus: rows.length, qty, share: rankedQty > 0 ? (qty / rankedQty) * 100 : 0 };
  });

  const activeBucket = bucketFilter === null ? null : AGE_BUCKETS.find((b) => b.label === bucketFilter) ?? null;
  const filtered = ranked.filter((g) => {
    if (skuFilter !== null && g.sku !== skuFilter) return false;
    if (activeBucket) {
      const age = daysBetween(g.oldest, t);
      if (age < activeBucket.min || age > activeBucket.max) return false;
    }
    return true;
  });
  const filterActive = bucketFilter !== null || skuFilter !== null;

  function clearFilters() {
    setBucketFilter(null);
    setSkuFilter(null);
  }

  function pickSku(sku: string) {
    setBucketFilter(null);
    setSkuFilter((prev) => (prev === sku ? null : sku));
    setOpen((prev) => new Set(prev).add(sku));
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pickBucket(label: string) {
    setSkuFilter(null);
    setBucketFilter((prev) => (prev === label ? null : label));
  }

  function toggleOpen(sku: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  }

  function exportStay() {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(ranked.map((g) => ({
      SKU: g.sku, Deskripsi: g.description, Qty: g.qty, "Terima tertua": g.oldest ? fmtDate(g.oldest) : "",
      "Umur hari": g.oldest ? daysBetween(g.oldest, t) : "", Bin: g.bins.length, Batch: g.batches.length,
      "Tanpa tgl terima": g.datelessQty,
    }))), "Lama di gudang");
    if (dateless.length > 0) {
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(dateless.map((g) => ({
        SKU: g.sku, Deskripsi: g.description, Qty: g.qty, Bin: g.bins.length,
      }))), "Tanpa tanggal terima");
    }
    XLSX.writeFile(book, `lama_di_gudang_${t}.xlsx`);
  }

  const tiles: [string, string, string, boolean?][] = [
    ["Terlama di gudang", longest?.sku ?? "–",
      longest ? `${fmtDate(longest.oldest)} · ${ageText(longest.oldest, t)} lalu` : "Tidak ada tanggal terima"],
    ["Tanpa tanggal terima", fmtNum(dateless.length),
      `${fmtNum(datelessQty)} qty · stok legacy, tidak ikut peringkat`, dateless.length > 0],
    ["SKU tercakup", fmtNum(stays.length), `${fmtNum(totalQty)} qty · ${fmtNum(ranked.length)} peringkat · ${fmtNum(dateless.length)} tanpa tanggal`],
    ["Baris stok", fmtNum(lines.length), `${fmtNum(new Set(lines.map((l) => l.bin_code)).size)} bin terbaca`],
  ];

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, note, bad]) => (
          <div key={label} className={cn("rounded-lg bg-white p-3", bad && "border-l-4 border-warn")}>
            <div className="text-xs text-steel-500">{label}</div>
            <div className="font-cond text-3xl font-semibold tabular">{value}</div>
            <div className="text-xs text-steel-500">{note}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Grafik umur</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {ranked.length === 0 ? (
            <p className="text-sm text-steel-500">Belum ada data umur.</p>
          ) : (<>
            {maxAgeDays <= 0 ? (
              <p className="text-sm text-steel-500">Belum ada data umur.</p>
            ) : (
              <section aria-labelledby="umur-top15">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="umur-top15" className="font-cond text-sm font-semibold">15 SKU tertua · umur di gudang</h3>
                <span className="text-xs text-steel-500">panjang batang sebanding umur, terpanjang {fmtNum(maxAgeDays)} hari</span>
              </div>
              <ol className="space-y-1.5">
                {oldest15.map((g) => {
                  const age = daysBetween(g.oldest, t);
                  const share = Math.min(100, Math.max(0, (age / maxAgeDays) * 100));
                  const desc = `${g.sku}, umur ${fmtNum(age)} hari (${ageText(g.oldest, t)}), qty ${fmtNum(g.qty)} ${g.uom ?? ""}`.trim();
                  const active = skuFilter === g.sku;
                  return (
                    <li key={g.sku}>
                      <button type="button" onClick={() => pickSku(g.sku)} aria-pressed={active}
                        className={cn("flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left sm:gap-3",
                          active && "bg-ckb-tint ring-2 ring-ckb")}>
                        <span title={g.sku} className={cn("w-20 shrink-0 truncate font-cond text-sm tabular sm:w-24", active && "font-semibold")}>{g.sku}</span>
                        <span className="block h-4 min-w-0 flex-1 rounded bg-steel-100" role="img" aria-label={desc} title={desc}>
                          <span className="block h-4 rounded bg-ckb" style={{ width: `${share}%` }} />
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-xs tabular text-steel-500">{ageText(g.oldest, t)} · {fmtNum(g.qty)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          <section aria-labelledby="umur-sebaran">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="umur-sebaran" className="font-cond text-sm font-semibold">Sebaran umur · {fmtNum(ranked.length)} SKU</h3>
              <span className="text-xs text-steel-500">{AGE_BUCKETS.length} kelompok umur, lebar batang sebanding qty</span>
            </div>
            {rankedQty <= 0 ? (
              <p className="text-sm text-steel-500">Belum ada data umur.</p>
            ) : (
              <>
                <div className="flex h-6 overflow-hidden rounded bg-steel-100">
                  {buckets.filter((b) => b.qty > 0).map((b) => {
                    const active = bucketFilter === b.label;
                    return (
                      <button key={b.label} type="button" onClick={() => pickBucket(b.label)} aria-pressed={active}
                        title={`${b.label} · ${fmtNum(b.skus)} SKU · ${fmtNum(b.qty)} qty`}
                        aria-label={`${b.label}: ${fmtNum(b.skus)} SKU, ${fmtNum(b.qty)} qty`}
                        className={cn("h-6 cursor-pointer", b.color, active && "ring-2 ring-inset ring-steel")}
                        style={{ width: `${b.share}%` }} />
                    );
                  })}
                </div>
                <ul className="mt-3 space-y-2">
                  {buckets.map((b) => {
                    const desc = `${b.label}: ${b.skus} SKU, ${fmtNum(b.qty)} qty dari ${fmtNum(rankedQty)} qty`;
                    const active = bucketFilter === b.label;
                    return (
                      <li key={b.label}>
                        <button type="button" onClick={() => pickBucket(b.label)} aria-pressed={active}
                          className={cn("w-full cursor-pointer rounded-md p-1 text-left", active && "bg-ckb-tint ring-2 ring-ckb")}>
                          <span className="flex items-center justify-between gap-2 text-xs">
                            <span className={cn("flex min-w-0 items-center gap-1.5", active ? "font-bold" : "font-semibold")}>
                              <span className={cn("h-3 w-3 shrink-0 rounded-sm", b.color)} aria-hidden="true" />
                              <span className="truncate">{b.label}</span>
                            </span>
                            <span className="shrink-0 whitespace-nowrap tabular text-steel-500">{fmtNum(b.skus)} SKU · {fmtNum(b.qty)} qty</span>
                          </span>
                          <span className="mt-1 block h-3 min-w-0 rounded bg-steel-100" role="img" aria-label={desc}>
                            <span className={cn("block h-3 rounded", b.color)} style={{ width: `${b.share}%` }} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
          </>)}
        </CardContent>
      </Card>

      <div ref={tableRef}>
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Lama di gudang per SKU · {fmtNum(filtered.length)} SKU</CardTitle>
              {filterActive && (
                <button type="button" onClick={clearFilters}
                  aria-label={bucketFilter ? `Hapus filter ${bucketFilter}` : `Hapus filter SKU ${skuFilter}`}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-ckb px-3 py-1 text-xs font-semibold text-white hover:bg-ckb-dark">
                  {bucketFilter ? `Filter: ${bucketFilter}` : `Filter: SKU ${skuFilter}`}<span aria-hidden="true">×</span>
                </button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={exportStay} disabled={ranked.length === 0 && dateless.length === 0}><Download className="h-4 w-4" />Excel</Button>
          </CardHeader>
          <CardContent>
            {ranked.length === 0 ? <p className="text-sm text-steel-500">Tidak ada stok dengan tanggal terima.</p> : filtered.length === 0 ? (
              <div className="rounded-md bg-paper p-4 text-center">
                <p className="text-sm text-steel-500">Tidak ada SKU yang cocok dengan filter {bucketFilter ? `"${bucketFilter}"` : `SKU ${skuFilter}`}.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>Hapus filter</Button>
              </div>
            ) : (
              <Table>
                <thead><tr>
                  <Th>SKU</Th><Th>Deskripsi</Th><Th className="text-right">Qty</Th><Th>Terima tertua</Th><Th>Umur</Th>
                  <Th className="text-right">Bin</Th><Th className="text-right">Batch</Th><Th className="text-right">Tanpa tgl</Th>
                </tr></thead>
                <tbody>{filtered.map((g) => {
                  const detail = [...g.lines].sort((a, b) => a.bin.localeCompare(b.bin));
                  return (
                    <Fragment key={g.sku}>
                      <tr className="cursor-pointer hover:bg-paper" onClick={() => toggleOpen(g.sku)}>
                        <Td className="font-semibold">{open.has(g.sku) ? <ChevronDown className="mr-1 inline h-4 w-4" /> : <ChevronRight className="mr-1 inline h-4 w-4" />}{g.sku}</Td>
                        <Td className="text-xs">{g.description}</Td>
                        <Td className="text-right tabular">{fmtNum(g.qty)} <span className="text-xs text-steel-500">{g.uom}</span></Td>
                        <Td className="whitespace-nowrap">{fmtDate(g.oldest)}</Td>
                        <Td className="whitespace-nowrap font-semibold">{ageText(g.oldest, t)}</Td>
                        <Td className="text-right tabular">{fmtNum(g.bins.length)}</Td>
                        <Td className="text-right tabular">{fmtNum(g.batches.length)}</Td>
                        <Td className="text-right tabular">{g.datelessQty ? fmtNum(g.datelessQty) : "–"}</Td>
                      </tr>
                      {open.has(g.sku) && (
                        <tr><td colSpan={8} className="bg-paper px-4 py-2">
                          <Table>
                            <thead><tr><Th>Bin</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Qty</Th><Th>Terima</Th></tr></thead>
                            <tbody>{detail.map((r, i) => (
                              <tr key={`${r.bin}-${r.batch}-${i}`}>
                                <Td><Link className="font-semibold underline" href={`/bin/${encodeURIComponent(r.bin)}`} onClick={(e) => e.stopPropagation()}>{r.bin}</Link></Td>
                                <Td>{r.batch || "–"}</Td>
                                <Td className="whitespace-nowrap text-xs">{fmtDate(r.expiry)}</Td>
                                <Td className="text-right tabular">{fmtNum(r.qty)}</Td>
                                <Td className="whitespace-nowrap text-xs">{fmtDate(r.received)}</Td>
                              </tr>
                            ))}</tbody>
                          </Table>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}</tbody>
              </Table>
            )}
            <p className="mt-2 text-xs text-steel-500">Diurutkan dari penerimaan tertua: umur = hari ini (WIB) dikurangi tanggal terima. Kolom &quot;Tanpa tgl&quot; adalah qty baris SKU itu yang tidak punya tanggal terima. Klik bar atau kelompok umur di Grafik umur untuk menyaring tabel; klik baris SKU untuk melihat binnya.</p>
          </CardContent>
        </Card>
      </div>

      {dateless.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Tanpa tanggal terima · {fmtNum(dateless.length)} SKU</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <thead><tr><Th>SKU</Th><Th className="text-right">Qty</Th><Th className="text-right">Bin</Th></tr></thead>
              <tbody>{dateless.map((g) => (
                <tr key={g.sku}>
                  <Td className="font-semibold">{g.sku}<div className="text-xs font-normal">{g.description}</div></Td>
                  <Td className="text-right tabular">{fmtNum(g.qty)} <span className="text-xs text-steel-500">{g.uom}</span></Td>
                  <Td className="text-right tabular">{fmtNum(g.bins.length)}</Td>
                </tr>
              ))}</tbody>
            </Table>
            <p className="mt-2 text-xs text-steel-500">SKU ini tidak punya satu pun baris bertanggal, jadi tidak masuk peringkat &quot;terlama&quot;. Tanggal terimanya tidak terbaca saat import (sel kosong / nilai tak terbaca) — perbaiki lewat mutasi adjustment bila perlu.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
