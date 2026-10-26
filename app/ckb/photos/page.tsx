import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { cleanFilters } from "@/lib/ckb/report-data";
import { isStaff } from "@/lib/ckb/permissions";
import { ENTITY_LABEL, EVIDENCE_KIND_LABEL, type EvidenceEntity, type EvidenceKind } from "@/lib/ckb/evidence";
import { CkbHeader, CkbBody, EmptyState, Notice, Pill } from "@/components/ckb/ui";
import { FilterBar } from "@/components/ckb/filter-bar";
import { RpcButton } from "@/components/ckb/rpc-button";
import { Table, Th, Td } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Arsip foto" };

type Item = { id: string; src: "ckb" | "rb"; entity: EvidenceEntity | "REBAGGING"; entityId: string; customerId: string | null; kind: string; mime: string;
  description: string | null; by: string; at: string; retainUntil: string | null; hold: boolean; archivedAt: string | null; archiveRef: string | null };

const LINK: Record<string, (id: string) => string> = {
  STOCKTAKE: (id) => `/ckb/stock-take/${id}`, INSPECTION: (id) => `/ckb/inspections/${id}`, REBAGGING: (id) => `/ckb/rebagging/${id}`,
};

/** Every photo and document, each opened through the access-checked, logged route. */
export default async function PhotosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireCkb("/ckb/photos");
  const sp = await searchParams;
  const f = cleanFilters(sp);
  const db = await createClient();
  const { data: customers } = await db.from("ckb_customers").select("id, name").order("name");
  const today = new Date().toISOString().slice(0, 10);

  let q = db.from("ckb_evidence").select("id, customer_id, entity_type, entity_id, kind, mime, description, uploaded_by_name, uploaded_at, retain_until, legal_hold, archived_at, archive_ref")
    .order("uploaded_at", { ascending: false }).limit(300);
  if (f.customer) q = q.eq("customer_id", f.customer);
  if (f.type && f.type !== "REBAGGING") q = q.eq("entity_type", f.type);
  if (f.from) q = q.gte("uploaded_at", f.from);
  if (f.to) q = q.lte("uploaded_at", `${f.to}T23:59:59+07:00`);
  if (sp.arsip === "1") q = q.lt("retain_until", today).is("archived_at", null);
  const { data: ev, error } = f.type === "REBAGGING" ? { data: [], error: null } : await q;

  let rb: Item[] = [];
  if (isStaff(user.ckbRole) && (!f.type || f.type === "REBAGGING") && sp.arsip !== "1") {
    let r = db.from("ckb_rebagging_evidence").select("id, job_id, kind, mime, note, uploader_name, uploaded_at, ckb_rebagging_jobs(customer_id)").order("uploaded_at", { ascending: false }).limit(200);
    if (f.from) r = r.gte("uploaded_at", f.from);
    if (f.to) r = r.lte("uploaded_at", `${f.to}T23:59:59+07:00`);
    const { data } = await r;
    rb = (data ?? []).map((x) => ({ id: x.id, src: "rb" as const, entity: "REBAGGING" as const, entityId: x.job_id,
      customerId: (x.ckb_rebagging_jobs as unknown as { customer_id: string | null } | null)?.customer_id ?? null,
      kind: x.kind, mime: x.mime, description: x.note, by: x.uploader_name, at: x.uploaded_at, retainUntil: null, hold: false, archivedAt: null, archiveRef: null }))
      .filter((x) => !f.customer || x.customerId === f.customer);
  }
  const items: Item[] = [
    ...(ev ?? []).map((e) => ({ id: e.id, src: "ckb" as const, entity: e.entity_type as EvidenceEntity, entityId: e.entity_id, customerId: e.customer_id, kind: e.kind, mime: e.mime,
      description: e.description, by: e.uploaded_by_name, at: e.uploaded_at, retainUntil: e.retain_until, hold: e.legal_hold, archivedAt: e.archived_at, archiveRef: e.archive_ref })),
    ...rb,
  ].sort((a, b) => b.at.localeCompare(a.at));
  const cname = new Map((customers ?? []).map((c) => [c.id, c.name]));
  const admin = user.ckbRole === "admin";

  return (
    <main>
      <CkbHeader title="Arsip foto" subtitle="Foto dan dokumen bukti. Setiap pembukaan file dicatat." live={["ckb_evidence"]} />
      <CkbBody>
        <FilterBar fields={[
          { name: "customer", label: "Customer", kind: "select", options: (customers ?? []).map((c) => ({ value: c.id, label: c.name })) },
          { name: "type", label: "Data", kind: "select", options: [
            { value: "STOCKTAKE", label: "Stock take" }, { value: "COUNT_TASK", label: "Tugas hitung" }, { value: "INSPECTION", label: "Inspeksi" },
            ...(isStaff(user.ckbRole) ? [{ value: "REBAGGING", label: "Rebagging" }] : [])] },
          { name: "from", label: "Dari", kind: "date" }, { name: "to", label: "Sampai", kind: "date" },
        ]} />
        {admin && (
          <Notice title="Masa simpan dan arsip">
            Bukti disimpan siap-buka selama masa simpan (bawaan dua tahun), lalu boleh dipindah ke penyimpanan arsip. Pemindahan belum otomatis: salin file
            ke arsip, lalu catat referensinya di sini. Bukti tidak pernah dihapus permanen; yang ditahan (legal hold) tidak bisa ditarik.
            {" "}<Link className="underline" href={sp.arsip === "1" ? "?" : "?arsip=1"}>{sp.arsip === "1" ? "Tampilkan semua" : "Tampilkan yang sudah lewat masa simpan"}</Link>
          </Notice>
        )}
        {error && <Notice tone="bad">Bukti tidak bisa dimuat: {error.message}</Notice>}
        {items.length === 0 ? <EmptyState title="Tidak ada bukti untuk filter ini" /> : (
          <div className="rounded-lg border border-steel-100 bg-white">
            <Table>
              <thead><tr><Th>Waktu</Th><Th>Customer</Th><Th>Data</Th><Th>Jenis</Th><Th>Keterangan</Th><Th>Oleh</Th><Th>Simpan s/d</Th><Th /></tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={`${it.src}-${it.id}`}>
                    <Td className="whitespace-nowrap text-xs">{fmtDateTime(it.at)}</Td>
                    <Td>{it.customerId ? cname.get(it.customerId) ?? "–" : "–"}</Td>
                    <Td>{LINK[it.entity] && isStaff(user.ckbRole) ? <Link className="text-ckb hover:underline" href={LINK[it.entity](it.entityId)}>{ENTITY_LABEL[it.entity]}</Link> : ENTITY_LABEL[it.entity]}</Td>
                    <Td>{EVIDENCE_KIND_LABEL[it.kind as EvidenceKind] ?? it.kind}{it.mime === "application/pdf" && <span className="ml-1 text-xs text-steel-500">PDF</span>}</Td>
                    <Td className="max-w-[16rem] truncate">{it.description ?? "–"}</Td>
                    <Td className="text-xs">{it.by}</Td>
                    <Td className="text-xs">{it.retainUntil ? fmtDate(it.retainUntil) : "–"}{it.hold && <Pill tone="warn" className="ml-1">ditahan</Pill>}
                      {it.archivedAt && <span className="block text-steel-500">arsip: {it.archiveRef}</span>}</Td>
                    <Td className="whitespace-nowrap text-right">
                      <a href={`/api/ckb/evidence/${it.id}${it.src === "rb" ? "?src=rb" : ""}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-ckb hover:underline"><ExternalLink className="h-3.5 w-3.5" />Buka</a>
                      {admin && it.src === "ckb" && (
                        <span className="ml-2 inline-flex gap-1">
                          <RpcButton rpc="ckb_set_evidence_hold" args={{ p_id: it.id, p_hold: !it.hold }} size="sm" variant="ghost" title={it.hold ? "Lepas penahanan" : "Tahan bukti"}
                            summary={it.hold ? "Penahanan dilepas; bukti kembali mengikuti aturan biasa." : "Bukti ditahan (mis. sengketa) dan tidak bisa ditarik siapa pun."}
                            reason={it.hold ? undefined : { arg: "p_reason", label: "Alasan", required: true }}>{it.hold ? "Lepas" : "Tahan"}</RpcButton>
                          {!it.archivedAt && it.retainUntil && it.retainUntil < today && (
                            <RpcButton rpc="ckb_record_evidence_archive" args={{ p_id: it.id }} size="sm" variant="ghost" title="Catat arsip"
                              summary="Catat bahwa file ini sudah disalin ke penyimpanan arsip." reason={{ arg: "p_archive_ref", label: "Referensi arsip", required: true }}>Arsip</RpcButton>
                          )}
                        </span>
                      )}
                    </Td>
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
