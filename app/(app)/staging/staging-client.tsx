"use client";
import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { isLong, movable, waitLabel, STAGING_LONG_DAYS, type StagingLine } from "@/lib/staging";
import { cn, fmtDate, fmtNum } from "@/lib/utils";
import { MoveDialog } from "./move-dialog";

const keyOf = (l: StagingLine) => `${l.bin_code}|${l.item_id}|${l.batch_lot}|${l.expiry_date ?? ""}`;

function Plate({ code }: { code: string }) {
  return <span className="inline-block rounded-plate bg-plate px-2 py-0.5 font-cond text-base font-bold leading-tight text-steel">{code}</span>;
}

function Waiting({ l }: { l: StagingLine }) {
  return (
    <span className={cn("text-sm", isLong(l.days_waiting) && "font-semibold text-warn")}>
      {l.arrival_date ? `${fmtDate(l.arrival_date)} · ` : ""}{waitLabel(l.days_waiting)}
    </span>
  );
}

export function StagingClient({ lines }: { lines: StagingLine[] }) {
  const [q, setQ] = useState("");
  const [moving, setMoving] = useState<StagingLine | null>(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return lines;
    return lines.filter((l) => [l.sku, l.description, l.batch_lot].some((v) => (v ?? "").toLowerCase().includes(s)));
  }, [lines, q]);
  const total = lines.reduce((a, l) => a + l.quantity, 0);
  const long = lines.filter((l) => isLong(l.days_waiting)).length;

  const moveButton = (l: StagingLine, className?: string) => (
    <Button size="sm" className={className} disabled={movable(l) === 0} onClick={() => setMoving(l)}
      title={movable(l) === 0 ? "Semua qty dipesan wave" : undefined}>
      Pindah ke rak<ArrowRight className="h-4 w-4" />
    </Button>
  );

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="py-3"><p className="text-xs text-steel-500">Baris</p><p className="font-cond text-2xl font-semibold tabular">{fmtNum(lines.length)}</p></CardContent></Card>
        <Card><CardContent className="py-3"><p className="text-xs text-steel-500">Total qty</p><p className="font-cond text-2xl font-semibold tabular">{fmtNum(total)}</p></CardContent></Card>
        <Card><CardContent className="py-3"><p className="text-xs text-steel-500">{STAGING_LONG_DAYS}+ hari</p>
          <p className={cn("font-cond text-2xl font-semibold tabular", long > 0 && "text-warn")}>{fmtNum(long)}</p></CardContent></Card>
      </div>

      {lines.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-steel-500">Tidak ada barang di staging.</CardContent></Card>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-400" />
            <Input aria-label="Cari SKU, deskripsi atau batch" placeholder="Cari SKU, deskripsi, batch" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {/* Phone: one card per line, oldest first. */}
          <div className="flex flex-col gap-3 md:hidden">
            {shown.map((l) => (
              <Card key={keyOf(l)} className={cn(isLong(l.days_waiting) && "border-l-4 border-l-warn")}>
                <CardContent className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{l.sku}</p>
                      <p className="truncate text-sm text-steel-500">{l.description}</p>
                    </div>
                    <Plate code={l.bin_code} />
                  </div>
                  <p className="text-sm">Batch {l.batch_lot || "–"} · exp {fmtDate(l.expiry_date)}</p>
                  <p className="text-sm"><b className="tabular">{fmtNum(l.quantity)}</b> {l.uom}
                    {l.reserved > 0 && <span className="text-steel-500"> · {fmtNum(l.reserved)} dipesan wave</span>}</p>
                  <div className="flex items-center justify-between gap-3">
                    <Waiting l={l} />
                    {moveButton(l)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop: a table. */}
          <Card className="hidden md:block">
            <CardContent>
              <Table>
                <thead><tr><Th>Lokasi</Th><Th>SKU</Th><Th>Deskripsi</Th><Th>Batch</Th><Th>Expired</Th><Th className="text-right">Qty</Th><Th>Datang · menunggu</Th><Th /></tr></thead>
                <tbody>{shown.map((l) => (
                  <tr key={keyOf(l)} className={cn(isLong(l.days_waiting) && "bg-warn/10")}>
                    <Td><Plate code={l.bin_code} /></Td>
                    <Td className="font-semibold">{l.sku}</Td>
                    <Td className="max-w-xs truncate">{l.description}</Td>
                    <Td>{l.batch_lot || "–"}</Td>
                    <Td>{fmtDate(l.expiry_date)}</Td>
                    <Td className="text-right tabular">{fmtNum(l.quantity)} {l.uom}
                      {l.reserved > 0 && <span className="block text-xs text-steel-500">{fmtNum(l.reserved)} dipesan wave</span>}</Td>
                    <Td><Waiting l={l} /></Td>
                    <Td className="text-right">{moveButton(l)}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            </CardContent>
          </Card>
          {shown.length === 0 && <p className="text-sm text-steel-500">Tidak ada baris yang cocok dengan &quot;{q}&quot;.</p>}
        </>
      )}

      <MoveDialog line={moving} onClose={() => setMoving(null)} />
    </>
  );
}
