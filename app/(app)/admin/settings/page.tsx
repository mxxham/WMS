import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import type { Layout } from "@/lib/warehouse-types";
import { parsePolicy } from "@/lib/inventory-control";
import { SettingsForms } from "./settings-forms";
import { PolicyForm } from "./policy-form";

export default async function SettingsPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const [{ data }, { data: policy }] = await Promise.all([
    supabase.from("settings").select("value").eq("key", "layout").single(),
    supabase.rpc("inventory_policy"),
  ]);
  return (
    <main>
      <PageHeader title="Pengaturan" />
      <div className="p-4 pb-0 lg:p-8 lg:pb-0"><PolicyForm policy={parsePolicy(policy)} /></div>
      <SettingsForms layout={data?.value as Layout & { _note?: string }} />
    </main>
  );
}
