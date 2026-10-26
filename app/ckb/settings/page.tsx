import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { CkbHeader, CkbBody, Notice } from "@/components/ckb/ui";
import { SettingsClient } from "./settings-client";
import { TemplatesClient, type TemplateRow } from "./templates-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pengaturan" };

/** CKB settings (admin): a fixed set of keys, each saved through ckb_save_setting (validated, audited). */
export default async function CkbSettingsPage() {
  await requireCkb("/ckb/settings");
  const db = await createClient();
  const [{ data: settings, error }, { data: templates }, { data: customers }] = await Promise.all([
    db.from("ckb_settings").select("key, value, updated_at"),
    db.from("ckb_inspection_templates").select("id, code, version, name, customer_id, items, active, created_at").order("code").order("version", { ascending: false }),
    db.from("ckb_customers").select("id, name").order("name"),
  ]);
  const value = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value])) as Record<string, unknown>;
  return (
    <main>
      <CkbHeader title="Pengaturan" subtitle="Konfigurasi CKB 3PL. Setiap perubahan tercatat di log aktivitas." />
      <CkbBody className="max-w-4xl">
        {error && <Notice tone="bad">Pengaturan tidak bisa dimuat: {error.message}</Notice>}
        <SettingsClient value={value} />
        <TemplatesClient templates={(templates ?? []) as TemplateRow[]} customers={customers ?? []} />
      </CkbBody>
    </main>
  );
}
