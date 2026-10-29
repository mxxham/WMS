import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Audit putaway, one rack: the header with the picking/putaway switch, then the rack screen — the
 * way back to all racks, the summary card (rack, state, how many putaways into how many bins, the
 * checker's name and the walk button), the sentence about what "Sesuai" means, and the eight-column
 * table with a header row per rack number.
 *
 * The download button above the card only appears when the rack has putaways on the date; it is left
 * out so the skeleton does not claim the rack does.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat audit putaway rak" header={false} className="flex flex-col">
      <AuditBarSkeleton />

      <div className="space-y-4 p-4 lg:p-8">
        <div aria-hidden className={cn("space-y-4", PULSE)} style={{ animationDelay: "80ms" }}>
          {/* Semua rak. */}
          <Bone className="h-2.5 w-24 rounded" />

          <div className={SKELETON_CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Bone className="h-7 w-28 rounded" />
                  <Bone className="h-5 w-20 rounded" />
                </div>
                <Bone className="h-2.5 w-56 max-w-full rounded" />
                <Bone className="h-3 w-52 max-w-full rounded" />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Bone className="mb-1.5 h-2.5 w-32 rounded" />
                  <Bone className="h-10 w-40 rounded-md" />
                </div>
                <Bone className="h-11 w-56 rounded-md" />
              </div>
            </div>
          </div>

          {/* What to compare, and how to record a wrong one. */}
          <div className="space-y-1.5">
            <Bone className="h-3 w-full max-w-4xl rounded" />
            <Bone className="h-3 w-full max-w-2xl rounded" />
          </div>

          {/* Bin · SKU · Batch / exp · Qty · Putaway · Status · Audit terakhir · aksi. */}
          <section className={SKELETON_CARD}>
            <TableSkeleton columns={8} rows={8} delayMs={120} />
          </section>
        </div>
      </div>
    </PageSkeleton>
  );
}

/** This route's header: title, Live dot, picking/putaway switch, date, Tampilkan. */
function AuditBarSkeleton() {
  return (
    <div aria-hidden className="flex flex-wrap items-end justify-between gap-3 border-b border-steel-100 bg-white px-4 py-4 lg:px-8">
      <div className={cn("flex items-baseline gap-3", PULSE)}>
        <Bone className="h-9 w-9 self-center rounded-md lg:hidden" />
        <Bone className="h-8 w-48 rounded sm:w-56" />
        <Bone className="h-2 w-2 rounded-full" />
      </div>
      <div className={cn("flex flex-wrap items-center gap-2", PULSE)} style={{ animationDelay: "60ms" }}>
        <Bone className="h-10 w-36 rounded-md" />
        <Bone className="h-10 w-36 rounded-md" />
        <Bone className="h-10 w-24 rounded-md" />
      </div>
      <div className={cn("ml-auto flex items-center gap-3", PULSE)} style={{ animationDelay: "60ms" }}>
        <Bone className="h-2.5 w-10 rounded" />
        <Bone className="h-10 w-10 rounded-full" />
      </div>
    </div>
  );
}
