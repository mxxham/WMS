import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbFilterSkeleton, CkbPageSkeleton, CkbStatTilesSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Laporan. The report picker first — a chip per kind, the one you are reading filled — then that
 * report's blurb, its own filters, the Excel / PDF pair and the note that the file holds the same rows
 * as the filters, the four summary figures, and the result table. One report at a time is on screen,
 * so the skeleton holds one table, not nine.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat laporan" pills={0}>
      {/* Jenis laporan: the chips, the active one filled. */}
      <div aria-hidden className={cn("flex flex-wrap gap-2", PULSE)} style={pulseDelay(60)}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Bone key={i} className={cn("h-9 rounded-full", i === 0 ? "w-28 bg-steel-300/60" : i % 2 ? "w-24" : "w-32")} />
        ))}
      </div>

      <Bone className={cn("h-2.5 w-full max-w-2xl rounded", PULSE)} style={pulseDelay(100)} />

      <CkbFilterSkeleton fields={3} delayMs={120} />

      {/* Excel, PDF, and the line that says the file matches the filters. */}
      <div aria-hidden className={cn("flex flex-wrap items-center gap-2", PULSE)} style={pulseDelay(160)}>
        <Bone className="h-8 w-24 rounded-md" />
        <Bone className="h-8 w-20 rounded-md" />
        <Bone className="ml-1 h-2.5 w-56 rounded" />
      </div>

      <CkbStatTilesSkeleton count={4} delayMs={200} />

      <CkbTableSkeleton columns={7} rows={12} delayMs={240} />
    </CkbPageSkeleton>
  );
}
