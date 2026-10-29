import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbFactsSkeleton, CkbPageSkeleton, CkbPhotoGridSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * One inspection, in the order it is read: the header (status and result pills), the notices a
 * rejected or superseded record carries, the eleven facts (document, warehouse/location, material,
 * batch, package, inspector, submitted, reviewer, damage class, closed), then the checklist grouped by
 * its own categories — a label on the left, the answer or OK/NG/NA pill on the right — and finally the
 * photo and document evidence, which is a gallery of square thumbnails with its upload row under it.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat inspeksi" back live pills={2}>
      <CkbFactsSkeleton items={11} delayMs={100} />

      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-28 rounded", PULSE)} style={pulseDelay(140)} />
        </div>
        <div className={cn("space-y-4 p-4", PULSE)} style={pulseDelay(160)}>
          {[0, 1].map((cat) => (
            <div key={cat}>
              {/* The category heading the checklist template groups its items under. */}
              <Bone className="mb-1 h-2.5 w-24 rounded" />
              <ul className="divide-y divide-steel-100">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <Bone className={cn("h-3 rounded", i % 2 ? "w-48" : "w-64")} />
                    {/* A check item answers in a pill; a number or text item answers in words. */}
                    {cat === 0 ? <Bone className="h-5 w-8 rounded" /> : <Bone className="h-3 w-16 rounded" />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-hidden className="rounded-lg border border-steel-100 bg-white">
        <div className="border-b border-steel-100 px-4 py-3">
          <Bone className={cn("h-5 w-40 rounded", PULSE)} style={pulseDelay(200)} />
        </div>
        <div className={cn("space-y-4 p-4", PULSE)} style={pulseDelay(220)}>
          <CkbPhotoGridSkeleton count={4} delayMs={240} />

          {/* The evidence row: jenis, keterangan, then the Foto / file button. */}
          <div className="grid gap-2 rounded-md bg-paper p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <div>
              <Bone className="mb-1 h-2 w-12 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
            <div>
              <Bone className="mb-1 h-2 w-24 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
            <Bone className="h-10 w-32 rounded-md" />
          </div>
        </div>
      </section>
    </CkbPageSkeleton>
  );
}
