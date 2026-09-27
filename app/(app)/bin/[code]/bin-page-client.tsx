"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ListChecks, ScanLine } from "lucide-react";
import { BinDetailView } from "@/components/bin/bin-detail-view";
import { LiveRefresh } from "@/components/app/live-refresh";
import { Button } from "@/components/ui/button";
import type { BinDetail } from "@/lib/bin-data";
import type { Role } from "@/lib/types";
import { fmtNum } from "@/lib/utils";

export type OpenTask = {
  id: string; planned_date: string; wave_no: string; task_type: "PICK" | "REPLENISH"; shipment_number: string | null;
  sku: string; quantity: number; uom: string | null; from_bin: string; to_bin: string | null; seq: number;
};

export function BinPageClient({ detail, role, openTasks }: { detail: BinDetail; role: Role; openTasks: OpenTask[] }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <main className="mx-auto max-w-4xl p-4 lg:p-8">
      <div className="mb-2 flex justify-end"><LiveRefresh tables={["movements", "pick_tasks", "waves"]} /></div>
      {openTasks.length > 0 && (
        <section className="mb-4 rounded-lg border-2 border-plate bg-white p-4" aria-label="Tugas terencana">
          <h2 className="flex items-center gap-2 font-cond text-lg font-semibold"><ListChecks className="h-5 w-5" />{openTasks.length} tugas terencana di bin ini</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {openTasks.map((t) => {
              const out = t.from_bin === detail.bin.bin_code;
              return (
                <li key={t.id}>
                  <Link href={`/waves?date=${t.planned_date}`} className="underline-offset-2 hover:underline">
                    NO {t.wave_no} #{t.seq}: {out ? "ambil" : "terima"} <b>{fmtNum(Number(t.quantity))} {t.uom}</b> SKU {t.sku}{" "}
                    {t.task_type === "PICK" ? `untuk shipment ${t.shipment_number}` : out ? `→ pickface ${t.to_bin}` : `dari ${t.from_bin}`}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <BinDetailView detail={detail} role={role} onChanged={() => { router.replace(path); router.refresh(); }} />
      <Button asChild variant="outline" size="lg" className="mt-6 w-full sm:w-auto"><Link href="/scan"><ScanLine className="h-5 w-5" />Scan bin berikutnya</Link></Button>
    </main>
  );
}
