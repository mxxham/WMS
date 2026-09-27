import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpiryBadge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { expiryStatus } from "@/config/warehouse";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { TraceExport, type TraceExportData } from "./trace-export";

export const dynamic = "force-dynamic";

type Mv = {
  id: string; type: string; quantity: number; batch_lot: string; expiry_date: string | null; created_at: string; note: string | null;
  items: { sku: string; description: string; uom: string | null } | null;
  from_bin: { bin_code: string } | null; to_bin: { bin_code: string } | null; profiles: { name: string } | null;
  pick_tasks: { shipment_number: string | null; waves: { wave_no: string; planned_date: string; truck: string | null } | null } | null;
};
type Inv = { bin_code: string; zone: string; sku: string; description: string; uom: string | null; batch_lot: string; quantity: number; expiry_date: string | null; received_date: string | null; bin_status: string };
type Outbound = { shipment_number: string; sku: string; destination: string; truck: string | null; order_nos: string[] };

const TYPE_LABEL: Record<string, string> = { inbound: "Terima", putaway: "Putaway", picking: "Pick", transfer: "Transfer", adjustment: "Adjust" };
/** ILIKE pattern for an exact, case-insensitive match (escape the wildcards). */
const exact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Batch traceability: where a batch is now, which shipments / customers it
 * went to, where it came from, and every movement of it (the ledger).
 */
