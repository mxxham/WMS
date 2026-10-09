"use client";
import { useMemo } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { findIssues } from "@/lib/data-quality";
import { SHELF_BUCKETS, shelfBucket } from "@/lib/inventory-view";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import type { FefoLine } from "../page";

export type FefoException = {
  movement_id: string; picked_at: string; sku: string; description: string; from_bin: string; batch_lot: string;
  expiry_date: string; quantity: number; by_name: string | null; note: string | null; shipment_number: string | null; wave_no: string | null;
  older_expiry: string; older_qty: number; older_bins: string;
};

type Group = { sku: string; description: string; uom: string | null; batch: string; expiry: string; days: number; qty: number; held: number; bins: string[]; gr: string | null };

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
/** "3 thn 4 bln 10 hr" like the manual near-expiry summary. */
function ageText(fromIso: string, toIso: string): string {
  const d = Math.max(daysBetween(fromIso, toIso), 0);
  const y = Math.floor(d / 365), m = Math.floor((d % 365) / 30), r = d - y * 365 - m * 30;
  return [y && `${y} thn`, m && `${m} bln`, `${r} hr`].filter(Boolean).join(" ");
}

export function FefoTab({ lines, nearDays, days, exceptions, picks, error, shelfLife, defaultShelfLife }: {
  lines: FefoLine[]; nearDays: number; days: number; exceptions: FefoException[]; picks: number; error: string | null;
  shelfLife: Record<string, number>; defaultShelfLife: number;
}) {
  const t = today();
  const buckets = useMemo(() => SHELF_BUCKETS.map((b) => {
    const ls = lines.filter((l) => shelfBucket(l.days_remaining) === b.key);
    return { ...b, qty: ls.reduce((s, l) => s + Number(l.quantity), 0), lines: ls.length, skus: new Set(ls.map((l) => l.sku)).size };
  }), [lines]);

  // Near expiry / expired, one row per SKU + batch + expiry with all its bins.
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const l of lines) {
      if (!l.expiry_date || l.days_remaining === null || l.days_remaining > nearDays) continue;
      const k = `${l.sku}|${l.batch_lot}|${l.expiry_date}`;
      const g = m.get(k) ?? { sku: l.sku, description: l.description, uom: l.uom, batch: l.batch_lot, expiry: l.expiry_date, days: l.days_remaining, qty: 0, held: 0, bins: [], gr: null };
      g.qty += Number(l.quantity); g.held += Number(l.held ?? 0);
      if (!g.bins.includes(l.bin_code)) g.bins.push(l.bin_code);
      if (l.received_date && (!g.gr || l.received_date < g.gr)) g.gr = l.received_date;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.sku.localeCompare(b.sku));
  }, [lines, nearDays]);
  const expired = groups.filter((g) => g.days < 0);
  const near = groups.filter((g) => g.days >= 0);

  const issues = useMemo(() => findIssues(lines.map((l) => ({ ...l, upp: null })), t, new Map(Object.entries(shelfLife)), defaultShelfLife)
    .filter((i) => i.kind === "expiry_vs_batch" || i.kind === "batch_multi_expiry"), [lines, t, shelfLife, defaultShelfLife]);
  const mismatchBins = new Set(issues.map((i) => i.row.bin_code)).size;
  const compliance = picks ? ((picks - exceptions.length) / picks) * 100 : null;

  async function exportNear() {
    // Loaded on click: the Excel library (~140 kB) is not part of the page.
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(groups.map((g) => ({
      item: g.sku, Description: g.description, Batch: g.batch, "Expired Date": g.expiry, "GR date": g.gr ?? "",
      "Aging Expired": g.days < 0 ? `lewat ${-g.days} hari` : ageText(t, g.expiry), "Aging day": g.gr ? ageText(g.gr, t) : "",
      "Sisa hari": g.days, Total: g.qty, Ditahan: g.held, Bin: g.bins.join(", "),
    }))), "Near expired");
    XLSX.writeFile(book, `near_expired_${t}.xlsx`);
  }

  const tiles: [string, string, string, boolean?][] = [
    ["Sudah expired", fmtNum(expired.reduce((s, g) => s + g.qty, 0)), `${fmtNum(expired.length)} batch · harus ditahan / dimusnahkan`, expired.length > 0],
    [`Near-expiry (≤ ${nearDays} hari)`, fmtNum(near.reduce((s, g) => s + g.qty, 0)), `${fmtNum(near.length)} batch · kirim dulu, lapor Shell`],
    [`FEFO dipatuhi · ${days} hari`, compliance === null ? "–" : `${compliance.toFixed(1)}%`, `${fmtNum(exceptions.length)} pick melanggar dari ${fmtNum(picks)} pick rak`, exceptions.length > 0],
    ["Expired ≠ kode batch", fmtNum(issues.length), `${fmtNum(mismatchBins)} bin · FEFO memakai tanggal yang salah`, issues.length > 0],
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
        <CardHeader><CardTitle>Stok per sisa umur</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <thead><tr><Th>Sisa umur</Th><Th className="text-right">Qty</Th><Th className="text-right">Baris stok</Th><Th className="text-right">SKU</Th></tr></thead>
            <tbody>{buckets.map((b) => (
              <tr key={b.key}><Td>{b.label}</Td><Td className="text-right tabular">{fmtNum(b.qty)}</Td><Td className="text-right tabular">{fmtNum(b.lines)}</Td><Td className="text-right tabular">{fmtNum(b.skus)}</Td></tr>
            ))}</tbody>
          </Table>
        </CardContent>
      </Card>

      {issues.length > 0 && (
        <Card className="border-l-4 border-warn">
          <CardContent className="space-y-1">
            <p className="text-sm"><b>{fmtNum(issues.length)} baris stok</b> punya tanggal expired yang tidak cocok dengan kode batchnya (mis. hari dan bulan tertukar). FEFO mengurutkan stok memakai tanggal itu, jadi urutan ambilnya salah.</p>
            <Link className="text-sm underline" href="/data-quality#expiry_vs_batch">Perbaiki di Kualitas data →</Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Expired & near-expiry (≤ {nearDays} hari) · {fmtNum(groups.length)} batch</CardTitle>
          <Button variant="outline" size="sm" onClick={exportNear} disabled={groups.length === 0}><Download className="h-4 w-4" />Excel untuk Shell</Button>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? <p className="text-sm text-steel-500">Tidak ada stok yang expired atau mendekati expired.</p> : (
            <Table>
              <thead><tr><Th>SKU</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Sisa hari</Th><Th>Terima (GR)</Th><Th className="text-right">Qty</Th><Th className="text-right">Ditahan</Th><Th>Bin</Th></tr></thead>
              <tbody>{groups.map((g) => (
                <tr key={`${g.sku}|${g.batch}|${g.expiry}`} className={cn(g.days < 0 && "bg-bad/10")}>
                  <Td className="font-semibold">{g.sku}<div className="text-xs font-normal">{g.description}</div></Td>
                  <Td>{g.batch || "–"}</Td><Td className="whitespace-nowrap">{fmtDate(g.expiry)}</Td>
                  <Td className={cn("text-right font-semibold tabular", g.days < 0 ? "text-bad" : g.days <= 90 && "text-warn")}>{g.days < 0 ? `lewat ${-g.days}` : g.days}</Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(g.gr)}{g.gr && <div>{ageText(g.gr, t)} lalu</div>}</Td>
                  <Td className="text-right tabular">{fmtNum(g.qty)} <span className="text-xs text-steel-500">{g.uom}</span></Td>
                  <Td className="text-right tabular">{g.held ? fmtNum(g.held) : "–"}</Td>
                  <Td className="text-xs">{g.bins.map((b) => <Link key={b} className="mr-1 underline" href={`/bin/${encodeURIComponent(b)}`}>{b}</Link>)}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          {expired.length > 0 && <p className="mt-2 text-xs text-steel-500">Stok expired tidak dialokasikan. Tahan dengan alasan &quot;Expired&quot; di tab Hold & karantina, pindahkan ke karantina, lalu tulis-off dengan kode alasan &quot;Expired dimusnahkan&quot; setelah ada berita acara.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Kepatuhan FEFO pada pick nyata · {days} hari</CardTitle>
          <div className="flex gap-1 text-sm">
            {[7, 30, 90].map((d) => <Link key={d} href={`/inventory?tab=fefo&days=${d}`} className={cn("rounded-md border px-2 py-1", d === days ? "border-ckb bg-ckb text-white" : "border-steel-300")}>{d} hari</Link>)}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-steel-500">Setiap pick dari rak dibandingkan dengan stok pada saat itu: pelanggaran = mengambil batch yang lebih baru padahal batch yang lebih tua dari SKU yang sama tersedia di rak (tidak ditahan, tidak dipesan tugas lain, sisa umur cukup).</p>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          {exceptions.length === 0 ? <p className="text-sm text-ok">Tidak ada pelanggaran FEFO pada periode ini.</p> : (
            <Table>
              <thead><tr><Th>Waktu</Th><Th>SKU</Th><Th>Diambil</Th><Th className="text-right">Qty</Th><Th>Yang lebih tua tersedia</Th><Th>Shipment / wave</Th><Th>Oleh · catatan</Th></tr></thead>
              <tbody>{exceptions.map((e) => (
                <tr key={e.movement_id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(e.picked_at)}</Td>
                  <Td className="font-semibold">{e.sku}<div className="text-xs font-normal">{e.description}</div></Td>
                  <Td className="text-xs">{e.from_bin} · {e.batch_lot || "–"} · exp {fmtDate(e.expiry_date)}</Td>
                  <Td className="text-right tabular">{fmtNum(Number(e.quantity))}</Td>
                  <Td className="text-xs">exp {fmtDate(e.older_expiry)} · {fmtNum(Number(e.older_qty))} unit · {e.older_bins}</Td>
                  <Td className="text-xs">{e.shipment_number ?? "manual"}{e.wave_no && ` · NO ${e.wave_no}`}</Td>
                  <Td className="text-xs">{e.by_name ?? "–"}{e.note && <div>{e.note}</div>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
