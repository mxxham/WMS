import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbFilterSkeleton, CkbNoticeSkeleton, CkbPageSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Export SAP. The warning that no verified SAP upload format exists comes first — the file is an
 * internal worksheet and a download is not a posting. Then the customer filter, the card of approved
 * adjustments waiting to be frozen (a checkbox per line, and the counts above it) and, under it, the
 * export history: ekspor · customer · jenis · baris · tambah/kurang · status with its SAP document
 * number · dibuat · unduhan.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat export SAP" live pills={0}>
      <CkbNoticeSkeleton lines={3} delayMs={60} />

      <CkbFilterSkeleton fields={1} delayMs={100} />

      {/* Disetujui, belum diekspor: the selection table and the one button that freezes it. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-56 rounded", PULSE)} style={pulseDelay(140)} />
          <Bone className={cn("h-10 w-40 rounded-md", PULSE)} style={pulseDelay(140)} />
        </div>
        <CkbTableSkeleton columns={10} rows={5} delayMs={180} className="rounded-none border-0" />
      </section>

      <section aria-hidden className="space-y-2">
        <Bone className={cn("h-5 w-36 rounded", PULSE)} style={pulseDelay(220)} />
        <CkbTableSkeleton columns={8} rows={6} delayMs={240} />
      </section>
    </CkbPageSkeleton>
  );
}
