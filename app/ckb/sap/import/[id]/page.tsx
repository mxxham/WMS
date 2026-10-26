import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { CkbHeader, CkbBody, Facts, Notice, Pill } from "@/components/ckb/ui";
import { RpcButton } from "@/components/ckb/rpc-button";
import { FilterBar } from "@/components/ckb/filter-bar";
import { Button } from "@/components/ui/button";
import { Table, Th, Td } from "@/components/ui/table";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Snapshot SAP" };
const PAGE = 500;

export default async function SnapshotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireCkb("/ckb/sap/import");
  const { id } = await params;
  const sp = await searchParams;
  const db = await createClient();
  const { data: s } = await db.from("ckb_sap_import_summary").select("*").eq("id", id).maybeSingle();
  if (!s) notFound();
  const { data: errorsRow } = await db.from("ckb_sap_imports").select("errors, mapping, file_sha256, header_line, sheet_name, note").eq("id", id).single();
  const page = Math.max(0, Number(sp.page) || 0);
  let q = db.from("ckb_sap_snapshot_rows").select("line_no, material_code, description, plant, storage_location, storage_bin, batch, expiry_date, uom, quantity, stock_type, identity_key", { count: "exact" }).eq("import_id", id);
  // Only plain characters reach the PostgREST or-filter (no commas, parentheses or wildcards from the user).
  const term = sp.material?.trim().replace(/[^A-Za-z0-9 _/-]/g, "").slice(0, 40);
  if (term) q = q.or(`material_code.ilike.%${term}%,storage_bin.ilike.%${term}%`);
  const { data: rows, count } = await q.order("line_no").range(page * PAGE, page * PAGE + PAGE - 1);
  const { data: others } = await db.from("ckb_sap_imports").select("id, ref_no, snapshot_date").eq("customer_id", s.customer_id).neq("id", id).order("snapshot_date", { ascending: false }).limit(10);
  const errors = (errorsRow?.errors ?? []) as { line: number; message: string }[];
  const dupKeys = new Set<string>();
  { const seen = new Set<string>(); for (const r of rows ?? []) { if (seen.has(r.identity_key)) dupKeys.add(r.identity_key); seen.add(r.identity_key); } }

  return (
    <main>
      <CkbHeader title={`Snapshot ${s.ref_no}`} subtitle={`${s.customer_name} · stok SAP per ${fmtDate(s.snapshot_date)}`} back={{ href: "/ckb/sap/import", label: "Import SAP" }}>
        {s.is_active ? <Pill tone="ok">Snapshot aktif</Pill> : (
          <RpcButton rpc="ckb_activate_snapshot" args={{ p_import: id }} title="Aktifkan snapshot"
            summary={`${s.ref_no} (stok ${fmtDate(s.snapshot_date)}) menjadi dasar bawaan untuk stock take baru dan Inventaris ${s.customer_name}. Sesi stock take yang sudah dibuat tetap memakai snapshot-nya sendiri.`}
            confirmLabel="Aktifkan">Aktifkan</RpcButton>
        )}
      </CkbHeader>
      <CkbBody>
        {!s.mapping_verified && <Notice tone="warn">Diimpor dengan pemetaan kolom yang belum diverifikasi terhadap file SAP CKB asli.</Notice>}
        <Facts items={[
          ["File", s.file_name], ["Sheet / baris judul", `${errorsRow?.sheet_name ?? "–"} / ${errorsRow?.header_line ?? "–"}`],
          ["Checksum", <span key="h" className="font-mono text-xs">{errorsRow?.file_sha256.slice(0, 16)}…</span>],
          ["Baris", fmtNum(s.row_count)], ["Ditolak", fmtNum(s.rejected_count)], ["Total qty", fmtNum(Number(s.total_qty), 3)],
          ["Identitas ganda", s.duplicate_identity_count], ["Diimpor oleh", s.imported_by_name], ["Waktu", fmtDateTime(s.imported_at)],
          ["Catatan", errorsRow?.note ?? "–"],
        ]} />
        {others && others.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-steel-500">Bandingkan dengan:</span>
            {others.map((o) => <Button key={o.id} asChild size="sm" variant="outline"><Link href={`/ckb/sap/compare?a=${o.id}&b=${id}`}>{o.ref_no} ({fmtDate(o.snapshot_date)})</Link></Button>)}
          </div>
        )}
        {errors.length > 0 && (
          <details className="rounded-lg border border-bad/30 bg-white p-3">
            <summary className="cursor-pointer text-sm font-medium text-bad">{s.rejected_count} baris ditolak saat impor</summary>
            <ul className="mt-2 max-h-64 overflow-y-auto text-sm">{errors.map((e) => <li key={e.line}><span className="font-mono">Baris {e.line}</span>: {e.message}</li>)}</ul>
          </details>
        )}
        <FilterBar fields={[{ name: "material", label: "Cari material / bin", kind: "text" }]} />
        <div className="rounded-lg border border-steel-100 bg-white">
          <Table sticky>
            <thead><tr><Th>Baris</Th><Th>Material</Th><Th>Deskripsi</Th><Th>Plant</Th><Th>SLoc</Th><Th>Bin</Th><Th>Batch</Th><Th>Expired</Th><Th>Satuan</Th><Th className="text-right">Qty</Th></tr></thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.line_no} className={dupKeys.has(r.identity_key) ? "bg-warn/10" : ""}>
                  <Td>{r.line_no}</Td><Td className="font-medium">{r.material_code}</Td><Td className="max-w-[16rem] truncate">{r.description}</Td>
                  <Td>{r.plant || "–"}</Td><Td>{r.storage_location || "–"}</Td><Td>{r.storage_bin || "–"}</Td><Td>{r.batch || "–"}</Td>
                  <Td>{r.expiry_date ? fmtDate(r.expiry_date) : "–"}</Td><Td>{r.uom}</Td><Td className="text-right">{fmtNum(Number(r.quantity), 3)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div className="flex justify-between text-sm text-steel-500">
          <span>{fmtNum(count ?? 0)} baris</span>
          <span className="flex gap-3">
            {page > 0 && <Link className="text-ckb hover:underline" href={`?page=${page - 1}${term ? `&material=${encodeURIComponent(term)}` : ""}`}>Sebelumnya</Link>}
            {(page + 1) * PAGE < (count ?? 0) && <Link className="text-ckb hover:underline" href={`?page=${page + 1}${term ? `&material=${encodeURIComponent(term)}` : ""}`}>Berikutnya</Link>}
          </span>
        </div>
      </CkbBody>
    </main>
  );
}
