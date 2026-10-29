import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * One shipment of the WMS file's picks: the way back to the file tab, the card naming the shipment
 * with its wave, date and source, and the six-column table the checker records each line against —
 * the file's qty, batch and expiry stay hidden until the line has been audited, so neither does the
 * skeleton show them.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat audit file shipment" className="flex flex-col gap-4 p-4 lg:p-8">
      <div aria-hidden className={cn("space-y-4", PULSE)}>
        {/* Kembali ke daftar shipment dari file. */}
        <Bone className="h-2.5 w-32 rounded" />

        <div className={SKELETON_CARD}>
          <div className="space-y-2 px-4 py-4">
            <Bone className="h-7 w-24 rounded" />
            <Bone className="h-2.5 w-72 max-w-full rounded" />
            <Bone className="h-3 w-48 max-w-full rounded" />
          </div>
        </div>

        {/* # · SKU · Bin asal · Status · Di file / audit · aksi. */}
        <section className={SKELETON_CARD}>
          <TableSkeleton columns={6} rows={8} delayMs={120} />
        </section>
      </div>
    </PageSkeleton>
  );
}
