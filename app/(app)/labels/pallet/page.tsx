import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { PalletClient } from "./pallet-client";

export const dynamic = "force-dynamic";

type Checked = {
  id: string; doc_no: string; shipment_no: string | null; container_no: string | null; slot_time: string | null; plan_date: string | null;
  checked_by_name: string | null; checked_at: string | null; pallets: number; good_qty: number;
};

/**
 * Pallet cards: from a checked inbound plan (0118: the bins chosen by the auto putaway), or from a Form
 * Checker workbook as before.
 */
export default async function PalletCardsPage() {
  await requirePage("/labels/pallet");
  const { data } = await (await createClient()).from("receipt_summary")
    .select("id, doc_no, shipment_no, container_no, slot_time, plan_date, checked_by_name, checked_at, pallets, good_qty")
    .eq("source", "PLAN").eq("status", "CHECKED").order("checked_at", { ascending: false }).limit(50);
  const checked = (data ?? []) as Checked[];
  return (
    <main>
      <PageHeader title="Cetak kartu palet" live={["receipts", "receipt_actuals"]} />
      <div className="space-y-4 p-4 lg:p-8">
        <Card>
          <CardHeader><CardTitle>Dari penerimaan (putaway otomatis)</CardTitle></CardHeader>
          <CardContent>
            {checked.length === 0 ? (
              <p className="text-sm text-steel-500">Belum ada penerimaan yang sudah diperiksa dan menunggu posting.
                Periksa kontainer di <Link className="underline" href="/receiving">Penerimaan</Link>, lalu kartunya muncul di sini.</p>
            ) : (
              <Table>
                <thead><tr><Th>DO</Th><Th>Shipment · kontainer</Th><Th>Rencana</Th><Th className="text-right">Palet</Th><Th>Diperiksa</Th><Th /></tr></thead>
                <tbody>{checked.map((r) => (
                  <tr key={r.id}>
                    <Td><Link className="font-semibold underline" href={`/receiving/${r.id}`}>{r.doc_no}</Link></Td>
                    <Td className="text-xs">{r.shipment_no ?? "–"} · {r.container_no ?? "–"}</Td>
                    <Td className="text-xs">{fmtDate(r.plan_date)}{r.slot_time && ` · ${r.slot_time}`}</Td>
                    <Td className="text-right tabular">{fmtNum(Number(r.pallets))}<div className="text-xs text-steel-500">{fmtNum(Number(r.good_qty))} unit</div></Td>
                    <Td className="text-xs">{r.checked_by_name ?? "–"} · {fmtDateTime(r.checked_at)}</Td>
                    <Td className="text-right"><a className="rounded-md bg-ckb px-3 py-1.5 text-sm font-semibold text-white" href={`/api/receiving/${r.id}/cards`} target="_blank" rel="noreferrer">Cetak kartu</a></Td>
                  </tr>
                ))}</tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <PalletClient />
    </main>
  );
}