export default async function TracePage({ searchParams }: { searchParams: Promise<{ batch?: string; sku?: string }> }) {
  await requireRole(["supervisor", "admin"]);
  const sp = await searchParams;
  const batch = (sp.batch ?? "").trim();
  const sku = (sp.sku ?? "").trim();
  const supabase = await createClient();

  let moves: Mv[] = [], inv: Inv[] = [], outbound: Outbound[] = [], similar: string[] = [];
  if (batch) {
    [moves, inv] = await Promise.all([
      fetchAll<Mv>((a, b) => {
        let q = supabase.from("movements")
          .select("id, type, quantity, batch_lot, expiry_date, created_at, note, items!inner(sku, description, uom), from_bin:bins!movements_from_bin_id_fkey(bin_code), to_bin:bins!movements_to_bin_id_fkey(bin_code), profiles(name), pick_tasks(shipment_number, waves(wave_no, planned_date, truck))")
          .ilike("batch_lot", exact(batch));
        if (sku) q = q.eq("items.sku", sku);
        return q.order("created_at").order("id").range(a, b);
      }),
      fetchAll<Inv>((a, b) => {
        let q = supabase.from("inventory_detail").select("bin_code, zone, sku, description, uom, batch_lot, quantity, expiry_date, received_date, bin_status").ilike("batch_lot", exact(batch));
        if (sku) q = q.eq("sku", sku);
        return q.order("sku").order("bin_code").range(a, b);
      }),
    ]);
    const shipments = [...new Set(moves.map((m) => m.pick_tasks?.shipment_number).filter((s): s is string => !!s))];
    if (shipments.length) {
      const { data } = await supabase.from("outbound").select("shipment_number, sku, destination, truck, order_nos").in("shipment_number", shipments);
      outbound = (data ?? []) as Outbound[];
    }
    if (moves.length === 0 && inv.length === 0) {
      const { data } = await supabase.from("movements").select("batch_lot").ilike("batch_lot", `%${exact(batch)}%`).limit(200);
      similar = [...new Set((data ?? []).map((d) => d.batch_lot as string))].slice(0, 20);
    }
  }

  // ---- Summary per SKU ------------------------------------------------------
  type Sum = { sku: string; description: string; uom: string | null; opening: number; received: number; shipped: number; adjusted: number; internal: number; onHand: number };
  const sums = new Map<string, Sum>();
  const sum = (s: string, d: string, u: string | null) => {
    let e = sums.get(s);
    if (!e) { e = { sku: s, description: d, uom: u, opening: 0, received: 0, shipped: 0, adjusted: 0, internal: 0, onHand: 0 }; sums.set(s, e); }
    return e;
  };
  for (const m of moves) {
    const e = sum(m.items!.sku, m.items!.description, m.items!.uom);
    const q = Number(m.quantity);
    if (m.type === "picking") e.shipped += q;
    else if (m.type === "inbound" || (m.type === "putaway" && !m.from_bin)) e.received += q;
    else if (m.type === "adjustment" && m.note?.startsWith("OPENING BALANCE")) e.opening += q;
    else if (m.type === "adjustment") e.adjusted += q;
    else e.internal += q;
  }
  for (const r of inv) sum(r.sku, r.description, r.uom).onHand += Number(r.quantity);

  // ---- Where it went: pick movements grouped per shipment + SKU ---------------
  const outBy = new Map(outbound.map((o) => [`${o.shipment_number}|${o.sku}`, o]));
  type Ship = { shipment: string; sku: string; date: string; wave: string; destination: string; truck: string | null; orders: string; qty: number; bins: Set<string>; last: string };
  const ships = new Map<string, Ship>();
  for (const m of moves.filter((x) => x.type === "picking")) {
    const sh = m.pick_tasks?.shipment_number ?? "(pick manual)";
    const k = `${sh}|${m.items!.sku}`;
    const o = outBy.get(k);
    const e = ships.get(k) ?? {
      shipment: sh, sku: m.items!.sku, date: m.pick_tasks?.waves?.planned_date ?? m.created_at.slice(0, 10),
      wave: m.pick_tasks?.waves?.wave_no ?? "–", destination: o?.destination ?? "–", truck: o?.truck ?? m.pick_tasks?.waves?.truck ?? null,
      orders: o?.order_nos?.join(", ") ?? "", qty: 0, bins: new Set<string>(), last: m.created_at,
    };
    e.qty += Number(m.quantity);
    if (m.from_bin) e.bins.add(m.from_bin.bin_code);
    if (m.created_at > e.last) e.last = m.created_at;
    ships.set(k, e);
  }
  const shipRows = [...ships.values()].sort((a, b) => b.last.localeCompare(a.last));
  const customers = new Set(shipRows.map((s) => s.destination).filter((d) => d !== "–")).size;

  const exportData: TraceExportData = {
    batch,
    summary: [...sums.values()].map((s) => ({ SKU: s.sku, Deskripsi: s.description, "Saldo awal": s.opening, Diterima: s.received, Dikirim: s.shipped, Penyesuaian: s.adjusted, "Stok sekarang": s.onHand })),
    shipments: shipRows.map((s) => ({ Shipment: s.shipment, SKU: s.sku, Tanggal: s.date, Wave: s.wave, Tujuan: s.destination, Truk: s.truck ?? "", "No order": s.orders, Qty: s.qty, "Dari bin": [...s.bins].join(", ") })),
    locations: inv.map((r) => ({ Bin: r.bin_code, SKU: r.sku, Batch: r.batch_lot, Expired: r.expiry_date ?? "", Qty: Number(r.quantity), "Tgl terima": r.received_date ?? "" })),
    history: moves.map((m) => ({ Waktu: m.created_at, Jenis: TYPE_LABEL[m.type] ?? m.type, SKU: m.items!.sku, Batch: m.batch_lot, Qty: Number(m.quantity), Dari: m.from_bin?.bin_code ?? "", Ke: m.to_bin?.bin_code ?? "", Shipment: m.pick_tasks?.shipment_number ?? "", Oleh: m.profiles?.name ?? "", Catatan: m.note ?? "" })),
  };

  return (
    <main>
      <PageHeader title="Lacak batch" />
      <div className="space-y-6 p-4 lg:p-8">
        <form className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4">
          <div className="min-w-48 flex-1"><Label htmlFor="batch">Batch</Label><Input id="batch" name="batch" defaultValue={batch} placeholder="mis. 29E26JJ" autoFocus required /></div>
          <div className="w-44"><Label htmlFor="sku">SKU (opsional)</Label><Input id="sku" name="sku" defaultValue={sku} inputMode="numeric" placeholder="semua SKU" /></div>
          <Button type="submit">Lacak</Button>
          {(moves.length > 0 || inv.length > 0) && <TraceExport data={exportData} />}
        </form>

        {!batch && <p className="text-sm text-steel-500">Masukkan kode batch untuk melihat di mana batch itu sekarang, ke shipment/customer mana saja sudah dikirim, dan seluruh riwayat mutasinya. Berguna untuk recall atau keluhan kualitas.</p>}

        {batch && moves.length === 0 && inv.length === 0 && (
          <div className="rounded-lg bg-white p-4 text-sm">
            <p>Batch <b>{batch}</b>{sku && ` untuk SKU ${sku}`} tidak ditemukan.</p>
            {similar.length > 0 && <p className="mt-2">Mungkin maksudnya: {similar.map((b, i) => <span key={b}>{i > 0 && ", "}<Link className="underline" href={`/trace?batch=${encodeURIComponent(b)}${sku ? `&sku=${sku}` : ""}`}>{b}</Link></span>)}</p>}
          </div>
        )}

        {(moves.length > 0 || inv.length > 0) && (
          <>
            <Card>
              <CardHeader><CardTitle>Ringkasan batch {batch}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Table>
                  <thead><tr><Th>SKU</Th><Th>Deskripsi</Th><Th className="text-right">Saldo awal</Th><Th className="text-right">Diterima</Th><Th className="text-right">Dikirim</Th><Th className="text-right">Penyesuaian</Th><Th className="text-right">Stok sekarang</Th></tr></thead>
                  <tbody>{[...sums.values()].map((s) => (
                    <tr key={s.sku}>
                      <Td className="font-semibold">{s.sku}</Td><Td className="text-xs">{s.description}</Td>
                      <Td className="text-right tabular">{fmtNum(s.opening)}</Td><Td className="text-right tabular">{fmtNum(s.received)}</Td>
                      <Td className="text-right tabular">{fmtNum(s.shipped)}</Td>
                      <Td className="text-right tabular">{s.adjusted > 0 ? "+" : ""}{fmtNum(s.adjusted)}</Td>
                      <Td className="text-right font-semibold tabular">{fmtNum(s.onHand)} <span className="text-xs font-normal text-steel-500">{s.uom}</span></Td>
                    </tr>
                  ))}</tbody>
                </Table>
                <p className="text-sm">Dikirim ke <b>{fmtNum(shipRows.filter((s) => s.shipment !== "(pick manual)").length)}</b> shipment · <b>{fmtNum(customers)}</b> tujuan. Saat ini ada di <b>{fmtNum(new Set(inv.map((r) => r.bin_code)).size)}</b> bin.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Dikirim ke (shipment &amp; tujuan)</CardTitle></CardHeader>
              <CardContent>
                {shipRows.length === 0 ? <p className="text-sm text-steel-500">Batch ini belum pernah dipick untuk shipment.</p> : (
                  <Table>
                    <thead><tr><Th>Shipment</Th><Th>SKU</Th><Th>Tanggal</Th><Th>Wave</Th><Th>Tujuan</Th><Th>Truk</Th><Th>No order</Th><Th className="text-right">Qty</Th><Th>Dari bin</Th></tr></thead>
                    <tbody>{shipRows.map((s) => (
                      <tr key={`${s.shipment}|${s.sku}`}>
                        <Td className="font-semibold">{s.shipment}</Td><Td>{s.sku}</Td><Td className="whitespace-nowrap">{fmtDate(s.date)}</Td>
                        <Td>{s.wave !== "–" ? <Link className="underline" href={`/waves?date=${s.date}`}>NO {s.wave}</Link> : "–"}</Td>
                        <Td>{s.destination}</Td><Td>{s.truck ?? "–"}</Td><Td className="text-xs">{s.orders || "–"}</Td>
                        <Td className="text-right tabular">{fmtNum(s.qty)}</Td><Td className="text-xs">{[...s.bins].join(", ")}</Td>
                      </tr>
                    ))}</tbody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Posisi sekarang</CardTitle></CardHeader>
              <CardContent>
                {inv.length === 0 ? <p className="text-sm text-steel-500">Tidak ada stok batch ini di gudang.</p> : (
                  <Table>
                    <thead><tr><Th>Bin</Th><Th>SKU</Th><Th>Deskripsi</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Qty</Th><Th>Terima</Th></tr></thead>
                    <tbody>{inv.map((r, i) => (
                      <tr key={i}>
                        <Td><Link className="font-semibold underline" href={`/bin/${encodeURIComponent(r.bin_code)}`}>{r.bin_code}</Link>{r.bin_status === "blocked" && <span className="ml-1 text-xs text-bad">diblokir</span>}</Td>
                        <Td>{r.sku}</Td><Td className="text-xs">{r.description}</Td><Td>{r.batch_lot}</Td>
                        <Td className="whitespace-nowrap text-xs">{fmtDate(r.expiry_date)} <ExpiryBadge status={expiryStatus(r.expiry_date)} /></Td>
                        <Td className="text-right tabular">{fmtNum(Number(r.quantity))} {r.uom}</Td><Td className="text-xs">{fmtDate(r.received_date)}</Td>
                      </tr>
                    ))}</tbody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Riwayat lengkap ({fmtNum(moves.length)} mutasi)</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <thead><tr><Th>Waktu</Th><Th>Jenis</Th><Th>SKU</Th><Th className="text-right">Qty</Th><Th>Dari</Th><Th>Ke</Th><Th>Shipment</Th><Th>Oleh</Th><Th>Catatan</Th></tr></thead>
                  <tbody>{[...moves].reverse().map((m) => (
                    <tr key={m.id}>
                      <Td className="whitespace-nowrap text-xs">{fmtDateTime(m.created_at)}</Td><Td>{TYPE_LABEL[m.type] ?? m.type}</Td><Td>{m.items?.sku}</Td>
                      <Td className="text-right tabular">{Number(m.quantity) > 0 && m.type === "adjustment" ? "+" : ""}{fmtNum(Number(m.quantity))}</Td>
                      <Td>{m.from_bin?.bin_code ?? "–"}</Td><Td>{m.to_bin?.bin_code ?? "–"}</Td><Td>{m.pick_tasks?.shipment_number ?? "–"}</Td>
                      <Td className="text-xs">{m.profiles?.name ?? "sistem"}</Td><Td className="text-xs">{m.note ?? ""}</Td>
                    </tr>
                  ))}</tbody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
