import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Penugasan: one day of shipments, each given to an Operator / Picker. The day bar (the two arrows,
 * the date, the calendar), the line of operators with their open counts, then the board — eight
 * columns on a desktop and one card per shipment on a phone, under the same `lg` breakpoint the
 * real board switches at.
 *
 * Nothing here names a shipment, a slot or a truck: the board is the record of who is responsible
 * for what today, and a placeholder that printed "SH 12" would be a claim about the day.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat penugasan" className="flex flex-col gap-4 p-4 lg:p-8">
      {/* Day nav: previous, the date, next, the calendar. */}
      <div aria-hidden className={cn("rounded-lg bg-white p-4", PULSE)}>
        <div className="flex items-center gap-1">
          <Bone className="h-11 w-11 rounded-md" />
          <Bone className="h-7 w-52 rounded" />
          <Bone className="h-11 w-11 rounded-md" />
          <Bone className="h-11 w-11 rounded-md" />
        </div>
      </div>

      {/* Operator: one line of names, each with its open count. */}
      <div aria-hidden className={cn("space-y-1.5 rounded-lg bg-white p-4", PULSE)} style={{ animationDelay: "60ms" }}>
        <Bone className="h-3 w-64 max-w-full rounded" />
        <Bone className="h-3 w-80 max-w-full rounded" />
      </div>

      {/* Desktop: NO · Shipment · Slot · Truck · FL · HP · Status · Operator. */}
      <section aria-hidden className={cn(SKELETON_CARD, "hidden lg:block")}>
        <TableSkeleton columns={8} rows={7} delayMs={120} />
      </section>

      {/* Phones: one card per shipment, its status pill at the right edge and the actions under it. */}
      <div aria-hidden className="space-y-3 lg:hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn("space-y-2 rounded-lg bg-white p-4", PULSE)} style={{ animationDelay: `${140 + i * 20}ms` }}>
            <div className="flex items-center justify-between gap-2">
              <Bone className="h-4 w-40 rounded" />
              <Bone className="h-5 w-16 rounded-full" />
            </div>
            <Bone className="h-2.5 w-56 max-w-full rounded" />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Bone className="h-9 w-32 rounded-md" />
              <Bone className="h-9 w-44 rounded-md" />
              <Bone className="h-9 w-24 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
