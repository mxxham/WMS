import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Putaway dari sheet: the first step is one dashed target — the WMS workbook — and under it the
 * history of what was posted in the last thirty days, grouped per upload, each opening into the
 * lines that conflicted with the bin at that moment.
 *
 * The review screen (the four counters, the verdict table, the posting card) only exists after a
 * file has been read, so nothing of it is drawn here.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat putaway" className="flex flex-col gap-6 p-4 lg:p-8">
      {/* Pilih file WMS: the dashed target, then what the sheet is compared against. */}
      <div aria-hidden className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-steel-300 bg-white p-10 text-center",
        PULSE)}>
        <Bone className="h-10 w-10 rounded-md" />
        <Bone className="h-6 w-56 max-w-full rounded" />
        <Bone className="h-3 w-80 max-w-full rounded" />
        <Bone className="h-3 w-72 max-w-full rounded" />
      </div>

      {/* Riwayat putaway: per upload, and per line that had to be decided. */}
      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-4", PULSE)} style={{ animationDelay: "80ms" }}>
          <div className="flex items-center gap-2">
            <Bone className="h-5 w-5 rounded" />
            <Bone className="h-5 w-56 rounded" />
          </div>
          <div className="flex items-center gap-2">
            <Bone className="h-4 w-4 rounded-sm" />
            <Bone className="h-2.5 w-64 rounded" />
          </div>
        </div>

        <div className={cn("space-y-3 border-t border-steel-100 px-4 py-4", PULSE)} style={{ animationDelay: "100ms" }}>
          {[0, 1].map((i) => (
            <div key={i} className="rounded-md border border-steel-200 bg-white">
              <div className="space-y-1.5 p-3">
                <Bone className="h-3 w-56 max-w-full rounded" />
                <Bone className="h-2.5 w-72 max-w-full rounded" />
              </div>
              {/* Baris · Bin · Sheet · Konflik · Isi bin waktu itu · Keputusan · Hasil. */}
              <div className="border-t border-steel-100">
                <TableSkeleton columns={7} rows={2} delayMs={120 + i * 20} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </PageSkeleton>
  );
}
