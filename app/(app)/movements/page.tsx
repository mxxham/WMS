import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { movementQuery, type MovementFilters } from "@/lib/movement-query";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import type { Movement } from "@/lib/types";
import { REASON_CODES, type ReasonCode } from "@/lib/inventory-control";
import { fmtNum, cn } from "@/lib/utils";
import { jakartaDateTime } from "@/lib/trace";
import { MOVEMENT_LABEL, QUICK_RANGES, fmtDay, movementEffect, parsePage, quickRange, splitPage, validDay } from "@/lib/movement-view";

export const dynamic = "force-dynamic";
const TYPES = Object.keys(MOVEMENT_LABEL);
const PAGE = 100;

type Row = Movement & { expiry_date: string | null; items: { sku: string; description: string; uom: string | null } | null };

const EFFECT_TONE = { in: "text-ok", out: "text-bad", move: "text-steel-500" } as const;
const TYPE_TONE: Record<string, string> = {
  inbound: "bg-ok/15 text-ok", picking: "bg-bad/10 text-bad", adjustment: "bg-warn/20 text-steel-700",
};

/** `+120`, `−48`, or `120` for a move between bins, coloured by what it does to the stock total. */
function Qty({ m }: { m: Row }) {
  const { effect, signed } = movementEffect(m.type, Number(m.quantity));
  const text = effect === "move" ? fmtNum(Number(m.quantity)) : `${signed > 0 ? "+" : "−"}${fmtNum(Math.abs(signed))}`;
  return <span className={cn("font-semibold", EFFECT_TONE[effect])}>{text} <span className="font-normal text-steel-500">{m.items?.uom}</span></span>;
}
const TypeBadge = ({ type }: { type: string }) => <Badge className={TYPE_TONE[type]}>{MOVEMENT_LABEL[type] ?? type}</Badge>;
const Route = ({ m }: { m: Row }) => <>{m.from_bin?.bin_code ?? "–"} → {m.to_bin?.bin_code ?? "–"}</>;
const reasonOf = (m: Row) => (m.reason_code ? REASON_CODES[m.reason_code as ReasonCode] ?? m.reason_code : null);
const whoOf = (m: Row) => m.by_name ?? m.profiles?.name ?? "–";

