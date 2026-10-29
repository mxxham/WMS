import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { loadLedgerMonth } from "@/lib/ledger/load";
import { addDays, jakartaDay, monthOf } from "@/lib/ledger/dates";
import { cn, fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { UploadSap } from "./upload-sap";
import { OpenDate } from "./open-date";

export const dynamic = "force-dynamic";

const MONTH_NAME = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const monthLabel = (m: string) => `${MONTH_NAME[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m: string, n: number) => addDays(`${m}-15`, n * 30).slice(0, 7);

/**
 * Buku stok: SAP's book against ours, one day per SAP upload (0116). A month at a time, like the team's
 * monthly Book to Book workbook; the accuracy of every day is computed against the live WMS book.
 */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requirePage("/ledger");
  const today = jakartaDay();
  const month = monthOf((await searchParams).month, today);
  const rows = await loadLedgerMonth(await createClient(), month);

  return (
    <main>
      <PageHeader title="Buku stok" live={["ledger_days", "ledger_notes"]}>
        <UploadSap />
      </PageHeader>
      <div className="space-y-4 p-4 lg:p-8">
        <p className="max-w-3xl text-sm text-steel-500">
          Buku SAP dibandingkan dengan buku WMS per hari: stok awal + inbound − outbound = stok akhir. Upload file SAP
          harian (MB52 + MB51). Satu file = satu hari, yaitu tanggal posting MB51-nya. Stok akhir SAP dan WMS harus sama.
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link className="rounded-md border border-steel-200 bg-white px-3 py-2 text-sm" href={`/ledger?month=${shiftMonth(month, -1)}`}>‹</Link>
            <h2 className="font-cond text-xl font-semibold">{monthLabel(month)}</h2>
            <Link className="rounded-md border border-steel-200 bg-white px-3 py-2 text-sm" href={`/ledger?month=${shiftMonth(month, 1)}`}>›</Link>
          </div>
          <OpenDate max={today} />
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-steel-500">Belum ada file SAP yang diupload untuk {monthLabel(month)}.</p>
        ) : (
          <>
            {/* phone: cards */}
            <div className="space-y-2 md:hidden">
              {rows.map((r) => (
                <Link key={r.date} href={`/ledger/${r.date}`} className="block">
                  <Card><CardContent className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{fmtDate(r.date)}</div>
                      <div className="text-xs text-steel-500">Akurasi SKU {r.accuracy === null ? "–" : `${fmtNum(r.accuracy, 2)}%`} · {fmtNum(r.differing)} SKU selisih · {r.waiting ? "menunggu putaway" : "selesai"}</div>
                    </div>
                    <Accuracy value={r.qtyAccuracy} />
                  </CardContent></Card>
                </Link>
              ))}
            </div>
            {/* desktop: table */}
            <Card className="hidden md:block"><CardContent>
              <Table>
                <thead><tr><Th>Tanggal</Th><Th className="text-right">Akurasi qty</Th><Th className="text-right">Akurasi SKU</Th><Th className="text-right">SKU selisih</Th>
                  <Th className="text-right">SKU</Th><Th>Status</Th><Th>Diupload</Th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.date}>
                    <Td><Link className="font-semibold underline" href={`/ledger/${r.date}`}>{fmtDate(r.date)}</Link></Td>
                    <Td className="text-right"><Accuracy value={r.qtyAccuracy} /></Td>
                    <Td className="text-right"><Accuracy value={r.accuracy} small /></Td>
                    <Td className={cn("text-right tabular", r.differing > 0 && "font-semibold text-bad")}>{fmtNum(r.differing)}</Td>
                    <Td className="text-right tabular">{fmtNum(r.skus)}</Td>
                    <Td className="text-xs">{r.waiting ? <span className="text-warn">Menunggu putaway</span> : "Selesai"}</Td>
                    <Td className="text-xs text-steel-500">{r.byName ?? "–"} · {fmtDateTime(r.createdAt)}{r.version > 1 ? ` · versi ${r.version}` : ""}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            </CardContent></Card>
          </>
        )}
      </div>
    </main>
  );
}

function Accuracy({ value, small = false }: { value: number | null; small?: boolean }) {
  if (value === null) return <span className="text-steel-500">–</span>;
  return <span className={cn("font-cond font-semibold tabular", small ? "text-base" : "text-xl", value === 100 ? "text-ok" : "text-bad")}>{fmtNum(value, 2)}%</span>;
}
