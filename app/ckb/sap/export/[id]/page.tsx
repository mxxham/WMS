import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { CkbHeader, CkbBody, Facts, Notice, Pill } from "@/components/ckb/ui";
import { RpcButton } from "@/components/ckb/rpc-button";
import { Button } from "@/components/ui/button";
import { Table, Th, Td } from "@/components/ui/table";
import { exportTotals, type ExportLineData } from "@/lib/ckb/export-file";
import { fmtDateTime, fmtNum } from "@/lib/utils";
import { EXPORT_STATUS } from "../status";
import { ConfirmSap } from "./confirm-sap";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ekspor SAP" };

export default async function SapExportDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCkb("/ckb/sap/export");
  const db = await createClient();
  const { data: e } = await db.from("ckb_sap_exports").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();
  const [{ data: lines }, { data: customer }, { data: original }, { data: reexports }] = await Promise.all([
    db.from("ckb_sap_export_lines").select("line_no, data").eq("export_id", id).order("line_no"),
    db.from("ckb_customers").select("name, code").eq("id", e.customer_id).single(),
    e.original_export_id ? db.from("ckb_sap_exports").select("id, ref_no").eq("id", e.original_export_id).single() : Promise.resolve({ data: null }),
    db.from("ckb_sap_exports").select("id, ref_no, created_at, reason").eq("original_export_id", id).order("created_at"),
  ]);
  const t = exportTotals((lines ?? []) as { data: ExportLineData }[]);
  const st = EXPORT_STATUS[e.status as keyof typeof EXPORT_STATUS];

  return (
    <main>
      <CkbHeader title={`Ekspor ${e.ref_no}`} subtitle={`${customer?.name} · ${e.kind === "REEXPORT" ? "ekspor ulang" : "ekspor"}`} back={{ href: `/ckb/sap/export?customer=${e.customer_id}`, label: "Export SAP" }}
        live={["ckb_sap_exports"]}>
        <Pill tone={st.tone}>{st.label}</Pill>
        {e.status !== "VOIDED" && <Button asChild><a href={`/api/ckb/sap/export/${id}`}><Download className="h-4 w-4" />Unduh file</a></Button>}
      </CkbHeader>
      <CkbBody>
        {!e.format_verified && <Notice tone="warn">Format {e.format_version}: lembar kerja internal, bukan format unggah SAP yang terverifikasi. File ini bukan bukti posting.</Notice>}
        {e.status === "GENERATED" && <Notice>Setelah tim SAP memposting penyesuaian ini, catat nomor dokumen SAP-nya. Bila SAP menolak file, admin membatalkan ekspor ini agar penyesuaiannya bisa diekspor lagi.</Notice>}
        <Facts items={[
          ["Customer", `${customer?.name} (${customer?.code})`], ["Baris", t.lines], ["Tambah", fmtNum(t.gain, 3)], ["Kurang", fmtNum(t.loss, 3)],
          ["Dibuat", `${e.created_by_name} · ${fmtDateTime(e.created_at)}`], ["Format", e.format_version], ["Diunduh", `${e.download_count} kali`],
          ["Dok. SAP", e.sap_document_ref ? `${e.sap_document_ref} (${e.confirmed_by_name}, ${fmtDateTime(e.confirmed_at)})` : "–"],
          ...(original ? [["Ekspor asli", <Link key="o" className="text-ckb hover:underline" href={`/ckb/sap/export/${original.id}`}>{original.ref_no}</Link>] as [string, React.ReactNode]] : []),
          ...(e.reason ? [["Alasan ekspor ulang", e.reason] as [string, string]] : []),
          ...(e.status === "VOIDED" ? [["Dibatalkan", `${e.voided_by_name} · ${fmtDateTime(e.voided_at)} · ${e.void_reason}`] as [string, string]] : []),
        ]} />
        <div className="flex flex-wrap gap-2">
          {e.status === "GENERATED" && <ConfirmSap exportId={id} refNo={e.ref_no} />}
          {e.status !== "VOIDED" && (
            <RpcButton rpc="ckb_reexport_sap" args={{ p_export: id }} variant="outline" title="Ekspor ulang"
              summary={`Membuat ekspor baru dengan baris yang sama persis dengan ${e.ref_no}. Dicatat sebagai ekspor ulang beserta alasannya.`}
              reason={{ arg: "p_reason", label: "Alasan ekspor ulang", required: true }} confirmLabel="Ekspor ulang">Ekspor ulang</RpcButton>
          )}
          {e.status === "GENERATED" && user.ckbRole === "admin" && (
            <RpcButton rpc="ckb_void_sap_export" args={{ p_export: id }} variant="ghost" title="Batalkan ekspor"
              summary={`${e.ref_no} dibatalkan (mis. SAP menolak file). Penyesuaiannya kembali ke "Disetujui" dan bisa diekspor lagi.`}
              reason={{ arg: "p_reason", label: "Alasan pembatalan", required: true }} confirmLabel="Batalkan ekspor">Batalkan ekspor</RpcButton>
          )}
        </div>
        {(reexports ?? []).length > 0 && (
          <p className="text-sm text-steel-500">Ekspor ulang: {(reexports ?? []).map((r) => <Link key={r.id} className="mr-2 text-ckb hover:underline" href={`/ckb/sap/export/${r.id}`}>{r.ref_no}</Link>)}</p>
        )}
        <div className="rounded-lg border border-steel-100 bg-white">
          <Table>
            <thead><tr><Th>No</Th><Th>Penyesuaian</Th><Th>Sesi</Th><Th>Bin</Th><Th>Material</Th><Th>Batch</Th><Th className="text-right">SAP</Th><Th className="text-right">Fisik</Th><Th className="text-right">Selisih</Th></tr></thead>
            <tbody>
              {(lines ?? []).map((l) => {
                const d = l.data as ExportLineData;
                return (
                  <tr key={l.line_no}>
                    <Td>{l.line_no}</Td><Td>{d.adjustment_ref}</Td><Td>{d.stocktake_ref}</Td><Td className="font-cond font-semibold">{d.storage_bin}</Td>
                    <Td>{d.material_code}<span className="block max-w-[14rem] truncate text-xs text-steel-500">{d.description}</span></Td><Td>{d.batch || "–"}</Td>
                    <Td className="text-right">{fmtNum(d.baseline_qty, 3)}</Td><Td className="text-right">{fmtNum(d.counted_qty, 3)}</Td>
                    <Td className={`text-right font-medium ${d.delta < 0 ? "text-bad" : "text-ok"}`}>{d.delta > 0 ? "+" : ""}{fmtNum(d.delta, 3)} {d.uom}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </CkbBody>
    </main>
  );
}
