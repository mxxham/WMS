import { requirePage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { loadRacks } from "./racks-data";
import { RacksClient } from "./racks-client";

export const dynamic = "force-dynamic";

/**
 * Rak & Lokasi (0132): the warehouse's racks and bins in one place — floor plan, bin list, history —
 * where bins are blocked, marked as not existing, lent to CKB 3PL, and new racks are planned.
 * Spec: docs/superpowers/specs/2026-11-08-racks-and-locations-design.md.
 */
export default async function RacksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePage("/racks");
  const sp = await searchParams;
  const data = await loadRacks(await createClient());
  const tab = sp.tab === "denah" || sp.tab === "daftar" || sp.tab === "riwayat" ? sp.tab : null;
  return (
    <main>
      <PageHeader title="Rak & Lokasi" live={["bins", "bin_changes", "movements"]} liveDebounceMs={3000} />
      <RacksClient {...data} role={user.role} initialTab={tab} />
    </main>
  );
}
