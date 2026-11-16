"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { RECON_STATUS } from "@/lib/inventory-control";
import { CAUSES, compareStats, gapBlocked, gapTotal, gapUnrestricted, hasGap, signed } from "@/lib/sap-compare";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { GONE } from "@/app/(app)/racks/floor-plan";
import type { ReconLine, ReconSummary } from "./types";

/** rack_occupancy() (0137): today's racks, Shell's side only. */
type Bay = { zone: string; rack: string; locations: number; occupied: number; gone: number; planned: number; blocked: number; ckb: number };
type Aisle = { zone: string; locations: number; occupied: number; blocked: number; gone: number; ckb: number };
type Occupancy = {
  at: string; locations: number; occupied: number; litres: number; cartons: number; skus_without_volume: number;
  target_volume_l: number | null; aisle_order: string[]; bays_per_side: number; aisles: Aisle[]; bays: Bay[];
};

const num = (v: unknown) => Number(v ?? 0) || 0;
const pct = (a: number, b: number) => (b ? (100 * a) / b : 0);

/** 0 = empty (pale), 1..10 bins holding stock = light to dark water blue. */
const SCALE = ["#EEF2F5", "#D4EBF3", "#B9DEEB", "#9DD0E3", "#80BFD6", "#63ABC8", "#4A97B8", "#3683A8", "#257096", "#165D84", "#01497C"];
const shade = (n: number) => SCALE[Math.max(0, Math.min(10, Math.round(n)))];

