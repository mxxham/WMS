import { Bone, PULSE } from "@/components/loading/skeleton";
import { CkbPageSkeleton, CkbTableSkeleton, pulseDelay } from "@/components/loading/ckb";
import { cn } from "@/lib/utils";

/**
 * Rebagging. The list page opens with its one-paragraph explanation, then the toolbar card (the
 * search field and the Filter toggle that opens six more fields), then the job table: job no ·
 * tanggal · shift · gudang · pelanggan · operasi · status · sumber · output · foto B/A · dibuat ·
 * oleh · aksi. Thirteen columns, so it scrolls sideways on a narrow screen and only the first few
 * are ever on the glass.
 */
export default function Loading() {
  return (
    <CkbPageSkeleton label="Memuat rebagging" live pills={0}>
      {/* The intro sentence above the toolbar. */}
      <div aria-hidden className={cn("space-y-1.5", PULSE)} style={pulseDelay(60)}>
        <Bone className="h-2.5 w-full max-w-2xl rounded" />
        <Bone className="h-2.5 w-3/5 rounded" />
      </div>

      {/* Toolbar card: the search field, then the Filter button. */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white p-4">
        <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", PULSE)} style={pulseDelay(100)}>
          <div className="flex-1">
            <Bone className="h-10 w-full max-w-md rounded-md" />
          </div>
          <Bone className="h-9 w-24 rounded-md" />
        </div>
      </section>

      {/* The job table, inside its own card (the card is the padded box, not the table). */}
      <section aria-hidden className="rounded-lg border border-steel-100 bg-white p-4 pt-2">
        <CkbTableSkeleton columns={13} rows={8} delayMs={180} className="rounded-none border-0" />
      </section>
    </CkbPageSkeleton>
  );
}
