import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { cleanFilters } from "@/lib/ckb/report-data";
import { CkbHeader, CkbBody, EmptyState, Notice } from "@/components/ckb/ui";
import { FilterBar } from "@/components/ckb/filter-bar";
import { Table, Th, Td } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/utils";
import { ACTION_GROUPS, actionLabel } from "./labels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Log aktivitas" };

const PAGE = 200;

/** The CKB audit log: append-only (0099), readable by admins and supervisors. */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireCkb("/ckb/activity");
  const sp = await searchParams;
  const f = cleanFilters(sp);
  const page = Math.max(0, Number(sp.page) || 0);
  const db = await createClient();
  const { data: customers } = await db.from("ckb_customers").select("id, name").order("name");
  let q = db.from("ckb_audit_events").select("id, at, actor_name, action, entity_type, entity_id, customer_id, details", { count: "exact" });
  if (f.customer) q = q.eq("customer_id", f.customer);
  if (f.type) q = q.ilike("action", `${f.type}%`);
  if (f.from) q = q.gte("at", f.from);
  if (f.to) q = q.lte("at", `${f.to}T23:59:59.999+07:00`);
  const { data, count, error } = await q.order("at", { ascending: false }).order("id", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  const cname = new Map((customers ?? []).map((c) => [c.id, c.name]));
  const qs = (p: number) => { const n = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]); n.set("page", String(p)); return `?${n}`; };

  return (
    <main>
      <CkbHeader title="Log aktivitas" subtitle="Setiap tindakan penting CKB, tidak bisa diubah atau dihapus." />
      <CkbBody>
        <FilterBar fields={[
          { name: "customer", label: "Customer", kind: "select", options: (customers ?? []).map((c) => ({ value: c.id, label: c.name })) },
          { name: "type", label: "Jenis", kind: "select", options: ACTION_GROUPS },
          { name: "from", label: "Dari", kind: "date" }, { name: "to", label: "Sampai", kind: "date" },
        ]} />
        {error && <Notice tone="bad">Log tidak bisa dimuat: {error.message}</Notice>}
        {(data ?? []).length === 0 ? <EmptyState title="Tidak ada aktivitas untuk filter ini" /> : (
          <div className="rounded-lg border border-steel-100 bg-white">
            <Table>
              <thead><tr><Th>Waktu</Th><Th>Oleh</Th><Th>Tindakan</Th><Th>Customer</Th><Th>Rincian</Th></tr></thead>
              <tbody>
                {(data ?? []).map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap">{fmtDateTime(e.at)}</Td>
                    <Td>{e.actor_name}</Td>
                    <Td><span className="font-medium">{actionLabel(e.action)}</span><span className="block text-xs text-steel-500">{e.entity_type} {e.entity_id ? `· ${String(e.entity_id).slice(0, 8)}` : ""}</span></Td>
                    <Td>{e.customer_id ? cname.get(e.customer_id) ?? "–" : "–"}</Td>
                    <Td className="max-w-md"><code className="block truncate text-xs text-steel-500" title={JSON.stringify(e.details)}>{JSON.stringify(e.details)}</code></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <div className="flex items-center justify-between text-sm text-steel-500">
          <span>{count ?? 0} kejadian</span>
          <span className="flex gap-3">
            {page > 0 && <a className="text-ckb hover:underline" href={qs(page - 1)}>Sebelumnya</a>}
            {(page + 1) * PAGE < (count ?? 0) && <a className="text-ckb hover:underline" href={qs(page + 1)}>Berikutnya</a>}
          </span>
        </div>
      </CkbBody>
    </main>
  );
}
