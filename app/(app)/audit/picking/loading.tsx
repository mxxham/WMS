import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Audit picking, the default "Per rak" tab: the bar with the picking/putaway switch and the date,
 * the tab strip, the download button, the three counters, the sentence that explains what a checker
 * counts, and the rack list.
 *
 * The bar is drawn here instead of using the kit's `HeaderSkeleton` because this page's header
 * carries the switch and the date form — the kit header has no room for them, and a title alone
 * would land in a different place than the real one.
 *
 * Two shapes are left out because they depend on the day, not on the page: the "Bin To Bin" column
 * of the rack list (only on days with replenishment moves) and the fourth tab, "Akurasi picking",
 * which only a supervisor is given. A skeleton cannot read the session, so the strip keeps the
 * page's full four-tab width rather than shrinking after the load.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat audit picking" header={false} className="flex flex-col">
      <AuditBarSkeleton />

      {/* Per rak · Shipment · Dari file WMS · Akurasi picking. */}
      <div aria-hidden className={cn("flex gap-1 overflow-x-auto border-b border-steel-100 bg-white px-4 lg:px-8", PULSE)}
        style={{ animationDelay: "40ms" }}>
        {["w-16", "w-20", "w-28", "w-32"].map((width, i) => (
          <div key={i} className="shrink-0 border-b-2 border-transparent px-3 py-2.5">
            <Bone className={cn("h-3 rounded", width, i === 0 && "bg-steel-300/60")} />
          </div>
        ))}
      </div>

      <div className="space-y-4 p-4 lg:p-8">
        {/* Unduh audit hari ini (.xlsx). */}
        <div aria-hidden className={cn("flex flex-wrap items-center gap-2", PULSE)} style={{ animationDelay: "80ms" }}>
          <Bone className="h-10 w-56 rounded-md" />
          <Bone className="h-2.5 w-40 rounded" />
        </div>

        {/* Rak belum dihitung · selisih · selesai. */}
        <div aria-hidden className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn("rounded-lg bg-white p-3", PULSE)} style={{ animationDelay: `${100 + i * 20}ms` }}>
              <Bone className="h-8 w-12 rounded" />
              <Bone className="mt-1 h-2.5 w-24 rounded" />
            </div>
          ))}
        </div>

        {/* What the checker counts: the emptied bin and both sides of every Bin To Bin. */}
        <div aria-hidden className={cn("space-y-1.5", PULSE)} style={{ animationDelay: "160ms" }}>
          <Bone className="h-3 w-full max-w-4xl rounded" />
          <Bone className="h-3 w-full max-w-2xl rounded" />
        </div>

        {/* Rak · Bin dipick · Baris · Sudah dihitung · Status. */}
        <section aria-hidden className={SKELETON_CARD}>
          <TableSkeleton columns={5} rows={7} delayMs={200} />
        </section>
      </div>
    </PageSkeleton>
  );
}

/** The page header this route really has: title, Live dot, picking/putaway switch, date, Tampilkan. */
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
