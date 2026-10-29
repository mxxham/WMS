import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Riwayat mutasi: the filter bar (eight cells, the last one Terapkan and Reset), then the ledger
 * itself — Waktu · Jenis · SKU · Batch · Qty · Dari · Ke · Alasan · Oleh — and the two page links
 * under it. The filter lives in the URL, so the bar is a plain form: a grid on a desktop, two
 * columns on a phone.
 *
 * The table scrolls sideways on a phone (nine columns never fit), so its skeleton shows three there
 * and all nine from md up — the same thing the eye sees at each width.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat riwayat mutasi" className="flex flex-col gap-4 p-4 lg:p-8">
      {/* Dari · Sampai · Jenis · Bin · SKU · Alasan · Orang · Terapkan / Reset. */}
      <div aria-hidden className={cn("grid grid-cols-2 gap-3 rounded-lg bg-white p-4 md:grid-cols-4 xl:grid-cols-8", PULSE)}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i}>
            <Bone className="mb-1.5 h-2.5 w-14 rounded" />
            <Bone className="h-10 w-full rounded-md" />
          </div>
        ))}
        <div className="flex items-end gap-2">
          <Bone className="h-10 flex-1 rounded-md" />
          <Bone className="h-10 w-16 rounded-md" />
        </div>
      </div>

      <section aria-hidden className={SKELETON_CARD}>
        <TableSkeleton columns={9} rows={12} phoneColumns={3} delayMs={120} />
      </section>

      {/* Sebelumnya · Berikutnya. */}
      <div aria-hidden className={cn("flex justify-between", PULSE)} style={{ animationDelay: "160ms" }}>
        <Bone className="h-3 w-24 rounded" />
        <Bone className="h-3 w-24 rounded" />
      </div>
    </PageSkeleton>
  );
}
