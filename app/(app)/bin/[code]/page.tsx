import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBinDetail } from "@/lib/bin-data";
import { parseBinCode } from "@/config/warehouse";
import { Button } from "@/components/ui/button";
import { BinPageClient, type OpenTask } from "./bin-page-client";

export const dynamic = "force-dynamic";

export default async function BinPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ scan?: string }> }) {
  const user = await requireRole(["operator", "supervisor", "admin"]);
  const { code } = await params;
  const { scan } = await searchParams;
  const supabase = await createClient();
  const detail = await getBinDetail(supabase, code);
  const shown = decodeURIComponent(code).toUpperCase();

  if (!detail) {
    const parsed = parseBinCode(shown);
    return (
      <main className="mx-auto max-w-lg p-4">
        <div className="rounded-lg border-2 border-bad bg-white p-5">
          <p className="font-cond text-4xl font-bold">{shown}</p>
          <h1 className="mt-2 text-lg font-semibold text-bad">Bin tidak ditemukan</h1>
          <p className="mt-1 text-sm text-steel-700">
            {parsed
              ? "Formatnya benar, tetapi bin ini belum terdaftar. Minta admin menambahkannya lewat Import."
              : "Kode ini bukan format bin gudang (contoh benar: CA01C01, STAGING, STG_01). Periksa label atau scan ulang."}
          </p>
          <Button asChild size="lg" className="mt-4 w-full"><Link href="/scan">Scan ulang</Link></Button>
        </div>
      </main>
    );
  }

  // Log only real scans (?scan=1), not refreshes or clicks from other screens.
  if (scan === "1") {
    await supabase.from("scan_logs").insert({ bin_id: detail.bin.id, user_id: user.id });
  }

  // Open pick/replenish tasks that start or end here, so a scan shows what to do at this bin.
  const { data: tasks } = await supabase.from("pick_task_detail")
    .select("id, planned_date, wave_no, task_type, shipment_number, sku, quantity, uom, from_bin, to_bin, seq")
    .eq("status", "PLANNED").eq("wave_status", "PENDING")
    .or(`from_bin.eq.${detail.bin.bin_code},to_bin.eq.${detail.bin.bin_code}`)
    .order("planned_date").order("seq").limit(20);

  return <BinPageClient detail={detail} role={user.role} openTasks={(tasks ?? []) as OpenTask[]} />;
}
