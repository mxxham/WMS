import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbCompareSkeleton, CkbPageSkeleton, CkbStatTilesSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Bandingkan snapshot. Two snapshots of one customer, identity by identity: the four figures (berubah
 * · baru · hilang · sama), the note that the comparison is per stock identity and never summed across
 * bins, and then the comparison itself, whose A quantity, B quantity and delta must be read as one
 * group — the reason that table is drawn here rather than as a plain grid.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat perbandingan snapshot" back pills={0}>
      <CkbStatTilesSkeleton count={4} delayMs={80} />

      <div aria-hidden className={cn("space-y-1.5", PULSE)} style={pulseDelay(120)}>
        <Bone className="h-2.5 w-full max-w-3xl rounded" />
        <Bone className="h-2.5 w-40 rounded" />
      </div>

      <CkbCompareSkeleton rows={8} delayMs={160} />
    </CkbPageSkeleton>
  );
}
