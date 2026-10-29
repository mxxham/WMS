import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Sesi stock take baru. One card, worked top to bottom: customer and the snapshot it will be counted
 * against, the coverage switch (semua stok / bin / material) as chips, the warehouse and the blind
 * count checkbox, the grid of counters who may count it, a note, and the button that creates the
 * draft. A draft changes nothing — the counting starts from the session page afterwards.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Membuat sesi stock take" back bodyClassName="max-w-3xl" pills={0}>
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white p-4">
        <div className="space-y-4">
          {/* Customer, then the snapshot dasar it will be measured against. */}
          <div className={cn("grid gap-3 sm:grid-cols-2", PULSE)} style={pulseDelay(80)}>
            {[0, 1].map((i) => (
              <div key={i}>
                <Bone className={cn("mb-1 h-2.5 rounded", i === 0 ? "w-16" : "w-28")} />
                <Bone className="h-10 w-full rounded-md" />
              </div>
            ))}
          </div>

          {/* Cakupan: the legend, then the chips. */}
          <div className={cn(PULSE)} style={pulseDelay(120)}>
            <Bone className="mb-1.5 h-2.5 w-16 rounded" />
            <div className="flex flex-wrap gap-2">
              <Bone className="h-10 w-28 rounded-md" />
              <Bone className="h-10 w-24 rounded-md" />
              <Bone className="h-10 w-32 rounded-md" />
            </div>
          </div>

          {/* Gudang, and the blind-count line beside it. */}
          <div className={cn("grid gap-3 sm:grid-cols-2", PULSE)} style={pulseDelay(160)}>
            <div>
              <Bone className="mb-1 h-2.5 w-14 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
            <div className="flex min-h-10 items-center gap-2">
              <Bone className="h-4 w-4 rounded-sm" />
              <Bone className="h-2.5 w-48 rounded" />
            </div>
          </div>

          {/* Penghitung yang ditugaskan: the hint, then the two/three-column grid of names. */}
          <div className={cn(PULSE)} style={pulseDelay(200)}>
            <Bone className="mb-1 h-2.5 w-40 rounded" />
            <Bone className="mb-2 h-2 w-64 rounded" />
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex min-h-10 items-center gap-2">
                  <Bone className="h-4 w-4 rounded-sm" />
                  <Bone className={cn("h-2.5 rounded", i % 2 ? "w-20" : "w-24")} />
                </div>
              ))}
            </div>
          </div>

          {/* Catatan sesi. */}
          <div className={cn(PULSE)} style={pulseDelay(240)}>
            <Bone className="mb-1 h-2.5 w-14 rounded" />
            <Bone className="h-10 w-full rounded-md" />
          </div>

          <div className={cn("space-y-2", PULSE)} style={pulseDelay(280)}>
            <Bone className="h-10 w-40 rounded-md" />
            <Bone className="h-2 w-72 max-w-full rounded" />
          </div>
        </div>
      </section>
    </CkbPageSkeleton>
  );
}
