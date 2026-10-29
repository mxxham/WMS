import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * One bin, opened from a scan: no page header — the bin plate is the heading. The Live dot sits on
 * its own line at the right, then the yellow plate with the code and its four parts, the three
 * figures under it (utilisation, ABC class, how many stock rows), the four movement buttons, the
 * stock in FEFO order, the last ten movements, and the way on to the next scan.
 *
 * The planned-tasks card above the plate is left out: it only exists when a wave has work at this
 * bin, and the skeleton cannot know that the bin is in a wave.
 *
 * The plate is the page's signature, so it is drawn as a plate — a wide block on the same yellow —
 * rather than as another white card.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat bin" header={false} mainClassName="mx-auto max-w-4xl p-4 lg:p-8" className="space-y-5">
      {/* LiveRefresh, pinned right like the real page's. */}
      <div aria-hidden className={cn("flex justify-end", PULSE)}>
        <Bone className="h-3 w-24 rounded" />
      </div>

      {/* BinPlate: the level's colour strip, the code, then aisle / rack / level / position. */}
      <div aria-hidden className={cn("overflow-hidden rounded-plate bg-plate", PULSE)} style={{ animationDelay: "60ms" }}>
        <div className="h-2 bg-steel-300/40" />
        <div className="space-y-3 px-4 py-3">
          <Bone className="h-14 w-64 max-w-full rounded bg-steel-300/35" />
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-baseline gap-1.5">
                <Bone className="h-2.5 w-10 rounded bg-steel-300/35" />
                <Bone className="h-3.5 w-12 rounded bg-steel-300/50" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Utilisasi (with its bar) · Kelas ABC · Baris stok. */}
      <div aria-hidden className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={cn("rounded-md bg-white p-3", PULSE)} style={{ animationDelay: `${100 + i * 20}ms` }}>
            <Bone className="h-2.5 w-16 rounded" />
            <Bone className="mt-1.5 h-7 w-16 rounded" />
            {i === 0 && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-steel-100">
                <div className="h-full w-2/3 rounded bg-steel-300/60" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Putaway · Pick · Transfer · Adjust. */}
      <div aria-hidden className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", PULSE)} style={{ animationDelay: "140ms" }}>
        {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-11 rounded-md" />)}
      </div>

      {/* Isi bin, urut FEFO: cards on a phone, the eight-column table from sm up. */}
      <section aria-hidden className="space-y-2">
        <div className={cn("flex items-baseline gap-2", PULSE)} style={{ animationDelay: "160ms" }}>
          <Bone className="h-6 w-28 rounded" />
          <Bone className="h-2.5 w-20 rounded" />
        </div>

        <div className="space-y-2 sm:hidden">
          {[0, 1].map((i) => (
            <div key={i} className={cn("rounded-md bg-white p-3", PULSE)} style={{ animationDelay: `${180 + i * 20}ms` }}>
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1.5">
                  <Bone className="h-3.5 w-20 rounded" />
                  <Bone className="h-2 w-40 rounded" />
                </div>
                <Bone className="h-5 w-16 rounded-full" />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[0, 1, 2].map((c) => (
                  <div key={c}>
                    <Bone className="h-2 w-12 rounded" />
                    <Bone className="mt-1 h-3.5 w-14 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className={cn(SKELETON_CARD, "hidden sm:block")}>
          <TableSkeleton columns={8} rows={4} delayMs={180} />
        </div>
      </section>

      {/* 10 mutasi terakhir: one row per movement, the signed quantity at the right edge. */}
      <section aria-hidden className="space-y-2">
        <div className={cn(PULSE)} style={{ animationDelay: "220ms" }}>
          <Bone className="h-6 w-44 rounded" />
        </div>
        <div className={cn("divide-y divide-steel-100 rounded-md bg-white", PULSE)} style={{ animationDelay: "240ms" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0 space-y-1.5">
                <Bone className="h-3 w-40 max-w-full rounded" />
                <Bone className="h-2 w-64 max-w-full rounded" />
              </div>
              <Bone className="h-4 w-12 shrink-0 rounded" />
            </div>
          ))}
        </div>
      </section>

      {/* Scan bin berikutnya. */}
      <div aria-hidden className={cn("mt-6", PULSE)} style={{ animationDelay: "260ms" }}>
        <Bone className="h-11 w-full rounded-md sm:w-56" />
      </div>
    </PageSkeleton>
  );
}
