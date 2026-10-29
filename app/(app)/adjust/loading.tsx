import { Bone, CardHeadSkeleton, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Adjust stok: one lookup bar (bin, Cari) and the stock lines of the bin it found, each with a `±`
 * and "Item salah" button, then the way to add a line. The column is the real one — `max-w-4xl`,
 * one form bar then one card — so the table lands where the reader's eye already is.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat adjust stok" className="mx-auto max-w-4xl space-y-4 p-4 lg:p-8">
      {/* Bin (ketik atau scan) + Cari: one field wide open, one button on its baseline. */}
      <div aria-hidden className={cn("flex items-end gap-2 rounded-lg bg-white p-4", PULSE)}>
        <div className="flex-1">
          <Bone className="mb-1 h-2.5 w-8 rounded" />
          <Bone className="h-10 w-full rounded-md" />
        </div>
        <Bone className="h-10 w-24 rounded-md" />
      </div>

      <section aria-hidden className={SKELETON_CARD}>
        <CardHeadSkeleton titleClass="h-6 w-28" subClass={null} right="h-10 w-40 rounded-md" />

        <div className="border-t border-steel-100">
          {/* SKU · Batch · Expired · Qty · the two buttons per line. */}
          <TableSkeleton columns={5} rows={4} phoneColumns={3} delayMs={140} />
        </div>

        <div className={cn("border-t border-steel-100 px-4 py-3", PULSE)} style={{ animationDelay: "180ms" }}>
          <Bone className="h-10 w-44 rounded-md" />
        </div>
      </section>
    </PageSkeleton>
  );
}
