import Link from "next/link";
import { Search } from "lucide-react";
import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpiryBadge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { expiryStatus } from "@/config/warehouse";
import { parsePolicy } from "@/lib/inventory-control";
import { jakartaDate } from "@/lib/inventory-view";
import {
  buildAlerts, buildCandidates, buildDestinations, buildExpiryGroups, buildHistory, buildPositions, buildShipments, buildSummary, jakartaDateTime,
  type Candidate, type TraceData, type TraceHold, type TraceMove, type TraceOutbound, type TraceStock, type TraceTask,
} from "@/lib/trace";
import { fmtDate, fmtNum } from "@/lib/utils";
import { RecentTraces, TraceView, traceHref } from "./trace-client";
import { SkuBatchReport } from "./trace-sku";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type MoveRow = {
  id: string; type: string; quantity: number; batch_lot: string; expiry_date: string | null; created_at: string; note: string | null;
  reason_code: string | null; by_name: string | null; approved_by_name: string | null;
  items: { sku: string; description: string; uom: string | null } | null;
  from_bin: { bin_code: string } | null; to_bin: { bin_code: string } | null; profiles: { name: string } | null;
  pick_tasks: { shipment_number: string | null; waves: { wave_no: string; planned_date: string; truck: string | null } | null } | null;
};

const STOCK_COLS = "bin_code, zone, rack, level, bin_status, sku, description, uom, upp, batch_lot, quantity, expiry_date, received_date, days_remaining, held, hold_reasons";
/** ILIKE pattern for an exact, case-insensitive match (escape the wildcards). */
const exact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Batch traceability. One search box: an exact batch code opens the trace
 * (where it is now with each expiry date and bin, who received it, every
 * movement, holds and open wave tasks, all downloadable as Excel); anything
 * else — part of a batch code, a SKU, a bin, a word of the description —
 * lists the batches that match, so the code need not be known by heart.
 */
