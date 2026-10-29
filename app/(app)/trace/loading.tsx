import { Bone, PULSE, PageSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Lacak batch: the page opens on one question — which batch, and optionally which SKU — so the
 * skeleton is the search form and the paragraph that says what a result will show: where the batch
 * is now, which shipments and customers it went to, and its whole movement history.
 *
 * The four result cards (summary, shipments, positions, history) exist only after a batch has been
 * looked up; drawing them would say a batch had been found.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat lacak batch" className="flex flex-col gap-6 p-4 lg:p-8">
      {/* Batch · SKU (opsional) · Lacak. */}
      <div aria-hidden className={cn("flex flex-wrap items-end gap-3 rounded-lg bg-white p-4", PULSE)}>
        <div className="min-w-48 flex-1">
          <Bone className="mb-1.5 h-2.5 w-12 rounded" />
          <Bone className="h-10 w-full rounded-md" />
        </div>
        <div className="w-44">
          <Bone className="mb-1.5 h-2.5 w-24 rounded" />
          <Bone className="h-10 w-full rounded-md" />
        </div>
        <Bone className="h-10 w-24 rounded-md" />
      </div>

      {/* What a lookup answers, for a recall or a quality complaint. */}
      <div aria-hidden className={cn("space-y-1.5", PULSE)} style={{ animationDelay: "60ms" }}>
        <Bone className="h-3 w-full max-w-3xl rounded" />
        <Bone className="h-3 w-full max-w-2xl rounded" />
      </div>
    </PageSkeleton>
  );
}
