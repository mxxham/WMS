"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExpiryBadge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { expiryStatus } from "@/config/warehouse";
import { LOC_LABEL, SHELF_BUCKETS, locType, shelfBucket, stockKey, type LocType, type ShelfBucket } from "@/lib/inventory-view";
import { cn, fmtDate, fmtNum } from "@/lib/utils";

export type InvLine = {
  bin_code: string; zone: string; rack: string | null; level: string | null; bin_status: "active" | "blocked";
  sku: string; description: string; uom: string | null; upp: number | null; item_abc: string | null;
  batch_lot: string; quantity: number; expiry_date: string | null; received_date: string | null; days_remaining: number | null;
  held: number; hold_reasons: string | null;
};
export type OpenTask = {
  task_type: "PICK" | "REPLENISH"; sku: string; from_bin: string; to_bin: string | null;
  batch_lot: string; expiry_date: string; quantity: number; wave_no: string; planned_date: string;
};

type Line = InvLine & { loc: LocType; bucket: ShelfBucket; reserved: number; incoming: number; available: number; waves: string[] };
type SkuRow = {
  sku: string; description: string; uom: string | null; upp: number | null; abc: string | null;
  total: number; byLoc: Record<LocType, number>; reserved: number; held: number; available: number; pallets: number;
  bins: number; batches: number; earliest: string | null; earliestDays: number | null; lines: Line[];
};
type View = "sku" | "line";
type Sort = "sku" | "qty" | "expiry" | "reserved";
const PAGE = 300;

const SORTS: Sort[] = ["sku", "qty", "expiry", "reserved"];

const LEVELS = ["A", "B", "C", "D", "E"];

