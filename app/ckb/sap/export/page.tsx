import type { Metadata } from "next";
import Link from "next/link";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { CkbHeader, CkbBody, EmptyState, Notice, Pill } from "@/components/ckb/ui";
import { FilterBar } from "@/components/ckb/filter-bar";
import { Table, Th, Td } from "@/components/ui/table";
import { fmtDateTime, fmtNum } from "@/lib/utils";
import { ExportCreate, type Approved } from "./export-create";
import { EXPORT_STATUS } from "./status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Export SAP" };

/** Approved adjustments waiting for SAP, and every export made (with downloads and confirmations). */
export default async function SapExportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireCkb("/ckb/sap/export");
  const sp = await searchParams;
  const db = await createClient();
  const [{ data: customers }, { data: setting }] = await Promise.all([
    db.from("ckb_customers").select("id, name").order("name"),
    db.from("ckb_settings").select("value").eq("key", "sap_export").single(),
  ]);
  const customer = (customers ?? []).find((c) => c.id === sp.customer);
  const approved = customer ? await fetchAll<Approved>((a, b) => db.from("ckb_adjustments")
    .select("id, ref_no, material_code, description, storage_bin, batch, uom, baseline_qty, accepted_qty, delta, decided_by_name, decided_at, ckb_stocktakes(ref_no)")
    .eq("customer_id", customer.id).eq("status", "APPROVED").order("ref_no").range(a, b)) : [];
  let q = db.from("ckb_sap_exports").select("id, ref_no, customer_id, kind, status, line_count, total_gain, total_loss, created_by_name, created_at, sap_document_ref, download_count").order("created_at", { ascending: false }).limit(100);
  if (customer) q = q.eq("customer_id", customer.id);
  const { data: exports } = await q;
  const cname = new Map((customers ?? []).map((c) => [c.id, c.name]));
  const fmt = setting?.value as { verified?: boolean; format_version?: string } | undefined;

  return (
    <main>
      <CkbHeader title="Export SAP" subtitle="Penyesuaian yang disetujui, siap dikirim ke SAP." live={["ckb_adjustments", "ckb_sap_exports"]} />
      <CkbBody>
        {!fmt?.verified && (
          <Notice tone="warn" title="Belum ada format unggah SAP yang terverifikasi">
            File yang dibuat di sini adalah lembar kerja internal ({fmt?.format_version ?? "CKB-INTERNAL-1"}) untuk diinput atau diunggah oleh tim SAP.
            Membuat file bukan berarti SAP sudah memposting: catat nomor dokumen SAP setelah posting di sana.
          </Notice>
        )}
        <FilterBar fields={[{ name: "customer", label: "Customer", kind: "select", all: "Pilih customer", options: (customers ?? []).map((c) => ({ value: c.id, label: c.name })) }]} />
        {!customer ? <Notice>Pilih customer untuk melihat penyesuaian yang siap diekspor.</Notice>
          : approved.length === 0 ? <EmptyState title={`Tidak ada penyesuaian disetujui untuk ${customer.name}`}>Penyesuaian muncul di sini setelah disetujui di review stock take.</EmptyState>
          : <ExportCreate customerId={customer.id} customerName={customer.name} rows={approved} />}

        <section className="space-y-2">
          <h2 className="font-cond text-lg font-semibold">Riwayat ekspor</h2>
          {(exports ?? []).length === 0 ? <p className="text-sm text-steel-500">Belum ada ekspor.</p> : (
            <div className="rounded-lg border border-steel-100 bg-white">
              <Table>
                <thead><tr><Th>Ekspor</Th><Th>Customer</Th><Th>Jenis</Th><Th className="text-right">Baris</Th><Th className="text-right">Tambah / kurang</Th><Th>Status</Th><Th>Dibuat</Th><Th className="text-right">Unduhan</Th></tr></thead>
                <tbody>
                  {(exports ?? []).map((e) => (
                    <tr key={e.id}>
                      <Td><Link href={`/ckb/sap/export/${e.id}`} className="font-medium text-ckb hover:underline">{e.ref_no}</Link></Td>
                      <Td>{cname.get(e.customer_id)}</Td>
                      <Td>{e.kind === "REEXPORT" ? "Ekspor ulang" : "Ekspor"}</Td>
                      <Td className="text-right">{e.line_count}</Td>
                      <Td className="text-right">+{fmtNum(Number(e.total_gain), 3)} / −{fmtNum(Number(e.total_loss), 3)}</Td>
                      <Td><Pill tone={EXPORT_STATUS[e.status as keyof typeof EXPORT_STATUS].tone}>{EXPORT_STATUS[e.status as keyof typeof EXPORT_STATUS].label}</Pill>
                        {e.sap_document_ref && <span className="block text-xs text-steel-500">Dok. {e.sap_document_ref}</span>}</Td>
                      <Td className="text-xs text-steel-500">{e.created_by_name}<br />{fmtDateTime(e.created_at)}</Td>
                      <Td className="text-right">{e.download_count}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </section>
      </CkbBody>
    </main>
  );
}
