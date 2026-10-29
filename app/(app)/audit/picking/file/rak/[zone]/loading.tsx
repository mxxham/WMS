import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Audit picking from the WMS file, one rack: the header without the picking/putaway switch, the
 * download button, then the same rack screen the system audit uses — the way back to the file tab,
 * the summary card with the checker's name and the walk button, the sentence that says the counts
 * are compared with the file, and the nine-column table.
 *
 * Only the source of the comparison differs from `audit/picking/rak/[zone]`, so the blocks are the
 * same; the words `dari file?date=` in the back link are the one thing a checker reads twice.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat audit rak dari file" header={false} className="flex flex-col">
      <AuditBarSkeleton />

      <div className="space-y-4 p-4 lg:p-8">
        {/* Unduh audit rak ini (.xlsx), compared against the file. */}
        <div aria-hidden className={cn("flex flex-wrap items-center gap-2", PULSE)} style={{ animationDelay: "80ms" }}>
          <Bone className="h-10 w-56 rounded-md" />
        </div>

        <div aria-hidden className={cn("space-y-4", PULSE)} style={{ animationDelay: "100ms" }}>
          {/* Kembali ke tab file. */}
          <Bone className="h-2.5 w-28 rounded" />

          <div className={SKELETON_CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Bone className="h-7 w-28 rounded" />
                  <Bone className="h-5 w-20 rounded" />
                </div>
                <Bone className="h-2.5 w-56 max-w-full rounded" />
                <Bone className="h-3 w-48 max-w-full rounded" />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Bone className="mb-1.5 h-2.5 w-28 rounded" />
                  <Bone className="h-10 w-40 rounded-md" />
                </div>
                <Bone className="h-11 w-56 rounded-md" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Bone className="h-3 w-full max-w-4xl rounded" />
            <Bone className="h-3 w-full max-w-3xl rounded" />
          </div>

          {/* Bin · SKU · Shipment · Picker · Baris · Sisa di file · Status · Hitung terakhir · aksi. */}
          <section className={SKELETON_CARD}>
            <TableSkeleton columns={9} rows={8} delayMs={140} />
          </section>
        </div>
      </div>
    </PageSkeleton>
  );
}

/** This route's header: title, Live dot, date, Tampilkan — no picking/putaway switch. */
function AuditBarSkeleton() {
  return (
    <div aria-hidden className="flex flex-wrap items-end justify-between gap-3 border-b border-steel-100 bg-white px-4 py-4 lg:px-8">
      <div className={cn("flex items-baseline gap-3", PULSE)}>
        <Bone className="h-9 w-9 self-center rounded-md lg:hidden" />
        <Bone className="h-8 w-48 rounded sm:w-60" />
        <Bone className="h-2 w-2 rounded-full" />
      </div>
      <div className={cn("flex flex-wrap items-center gap-2", PULSE)} style={{ animationDelay: "60ms" }}>
        <Bone className="h-10 w-36 rounded-md" />
        <Bone className="h-10 w-24 rounded-md" />
      </div>
      <div className={cn("ml-auto flex items-center gap-3", PULSE)} style={{ animationDelay: "60ms" }}>
        <Bone className="h-2.5 w-10 rounded" />
        <Bone className="h-10 w-10 rounded-full" />
      </div>
    </div>
  );
}
