import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbNoticeSkeleton, CkbPageSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Selisih. The investigation view: the notice that a short bin is never netted against an over bin,
 * the "tampilkan juga yang cocok" toggle, then one card per task that did not match — the bin plate
 * and material on the left with its classification, task status and "mungkin salah bin" pills on the
 * right, the three figures it is judged by (SAP · diterima or last count · selisih), the
 * classification's own hint, and the count history folded away underneath.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat selisih" back live pills={0} actions={1}>
      <CkbNoticeSkeleton lines={3} delayMs={80} />

      {/* "Tampilkan juga yang cocok". */}
      <Bone className={cn("h-3 w-40 rounded", PULSE)} style={pulseDelay(120)} />

      <ul aria-hidden className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className={cn("rounded-lg border border-steel-100 bg-white p-4", PULSE)} style={pulseDelay(160 + i * 30)}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="rounded-plate bg-plate px-1.5 py-0.5">
                    <Bone className="h-3.5 w-12 rounded bg-steel/25" />
                  </span>
                  <Bone className="h-3 w-28 rounded" />
                </div>
                <Bone className="h-2.5 w-64 max-w-full rounded" />
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Bone className="h-5 w-20 rounded" />
                <Bone className="h-5 w-24 rounded" />
              </div>
            </div>

            {/* SAP · diterima atau hitungan terakhir · selisih — three figures, never summed. */}
            <div className="mt-2 grid grid-cols-3 gap-2 sm:max-w-md">
              {[0, 1, 2].map((n) => (
                <div key={n}>
                  <Bone className="h-2 w-12 rounded" />
                  <Bone className="mt-1 h-3.5 w-16 rounded" />
                </div>
              ))}
            </div>

            <Bone className="mt-2 h-2 w-2/3 rounded" />
            <Bone className="mt-2.5 h-2.5 w-48 rounded" />
          </li>
        ))}
      </ul>
    </CkbPageSkeleton>
  );
}