export function InventoryClient({ lines, tasks, initialQuery, initialAbc, initialSort, initialAisle, initialLevel, initialView, emptyBins = [] }: {
  lines: InvLine[]; tasks: OpenTask[]; initialQuery: string; initialAbc?: string; initialSort?: string;
  initialAisle?: string; initialLevel?: string; initialView?: View; emptyBins?: { code: string; blocked: boolean }[];
}) {
  const [q, setQ] = useState(initialQuery);
  const [loc, setLoc] = useState<LocType | "all">("all");
  const [aisle, setAisle] = useState(initialAisle ?? "all");
  const [level, setLevel] = useState(initialLevel ?? "all");
  // ?abc=A|B|C|– from the dashboard's ABC card; anything else = all classes.
  const [abc, setAbc] = useState(["A", "B", "C", "–"].includes(initialAbc ?? "") ? initialAbc! : "all");
  const [bucket, setBucket] = useState<ShelfBucket | "all" | "risk">("all");
  const [onlyReserved, setOnlyReserved] = useState(false);
  const [onlyHeld, setOnlyHeld] = useState(false);
  const [view, setView] = useState<View>(initialView ?? "sku");
  const [sort, setSort] = useState<Sort>(SORTS.includes(initialSort as Sort) ? (initialSort as Sort) : "sku");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  // Reserved (open tasks taking stock out) and incoming (replenish into) per stock identity.
  const enriched: Line[] = useMemo(() => {
    const out = new Map<string, { q: number; waves: Set<string> }>();
    const inc = new Map<string, number>();
    for (const t of tasks) {
      const k = stockKey(t.from_bin, t.sku, t.batch_lot, t.expiry_date);
      const e = out.get(k) ?? { q: 0, waves: new Set<string>() };
      e.q += Number(t.quantity); e.waves.add(`NO ${t.wave_no} (${fmtDate(t.planned_date)})`);
      out.set(k, e);
      if (t.task_type === "REPLENISH" && t.to_bin) {
        const ki = stockKey(t.to_bin, t.sku, t.batch_lot, t.expiry_date);
        inc.set(ki, (inc.get(ki) ?? 0) + Number(t.quantity));
      }
    }
    return lines.map((l) => {
      const k = stockKey(l.bin_code, l.sku, l.batch_lot, l.expiry_date);
      const r = out.get(k);
      const reserved = Math.min(r?.q ?? 0, Number(l.quantity));
      const where = locType(l);
      // Held (0017) and quarantined stock is not available to ship.
      const held = where === "quarantine" ? Number(l.quantity) : Number(l.held ?? 0);
      return { ...l, held, loc: where, bucket: shelfBucket(l.days_remaining), reserved, incoming: inc.get(k) ?? 0,
        available: Math.max(Number(l.quantity) - reserved - held, 0), waves: r ? [...r.waves] : [] };
    });
  }, [lines, tasks]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return enriched.filter((l) =>
      (!needle || l.sku.toLowerCase().includes(needle) || l.description?.toLowerCase().includes(needle)
        || l.batch_lot.toLowerCase().includes(needle) || l.bin_code.toLowerCase().includes(needle))
      && (loc === "all" || l.loc === loc)
      && (abc === "all" || (l.item_abc ?? "–") === abc)
      && (bucket === "all" || (bucket === "risk" ? l.bucket === "expired" || l.bucket === "d90" : l.bucket === bucket))
      && (!onlyReserved || l.reserved > 0)
      && (!onlyHeld || l.held > 0)
      && (aisle === "all" || (l.rack !== null && l.zone === aisle))
      && (level === "all" || (l.rack !== null && l.level === level)));
  }, [enriched, q, loc, abc, bucket, onlyReserved, onlyHeld, aisle, level]);
  const aisles = useMemo(() => [...new Set(lines.filter((l) => l.rack).map((l) => l.zone))].sort(), [lines]);
  // Empty positions came from the server for the aisle/level the page was opened with.
  const showEmpty = emptyBins.length > 0 && aisle === (initialAisle ?? "all") && level === (initialLevel ?? "all");
  const occupiedBins = new Set(filtered.map((l) => l.bin_code)).size;

  const skuRows: SkuRow[] = useMemo(() => {
    const m = new Map<string, SkuRow>();
    for (const l of filtered) {
      const r = m.get(l.sku) ?? {
        sku: l.sku, description: l.description, uom: l.uom, upp: l.upp, abc: l.item_abc, total: 0,
        byLoc: { rack: 0, staging: 0, quarantine: 0, other: 0 }, reserved: 0, held: 0, available: 0, pallets: 0,
        bins: 0, batches: 0, earliest: null, earliestDays: null, lines: [],
      };
      const qty = Number(l.quantity);
      r.total += qty; r.byLoc[l.loc] += qty; r.reserved += l.reserved; r.held += l.held; r.available += l.available;
      r.pallets += l.upp ? qty / Number(l.upp) : 0; r.lines.push(l);
      if (l.expiry_date && (!r.earliest || l.expiry_date < r.earliest)) { r.earliest = l.expiry_date; r.earliestDays = l.days_remaining; }
      m.set(l.sku, r);
    }
    const rows = [...m.values()];
    for (const r of rows) {
      r.bins = new Set(r.lines.map((l) => l.bin_code)).size;
      r.batches = new Set(r.lines.map((l) => l.batch_lot)).size;
      r.lines.sort((a, b) => (a.expiry_date ?? "9999").localeCompare(b.expiry_date ?? "9999") || a.bin_code.localeCompare(b.bin_code));
    }
    return rows.sort((a, b) =>
      sort === "qty" ? b.total - a.total
      : sort === "expiry" ? (a.earliest ?? "9999").localeCompare(b.earliest ?? "9999")
      : sort === "reserved" ? b.reserved - a.reserved
      : a.sku.localeCompare(b.sku));
  }, [filtered, sort]);

  const lineRows = useMemo(() => [...filtered].sort((a, b) =>
    sort === "qty" ? Number(b.quantity) - Number(a.quantity)
    : sort === "expiry" ? (a.expiry_date ?? "9999").localeCompare(b.expiry_date ?? "9999")
    : sort === "reserved" ? b.reserved - a.reserved
    : a.sku.localeCompare(b.sku) || a.bin_code.localeCompare(b.bin_code)), [filtered, sort]);

  const totals = useMemo(() => ({
    skus: new Set(filtered.map((l) => l.sku)).size,
    qty: filtered.reduce((s, l) => s + Number(l.quantity), 0),
    pallets: filtered.reduce((s, l) => s + (l.upp ? Number(l.quantity) / Number(l.upp) : 0), 0),
    reserved: filtered.reduce((s, l) => s + l.reserved, 0),
    held: filtered.reduce((s, l) => s + l.held, 0),
    available: filtered.reduce((s, l) => s + l.available, 0),
    bins: new Set(filtered.map((l) => l.bin_code)).size,
  }), [filtered]);

  function exportXlsx() {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(skuRows.map((r) => ({
      SKU: r.sku, Deskripsi: r.description, ABC: r.abc ?? "", UOM: r.uom ?? "", UPP: r.upp ?? "",
      Total: r.total, Rak: r.byLoc.rack, Staging: r.byLoc.staging, Karantina: r.byLoc.quarantine, "Lantai lain": r.byLoc.other,
      Dipesan: r.reserved, Ditahan: r.held, Tersedia: r.available, "Palet (setara)": Math.round(r.pallets * 10) / 10,
      Bin: r.bins, Batch: r.batches, "Expired terdekat": r.earliest ?? "",
    }))), "Per SKU");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(lineRows.map((l) => ({
      Bin: l.bin_code, Lokasi: LOC_LABEL[l.loc], "Status bin": l.bin_status, SKU: l.sku, Deskripsi: l.description,
      Batch: l.batch_lot, Expired: l.expiry_date ?? "", "Sisa hari": l.days_remaining ?? "", Qty: Number(l.quantity),
      Dipesan: l.reserved, Ditahan: l.held, "Alasan hold": l.hold_reasons ?? "", Tersedia: l.available, "Masuk (replenish)": l.incoming, Wave: l.waves.join(", "), "Tgl terima": l.received_date ?? "",
    }))), "Per lokasi");
    XLSX.writeFile(book, `inventory_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" })}.xlsx`);
  }

  const toggle = (sku: string) => setOpen((s) => { const n = new Set(s); if (n.has(sku)) n.delete(sku); else n.add(sku); return n; });

  return (
    <div className="space-y-4 p-4 lg:p-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {([["SKU", fmtNum(totals.skus)], ["Total stok", fmtNum(totals.qty)], ["Palet (setara)", fmtNum(totals.pallets, 1)],
          ["Dipesan wave", fmtNum(totals.reserved)], ["Ditahan / karantina", fmtNum(totals.held)], ["Tersedia", fmtNum(totals.available)], ["Bin terisi", fmtNum(totals.bins)]] as const).map(([l, v]) => (
          <div key={l} className="rounded-lg bg-white p-3">
            <div className="text-xs text-steel-500">{l}</div>
            <div className="font-cond text-2xl font-semibold tabular">{v}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4">
        <div className="min-w-56 flex-1"><Label htmlFor="q">Cari</Label>
          <Input id="q" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="SKU, deskripsi, batch, atau bin" /></div>
        <div><Label htmlFor="loc">Lokasi</Label>
          <Select id="loc" value={loc} onChange={(e) => setLoc(e.target.value as LocType | "all")}>
            <option value="all">Semua</option>{(Object.keys(LOC_LABEL) as LocType[]).map((k) => <option key={k} value={k}>{LOC_LABEL[k]}</option>)}
          </Select></div>
        <div><Label htmlFor="aisle">Aisle</Label>
          <Select id="aisle" value={aisle} onChange={(e) => setAisle(e.target.value)}>
            <option value="all">Semua</option>{aisles.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select></div>
        <div><Label htmlFor="level">Level</Label>
          <Select id="level" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="all">Semua</option>{LEVELS.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
          </Select></div>
        <div><Label htmlFor="abc">ABC</Label>
          <Select id="abc" value={abc} onChange={(e) => setAbc(e.target.value)}>
            <option value="all">Semua</option>{["A", "B", "C", "–"].map((k) => <option key={k} value={k}>{k === "–" ? "Tanpa" : k}</option>)}
          </Select></div>
        <div><Label htmlFor="exp">Umur simpan</Label>
          <Select id="exp" value={bucket} onChange={(e) => setBucket(e.target.value as ShelfBucket | "all" | "risk")}>
            <option value="all">Semua</option><option value="risk">Expired + ≤ 90 hari</option>
            {SHELF_BUCKETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </Select></div>
        <div><Label htmlFor="sort">Urutkan</Label>
          <Select id="sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="sku">SKU</option><option value="qty">Stok terbanyak</option><option value="expiry">Expired terdekat</option><option value="reserved">Dipesan terbanyak</option>
          </Select></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyReserved} onChange={(e) => setOnlyReserved(e.target.checked)} />Hanya yang dipesan</label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyHeld} onChange={(e) => setOnlyHeld(e.target.checked)} />Hanya yang ditahan</label>
        <div className="flex gap-2">
          <div className="flex rounded-md border border-steel-300 text-sm">
            {(["sku", "line"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={cn("px-3 py-2 first:rounded-l-md last:rounded-r-md", view === v ? "bg-ckb text-white" : "hover:bg-steel-100")}>
                {v === "sku" ? "Per SKU" : "Per lokasi"}
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={exportXlsx} disabled={filtered.length === 0}><Download className="h-4 w-4" />Excel</Button>
        </div>
      </div>

      {showEmpty && (
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm">
              <b>{aisle !== "all" ? `Aisle ${aisle}` : "Semua aisle"}{level !== "all" ? ` · level ${level}` : ""}</b>:{" "}
              {fmtNum(occupiedBins)} posisi terisi, <b>{fmtNum(emptyBins.length)} posisi kosong</b>
              {" "}({Math.round((occupiedBins / Math.max(occupiedBins + emptyBins.length, 1)) * 100)}% terisi).
            </p>
            <div className="flex flex-wrap gap-1.5">
              {emptyBins.map((b) => (
                <Link key={b.code} href={`/bin/${encodeURIComponent(b.code)}`}
                  className={cn("rounded border px-2 py-0.5 font-mono text-xs hover:bg-paper", b.blocked ? "border-bad text-bad" : "border-steel-300")}
                  title={b.blocked ? "Kosong, diblokir" : "Kosong"}>
                  {b.code}
                </Link>
              ))}
            </div>
            <p className="text-xs text-steel-500">Posisi kosong di rak ini (merah = diblokir). Klik untuk membuka bin.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          {filtered.length === 0 ? <p className="text-sm text-steel-500">Tidak ada stok untuk filter ini.</p> : view === "sku" ? (
            <Table>
              <thead><tr>
                <Th /><Th>SKU</Th><Th>Deskripsi</Th><Th>ABC</Th><Th className="text-right">Total</Th><Th className="text-right">Rak</Th>
                <Th className="text-right">Staging</Th><Th className="text-right">Karantina</Th><Th className="text-right">Dipesan</Th><Th className="text-right">Ditahan</Th>
                <Th className="text-right">Tersedia</Th><Th className="text-right">Palet</Th><Th className="text-right">Bin · batch</Th><Th>Expired terdekat</Th>
              </tr></thead>
              <tbody>{skuRows.slice(0, limit).map((r) => (
                <Fragment key={r.sku}>
                  <tr className="cursor-pointer hover:bg-paper" onClick={() => toggle(r.sku)}>
                    <Td>{open.has(r.sku) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Td>
                    <Td className="font-semibold">{r.sku}</Td>
                    <Td className="text-xs">{r.description}</Td>
                    <Td>{r.abc ?? "–"}</Td>
                    <Td className="text-right font-semibold tabular">{fmtNum(r.total)} <span className="text-xs font-normal text-steel-500">{r.uom}</span></Td>
                    <Td className="text-right tabular">{fmtNum(r.byLoc.rack + r.byLoc.other)}</Td>
                    <Td className="text-right tabular">{r.byLoc.staging ? fmtNum(r.byLoc.staging) : "–"}</Td>
                    <Td className="text-right tabular">{r.byLoc.quarantine ? fmtNum(r.byLoc.quarantine) : "–"}</Td>
                    <Td className="text-right tabular">{r.reserved ? fmtNum(r.reserved) : "–"}</Td>
                    <Td className={cn("text-right tabular", r.held > 0 && "text-warn")}>{r.held ? fmtNum(r.held) : "–"}</Td>
                    <Td className={cn("text-right font-semibold tabular", r.available === 0 && "text-bad")}>{fmtNum(r.available)}</Td>
                    <Td className="text-right tabular">{fmtNum(r.pallets, 1)}</Td>
                    <Td className="text-right tabular">{r.bins} · {r.batches}</Td>
                    <Td className="whitespace-nowrap text-xs">{fmtDate(r.earliest)} <ExpiryBadge status={expiryStatus(r.earliest)} /></Td>
                  </tr>
                  {open.has(r.sku) && (
                    <tr><td colSpan={14} className="bg-paper px-4 py-2"><LineTable lines={r.lines} compact /></td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </Table>
          ) : <LineTable lines={lineRows.slice(0, limit)} />}
          {(view === "sku" ? skuRows.length : lineRows.length) > limit && (
            <Button variant="outline" className="mt-3" onClick={() => setLimit(limit + PAGE)}>
              Tampilkan lebih banyak ({fmtNum((view === "sku" ? skuRows.length : lineRows.length) - limit)} lagi)
            </Button>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-steel-500">Dipesan = stok yang akan diambil tugas wave yang belum dikerjakan. Ditahan = stok on hold (QC, rusak, investigasi, recall) atau di karantina. Tersedia = stok fisik dikurangi yang dipesan dan yang ditahan. Palet setara = stok ÷ UPP.</p>
    </div>
  );
}

function LineTable({ lines, compact }: { lines: Line[]; compact?: boolean }) {
  return (
    <Table>
      <thead><tr>
        <Th>Bin</Th><Th>Lokasi</Th>{!compact && <><Th>SKU</Th><Th>Deskripsi</Th></>}<Th>Batch</Th><Th>Expired</Th><Th className="text-right">Qty</Th>
        <Th className="text-right">Dipesan</Th><Th className="text-right">Ditahan</Th><Th className="text-right">Tersedia</Th><Th>Wave</Th><Th>Terima</Th>
      </tr></thead>
      <tbody>{lines.map((l, i) => (
        <tr key={i}>
          <Td><Link className="font-semibold underline" href={`/bin/${encodeURIComponent(l.bin_code)}`} onClick={(e) => e.stopPropagation()}>{l.bin_code}</Link>
            {l.bin_status === "blocked" && <span className="ml-1 text-xs text-bad">diblokir</span>}</Td>
          <Td className="text-xs">{LOC_LABEL[l.loc]}</Td>
          {!compact && <><Td className="font-semibold">{l.sku}</Td><Td className="text-xs">{l.description}</Td></>}
          <Td>{l.batch_lot || "–"}</Td>
          <Td className="whitespace-nowrap text-xs">{fmtDate(l.expiry_date)} <ExpiryBadge status={expiryStatus(l.expiry_date)} /></Td>
          <Td className="text-right tabular">{fmtNum(Number(l.quantity))} <span className="text-xs text-steel-500">{l.uom}</span></Td>
          <Td className="text-right tabular">{l.reserved ? fmtNum(l.reserved) : "–"}{l.incoming ? <span className="block text-xs text-ok">+{fmtNum(l.incoming)} masuk</span> : null}</Td>
          <Td className={cn("text-right tabular", l.held > 0 && "text-warn")}>{l.held ? fmtNum(l.held) : "–"}{l.hold_reasons && <span className="block text-[11px]">{l.hold_reasons}</span>}</Td>
          <Td className="text-right font-semibold tabular">{fmtNum(l.available)}</Td>
          <Td className="text-xs">{l.waves.join(", ") || "–"}</Td>
          <Td className="whitespace-nowrap text-xs">{fmtDate(l.received_date)}</Td>
        </tr>
      ))}</tbody>
    </Table>
  );
}
