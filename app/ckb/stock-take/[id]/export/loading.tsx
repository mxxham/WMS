import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, CkbSheetSkeleton, CkbStatTilesSkeleton, CkbStepRailSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Ekspor sesi. The last stage: the rail with its end lit, then the count sheet — the heading, the one
 * sentence saying what the file holds, and the three downloads (semua tugas in Excel and PDF, only
 * the differences in Excel) — and under it the sheet's second half: the four adjustment figures
 * (proposed · approved · exported · rejected) and the button that carries the approved ones to SAP.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat ekspor sesi" back pills={0} bodyClassName="max-w-3xl">
      <CkbStepRailSkeleton steps={3} active={2} delayMs={80} />

      <CkbSheetSkeleton lines={1} actions={3} delayMs={120} />

      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-40 rounded", PULSE)} style={pulseDelay(180)} />
        </div>
        <div className={cn("space-y-3 p-4", PULSE)} style={pulseDelay(200)}>
          <CkbStatTilesSkeleton count={4} columns="grid-cols-2 gap-3 sm:grid-cols-4" delayMs={220} />
          <Bone className="h-10 w-64 max-w-full rounded-md" />
        </div>
      </section>
    </CkbPageSkeleton>
  );
}
