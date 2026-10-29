import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * One shipment's lines, audited at staging: the card with "SH …" and its state, the wave / date /
 * truck line, how many lines passed, and the "Muat shipment" button — then the table the checker
 * works down, one row per line with the picker, the bin's remaining stock and the audit button.
 *
 * The line above the card that opens the wave's Bin To Bin audit is left out: it is only there when
 * the wave had replenishment moves.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat audit shipment" className="flex flex-col gap-3 p-4 lg:p-8">
      {/* The shipment: its number and state, its wave, date and truck, how many lines passed. */}
      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-4", PULSE)}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Bone className="h-7 w-24 rounded" />
              <Bone className="h-5 w-24 rounded" />
            </div>
            <Bone className="h-2.5 w-64 max-w-full rounded" />
            <Bone className="h-3 w-56 max-w-full rounded" />
          </div>
          <Bone className="h-11 w-44 rounded-md" />
        </div>
      </section>

      {/* # · SKU · Bin asal · Sisa di bin · Picker · Status · Dipick / audit · aksi. */}
      <section aria-hidden className={SKELETON_CARD}>
        <TableSkeleton columns={8} rows={9} delayMs={140} />
      </section>
    </PageSkeleton>
  );
}
