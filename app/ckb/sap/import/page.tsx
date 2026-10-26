import type { Metadata } from "next";
import Link from "next/link";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { cleanFilters } from "@/lib/ckb/report-data";
import { CkbHeader, CkbBody, EmptyState, Notice, Pill } from "@/components/ckb/ui";
import { FilterBar } from "@/components/ckb/filter-bar";
import { Table, Th, Td } from "@/components/ui/table";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Import SAP" };

/** SAP stock snapshots: upload with preview, history, and which one is active per customer. */
export default async function SapImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireCkb("/ckb/sap/import");
  const f = cleanFilters(await searchParams);
  const db = await createClient();
  const [{ data: customers }, { data: setting }] = await Promise.all([
    db.from("ckb_customers").select("id, name, active").order("name"),
    db.from("ckb_settings").select("value").eq("key", "sap_import").single(),
  ]);
  let q = db.from("ckb_sap_import_summary").select("*").order("imported_at", { ascending: false }).limit(200);
  if (f.customer) q = q.eq("customer_id", f.customer);
  const { data: imports, error } = await q;
  const verified = (setting?.value as { verified?: boolean } | null)?.verified === true;

  return (
    <main>
      <CkbHeader title="Import SAP" subtitle="Snapshot stok SAP per customer. Snapshot lama tidak pernah ditimpa." live={["ckb_sap_imports", "ckb_customers"]} />
      <CkbBody>
        {!verified && (
          <Notice tone="warn" title="Format file SAP CKB belum diverifikasi">
            Kolom dibaca menurut pemetaan di Pengaturan, yang belum dicocokkan dengan file SAP CKB asli. Periksa pratinjau
            dengan teliti; setiap snapshot mencatat bahwa pemetaannya belum diverifikasi.
          </Notice>
        )}
        <ImportClient customers={(customers ?? []).filter((c) => c.active)} />
        <FilterBar fields={[{ name: "customer", label: "Customer", kind: "select", options: (customers ?? []).map((c) => ({ value: c.id, label: c.name })) }]} />
        {error && <Notice tone="bad">Riwayat tidak bisa dimuat: {error.message}</Notice>}
        {(imports ?? []).length === 0 ? <EmptyState title="Belum ada snapshot SAP">Unggah file stok SAP di atas untuk membuat snapshot pertama.</EmptyState> : (
          <div className="rounded-lg border border-steel-100 bg-white">
            <Table>
              <thead><tr><Th>Snapshot</Th><Th>Customer</Th><Th>Tanggal</Th><Th>File</Th><Th className="text-right">Baris</Th><Th className="text-right">Ditolak</Th><Th className="text-right">Total qty</Th><Th>Status</Th><Th>Oleh</Th></tr></thead>
              <tbody>
                {(imports ?? []).map((i) => (
                  <tr key={i.id}>
                    <Td><Link href={`/ckb/sap/import/${i.id}`} className="font-medium text-ckb hover:underline">{i.ref_no}</Link></Td>
                    <Td>{i.customer_name}</Td>
                    <Td>{fmtDate(i.snapshot_date)}</Td>
                    <Td className="max-w-[14rem] truncate" title={i.file_name}>{i.file_name}</Td>
                    <Td className="text-right">{fmtNum(i.row_count)}</Td>
                    <Td className="text-right">{i.rejected_count ? <span className="text-bad">{fmtNum(i.rejected_count)}</span> : 0}</Td>
                    <Td className="text-right">{fmtNum(Number(i.total_qty), 3)}</Td>
                    <Td className="space-x-1">{i.is_active && <Pill tone="ok">Aktif</Pill>}{!i.mapping_verified && <Pill tone="warn">Belum terverifikasi</Pill>}{i.duplicate_identity_count > 0 && <Pill tone="bad">{i.duplicate_identity_count} identitas ganda</Pill>}</Td>
                    <Td className="whitespace-nowrap text-xs text-steel-500">{i.imported_by_name}<br />{fmtDateTime(i.imported_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </CkbBody>
    </main>
  );
}