function BayCell({ bay }: { bay: Bay | undefined }) {
  // No rack at this number: the floor, never mistaken for a full rack.
  if (!bay) return <span aria-hidden className="block h-6 bg-[#DDE3E8]" />;
  const pillar = bay.gone > 0 && bay.locations === 0 && bay.blocked === 0 && bay.planned === 0;
  const title = `${bay.zone}${bay.rack}: ${bay.occupied} dari ${bay.locations} bin terisi`
    + (bay.gone ? `, ${bay.gone} tiang` : "") + (bay.blocked ? `, ${bay.blocked} diblokir` : "") + (bay.ckb ? `, ${bay.ckb} dipinjam CKB 3PL` : "");
  if (pillar) return <span title={title} aria-label={title} className="block h-6" style={{ background: GONE }} />;
  return (
    <span title={title} aria-label={title}
      className={cn("relative flex h-6 items-center justify-center text-[10px] font-semibold tabular", bay.occupied >= 6 ? "text-white" : "text-steel-800")}
      style={{ background: shade(bay.occupied) }}>
      {bay.locations ? bay.occupied : ""}
      {bay.gone > 0 && <span aria-hidden className="absolute bottom-0 right-0 h-2 w-2" style={{ background: GONE }} />}
      {bay.blocked > 0 && <span aria-hidden className="absolute left-0 top-0 h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-bad" />}
      {bay.ckb > 0 && <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-jeir-teal" />}
    </span>
  );
}

/** The racks from above, one cell per rack (aisle + rack number), coloured by how many of its bins hold stock. */
function OccupancyMap({ occ }: { occ: Occupancy }) {
  const per = occ.bays_per_side || 20;
  const byKey = useMemo(() => new Map(occ.bays.map((b) => [`${b.zone}${b.rack}`, b])), [occ.bays]);
  const zones = useMemo(() => {
    const present = new Set(occ.bays.map((b) => b.zone));
    const ordered = occ.aisle_order.filter((z) => present.has(z));
    return [...ordered, ...[...present].filter((z) => !ordered.includes(z)).sort()];
  }, [occ]);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="overflow-x-auto rounded-xl bg-[#DDE3E8] p-3">
      <div className="min-w-[680px] space-y-2">
        <div className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-px pl-14 text-center text-[9px] text-steel-500" aria-hidden>
          {Array.from({ length: per }, (_, i) => <span key={i}>{pad(i + 1)}</span>)}
        </div>
        {zones.map((zone) => (
          <div key={zone} className="flex items-stretch gap-2">
            <div className="flex w-12 shrink-0 flex-col items-center justify-center font-cond text-lg font-bold leading-none text-steel">{zone}</div>
            <div className="flex-1 space-y-px rounded-sm bg-plate-dark p-px">
              {[0, 1].map((face) => (
                <div key={face} className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-px">
                  {Array.from({ length: per }, (_, slot) => <BayCell key={slot} bay={byKey.get(`${zone}${pad(slot + 1 + face * per)}`)} />)}
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="pl-14 text-[11px] text-steel-500">Baris atas = rak 01–{pad(per)}, baris bawah = rak {pad(per + 1)}–{pad(per * 2)} (di belakangnya). Angka = bin terisi dari 10.</p>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-steel-700">
      <span className="flex items-center gap-1">
        <span>Bin terisi</span>
        {SCALE.map((c, i) => (
          <span key={i} className={cn("flex h-5 w-5 items-center justify-center text-[10px] font-semibold tabular", i >= 6 ? "text-white" : "text-steel-800")} style={{ background: c }}>{i}</span>
        ))}
      </span>
      <span className="flex items-center gap-1"><span className="h-4 w-4" style={{ background: GONE }} />Tiang (tidak ada bin)</span>
      <span className="flex items-center gap-1"><span className="relative h-4 w-4 bg-[#9DD0E3]"><span className="absolute left-0 top-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-bad" /></span>Ada bin diblokir</span>
      <span className="flex items-center gap-1"><span className="relative h-4 w-4 bg-[#9DD0E3]"><span className="absolute inset-x-0 top-0 h-[3px] bg-jeir-teal" /></span>Dipinjam CKB 3PL</span>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-white p-3">
      <div className="text-xs text-steel-500">{label}</div>
      <div className={cn("font-cond text-2xl font-semibold tabular", tone)}>{value}</div>
      {sub && <div className="text-xs tabular text-steel-500">{sub}</div>}
    </div>
  );
}

/** The gap as the sheet shows it: total, or "bebas −4 · blok +4" when unrestricted and blocked differ. */
function gapText(l: ReconLine): string {
  const g = gapTotal(l), b = gapBlocked(l);
  if (b !== 0) return `bebas ${signed(gapUnrestricted(l))} · blok ${signed(b)}`;
  return g ? signed(g) : "0";
}
const gapTone = (l: ReconLine) => { const g = gapTotal(l); return g > 0 ? "text-ckb-dark" : g < 0 || hasGap(l) ? "text-bad" : "text-steel-400"; };

/** What the sheet's Keterangan column says: the note typed on the line, else its cause, else its status when it differs. */
function remarkOf(l: ReconLine): string {
  if (l.remark?.trim()) return l.remark.trim();
  if (l.cause) return CAUSES[l.cause];
  return hasGap(l) ? RECON_STATUS[l.status] : "";
}

/**
 * Laporan gudang (0137): the Cocok view of a reconciliation, for the warehouse manager. Replaces the two pictures
 * sent on WhatsApp every afternoon: SAP vs WMS accuracy for the reconciliation day, and today's rack occupancy.
 */
export function ManagerReport({ run, lines }: { run: ReconSummary; lines: ReconLine[] }) {
  const [occ, setOcc] = useState<Occupancy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = useMemo(() => compareStats(lines), [lines]);
  const sheet = useMemo(() => lines.slice().sort((a, b) => a.sku.localeCompare(b.sku)), [lines]);
  const diffs = useMemo(() => lines.filter(hasGap).length, [lines]);

  useEffect(() => {
    let live = true;
    createClient().rpc("rack_occupancy").then(({ data, error: e }) => {
      if (!live) return;
      if (e) setError(e.message); else setOcc(data as Occupancy);
    });
    return () => { live = false; };
  }, []);

  const locations = num(occ?.locations), occupied = num(occ?.occupied);
  const litres = num(occ?.litres), target = num(occ?.target_volume_l);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-cond text-xl font-semibold">Laporan gudang per {fmtDate(run.as_of)}</h3>
        <p className="text-xs text-steel-500">
          Akurasi: rekonsiliasi {fmtDate(run.as_of)} ({(run.slocs ?? []).join(", ") || "semua lokasi SAP"})
          {occ && <> · rak: per sekarang, {fmtDateTime(occ.at)}</>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Akurasi SKU (SAP vs WMS)" value={s.skuAccuracy === null ? "–" : `${fmtNum(s.skuAccuracy, 1)}%`} sub={`${fmtNum(s.match)} dari ${fmtNum(s.skus)} SKU cocok`}
          tone={s.match === s.skus ? "text-ok" : undefined} />
        <Tile label="Akurasi qty" value={s.qtyAccuracy === null ? "–" : `${fmtNum(s.qtyAccuracy, 1)}%`} sub={`SAP ${fmtNum(s.sapQty)} · WMS ${fmtNum(s.wmsQty)}`} />
        <Tile label="Total SKU" value={fmtNum(s.skus)} sub={diffs ? `${fmtNum(diffs)} ada selisih` : "semua cocok"} />
        {occ ? <>
          <Tile label="Lokasi" value={fmtNum(locations)} sub="bin rak yang bisa dipakai" />
          <Tile label="Terisi" value={fmtNum(occupied)} sub="bin berisi stok" />
          <Tile label="Sisa" value={fmtNum(locations - occupied)} sub="bin kosong" />
          <Tile label="Okupansi" value={`${fmtNum(pct(occupied, locations), 0)}%`} sub={`${fmtNum(occupied)} ÷ ${fmtNum(locations)}`}
            tone={pct(occupied, locations) >= 90 ? "text-bad" : undefined} />
          <Tile label="Volume stok (L)" value={fmtNum(Math.round(litres))}
            sub={target ? `${fmtNum(pct(litres, target), 0)}% dari target ${fmtNum(target)}` : `${fmtNum(num(occ.cartons))} karton`} />
        </> : <div className="col-span-2 rounded-lg bg-white p-3 text-sm text-steel-500 md:col-span-5">{error ? <span className="text-bad">Data rak gagal dimuat: {error}</span> : "Memuat data rak…"}</div>}
      </div>

      {occ && (
        <Card>
          <CardHeader><CardTitle className="text-base">Okupansi rak</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <OccupancyMap occ={occ} />
            <Legend />
            <div className="flex flex-wrap gap-2">
              {occ.aisles.map((a) => (
                <div key={a.zone} className="flex items-center gap-2 rounded-md border border-steel-200 bg-white px-2 py-1 text-xs">
                  <b className="font-cond text-base">{a.zone}</b>
                  <span className="tabular">{fmtNum(a.occupied)}/{fmtNum(a.locations)} · {fmtNum(pct(a.occupied, a.locations), 0)}%</span>
                  {a.blocked > 0
                    ? <span className="rounded bg-bad/15 px-1.5 font-semibold text-bad">{fmtNum(a.blocked)} diblokir</span>
                    : <span className="rounded bg-ok/15 px-1.5 font-semibold text-ok">Aktif</span>}
                </div>
              ))}
            </div>
            {occ.skus_without_volume > 0 && (
              <p className="text-xs text-warn">{fmtNum(occ.skus_without_volume)} SKU belum punya volume di Master item: volume stok terhitung lebih kecil.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">SAP vs WMS per SKU</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th rowSpan={2}>SKU</Th><Th rowSpan={2}>Nama barang</Th><Th rowSpan={2}>Satuan</Th>
                  <Th colSpan={2} className="border-l border-steel-200 text-center">SAP</Th>
                  <Th colSpan={2} className="border-l border-steel-200 text-center">WMS</Th>
                  <Th rowSpan={2} className="border-l border-steel-200 text-right">Selisih</Th><Th rowSpan={2}>Keterangan</Th>
                </tr>
                <tr>
                  <Th className="border-l border-steel-200 text-right">Bebas</Th><Th className="text-right">Blok</Th>
                  <Th className="border-l border-steel-200 text-right">Bebas</Th><Th className="text-right">Blok</Th>
                </tr>
              </thead>
              <tbody>{sheet.map((l) => {
                const off = hasGap(l);
                return (
                  <tr key={l.id} className={cn(off && "bg-warn/25")}>
                    <Td className="font-semibold tabular">{l.sku}</Td>
                    <Td className="max-w-72 truncate text-xs">{l.description}</Td>
                    <Td className="text-xs">{l.sap_uom || l.wms_uom}</Td>
                    <Td className="border-l border-steel-100 text-right tabular">{fmtNum(num(l.sap_unrestricted))}</Td>
                    <Td className="text-right tabular">{fmtNum(num(l.sap_blocked))}</Td>
                    <Td className="border-l border-steel-100 text-right tabular">{fmtNum(num(l.wms_unrestricted))}</Td>
                    <Td className="text-right tabular">{fmtNum(num(l.wms_blocked))}</Td>
                    <Td className={cn("whitespace-nowrap border-l border-steel-100 text-right font-semibold tabular", gapTone(l))}>{gapText(l)}</Td>
                    <Td className="text-xs">{remarkOf(l)}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          </div>
          <ul className="divide-y divide-steel-100 md:hidden">
            {sheet.map((l) => {
              return (
                <li key={l.id} className={cn("px-3 py-2 text-sm", hasGap(l) && "bg-warn/25")}>
                  <div className="flex items-baseline justify-between gap-2">
                    <b className="tabular">{l.sku}</b>
                    <span className={cn("text-xs font-semibold tabular", hasGap(l) ? gapTone(l) : "text-ok")}>{hasGap(l) ? gapText(l) : "Cocok"}</span>
                  </div>
                  <div className="truncate text-xs text-steel-500">{l.description}</div>
                  <div className="text-xs tabular">
                    SAP {fmtNum(num(l.sap_unrestricted))} / blok {fmtNum(num(l.sap_blocked))} · WMS {fmtNum(num(l.wms_unrestricted))} / blok {fmtNum(num(l.wms_blocked))} {l.sap_uom || l.wms_uom}
                  </div>
                  {remarkOf(l) && <div className="text-xs text-steel-700">{remarkOf(l)}</div>}
                </li>
              );
            })}
          </ul>
          <p className="px-3 py-2 text-xs text-steel-500">Baris kuning = ada selisih (WMS − SAP setelah koreksi timing). Bebas = unrestricted, Blok = blocked.</p>
        </CardContent>
      </Card>
    </div>
  );
}
