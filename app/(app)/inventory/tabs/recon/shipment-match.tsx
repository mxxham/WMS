"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { signed } from "@/lib/sap-compare";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { SHIP_STATUS, type ReconSummary, type ShipMatch } from "./types";

const num = (v: unknown) => Number(v ?? 0) || 0;
type Key = ShipMatch["status"] | "ALL" | "DIFF";

/**
 * MB51 goods issues (601 / 602) matched to our shipments by DO number. A
 * shipment we picked but SAP has not issued yet makes our stock lower than
 * SAP's for a while; this turns those into the "GI otomatis" correction.
 */
export function ShipmentMatch({ run, rows, error, person }: { run: ReconSummary; rows: ShipMatch[]; error: string | null; person: string }) {
  const router = useRouter();
  const [key, setKey] = useState<Key>("DIFF");
  const [query, setQuery] = useState("");
  const editable = run.status === "OPEN";
  const stats = useMemo(() => {
    const s = Object.fromEntries(Object.keys(SHIP_STATUS).map((k) => [k, { n: 0, timing: 0, gi: 0 }])) as Record<ShipMatch["status"], { n: number; timing: number; gi: number }>;
    for (const r of rows) { s[r.status].n++; s[r.status].timing += num(r.timing); s[r.status].gi += num(r.sap_gi); }
    return s;
  }, [rows]);
  const timing = useMemo(() => {
    const per = new Map<string, number>();
    for (const r of rows) if (r.status !== "MATCH" && r.status !== "NOT_IN_WMS") per.set(r.sku, (per.get(r.sku) ?? 0) + num(r.timing));
    const nz = [...per.values()].filter((v) => v !== 0);
    return { skus: nz.length, qty: nz.reduce((a, b) => a + b, 0) };
  }, [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => key === "ALL" || (key === "DIFF" ? r.status !== "MATCH" : r.status === key))
      .filter((r) => !q || r.sku.includes(q) || (r.shipment_number ?? "").toLowerCase().includes(q) || (r.do_nos ?? []).some((d) => d.includes(q))
        || (r.description ?? "").toLowerCase().includes(q));
  }, [rows, key, query]);

  async function apply(): Promise<string | null> {
    const { error } = await createClient().rpc("apply_recon_auto_gi", { p_recon_id: run.id, p_by_name: person });
    if (error) return error.message;
    router.refresh();
    return null;
  }
  async function clear(): Promise<string | null> {
    const { error } = await createClient().rpc("clear_recon_auto_gi", { p_recon_id: run.id, p_by_name: person });
    if (error) return error.message;
    router.refresh();
    return null;
  }

  if (error) return <p role="alert" className="rounded-md bg-white p-4 text-sm text-bad">{error}</p>;
  if (!run.sap_moves) return <p className="rounded-md bg-white p-4 text-sm text-steel-500">Rekonsiliasi ini dibuat tanpa MB51. Upload MB52 + MB51 di rekonsiliasi baru untuk mencocokkan pengiriman dengan GI SAP.</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-steel-500">
        GI SAP (mvt 601 / 602 di MB51) dicocokkan dengan pengiriman WMS lewat nomor DO (Reference MB51 = Order No di Schedule). Yang sudah kita pick tapi belum di-GI membuat stok WMS
        sementara lebih kecil dari SAP; yang sudah di-GI SAP tapi belum kita pick membuat stok WMS lebih besar. Hanya pengiriman di tanggal MB51 yang bisa dicek.
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {(Object.keys(SHIP_STATUS) as ShipMatch["status"][]).map((k) => (
          <button key={k} type="button" onClick={() => setKey(k)} title={SHIP_STATUS[k].help}
            className={cn("rounded-lg border bg-white p-3 text-left", key === k ? "border-ckb" : "border-transparent")}>
            <div className="text-xs text-steel-500">{SHIP_STATUS[k].label}</div>
            <div className="font-cond text-2xl font-semibold tabular">{fmtNum(stats[k].n)}</div>
            <div className="text-xs tabular text-steel-500">{k === "NOT_IN_WMS" || k === "MATCH" ? `GI ${fmtNum(stats[k].gi)}` : `timing ${signed(stats[k].timing)}`}</div>
          </button>
        ))}
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-white p-3">
          <div className="flex-1 text-sm">
            {timing.skus
              ? <>Koreksi timing dari pengiriman: <b>{fmtNum(timing.skus)} SKU</b>, total <b>{signed(timing.qty)}</b> karton.</>
              : "Tidak ada koreksi timing dari pengiriman."}
            {run.auto_gi_at && <span className="block text-xs text-steel-500">Sudah dipakai {fmtDateTime(run.auto_gi_at)} oleh {run.auto_gi_by_name}.</span>}
          </div>
          {timing.skus > 0 && (
            <ConfirmButton title="Pakai koreksi GI otomatis" confirmLabel="Pakai"
              summary={`Isi kolom GI otomatis untuk ${fmtNum(timing.skus)} SKU (total ${signed(timing.qty)} karton) dari pencocokan pengiriman. Selisih SKU dihitung ulang; isian GI otomatis sebelumnya diganti.`}
              extra={<p className="text-xs text-steel-500">DO yang tidak ada di WMS tidak dihitung: bisa jadi dikirim dari luar WMS.</p>}
              onConfirm={apply} disabled={person.trim().length < 2}>{run.auto_gi_at ? "Hitung ulang koreksi" : "Pakai sebagai koreksi timing"}</ConfirmButton>
          )}
          {run.auto_gi_at && (
            <ConfirmButton variant="outline" title="Hapus koreksi GI otomatis" confirmLabel="Hapus" summary="Kolom GI otomatis semua SKU dikembalikan ke 0. Selisih dihitung tanpa koreksi pengiriman."
              onConfirm={clear} disabled={person.trim().length < 2}>Hapus koreksi</ConfirmButton>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {([["DIFF", "Tidak cocok"], ["ALL", "Semua"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKey(k)} className={cn("rounded-md border px-3 py-1.5 text-sm", key === k ? "border-ckb bg-ckb text-white" : "border-steel-300 bg-white")}>{l}</button>
          ))}
        </div>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-steel-400" />
          <Input aria-label="Cari pengiriman" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari SKU / shipment / DO" />
        </div>
      </div>

      {shown.length === 0 ? <p className="rounded-md bg-white p-4 text-sm text-ok">Tidak ada baris untuk filter ini.</p> : (
        <>
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <thead><tr><Th>Status</Th><Th>Shipment</Th><Th>SKU</Th><Th>DO</Th><Th className="text-right">GI SAP</Th><Th className="text-right">Order</Th>
                  <Th className="text-right">Dipick</Th><Th className="text-right">Timing</Th><Th>Pick terakhir</Th></tr></thead>
                <tbody>{shown.map((r, i) => (
                  <tr key={i}>
                    <Td><span className={cn("rounded px-2 py-0.5 text-xs font-semibold", SHIP_STATUS[r.status].tone)}>{SHIP_STATUS[r.status].label}</span></Td>
                    <Td className="text-xs">{r.shipment_number ?? "–"}{r.wave_no && <div className="text-steel-500">Wave {r.wave_no} · {fmtDate(r.planned_date)}</div>}</Td>
                    <Td><b>{r.sku}</b><div className="max-w-64 truncate text-xs">{r.description}</div></Td>
                    <Td className="text-xs">{(r.do_nos ?? []).join(", ")}</Td>
                    <Td className="text-right tabular">{fmtNum(num(r.sap_gi))}</Td>
                    <Td className="text-right tabular">{r.status === "NOT_IN_WMS" ? "–" : fmtNum(num(r.ordered))}</Td>
                    <Td className="text-right tabular">{r.status === "NOT_IN_WMS" ? "–" : fmtNum(num(r.picked))}</Td>
                    <Td className={cn("text-right font-semibold tabular", num(r.timing) !== 0 && "text-warn")}>{num(r.timing) ? signed(num(r.timing)) : "–"}</Td>
                    <Td className="text-xs">{fmtDateTime(r.last_pick)}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            </CardContent>
          </Card>
          <div className="space-y-2 md:hidden">
            {shown.map((r, i) => (
              <div key={i} className="rounded-lg border border-steel-200 bg-white p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><b>{r.sku}</b><div className="truncate text-xs">{r.description}</div></div>
                  <span className={cn("shrink-0 rounded px-2 py-0.5 text-xs font-semibold", SHIP_STATUS[r.status].tone)}>{SHIP_STATUS[r.status].label}</span>
                </div>
                <div className="mt-1 text-xs text-steel-500">{r.shipment_number ? `Shipment ${r.shipment_number}` : "Tidak ada di WMS"} · DO {(r.do_nos ?? []).join(", ")}</div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                  <div className="rounded bg-paper p-1">GI SAP<div className="font-semibold tabular">{fmtNum(num(r.sap_gi))}</div></div>
                  <div className="rounded bg-paper p-1">Dipick<div className="font-semibold tabular">{fmtNum(num(r.picked))}</div></div>
                  <div className="rounded bg-paper p-1">Timing<div className="font-semibold tabular">{num(r.timing) ? signed(num(r.timing)) : "–"}</div></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
