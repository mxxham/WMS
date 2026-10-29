import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Penerimaan: the three numbered steps the page explains (the supervisor makes the receipt from
 * Shell's document, the checker records what really arrived per pallet, someone else posts it), the
 * card that takes the inbound plan, the card that makes a receipt by hand, and the list of receipts.
 *
 * Only a supervisor is given the two cards that create something; the loading skeleton cannot read
 * the role, so it keeps the page's full height instead of collapsing for an operator.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat penerimaan" className="flex flex-col gap-6 p-4 lg:p-8">
      {/* The three steps, and what a mismatch becomes. */}
      <div aria-hidden className={cn("space-y-1.5", PULSE)}>
        <Bone className="h-3 w-full max-w-4xl rounded" />
        <Bone className="h-3 w-full max-w-3xl rounded" />
        <Bone className="h-3 w-full max-w-2xl rounded" />
      </div>

      {/* Rencana inbound Shell: the upload, then the DOs it holds. */}
      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("px-4 pb-3 pt-4", PULSE)} style={{ animationDelay: "60ms" }}>
          <Bone className="h-5 w-52 rounded" />
        </div>
        <div className={cn("space-y-3 border-t border-steel-100 px-4 py-4", PULSE)} style={{ animationDelay: "80ms" }}>
          <div className="space-y-1.5">
            <Bone className="h-2.5 w-full max-w-3xl rounded" />
            <Bone className="h-2.5 w-full max-w-xl rounded" />
          </div>
          <Bone className="h-10 w-64 rounded-md" />
        </div>
      </section>

      {/* Penerimaan baru: the document, the vehicle, the DO file, one row per SKU, then who. */}
      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("px-4 pb-3 pt-4", PULSE)} style={{ animationDelay: "120ms" }}>
          <Bone className="h-5 w-40 rounded" />
        </div>
        <div className={cn("space-y-3 border-t border-steel-100 px-4 py-4", PULSE)} style={{ animationDelay: "140ms" }}>
          <div className="flex flex-wrap items-end gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Bone className="mb-1.5 h-2.5 w-20 rounded" />
                <Bone className="h-10 w-40 rounded-md" />
              </div>
            ))}
            <Bone className="h-10 w-56 rounded-md" />
          </div>

          {[0, 1].map((r) => (
            <div key={r} className="grid grid-cols-[1.4fr_1fr_8rem_2.5rem] gap-2">
              <Bone className="h-10 rounded-md" />
              <Bone className="h-10 rounded-md" />
              <Bone className="h-10 rounded-md" />
              <Bone className="h-10 w-10 rounded-md" />
            </div>
          ))}
          <Bone className="h-8 w-32 rounded-md" />

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Bone className="mb-1.5 h-2.5 w-16 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
            <div>
              <Bone className="mb-1.5 h-2.5 w-24 rounded" />
              <Bone className="h-10 w-40 rounded-md" />
            </div>
            <Bone className="h-10 w-40 rounded-md" />
          </div>
        </div>
      </section>

      {/* Dokumen · Tanggal · Status · Dokumen · Baik · Rusak · Selisih · Orang. */}
      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("px-4 pb-3 pt-4", PULSE)} style={{ animationDelay: "180ms" }}>
          <Bone className="h-5 w-32 rounded" />
        </div>
        <div className="border-t border-steel-100">
          <TableSkeleton columns={8} rows={5} phoneColumns={3} delayMs={200} />
        </div>
      </section>
    </PageSkeleton>
  );
}
