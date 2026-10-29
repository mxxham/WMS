import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * One day of Buku stok: the way back to the month and the two neighbouring days, the four figures at
 * the top (accuracy by quantity and by SKU, the total difference, the status), the summary table with
 * SAP and WMS side by side, the warnings under it, and the BOOK TO BOOK list — cards on a phone, the
 * wide table from md up, with the two-way filter and the Excel button above it.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat buku stok harian" className="flex flex-col gap-4 p-4 lg:p-8">
      {/* Semua hari · hari sebelumnya · hari berikutnya. */}
      <div aria-hidden className={cn("flex flex-wrap items-center gap-3", PULSE)}>
        <Bone className="h-2.5 w-20 rounded" />
        <Bone className="h-2.5 w-28 rounded" />
        <Bone className="h-2.5 w-28 rounded" />
      </div>

      {/* Akurasi qty · akurasi SKU · total selisih · status. */}
      <div aria-hidden className="grid gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn("rounded-lg bg-white p-3", PULSE)} style={{ animationDelay: `${60 + i * 20}ms` }}>
            <Bone className="h-8 w-20 rounded" />
            <Bone className="mt-1.5 h-2.5 w-32 max-w-full rounded" />
            <Bone className="mt-1 h-2 w-40 max-w-full rounded" />
          </div>
        ))}
      </div>

      {/* SAP and WMS: opening (unrestricted, block), inbound, outbound, closing — litres underneath. */}
      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("px-4 py-4", PULSE)} style={{ animationDelay: "140ms" }}>
          <div className="grid grid-cols-[4rem_repeat(6,1fr)] gap-3 border-b border-steel-100 pb-2">
            <Bone className="h-2 w-6 rounded" />
            {[0, 1, 2, 3, 4, 5].map((c) => <Bone key={c} className="ml-auto h-2 w-14 rounded" />)}
          </div>
          {[0, 1].map((r) => (
            <div key={r} className="grid grid-cols-[4rem_repeat(6,1fr)] gap-3 border-b border-steel-100/70 py-2 last:border-b-0">
              <Bone className="h-3 w-10 rounded" />
              {[0, 1, 2, 3, 4, 5].map((c) => (
                <div key={c} className="space-y-1">
                  <Bone className="ml-auto h-2.5 w-12 rounded" />
                  <Bone className="ml-auto h-2 w-10 rounded" />
                </div>
              ))}
            </div>
          ))}
          <Bone className="mt-2 h-2 w-full max-w-xl rounded" />
        </div>
      </section>

      {/* The warnings: a block stock with no WMS counterpart, a day still waiting for putaway, a
          broken chain. They sit between the summary and the list, so the eye finds them there too. */}
      <div aria-hidden className={cn("space-y-1 rounded-md bg-warn/10 p-2", PULSE)} style={{ animationDelay: "180ms" }}>
        <Bone className="h-2.5 w-full max-w-3xl rounded" />
        <Bone className="h-2.5 w-full max-w-xl rounded" />
      </div>

      {/* Hanya selisih · Semua, then Download Excel. */}
      <div aria-hidden className={cn("flex flex-wrap items-center justify-between gap-2", PULSE)} style={{ animationDelay: "200ms" }}>
        <div className="flex gap-1 rounded-md bg-white p-1">
          <Bone className="h-7 w-32 rounded" />
          <Bone className="h-7 w-20 rounded" />
        </div>
        <Bone className="h-10 w-40 rounded-md" />
      </div>

      {/* Phones: one card per SKU with the SAP and WMS columns side by side. */}
      <div aria-hidden className="space-y-2 md:hidden">
        {[0, 1].map((i) => (
          <div key={i} className={cn(SKELETON_CARD, "space-y-1 px-4 py-4", PULSE)} style={{ animationDelay: `${220 + i * 20}ms` }}>
            <div className="flex justify-between gap-2">
              <Bone className="h-4 w-24 rounded" />
              <Bone className="h-2.5 w-8 rounded" />
            </div>
            <Bone className="h-2 w-48 rounded" />
            <div className="grid grid-cols-3 gap-1 pt-1">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => (
                <Bone key={c} className="h-2.5 w-full rounded" />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: SKU · SAP's six figures · WMS's six · the two differences · the note. */}
      <section aria-hidden className={cn(SKELETON_CARD, "hidden md:block")}>
        <TableSkeleton columns={14} rows={6} delayMs={240} />
      </section>
    </PageSkeleton>
  );
}
