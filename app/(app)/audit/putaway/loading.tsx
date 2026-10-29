import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Audit putaway, the "Per rak" tab: the bar with the picking/putaway switch, the two tabs, the three
 * counters for racks not yet audited / in mismatch / done, the sentence about what a checker checks,
 * and the rack list (one row per aisle, with its progress).
 *
 * The download button is left out: it is only drawn when the day has putaways, and here it would
 * claim the day has work. The "Daftar" tab belongs to a supervisor, but a loading skeleton cannot
 * read the session, so the strip keeps both tabs rather than growing one after the load.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat audit putaway" header={false} className="flex flex-col">
      <AuditBarSkeleton />

      {/* Per rak · Daftar. */}
      <div aria-hidden className={cn("flex gap-1 overflow-x-auto border-b border-steel-100 bg-white px-4 lg:px-8", PULSE)}
        style={{ animationDelay: "40ms" }}>
        {["w-16", "w-16"].map((width, i) => (
          <div key={i} className="shrink-0 border-b-2 border-transparent px-3 py-2.5">
            <Bone className={cn("h-3 rounded", width, i === 0 && "bg-steel-300/60")} />
          </div>
        ))}
      </div>

      <div className="space-y-4 p-4 lg:p-8">
        {/* Rak belum diaudit · selisih · selesai. */}
        <div aria-hidden className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn("rounded-lg bg-white p-3", PULSE)} style={{ animationDelay: `${80 + i * 20}ms` }}>
              <Bone className="h-8 w-12 rounded" />
              <Bone className="mt-1 h-2.5 w-24 rounded" />
            </div>
          ))}
        </div>

        {/* What the checker compares: SKU, batch and quantity of every putaway. */}
        <div aria-hidden className={cn(PULSE)} style={{ animationDelay: "140ms" }}>
          <Bone className="h-3 w-full max-w-3xl rounded" />
        </div>

        {/* Rak · Bin diisi · Putaway · Sudah diaudit · Status. */}
        <section aria-hidden className={SKELETON_CARD}>
          <TableSkeleton columns={5} rows={7} delayMs={180} />
        </section>
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
        <Bone className="h-8 w-40 rounded sm:w-48" />
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
