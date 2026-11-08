import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { cleanFilters } from "@/lib/ckb/report-data";
import { loadSessionList, type SessionListRow } from "@/lib/ckb/stocktake-data";
import { isLead, isStaff } from "@/lib/ckb/permissions";
import { STOCKTAKE_STATUS, SCOPE_LABEL, type StocktakeStatus } from "@/lib/ckb/stocktake";
import { CkbHeader, CkbBody, EmptyState, Notice, Pill } from "@/components/ckb/ui";
import { FilterBar } from "@/components/ckb/filter-bar";
import { Button } from "@/components/ui/button";
import { Table, Th, Td } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stock take" };

/**
 * Stock-take sessions. Representatives see only their customers' closed sessions (RLS). The list is
 * read in full, in pages — a fixed cap here dropped older sessions without saying so.
 */
export default async function StocktakeListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCkb("/ckb/stock-take");
  const f = cleanFilters(await searchParams);
  const db = await createClient();
  const { data: customers } = await db.from("ckb_customers").select("id, name").order("name");
  let sessions: SessionListRow[] = [];
  let loadError: string | null = null;
  try {
    sessions = await loadSessionList({ customer: f.customer, status: f.status });
  } catch (e) {
    loadError = (e as Error).message;
  }
  const cname = new Map((customers ?? []).map((c) => [c.id, c.name]));
  const lead = isLead(user.ckbRole);

  return (
    <main>
      <CkbHeader title="Stock take & hitung ulang" subtitle="Penghitungan fisik terhadap snapshot SAP. Menghitung tidak mengubah stok." live={["ckb_stocktakes"]}>
        {lead && <Button asChild><Link href="/ckb/stock-take/new"><Plus className="h-4 w-4" />Sesi baru</Link></Button>}
      </CkbHeader>
      <CkbBody>
        {!isStaff(user.ckbRole) && <Notice>Menampilkan sesi yang sudah ditutup untuk customer Anda.</Notice>}
        <FilterBar fields={[
          { name: "customer", label: "Customer", kind: "select", options: (customers ?? []).map((c) => ({ value: c.id, label: c.name })) },
          ...(isStaff(user.ckbRole) ? [{ name: "status", label: "Status", kind: "select" as const, options: (Object.keys(STOCKTAKE_STATUS) as StocktakeStatus[]).map((s) => ({ value: s, label: STOCKTAKE_STATUS[s].label })) }] : []),
        ]} />
        {loadError && <Notice tone="bad">Sesi tidak bisa dimuat: {loadError}</Notice>}
        {loadError ? null : sessions.length === 0 ? (
          <EmptyState title="Belum ada sesi stock take" action={lead && <Button asChild><Link href="/ckb/stock-take/new">Buat sesi pertama</Link></Button>}>
            {lead ? "Sesi dibuat dari snapshot SAP sebuah customer." : undefined}
          </EmptyState>
        ) : (
          <>
            <ul className="space-y-2 md:hidden">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link href={`/ckb/stock-take/${s.id}`} className="block rounded-lg border border-steel-100 bg-white p-4 hover:bg-steel-100/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-cond text-lg font-semibold">{s.ref_no}</span>
                      <Pill tone={STOCKTAKE_STATUS[s.status as StocktakeStatus].tone}>{STOCKTAKE_STATUS[s.status as StocktakeStatus].label}</Pill>
                    </div>
                    <p className="text-sm text-steel-500">{cname.get(s.customer_id)} · {SCOPE_LABEL[s.scope_type as keyof typeof SCOPE_LABEL]} · {fmtDate(s.created_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden rounded-lg border border-steel-100 bg-white md:block">
              <Table>
                <thead><tr><Th>Sesi</Th><Th>Customer</Th><Th>Cakupan</Th><Th>Gudang</Th><Th>Status</Th><Th>Dibuat</Th><Th>Ditutup</Th></tr></thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <Td><Link href={`/ckb/stock-take/${s.id}`} className="font-medium text-ckb hover:underline">{s.ref_no}</Link>{s.blind && <span className="ml-2 text-xs text-steel-500">buta</span>}</Td>
                      <Td>{cname.get(s.customer_id)}</Td>
                      <Td>{SCOPE_LABEL[s.scope_type as keyof typeof SCOPE_LABEL]}</Td>
                      <Td>{s.warehouse}</Td>
                      <Td><Pill tone={STOCKTAKE_STATUS[s.status as StocktakeStatus].tone}>{STOCKTAKE_STATUS[s.status as StocktakeStatus].label}</Pill></Td>
                      <Td className="text-xs text-steel-500">{s.created_by_name}<br />{fmtDateTime(s.created_at)}</Td>
                      <Td className="text-xs text-steel-500">{s.closed_at ? fmtDateTime(s.closed_at) : "–"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </CkbBody>
    </main>
  );
}
