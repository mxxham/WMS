import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Cetak kartu palet: first the receipts that are checked and waiting to be posted (one row each,
 * "Cetak kartu" at the right), then the Form Checker card with its dashed drop target, and the idle
 * box that tells the checker the page is waiting for a file.
 *
 * The receipt list is shown as a table: it belongs to the page above the upload card, and on a day
 * with nothing checked the card prints one sentence in its place instead.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat kartu palet" className="flex flex-col">
      <div className="space-y-4 p-4 lg:p-8">
        {/* Dari penerimaan: DO · Shipment · Rencana · Palet · Diperiksa · Cetak kartu. */}
        <section aria-hidden className={SKELETON_CARD}>
          <div className={cn("px-4 pb-3 pt-4", PULSE)}>
            <Bone className="h-5 w-64 max-w-full rounded" />
          </div>
          <div className="border-t border-steel-100">
            <TableSkeleton columns={6} rows={3} delayMs={80} />
          </div>
        </section>
      </div>

      <div className="mx-auto grid max-w-3xl gap-6 p-4 lg:p-8">
        {/* Berkas Form Checker: the dashed target the workbook is dropped onto. */}
        <section aria-hidden className={SKELETON_CARD}>
          <div className={cn("flex items-center gap-2 px-4 pb-3 pt-4", PULSE)} style={{ animationDelay: "120ms" }}>
            <Bone className="h-5 w-5 rounded" />
            <Bone className="h-5 w-48 rounded" />
          </div>
          <div className="border-t border-steel-100 p-4 lg:p-6">
            <div className={cn("rounded-xl border-2 border-dashed border-steel-200 p-8 text-center lg:p-12", PULSE)}
              style={{ animationDelay: "140ms" }}>
              <Bone className="mx-auto h-16 w-16 rounded-full" />
              <Bone className="mx-auto mt-4 h-6 w-64 max-w-full rounded" />
              <Bone className="mx-auto mt-2 h-3 w-52 max-w-full rounded" />
              <Bone className="mx-auto mt-3 h-2.5 w-72 max-w-full rounded" />
            </div>
          </div>
        </section>

        {/* Siap memulai: the idle box that says what the page is for. */}
        <div aria-hidden className={cn("rounded-xl border border-steel-200 bg-steel-50 p-6 text-center", PULSE)}
          style={{ animationDelay: "180ms" }}>
          <Bone className="mx-auto h-12 w-12 rounded-full" />
          <Bone className="mx-auto mt-3 h-5 w-36 rounded" />
          <Bone className="mx-auto mt-2 h-3 w-80 max-w-full rounded" />
        </div>
      </div>
    </PageSkeleton>
  );
}
