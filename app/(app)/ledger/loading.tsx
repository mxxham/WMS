import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Buku stok: SAP's book against the WMS book, a month at a time. The paragraph that states the
 * identity (opening + inbound − outbound = closing), the month with its two arrows and the date
 * picker that opens one day, and then the month's days — cards on a phone, a table from md up.
 *
 * Nothing here prints an accuracy figure or a number of differing SKUs: those are the measurement
 * the page exists to show, and a placeholder figure would be a wrong one.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat buku stok" className="flex flex-col gap-4 p-4 lg:p-8">
      {/* What the book compares, and what one uploaded file is. */}
      <div aria-hidden className={cn("space-y-1.5", PULSE)}>
        <Bone className="h-3 w-full max-w-3xl rounded" />
        <Bone className="h-3 w-full max-w-2xl rounded" />
        <Bone className="h-3 w-full max-w-xl rounded" />
      </div>

      {/* The month: previous, its name, next; then Buka tanggal. */}
      <div aria-hidden className={cn("flex flex-wrap items-end justify-between gap-3", PULSE)} style={{ animationDelay: "60ms" }}>
        <div className="flex items-center gap-2">
          <Bone className="h-9 w-9 rounded-md" />
          <Bone className="h-6 w-32 rounded" />
          <Bone className="h-9 w-9 rounded-md" />
        </div>
        <div>
          <Bone className="mb-1.5 h-2.5 w-20 rounded" />
          <Bone className="h-10 w-40 rounded-md" />
        </div>
      </div>

      {/* Phones: one card per day, the day's accuracy at the right edge. */}
      <div aria-hidden className="space-y-2 md:hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className={cn(SKELETON_CARD, "flex items-center justify-between gap-3 px-4 py-4", PULSE)}
            style={{ animationDelay: `${100 + i * 20}ms` }}>
            <div className="min-w-0 space-y-1.5">
              <Bone className="h-4 w-28 rounded" />
              <Bone className="h-2.5 w-64 max-w-full rounded" />
            </div>
            <Bone className="h-6 w-16 shrink-0 rounded" />
          </div>
        ))}
      </div>

      {/* Desktop: Tanggal · akurasi qty · akurasi SKU · SKU selisih · SKU · status · diupload. */}
      <section aria-hidden className={cn(SKELETON_CARD, "hidden md:block")}>
        <TableSkeleton columns={7} rows={8} delayMs={120} />
      </section>
    </PageSkeleton>
  );
}
