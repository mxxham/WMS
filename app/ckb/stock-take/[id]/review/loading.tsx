import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbNoticeSkeleton, CkbPageSkeleton, CkbStepRailSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Review. The middle stage of the session: the rail with review lit, the notice that accepting a
 * count changes no stock, then one decision block per undecided task — bin plate and material, the
 * description and the SAP figure it is measured against, its classification and status pills, its
 * count history (each round with its quantity, note and photo count), and the three decisions
 * (Terima / Hitung ulang / Kecualikan). The adjustments the accepted variances became sit under it,
 * as a table with a checkbox column and one batch decision.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat review stock take" back live pills={1} actions={1}>
      <CkbStepRailSkeleton steps={3} active={1} delayMs={80} />

      <CkbNoticeSkeleton lines={2} delayMs={120} />

      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-48 rounded", PULSE)} style={pulseDelay(160)} />
        </div>
        <div className={cn("space-y-3 p-4", PULSE)} style={pulseDelay(180)}>
          {[0, 1, 2].map((block) => (
            <div key={block} className="rounded-md border border-steel-100 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    {/* The bin plate, then the sequence number and the material. */}
                    <span className="rounded-plate bg-plate px-1.5 py-0.5">
                      <Bone className="h-3.5 w-12 rounded bg-steel/25" />
                    </span>
                    <Bone className="h-3 w-28 rounded" />
                  </div>
                  <Bone className="h-2.5 w-64 max-w-full rounded" />
                </div>
                <div className="flex flex-wrap gap-1">
                  <Bone className="h-5 w-20 rounded" />
                  <Bone className="h-5 w-24 rounded" />
                </div>
              </div>

              {/* The count history of this task: one line per round. */}
              <div className="mt-2 space-y-1.5 rounded-md bg-paper p-2">
                {[0, 1].map((row) => (
                  <div key={row} className="flex items-center gap-2">
                    <Bone className="h-2.5 w-16 rounded" />
                    <Bone className="h-2.5 w-20 rounded" />
                    <Bone className="h-2.5 w-16 rounded" />
                    <Bone className="ml-auto h-2.5 w-10 rounded" />
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Bone className="h-8 w-20 rounded-md" />
                <Bone className="h-8 w-28 rounded-md" />
                <Bone className="h-8 w-24 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Penyesuaian: SAP · fisik · selisih · penghitung · status, with the batch decision above it. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-40 rounded", PULSE)} style={pulseDelay(240)} />
          <div className={cn("flex gap-2", PULSE)} style={pulseDelay(240)}>
            <Bone className="h-8 w-24 rounded-md" />
            <Bone className="h-8 w-20 rounded-md" />
          </div>
        </div>
        <CkbTableSkeleton columns={9} rows={4} delayMs={280} className="rounded-none border-0" />
      </section>
    </CkbPageSkeleton>
  );
}
