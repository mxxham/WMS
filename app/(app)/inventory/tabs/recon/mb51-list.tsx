"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { mvtLabel, signed } from "@/lib/sap-compare";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import type { SapMove } from "./types";

const num = (v: unknown) => Number(v ?? 0) || 0;

/** The MB51 lines kept with this reconciliation, as SAP sent them. */
export function Mb51List({ moves }: { moves: SapMove[] }) {
  const [type, setType] = useState("");
  const [sloc, setSloc] = useState("");
  const [query, setQuery] = useState("");
  const types = useMemo(() => {
    const m = new Map<string, { text: string; lines: number; inQty: number; outQty: number; skus: Set<string> }>();
    for (const x of moves) {
      const e = m.get(x.mvt_type) ?? { text: x.mvt_text ?? "", lines: 0, inQty: 0, outQty: 0, skus: new Set<string>() };
      e.lines++; e.skus.add(x.sku);
      if (num(x.quantity) > 0) e.inQty += num(x.quantity); else e.outQty += num(x.quantity);
      m.set(x.mvt_type, e);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [moves]);
  const slocs = useMemo(() => [...new Set(moves.map((m) => m.sloc))].sort(), [moves]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return moves.filter((m) => (!type || m.mvt_type === type) && (!sloc || m.sloc === sloc))
      .filter((m) => !q || m.sku.includes(q) || (m.description ?? "").toLowerCase().includes(q) || (m.mat_doc ?? "").includes(q)
        || (m.reference ?? "").includes(q) || (m.customer_name ?? "").toLowerCase().includes(q));
  }, [moves, type, sloc, query]);

  if (!moves.length) return <p className="rounded-md bg-white p-4 text-sm text-steel-500">Rekonsiliasi ini dibuat tanpa MB51.</p>;
  const total = shown.reduce((s, m) => s + num(m.quantity), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Per jenis transaksi</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <thead><tr><Th>Mvt</Th><Th>Arti</Th><Th className="text-right">Baris</Th><Th className="text-right">SKU</Th><Th className="text-right">Masuk</Th><Th className="text-right">Keluar</Th></tr></thead>
            <tbody>{types.map(([t, v]) => (
              <tr key={t} className={cn("cursor-pointer hover:bg-paper", type === t && "bg-ckb/10")} onClick={() => setType(type === t ? "" : t)}>
                <Td className="font-semibold">{t}</Td><Td className="text-xs">{mvtLabel(t)}{v.text && <div className="text-steel-500">{v.text}</div>}</Td>
                <Td className="text-right tabular">{fmtNum(v.lines)}</Td><Td className="text-right tabular">{fmtNum(v.skus.size)}</Td>
                <Td className="text-right tabular text-ok">{v.inQty ? `+${fmtNum(v.inQty)}` : "–"}</Td><Td className="text-right tabular text-bad">{v.outQty ? fmtNum(v.outQty) : "–"}</Td>
              </tr>
            ))}</tbody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-steel-400" />
          <Input aria-label="Cari transaksi" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari SKU / dokumen / DO / pelanggan" />
        </div>
        <Select aria-label="Jenis transaksi" value={type} onChange={(e) => setType(e.target.value)} className="w-52">
          <option value="">Semua jenis</option>{types.map(([t]) => <option key={t} value={t}>{t} {mvtLabel(t)}</option>)}
        </Select>
        <Select aria-label="Storage location" value={sloc} onChange={(e) => setSloc(e.target.value)} className="w-36">
          <option value="">Semua lokasi</option>{slocs.map((s) => <option key={s} value={s}>{s || "(kosong)"}</option>)}
        </Select>
        <span className="pb-2 text-sm text-steel-500">{fmtNum(shown.length)} baris · net {signed(total)}</span>
      </div>

      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <thead><tr><Th>Posting</Th><Th>Lok</Th><Th>Mvt</Th><Th>SKU</Th><Th className="text-right">Qty</Th><Th>Dokumen</Th><Th>Ref / DO</Th><Th>Pelanggan</Th><Th>User</Th></tr></thead>
            <tbody>{shown.map((m) => (
              <tr key={m.line_no}>
                <Td className="whitespace-nowrap text-xs">{fmtDate(m.posting_date)}</Td><Td className="text-xs">{m.sloc}</Td>
                <Td className="text-xs"><b>{m.mvt_type}</b> {mvtLabel(m.mvt_type)}</Td>
                <Td><b>{m.sku}</b><div className="max-w-64 truncate text-xs">{m.description}</div></Td>
                <Td className={cn("text-right font-semibold tabular", num(m.quantity) < 0 ? "text-bad" : "text-ok")}>{signed(num(m.quantity))} <span className="text-xs font-normal text-steel-500">{m.uom}</span></Td>
                <Td className="text-xs">{m.mat_doc}</Td><Td className="text-xs">{m.reference}</Td>
                <Td className="text-xs">{m.customer_name}{m.customer && <div className="text-steel-500">{m.customer}</div>}</Td><Td className="text-xs">{m.user_name}</Td>
              </tr>
            ))}</tbody>
          </Table>
        </CardContent>
      </Card>
      <div className="space-y-2 md:hidden">
        {shown.map((m) => (
          <div key={m.line_no} className="rounded-lg border border-steel-200 bg-white p-3 text-sm">
            <div className="flex justify-between gap-2"><b>{m.sku}</b><span className={cn("font-semibold tabular", num(m.quantity) < 0 ? "text-bad" : "text-ok")}>{signed(num(m.quantity))} {m.uom}</span></div>
            <div className="truncate text-xs">{m.description}</div>
            <div className="mt-1 text-xs text-steel-500">{fmtDate(m.posting_date)} · {m.sloc} · {m.mvt_type} {mvtLabel(m.mvt_type)}{m.reference && ` · DO ${m.reference}`}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
