import { Bone, PULSE, PageSkeleton, SKELETON_CARD } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Cetak label bin: two columns on a desktop and one on a phone. Left, the card that says which bins
 * are printed (one rack, one aisle or a list) and the card that says how (the strip or the single
 * cell, colour or thermal black, with or without a Code 128), then at the right the warning about
 * printing at 100%, the button that builds the PDF, and the history of prints.
 *
 * Nothing here names a rack, an aisle or a bin: the pickers list only what the warehouse owns, and a
 * placeholder that printed "CA01" would be a claim about a shelf.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat cetak label" className="grid gap-6 p-4 lg:grid-cols-[1fr_22rem] lg:p-8">
      <div className="space-y-6">
        {/* Bin yang dicetak: the three scopes, then the aisle and rack pickers. */}
        <section aria-hidden className={SKELETON_CARD}>
          <div className={cn("px-4 pb-3 pt-4", PULSE)}>
            <Bone className="h-5 w-40 rounded" />
          </div>
          <div className={cn("space-y-4 border-t border-steel-100 px-4 py-4", PULSE)} style={{ animationDelay: "50ms" }}>
            <div className="flex flex-wrap gap-2">
              <Bone className="h-10 w-24 rounded-md" />
              <Bone className="h-10 w-36 rounded-md" />
              <Bone className="h-10 w-28 rounded-md" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map((i) => (
                <div key={i}>
                  <Bone className="mb-1.5 h-2.5 w-20 rounded" />
                  <Bone className="h-10 w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Format: layout, colour mode and the optional Code 128. */}
        <section aria-hidden className={SKELETON_CARD}>
          <div className={cn("px-4 pb-3 pt-4", PULSE)} style={{ animationDelay: "90ms" }}>
            <Bone className="h-5 w-20 rounded" />
          </div>
          <div className={cn("space-y-4 border-t border-steel-100 px-4 py-4", PULSE)} style={{ animationDelay: "110ms" }}>
            {[0, 1].map((group) => (
              <div key={group} className="space-y-2">
                <Bone className="h-3 w-24 rounded" />
                {[0, 1].map((row) => (
                  <div key={row} className="flex gap-2">
                    <Bone className="mt-0.5 h-4 w-4 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Bone className="h-2.5 w-full max-w-2xl rounded" />
                      <Bone className="h-2.5 w-3/4 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Bone className="h-4 w-4 shrink-0 rounded-sm" />
              <Bone className="h-2.5 w-64 max-w-full rounded" />
            </div>
          </div>
        </section>
      </div>

      <div className="space-y-4">
        {/* Cetak di skala 100%: the warning box the printer dialog makes people need. */}
        <div aria-hidden className={cn("space-y-2 rounded-lg border-2 border-warn bg-warn/10 p-4", PULSE)} style={{ animationDelay: "140ms" }}>
          <Bone className="h-3.5 w-52 rounded" />
          <Bone className="h-2.5 w-full rounded" />
          <Bone className="h-2.5 w-full rounded" />
          <Bone className="h-2.5 w-2/3 rounded" />
        </div>

        {/* Buat PDF label. */}
        <div aria-hidden className={cn(PULSE)} style={{ animationDelay: "160ms" }}>
          <Bone className="h-12 w-full rounded-md" />
        </div>

        {/* Riwayat cetak: how many bins, by whom, and when. */}
        <section aria-hidden className={SKELETON_CARD}>
          <div className={cn("px-4 pb-3 pt-4", PULSE)} style={{ animationDelay: "180ms" }}>
            <Bone className="h-4 w-32 rounded" />
          </div>
          <div className={cn("space-y-3 border-t border-steel-100 px-4 py-4", PULSE)} style={{ animationDelay: "200ms" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5 border-b border-steel-100 pb-3 last:border-0 last:pb-0">
                <Bone className="h-3 w-40 rounded" />
                <Bone className="h-2 w-48 max-w-full rounded" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </PageSkeleton>
  );
}
