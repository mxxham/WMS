import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { movementQuery, type MovementFilters } from "@/lib/movement-query";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import type { Movement } from "@/lib/types";
import { REASON_CODES, type ReasonCode } from "@/lib/inventory-control";
import { fmtDateTime, fmtNum } from "@/lib/utils";

export const dynamic = "force-dynamic";
const TYPES = ["inbound", "putaway", "picking", "transfer", "adjustment"];
const PAGE = 100;

export default async function MovementsPage({ searchParams }: { searchParams: Promise<MovementFilters & { page?: string }> }) {
  await requireRole(["supervisor", "admin"]);
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0));
  const supabase = await createClient();
  const build = await movementQuery(supabase, sp);
  const res = build ? await build(page * PAGE, page * PAGE + PAGE - 1) : { data: [] };
  const rows = (res.data ?? []) as unknown as (Movement & { items: { sku: string; description: string; uom: string | null } | null })[];
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);

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
          <div><Label htmlFor="type">Jenis</Label><Select id="type" name="type" defaultValue={sp.type ?? ""}><option value="">Semua</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select></div>
          <div><Label htmlFor="bin">Bin</Label><Input id="bin" name="bin" defaultValue={sp.bin} placeholder="CA01C01" /></div>
          <div><Label htmlFor="sku">SKU</Label><Input id="sku" name="sku" defaultValue={sp.sku} /></div>
          <div><Label htmlFor="reason">Alasan</Label><Select id="reason" name="reason" defaultValue={sp.reason ?? ""}><option value="">Semua</option>{Object.entries(REASON_CODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          <div><Label htmlFor="person">Orang</Label><Input id="person" name="person" defaultValue={sp.person} placeholder="nama" /></div>
          <div className="flex items-end gap-2"><Button type="submit" className="flex-1">Terapkan</Button><Button asChild variant="ghost"><a href="/movements">Reset</a></Button></div>
        </form>
        {!build && <p className="text-sm text-bad">Bin atau SKU pada filter tidak ditemukan.</p>}
        <div className="rounded-lg bg-white">
          <Table>
            <thead><tr><Th>Waktu</Th><Th>Jenis</Th><Th>SKU</Th><Th>Batch</Th><Th className="text-right">Qty</Th><Th>Dari</Th><Th>Ke</Th><Th>Alasan · catatan</Th><Th>Oleh</Th></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap">{fmtDateTime(m.created_at)}</Td><Td>{m.type}</Td>
                <Td title={m.items?.description}>{m.items?.sku}</Td><Td>{m.batch_lot || "–"}</Td>
                <Td className="text-right">{fmtNum(m.quantity)} {m.items?.uom}</Td><Td>{m.from_bin?.bin_code ?? "–"}</Td><Td>{m.to_bin?.bin_code ?? "–"}</Td>
                <Td className="text-xs">{m.reason_code && <b>{REASON_CODES[m.reason_code as ReasonCode] ?? m.reason_code} · </b>}{m.note}</Td>
                <Td className="text-xs">{m.by_name ?? m.profiles?.name ?? "–"}{m.approved_by_name && m.approved_by_name !== m.by_name && <div>disetujui {m.approved_by_name}</div>}</Td>
              </tr>
            ))}</tbody>
          </Table>
          {rows.length === 0 && <p className="p-4 text-sm text-steel-500">Tidak ada mutasi untuk filter ini.</p>}
        </div>
        <div className="flex justify-between text-sm">
          {page > 0 ? <a className="underline" href={`/movements?${qs}&page=${page - 1}`}>Sebelumnya</a> : <span />}
          {rows.length === PAGE && <a className="underline" href={`/movements?${qs}&page=${page + 1}`}>Berikutnya</a>}
        </div>
      </div>
    </main>
  );
}