export default async function MovementsPage({ searchParams }: { searchParams: Promise<MovementFilters & { page?: string }> }) {
  await requirePage("/movements");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const supabase = await createClient();
  const build = await movementQuery(supabase, sp);
  // One extra row tells whether a next page really exists.
  const res = build ? await build(page * PAGE, page * PAGE + PAGE) : { data: [], error: null };
  const { shown: rows, hasNext } = splitPage((res.data ?? []) as unknown as Row[], PAGE);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);
  const link = (p: number) => `/movements?${qs}${p ? `${qs.size ? "&" : ""}page=${p}` : ""}`;
  const ranged = Boolean(validDay(sp.from) || validDay(sp.to));
  const first = page * PAGE + 1;

  return (
    <main>
      <PageHeader title="Riwayat mutasi" live={["movements"]}>
        <Button asChild variant="outline"><a href={`/api/movements/export?${qs}`}>Export .xlsx</a></Button>
      </PageHeader>
      <div className="space-y-4 p-4 lg:p-8">
        {/* Plain GET form: filters live in the URL, so a filtered view can be shared or bookmarked */}
        <form className="grid grid-cols-2 gap-3 rounded-lg bg-white p-4 md:grid-cols-4 xl:grid-cols-8">
          <div><Label htmlFor="from">Dari</Label><Input id="from" name="from" type="date" defaultValue={sp.from} /></div>
          <div><Label htmlFor="to">Sampai</Label><Input id="to" name="to" type="date" defaultValue={sp.to} /></div>
          <div><Label htmlFor="type">Jenis</Label><Select id="type" name="type" defaultValue={sp.type ?? ""}><option value="">Semua</option>{TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}</Select></div>
          <div><Label htmlFor="bin">Bin</Label><Input id="bin" name="bin" defaultValue={sp.bin} placeholder="CA01C01" /></div>
          <div><Label htmlFor="sku">SKU</Label><Input id="sku" name="sku" defaultValue={sp.sku} /></div>
          <div><Label htmlFor="reason">Alasan</Label><Select id="reason" name="reason" defaultValue={sp.reason ?? ""}><option value="">Semua</option>{Object.entries(REASON_CODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          <div><Label htmlFor="person">Orang</Label><Input id="person" name="person" defaultValue={sp.person} placeholder="nama" /></div>
          <div className="flex items-end gap-2"><Button type="submit" className="flex-1">Terapkan</Button><Button asChild variant="ghost"><a href="/movements">Reset</a></Button></div>
        </form>

        {/* Quick ranges keep the other filters and only swap the dates. */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-steel-500">Rentang cepat:</span>
          {QUICK_RANGES.map((r) => {
            const { from, to } = quickRange(r.days);
            const next = new URLSearchParams(qs); next.set("from", from); next.set("to", to);
            const active = sp.from === from && sp.to === to;
            return (
              <a key={r.label} href={`/movements?${next}`} aria-current={active ? "true" : undefined}
                className={cn("rounded-full border px-3 py-1", active ? "border-steel bg-steel text-white" : "border-steel-300 bg-white hover:bg-steel-100")}>{r.label}</a>
            );
          })}
          {!ranged && <span className="text-xs text-steel-500">Semua waktu. Export tanpa rentang hanya memuat 30 hari terakhir.</span>}
        </div>

        {!build && <p className="text-sm text-bad">Bin atau SKU pada filter tidak ditemukan.</p>}
        {res.error && <p className="text-sm text-bad">Gagal memuat mutasi: {res.error.message}</p>}

        {/* Desktop: the ledger table. */}
        <div className="hidden rounded-lg bg-white md:block">
          <Table>
            <thead><tr><Th>Waktu</Th><Th>Jenis</Th><Th>SKU</Th><Th>Batch · expired</Th><Th className="text-right">Qty</Th><Th>Dari → Ke</Th><Th>Alasan · catatan</Th><Th>Oleh</Th></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap">{jakartaDateTime(m.created_at)}</Td>
                <Td><TypeBadge type={m.type} /></Td>
                <Td title={m.items?.description}>{m.items?.sku}<div className="max-w-[16rem] truncate text-xs text-steel-500">{m.items?.description}</div></Td>
                <Td>{m.batch_lot || "–"}<div className="text-xs text-steel-500">{fmtDay(m.expiry_date)}</div></Td>
                <Td className="whitespace-nowrap text-right"><Qty m={m} /></Td>
                <Td className="whitespace-nowrap"><Route m={m} /></Td>
                <Td className="text-xs">{reasonOf(m) && <b>{reasonOf(m)}{m.note ? " · " : ""}</b>}{m.note}</Td>
                <Td className="text-xs">{whoOf(m)}{m.approved_by_name && m.approved_by_name !== m.by_name && <div>disetujui {m.approved_by_name}</div>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        </div>

        {/* Phone: one card per movement, as the rest of the app does. */}
        <ul className="space-y-2 md:hidden">
          {rows.map((m) => (
            <li key={m.id} className="rounded-lg bg-white p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><TypeBadge type={m.type} /><Qty m={m} /></div>
              <div className="mt-2 font-semibold">{m.items?.sku} <span className="font-normal text-steel-500">{m.items?.description}</span></div>
              <div className="text-xs text-steel-500">Batch {m.batch_lot || "–"} · exp {fmtDay(m.expiry_date)}</div>
              <div className="mt-1"><Route m={m} /></div>
              {(reasonOf(m) || m.note) && <div className="mt-1 text-xs">{reasonOf(m) && <b>{reasonOf(m)}{m.note ? " · " : ""}</b>}{m.note}</div>}
              <div className="mt-1 text-xs text-steel-500">{jakartaDateTime(m.created_at)} · {whoOf(m)}{m.approved_by_name && m.approved_by_name !== m.by_name && ` · disetujui ${m.approved_by_name}`}</div>
            </li>
          ))}
        </ul>

        {rows.length === 0 && build && !res.error && <p className="rounded-lg bg-white p-4 text-sm text-steel-500">Tidak ada mutasi untuk filter ini.</p>}
        <div className="flex items-center justify-between text-sm">
          {page > 0 ? <a className="underline" href={link(page - 1)}>Sebelumnya</a> : <span />}
          {rows.length > 0 && <span className="text-steel-500">Baris {fmtNum(first)}–{fmtNum(first + rows.length - 1)}</span>}
          {hasNext ? <a className="underline" href={link(page + 1)}>Berikutnya</a> : <span />}
        </div>
      </div>
    </main>
  );
}
