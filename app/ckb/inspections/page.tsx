import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { cleanFilters } from "@/lib/ckb/report-data";
import { isStaff } from "@/lib/ckb/permissions";
import { INSPECTION_STATUS, INSPECTION_TYPE, DAMAGE_CLASS, type InspectionStatus, type InspectionType, type DamageClass } from "@/lib/ckb/inspection";
import { CkbHeader, CkbBody, EmptyState, Notice, Pill } from "@/components/ckb/ui";
import { FilterBar } from "@/components/ckb/filter-bar";
import { Button } from "@/components/ui/button";
import { Table, Th, Td } from "@/components/ui/table";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inspeksi kargo" };

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCkb("/ckb/inspections");
  const sp = await searchParams;
  const f = cleanFilters(sp);
  const db = await createClient();
  const { data: customers } = await db.from("ckb_customers").select("id, name").order("name");
  let q = db.from("ckb_inspections").select("id, ref_no, customer_id, inspection_type, source_ref, inspection_date, material_code, status, result, damage_class, inspector_name, reviewer_name").order("inspection_date", { ascending: false }).order("ref_no", { ascending: false }).limit(300);
  if (f.customer) q = q.eq("customer_id", f.customer);
  if (f.status) q = q.eq("status", f.status);
  if (f.type) q = q.eq("inspection_type", f.type);
  if (f.from) q = q.gte("inspection_date", f.from);
  if (f.to) q = q.lte("inspection_date", f.to);
  const term = sp.material?.trim().replace(/[^A-Za-z0-9 _/-]/g, "").slice(0, 40);
  if (term) q = q.or(`source_ref.ilike.%${term}%,material_code.ilike.%${term}%,ref_no.ilike.%${term}%`);
  const { data: rows, error } = await q;
  const cname = new Map((customers ?? []).map((c) => [c.id, c.name]));
  const staff = isStaff(user.ckbRole);

  return (
    <main>
      <CkbHeader title="Inspeksi kargo" subtitle={staff ? "Pemeriksaan kargo dengan checklist dan foto. Inspeksi tidak mengubah stok." : "Hasil inspeksi customer Anda yang sudah direview."} live={["ckb_inspections"]}>
        {staff && <Button asChild><Link href="/ckb/inspections/new"><Plus className="h-4 w-4" />Inspeksi baru</Link></Button>}
      </CkbHeader>
      <CkbBody>
        <FilterBar fields={[
          { name: "customer", label: "Customer", kind: "select", options: (customers ?? []).map((c) => ({ value: c.id, label: c.name })) },
          { name: "status", label: "Status", kind: "select", options: (Object.keys(INSPECTION_STATUS) as InspectionStatus[]).map((s) => ({ value: s, label: INSPECTION_STATUS[s].label })) },
          { name: "type", label: "Jenis", kind: "select", options: (Object.keys(INSPECTION_TYPE) as InspectionType[]).map((s) => ({ value: s, label: INSPECTION_TYPE[s] })) },
          { name: "from", label: "Dari", kind: "date" }, { name: "to", label: "Sampai", kind: "date" },
          { name: "material", label: "Cari ref / dokumen / material", kind: "text" },
        ]} />
        {error && <Notice tone="bad">Inspeksi tidak bisa dimuat: {error.message}</Notice>}
        {(rows ?? []).length === 0 ? <EmptyState title="Tidak ada inspeksi" action={staff && <Button asChild><Link href="/ckb/inspections/new">Buat inspeksi</Link></Button>} /> : (
          <>
            <ul className="space-y-2 md:hidden">
              {(rows ?? []).map((r) => (
                <li key={r.id}>
                  <Link href={`/ckb/inspections/${r.id}`} className="block rounded-lg border border-steel-100 bg-white p-4 hover:bg-steel-100/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-cond text-lg font-semibold">{r.ref_no}</span>
                      <Pill tone={INSPECTION_STATUS[r.status as InspectionStatus].tone}>{INSPECTION_STATUS[r.status as InspectionStatus].label}</Pill>
                    </div>
                    <p className="text-sm text-steel-500">{cname.get(r.customer_id)} · {INSPECTION_TYPE[r.inspection_type as InspectionType]} · {fmtDate(r.inspection_date)}</p>
                    {r.result && <p className={`text-sm font-medium ${r.result === "FAIL" ? "text-bad" : "text-ok"}`}>{r.result === "FAIL" ? `Ada temuan · ${DAMAGE_CLASS[r.damage_class as DamageClass]}` : "Lulus"}</p>}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden rounded-lg border border-steel-100 bg-white md:block">
              <Table>
                <thead><tr><Th>Ref</Th><Th>Tanggal</Th><Th>Customer</Th><Th>Jenis</Th><Th>Dokumen</Th><Th>Material</Th><Th>Hasil</Th><Th>Status</Th><Th>Pemeriksa / reviewer</Th></tr></thead>
                <tbody>
                  {(rows ?? []).map((r) => (
                    <tr key={r.id}>
                      <Td><Link href={`/ckb/inspections/${r.id}`} className="font-medium text-ckb hover:underline">{r.ref_no}</Link></Td>
                      <Td>{fmtDate(r.inspection_date)}</Td><Td>{cname.get(r.customer_id)}</Td><Td>{INSPECTION_TYPE[r.inspection_type as InspectionType]}</Td>
                      <Td>{r.source_ref ?? "–"}</Td><Td>{r.material_code ?? "–"}</Td>
                      <Td>{r.result ? <Pill tone={r.result === "FAIL" ? "bad" : "ok"}>{r.result === "FAIL" ? DAMAGE_CLASS[r.damage_class as DamageClass] : "Lulus"}</Pill> : "–"}</Td>
                      <Td><Pill tone={INSPECTION_STATUS[r.status as InspectionStatus].tone}>{INSPECTION_STATUS[r.status as InspectionStatus].label}</Pill></Td>
                      <Td className="text-xs text-steel-500">{r.inspector_name}{r.reviewer_name ? ` / ${r.reviewer_name}` : ""}</Td>
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
