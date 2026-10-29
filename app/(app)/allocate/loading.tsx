import { Bone, PULSE, PageSkeleton, SKELETON_CARD } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Alokasi FEFO: the one card that starts a run — the workbook, the four options, the stock-basis
 * notice, the notice about waves still open from earlier days, and the button. The result section
 * (fill rate, picklist summary, the tabbed tables) is rendered only after a run, so a skeleton that
 * drew it would claim the day had already been calculated.
 *
 * The card is the whole page until then, so the skeleton is one card and a little air under it.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat alokasi" className="flex flex-col gap-4 p-4 lg:p-8">
      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("px-4 pb-3 pt-4", PULSE)}>
          <Bone className="h-5 w-44 rounded" />
        </div>

        <div className={cn("grid gap-4 border-t border-steel-100 px-4 py-4 md:grid-cols-3", PULSE)} style={{ animationDelay: "50ms" }}>
          {/* File WMS harian: the label and the dashed target the workbook is dropped onto. */}
          <div className="md:col-span-3">
            <Bone className="mb-1.5 h-2.5 w-72 max-w-full rounded" />
            <Bone className="h-16 rounded-md border-2 border-dashed border-steel-300 bg-paper" />
          </div>

          {/* Tanggal alokasi · Sumber stok · Sisa umur minimum · Target isi pickface. */}
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Bone className="mb-1.5 h-2.5 w-32 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
          ))}

          {/* Pisahkan picklist forklift (palet) & handpick (karton). */}
          <div className="flex items-center gap-2 pb-2 pt-6">
            <Bone className="h-4 w-4 rounded-sm" />
            <Bone className="h-2.5 w-64 max-w-full rounded" />
          </div>

          {/* Sumber stok basis: the date the stock was imported, or the "run anyway" tick. */}
          <div className="space-y-2 md:col-span-3">
            <Bone className="h-3 w-56 rounded" />
            <Bone className="h-10 rounded-md border border-steel-100 bg-paper" />
          </div>

          {/* Waves of earlier dates still open: a bordered notice, then the acknowledgement tick. */}
          <div className="space-y-2 md:col-span-3">
            <Bone className="h-2.5 w-64 rounded" />
            <div className="space-y-2 rounded-md border border-steel-300 bg-white p-3">
              <Bone className="h-3 w-52 rounded" />
              <Bone className="h-2.5 w-full max-w-2xl rounded" />
              <Bone className="h-2.5 w-full max-w-xl rounded" />
            </div>
          </div>

          {/* Jalankan alokasi. */}
          <div className="self-end">
            <Bone className="h-10 w-full rounded-md" />
          </div>
        </div>
      </section>
    </PageSkeleton>
  );
}
