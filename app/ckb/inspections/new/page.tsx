import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { CkbHeader, CkbBody, Notice } from "@/components/ckb/ui";
import { NewInspectionForm } from "./new-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inspeksi baru" };

/** `?ulang=<id>` starts a re-inspection of a rejected inspection, prefilled from it. */
export default async function NewInspectionPage({ searchParams }: { searchParams: Promise<{ ulang?: string }> }) {
  await requireCkb("/ckb/inspections/new");
  const { ulang } = await searchParams;
  const db = await createClient();
  const [{ data: customers }, { data: templates }, { data: settings }, prev] = await Promise.all([
    db.from("ckb_customers").select("id, name").eq("active", true).order("name"),
    db.from("ckb_inspection_templates").select("id, code, version, name, customer_id").eq("active", true).order("name"),
    db.from("ckb_settings").select("value").eq("key", "warehouses").single(),
    ulang && /^[0-9a-f-]{36}$/.test(ulang)
      ? db.from("ckb_inspections").select("id, ref_no, customer_id, inspection_type, source_ref, warehouse, location, material_code, material_desc, batch, package_ref, status").eq("id", ulang).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const previous = prev.data && prev.data.status === "REJECTED" ? prev.data : null;
  return (
    <main>
      <CkbHeader title={previous ? `Inspeksi ulang ${previous.ref_no}` : "Inspeksi baru"} back={{ href: "/ckb/inspections", label: "Inspeksi kargo" }} />
      <CkbBody className="max-w-3xl">
        {previous && <Notice>Inspeksi baru ini menggantikan {previous.ref_no} yang ditolak. Inspeksi lama tetap tersimpan apa adanya.</Notice>}
        {(templates ?? []).length === 0 && <Notice tone="warn">Belum ada checklist aktif. Admin CKB membuatnya di Pengaturan.</Notice>}
        <NewInspectionForm customers={customers ?? []} templates={templates ?? []} warehouses={(settings?.value as string[] | undefined) ?? ["Warehouse 5"]} previous={previous} />
      </CkbBody>
    </main>
  );
}
