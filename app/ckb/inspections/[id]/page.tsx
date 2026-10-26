import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { isLead, isStaff } from "@/lib/ckb/permissions";
import { INSPECTION_STATUS, INSPECTION_TYPE, DAMAGE_CLASS, type ChecklistItem, type DamageClass, type InspectionStatus, type InspectionType, type Response } from "@/lib/ckb/inspection";
import { CkbHeader, CkbBody, Facts, Notice, Pill } from "@/components/ckb/ui";
import { RpcButton } from "@/components/ckb/rpc-button";
import { EvidencePanel, type EvidenceRow } from "@/components/ckb/evidence-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { ChecklistForm } from "./checklist-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inspeksi" };

const RESULT_TONE = { OK: "ok", NG: "bad", NA: "muted" } as const;

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCkb(`/ckb/inspections/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await createClient();
  const { data: i } = await db.from("ckb_inspections").select("*").eq("id", id).maybeSingle();
  if (!i) notFound();
  const [{ data: responses }, { data: evidence }, { data: customer }, { data: setting }, { data: next }, { data: prev }] = await Promise.all([
    db.from("ckb_inspection_responses").select("item_key, result, value_text, value_num, note").eq("inspection_id", id),
    db.from("ckb_evidence").select("id, kind, mime, size_bytes, description, uploaded_by, uploaded_by_name, uploaded_at, legal_hold").eq("entity_type", "INSPECTION").eq("entity_id", id).order("uploaded_at"),
    db.from("ckb_customers").select("name").eq("id", i.customer_id).single(),
    db.from("ckb_settings").select("value").eq("key", "inspection").maybeSingle(),
    db.from("ckb_inspections").select("id, ref_no").eq("supersedes_id", id).maybeSingle(),
    i.supersedes_id ? db.from("ckb_inspections").select("id, ref_no").eq("id", i.supersedes_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const checklist = i.checklist as ChecklistItem[];
  const answers: Response[] = (responses ?? []).map((r) => ({ key: r.item_key, result: r.result, value_text: r.value_text, value_num: r.value_num === null ? null : Number(r.value_num), note: r.note }));
  const byKey = new Map(answers.map((a) => [a.key, a]));
  const status = i.status as InspectionStatus;
  const staff = isStaff(user.ckbRole), lead = isLead(user.ckbRole);
  const canEdit = status === "DRAFT" && (i.inspector_id === user.id || lead);
  const requirePhoto = (setting?.value as { require_photo_on_ng?: boolean } | null)?.require_photo_on_ng ?? true;
  const categories = [...new Set(checklist.map((c) => c.category ?? "Umum"))];

  return (
    <main>
      <CkbHeader title={`Inspeksi ${i.ref_no}`} subtitle={`${customer?.name} · ${INSPECTION_TYPE[i.inspection_type as InspectionType]} · ${fmtDate(i.inspection_date)}`}
        back={{ href: "/ckb/inspections", label: "Inspeksi kargo" }} live={["ckb_inspections", "ckb_evidence"]}>
        <Pill tone={INSPECTION_STATUS[status].tone}>{INSPECTION_STATUS[status].label}</Pill>
        {i.result && <Pill tone={i.result === "FAIL" ? "bad" : "ok"}>{i.result === "FAIL" ? "Ada temuan" : "Lulus"}</Pill>}
        {status === "SUBMITTED" && lead && i.inspector_id !== user.id && (
          <>
            <RpcButton rpc="ckb_review_inspection" args={{ p_id: id, p_accept: true }} title="Terima inspeksi"
              summary={`${i.ref_no} diterima${i.result === "FAIL" ? " beserta temuannya" : ""}. Hasilnya terlihat oleh perwakilan ${customer?.name}.`}
              reason={{ arg: "p_note", label: "Catatan review" }} confirmLabel="Terima">Terima</RpcButton>
            <RpcButton rpc="ckb_review_inspection" args={{ p_id: id, p_accept: false }} variant="outline" title="Tolak inspeksi"
              summary={`${i.ref_no} ditolak. Pemeriksa bisa membuat inspeksi ulang; jawaban ini tetap tersimpan.`}
              reason={{ arg: "p_note", label: "Alasan penolakan", required: true }} confirmLabel="Tolak">Tolak</RpcButton>
          </>
        )}
        {status === "ACCEPTED" && lead && (
          <RpcButton rpc="ckb_close_inspection" args={{ p_id: id }} variant="outline" title="Tutup inspeksi" summary={`${i.ref_no} ditutup. Tidak ada lagi perubahan atau bukti baru.`}
            reason={{ arg: "p_note", label: "Catatan" }} confirmLabel="Tutup">Tutup</RpcButton>
        )}
        {status === "REJECTED" && staff && !next && <Button asChild><Link href={`/ckb/inspections/new?ulang=${id}`}>Inspeksi ulang</Link></Button>}
      </CkbHeader>
      <CkbBody>
        {status === "SUBMITTED" && lead && i.inspector_id === user.id && <Notice>Inspeksi ini Anda buat: review dilakukan supervisor/admin lain.</Notice>}
        {status === "REJECTED" && <Notice tone="warn">Ditolak oleh {i.reviewer_name} ({fmtDateTime(i.reviewed_at)}): {i.review_note}</Notice>}
        {next && <Notice>Digantikan oleh <Link className="underline" href={`/ckb/inspections/${next.id}`}>{next.ref_no}</Link>.</Notice>}
        {prev && <Notice>Inspeksi ulang dari <Link className="underline" href={`/ckb/inspections/${prev.id}`}>{prev.ref_no}</Link>.</Notice>}
        <Facts items={[
          ["Dokumen", i.source_ref], ["Gudang / lokasi", `${i.warehouse}${i.location ? ` · ${i.location}` : ""}`], ["Material", i.material_code],
          ["Deskripsi", i.material_desc], ["Batch", i.batch], ["Kemasan / palet", i.package_ref], ["Pemeriksa", i.inspector_name],
          ["Dikirim", fmtDateTime(i.submitted_at)], ["Reviewer", i.reviewer_name ? `${i.reviewer_name} · ${fmtDateTime(i.reviewed_at)}` : "–"],
          ["Kerusakan", DAMAGE_CLASS[i.damage_class as DamageClass]], ["Ditutup", i.closed_at ? `${i.closed_by_name} · ${fmtDateTime(i.closed_at)}` : "–"],
        ]} />

        <Card>
          <CardHeader><CardTitle>Checklist</CardTitle></CardHeader>
          <CardContent>
            {canEdit ? (
              <ChecklistForm inspectionId={id} checklist={checklist} answers={answers} findings={i.findings} damageClass={i.damage_class as DamageClass}
                photoCount={(evidence ?? []).length} requirePhotoOnNg={requirePhoto} />
            ) : (
              <div className="space-y-4">
                {categories.map((cat) => (
                  <section key={cat}>
                    <h3 className="mb-1 text-sm font-semibold text-steel-500">{cat}</h3>
                    <ul className="divide-y divide-steel-100">
                      {checklist.filter((c) => (c.category ?? "Umum") === cat).map((c) => {
                        const a = byKey.get(c.key);
                        return (
                          <li key={c.key} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                            <span>{c.label}{a?.note && <span className="block text-xs text-steel-500">{a.note}</span>}</span>
                            <span>{c.kind === "CHECK" ? (a?.result ? <Pill tone={RESULT_TONE[a.result]}>{a.result}</Pill> : "–") : c.kind === "NUMBER" ? (a?.value_num ?? "–") : (a?.value_text ?? "–")}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
                {i.findings && <p className="text-sm"><span className="font-medium">Temuan:</span> {i.findings}</p>}
                {status === "DRAFT" && <p className="text-sm text-steel-500">Draf; diisi oleh {i.inspector_name}.</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Foto dan dokumen</CardTitle></CardHeader>
          <CardContent>
            <EvidencePanel entityType="INSPECTION" entityId={id} rows={(evidence ?? []) as EvidenceRow[]} canUpload={staff && (status === "DRAFT" || status === "SUBMITTED")}
              me={user.id} lead={lead} defaultKind="DAMAGE" />
          </CardContent>
        </Card>
      </CkbBody>
    </main>
  );
}
