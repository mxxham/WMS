import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Audit of one wave's Bin To Bin moves: the header with its way back to the date, the card that says
 * which wave this is and how far its lines have got, and the table of moves with both bins of every
 * line — the source and its remaining stock, the destination and what arrived.
 *
 * The "Shipment audit: SH …" links in the summary card are left out: a wave of replenishment moves
 * may carry none, and the skeleton cannot know.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat audit pindahan bin" className="flex flex-col gap-4 p-4 lg:p-8">
      {/* The wave: number and state, its date and slot, how many lines passed. */}
      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-4", PULSE)}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Bone className="h-7 w-28 rounded" />
              <Bone className="h-5 w-20 rounded" />
            </div>
            <Bone className="h-2.5 w-56 max-w-full rounded" />
            <Bone className="h-3 w-44 max-w-full rounded" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Bone className="h-2.5 w-24 rounded" />
            <Bone className="h-2.5 w-16 rounded" />
            <Bone className="h-2.5 w-16 rounded" />
          </div>
        </div>
      </section>

      {/* # · SKU · Dari bin · Ke bin · Petugas. */}
      <section aria-hidden className={SKELETON_CARD}>
        <TableSkeleton columns={5} rows={8} delayMs={140} />
      </section>
    </PageSkeleton>
  );
}