export default async function TracePage({ searchParams }: { searchParams: Promise<{ batch?: string; sku?: string; tab?: string; mode?: string }> }) {
  await requirePage("/trace");
  const sp = await searchParams;
  const batch = (sp.batch ?? "").trim();
  const sku = (sp.sku ?? "").trim();
  // ?mode=sku: the batches of many materials at once (a principal's request), instead of one batch.
  const listMode = sp.mode === "sku" && !batch;
  const supabase = await createClient();

  let data: TraceData | null = null;
  let nearDays = 90;
  let found: { candidates: Candidate[]; past: string[]; kind: string } | null = null;
  let error: string | null = null;

  if (batch) {
    try {
      const [moveRows, stock, tasks, holdsRes, policyRes] = await Promise.all([
        fetchAll<MoveRow>((a, b) => {
          let q = supabase.from("movements")
            .select("id, type, quantity, batch_lot, expiry_date, created_at, note, reason_code, by_name, approved_by_name, items!inner(sku, description, uom), from_bin:bins!movements_from_bin_id_fkey(bin_code), to_bin:bins!movements_to_bin_id_fkey(bin_code), profiles(name), pick_tasks(shipment_number, waves(wave_no, planned_date, truck))")
            .ilike("batch_lot", exact(batch));
          if (sku) q = q.eq("items.sku", sku);
          return q.order("created_at").order("id").range(a, b);
        }),
        fetchAll<TraceStock>((a, b) => {
          let q = supabase.from("inventory_detail_all").select(STOCK_COLS).ilike("batch_lot", exact(batch));
          if (sku) q = q.eq("sku", sku);
          return q.order("sku").order("bin_code").order("id").range(a, b);
        }),
        fetchAll<TraceTask>((a, b) => {
          let q = supabase.from("pick_task_detail")
            .select("task_type, sku, description, from_bin, to_bin, batch_lot, expiry_date, quantity, wave_no, planned_date, shipment_number")
            .eq("status", "PLANNED").in("wave_status", ["PENDING", "RESCHEDULED"]).ilike("batch_lot", exact(batch));
          if (sku) q = q.eq("sku", sku);
          return q.order("planned_date").order("id").range(a, b);
        }),
        (() => {
          let q = supabase.from("stock_hold_detail")
            .select("id, scope, bin_code, sku, batch_lot, expiry_date, quantity, reason_code, note, status, created_by_name, created_at, released_by_name, released_at, release_note, covered_qty")
            .ilike("batch_lot", exact(batch));
          if (sku) q = q.eq("sku", sku);
          return q.order("created_at", { ascending: false }).limit(200);
        })(),
        supabase.rpc("inventory_policy"),
      ]);
      const policy = parsePolicy(policyRes.data);
      nearDays = policy.near_expiry_days;

      if (moveRows.length > 0 || stock.some((s) => Number(s.quantity) > 0)) {
        const moves: TraceMove[] = moveRows.map((m) => ({
          id: m.id, type: m.type, quantity: Number(m.quantity), batch_lot: m.batch_lot, expiry_date: m.expiry_date, created_at: m.created_at,
          note: m.note, reason_code: m.reason_code, by_name: m.by_name, approved_by_name: m.approved_by_name,
          sku: m.items?.sku ?? "", description: m.items?.description ?? "", uom: m.items?.uom ?? null,
          from_bin: m.from_bin?.bin_code ?? null, to_bin: m.to_bin?.bin_code ?? null, user: m.profiles?.name ?? null,
          shipment: m.pick_tasks?.shipment_number ?? null, wave_no: m.pick_tasks?.waves?.wave_no ?? null,
          wave_date: m.pick_tasks?.waves?.planned_date ?? null, truck: m.pick_tasks?.waves?.truck ?? null,
        }));
        const skus = [...new Set([...moves.map((m) => m.sku), ...stock.map((s) => s.sku)])].filter(Boolean);
        const shipments = [...new Set(moves.map((m) => m.shipment).filter((s): s is string => !!s))];
        const [outRes, itemRes] = await Promise.all([
          shipments.length
            ? supabase.from("outbound").select("shipment_number, sku, destination, truck, order_nos").in("shipment_number", shipments)
            : Promise.resolve({ data: [] as TraceOutbound[] }),
          skus.length
            ? supabase.from("items").select("sku, shelf_life_months").in("sku", skus).not("shelf_life_months", "is", null)
            : Promise.resolve({ data: [] as { sku: string; shelf_life_months: number }[] }),
        ]);
        const shelfLife = Object.fromEntries(((itemRes.data ?? []) as { sku: string; shelf_life_months: number }[]).map((i) => [i.sku, Number(i.shelf_life_months)]));

        const positions = buildPositions(stock, tasks, jakartaDate());
        const expiries = buildExpiryGroups(positions, shelfLife, policy.default_shelf_life_months);
        const history = buildHistory(moves);
        const summary = buildSummary(history, positions, expiries);
        const ships = buildShipments(history, (outRes.data ?? []) as TraceOutbound[]);
        const holds = (holdsRes.data ?? []) as TraceHold[];
        // The batch as it is written in the data (the search is case-insensitive).
        const code = stock[0]?.batch_lot ?? moves[0]?.batch_lot ?? batch;
        data = {
          batch: code, skuFilter: sku, printedAt: jakartaDateTime(new Date().toISOString()),
          positions, summary, expiries, ships, destinations: buildDestinations(ships), history, tasks, holds,
          alerts: buildAlerts({ positions, summary, holds, nearDays, fmtDate: (d) => fmtDate(d) }),
        };
      } else {
        found = await findBatches(batch, sku);
      }
    } catch (e) { error = (e as Error).message; }
  }

  /** Not an exact batch code: stock whose batch, SKU, bin or description matches, and past batches by code. */
  async function findBatches(q: string, skuOnly: string) {
    const like = `%${exact(q)}%`;
    const stockQ = () => { const s = supabase.from("inventory_detail_all").select(STOCK_COLS).gt("quantity", 0); return skuOnly ? s.eq("sku", skuOnly) : s; };
    const [byBatch, bySku, byBin, byDesc, pastRes] = await Promise.all([
      fetchAll<TraceStock>((a, b) => stockQ().ilike("batch_lot", like).order("id").range(a, b)),
      fetchAll<TraceStock>((a, b) => stockQ().eq("sku", q).order("id").range(a, b)),
      fetchAll<TraceStock>((a, b) => stockQ().eq("bin_code", q.toUpperCase()).order("id").range(a, b)),
      q.length >= 3 ? fetchAll<TraceStock>((a, b) => stockQ().ilike("description", like).order("id").range(a, b)) : Promise.resolve([] as TraceStock[]),
      supabase.from("movements").select("batch_lot").ilike("batch_lot", like).limit(500),
    ]);
    const kind = byBin.length ? `bin ${q.toUpperCase()}` : bySku.length ? `SKU ${q}` : byBatch.length ? `kode batch yang memuat "${q}"` : `deskripsi yang memuat "${q}"`;
    const candidates = buildCandidates(byBin.length ? byBin : bySku.length ? bySku : byBatch.length ? byBatch : byDesc);
    const inStock = new Set(candidates.map((c) => c.batch.toUpperCase()));
    const past = [...new Set(((pastRes.data ?? []) as { batch_lot: string }[]).map((d) => d.batch_lot).filter((b) => b && !inStock.has(b.toUpperCase())))].sort().slice(0, 40);
    return { candidates, past, kind };
  }

  return (
    <main>
      <PageHeader title="Lacak batch" />
      <div className="space-y-4 p-4 lg:p-8">
        <nav aria-label="Cara melacak" className="inline-flex rounded-md border border-steel-300 bg-white text-sm">
          {([["/trace", "Lacak satu batch", !listMode], ["/trace?mode=sku", "Daftar batch per SKU", listMode]] as const).map(([href, label, on]) => (
            <Link key={href} href={href} aria-current={on ? "page" : undefined}
              className={cn("px-4 py-2 first:rounded-l-md last:rounded-r-md", on ? "bg-ckb font-semibold text-white" : "hover:bg-steel-100")}>{label}</Link>
          ))}
        </nav>

        {listMode && <SkuBatchReport />}

        {!listMode && <form className="rounded-lg border border-steel-100 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1"><Label htmlFor="batch">Batch, SKU, atau bin</Label>
              <Input id="batch" name="batch" defaultValue={batch} placeholder="mis. 29E26JJ · 550044709 · CA10A02" autoFocus={!data} required autoComplete="off" className="h-11 font-mono text-base" /></div>
            <div className="w-44"><Label htmlFor="sku">Batasi ke SKU (opsional)</Label>
              <Input id="sku" name="sku" defaultValue={sku} inputMode="numeric" placeholder="semua SKU" autoComplete="off" className="h-11" /></div>
            <Button type="submit" className="h-11"><Search className="h-4 w-4" />Lacak</Button>
          </div>
          <p className="mt-2 text-xs text-steel-500">Kode batch lengkap langsung membuka lacaknya. Sebagian kode, nomor SKU, kode bin, atau kata dari deskripsi menampilkan daftar batch yang cocok.</p>
        </form>}

        {!listMode && <RecentTraces remember={data ? { batch: data.batch, sku } : undefined} />}

        {error && <p role="alert" className="rounded-lg border border-bad/40 bg-bad/5 p-4 text-sm text-bad">Data batch tidak bisa dibaca: {error}</p>}

        {!batch && !error && !listMode && <Landing />}

        {data && <TraceView key={`${data.batch}|${sku}`} data={data} nearDays={nearDays} initialTab={sp.tab} />}

        {found && <Found q={batch} sku={sku} found={found} />}
      </div>
    </main>
  );
}

