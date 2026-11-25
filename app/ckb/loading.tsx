import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, CkbStatTilesSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * The fallback for any CKB page that has no skeleton of its own (the home and the dashboard each have theirs): a header, a
 * row of tiles and a block, so the shell never flashes the wrong page's layout.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat halaman" pills={0}>
      <CkbStatTilesSkeleton count={4} delayMs={80} />
      <Bone className={cn("h-64 w-full rounded-lg", PULSE)} style={pulseDelay(140)} />
    </CkbPageSkeleton>
  );
}
