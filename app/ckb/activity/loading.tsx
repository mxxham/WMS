import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, CkbFilterSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Log aktivitas. Four filters (customer, jenis, dari, sampai), then the append-only event table —
 * waktu · oleh · tindakan with its entity under it · customer · the JSON details — and the pager
 * line beneath ("N kejadian", Sebelumnya / Berikutnya). The rows are read-only forever, so there is
 * no action column to hold open.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat log aktivitas" pills={0}>
      <CkbFilterSkeleton fields={4} delayMs={80} />

      <CkbTableSkeleton columns={5} rows={12} delayMs={220} />

      {/* The pager: how many events, and the two page links. */}
      <div aria-hidden className={cn("flex items-center justify-between", PULSE)} style={pulseDelay(280)}>
        <Bone className="h-3 w-24 rounded" />
        <div className="flex gap-3">
          <Bone className="h-3 w-20 rounded" />
          <Bone className="h-3 w-20 rounded" />
        </div>
      </div>
    </CkbPageSkeleton>
  );
}