function Landing() {
  const items = [
    ["Posisi sekarang", "Setiap bin yang menyimpan batch itu, dengan tanggal expired, sisa hari, qty, yang dipesan wave, yang ditahan, dan yang tersedia."],
    ["Dikirim ke", "Shipment, tujuan, truk dan nomor order yang menerima batch itu: daftar yang dihubungi saat recall."],
    ["Riwayat", "Semua mutasi sejak batch masuk, dengan efek ke stok dan saldo berjalan."],
    ["Hold & pesanan wave", "Hold yang aktif dan tugas wave terbuka yang akan mengambil batch itu."],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([t, d]) => (
        <div key={t} className="rounded-lg border border-steel-100 bg-white p-4">
          <p className="font-cond text-lg font-semibold">{t}</p>
          <p className="mt-1 text-sm text-steel-500">{d}</p>
        </div>
      ))}
      <p className="text-sm text-steel-500 sm:col-span-2 xl:col-span-4">Semua bagian bisa diunduh ke Excel, lengkap atau per bagian. Berguna untuk recall, keluhan kualitas, dan pengecekan expired.</p>
    </div>
  );
}

function Found({ q, sku, found }: { q: string; sku: string; found: { candidates: Candidate[]; past: string[]; kind: string } }) {
  const { candidates, past, kind } = found;
  if (candidates.length === 0 && past.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-steel-300 bg-white px-4 py-8 text-center">
        <p className="font-semibold">Tidak ada yang cocok dengan &quot;{q}&quot;{sku && ` untuk SKU ${sku}`}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-steel-500">Periksa ejaan kode batch, atau coba nomor SKU, kode bin, atau sebagian kode batch.</p>
      </div>
    );
  }
  return (
    <>
      {candidates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{fmtNum(candidates.length)} batch di gudang untuk {kind}</CardTitle>
            <p className="mt-0.5 text-sm text-steel-500">Bukan kode batch lengkap. Pilih batch untuk membuka lacaknya; expired terdekat di atas.</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 md:hidden">
              {candidates.map((c) => (
                <Link key={`${c.batch}|${c.sku}`} href={c.batch ? traceHref(c.batch, c.sku) : "#"} className="block rounded-lg border border-steel-100 p-3 hover:border-ckb">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-base font-semibold text-ckb">{c.batch || "(tanpa batch)"}</span>
                    <span className="font-cond text-xl font-semibold tabular">{fmtNum(c.qty)} <span className="text-xs font-normal text-steel-500">{c.uom}</span></span>
                  </div>
                  <div className="text-xs"><b>{c.sku}</b> · {c.description}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    {c.expiries.length ? c.expiries.map((e) => <span key={e} className="whitespace-nowrap">{fmtDate(e)} <ExpiryBadge status={expiryStatus(e)} /></span>) : <ExpiryBadge status="unknown" />}
                  </div>
                  <div className="mt-1 font-mono text-xs text-steel-500">{c.bins.slice(0, 8).join(", ")}{c.bins.length > 8 ? ` +${c.bins.length - 8}` : ""}</div>
                </Link>
              ))}
            </div>
            <div className="hidden md:block">
              <Table sticky>
                <thead><tr><Th>Batch</Th><Th>SKU</Th><Th>Deskripsi</Th><Th>Produksi</Th><Th>Expired</Th><Th className="text-right">Qty</Th><Th className="text-right">Bin</Th><Th>Di bin</Th></tr></thead>
                <tbody>{candidates.map((c) => (
                  <tr key={`${c.batch}|${c.sku}`} className="hover:bg-paper">
                    <Td>{c.batch ? <Link className="font-mono font-semibold text-ckb underline" href={traceHref(c.batch, c.sku)}>{c.batch}</Link> : <span className="text-steel-500">(tanpa batch)</span>}</Td>
                    <Td className="font-semibold">{c.sku}</Td><Td className="text-xs">{c.description}</Td>
                    <Td className="whitespace-nowrap text-xs">{c.mfg ? fmtDate(c.mfg) : "–"}</Td>
                    <Td className="text-xs">{c.expiries.length ? c.expiries.map((e) => <span key={e} className="block whitespace-nowrap py-0.5">{fmtDate(e)} <ExpiryBadge status={expiryStatus(e)} /></span>) : <ExpiryBadge status="unknown" />}</Td>
                    <Td className="text-right font-semibold tabular">{fmtNum(c.qty)} <span className="text-xs font-normal text-steel-500">{c.uom}</span></Td>
                    <Td className="text-right tabular">{fmtNum(c.bins.length)}</Td>
                    <Td className="font-mono text-xs">{c.bins.slice(0, 10).join(", ")}{c.bins.length > 10 ? ` +${c.bins.length - 10}` : ""}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      {past.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Batch lain dengan kode yang mirip</CardTitle>
            <p className="mt-0.5 text-sm text-steel-500">Tercatat di riwayat mutasi; mungkin sudah tidak ada di gudang.</p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {past.map((b) => (
              <Link key={b} href={traceHref(b, sku)} className="rounded-full border border-steel-300 bg-white px-3 py-1 font-mono text-xs hover:border-ckb hover:text-ckb">{b}</Link>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
