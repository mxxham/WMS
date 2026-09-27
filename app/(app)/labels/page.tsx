import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/app/page-header";
import { LabelsClient } from "./labels-client";

export default async function LabelsPage() {
  await requireRole(["supervisor", "admin"]);
  const supabase = await createClient();
  // Distinct zone/rack pairs for the pickers (rack bins only).
  const data = await fetchAll<{ zone: string; rack: string | null }>((a, b) =>
    supabase.from("bins").select("zone, rack").not("rack", "is", null).order("bin_code").range(a, b));
  const racks: Record<string, string[]> = {};
  for (const r of data) {
    racks[r.zone] ??= [];
    if (!racks[r.zone].includes(r.rack!)) racks[r.zone].push(r.rack!);
  }
  const { data: floor } = await supabase.from("bins").select("zone").is("rack", null);
  for (const f of floor ?? []) racks[f.zone] ??= [];
  const { data: logs } = await supabase.from("print_logs").select("id, bin_ids, printed_at, note, profiles(name)").order("printed_at", { ascending: false }).limit(8);
  return (
    <main>
      <PageHeader title="Cetak label bin" />
      <LabelsClient racks={racks} logs={(logs ?? []) as unknown as { id: number; bin_ids: string[]; printed_at: string; note: string | null; profiles: { name: string } | null }[]} />
    </main>
  );
}
