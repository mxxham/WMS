import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Kualitas data stok: the officer's name, the paragraph that explains what a correction posts, the
 * seven issue counters, then one card per kind of problem that has rows — its title and why, the
 * bulk-fix button, and the table with the fix per row.
 *
 * Three cards are drawn: the real page prints only the kinds that actually have rows, and how many
 * of the seven do is a measurement of the stock, not a shape of the page.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat kualitas data" className="flex flex-col gap-6 p-4 lg:p-8">
      {/* Nama petugas (dicatat di setiap koreksi). */}
      <div aria-hidden className={cn("max-w-xs", PULSE)}>
        <Bone className="mb-1.5 h-2.5 w-56 rounded" />
        <Bone className="h-10 w-full rounded-md" />
      </div>

      {/* What a correction does, and what it does not touch. */}
      <div aria-hidden className={cn("space-y-1.5", PULSE)} style={{ animationDelay: "60ms" }}>
        <Bone className="h-3 w-full max-w-4xl rounded" />
        <Bone className="h-3 w-full max-w-3xl rounded" />
        <Bone className="h-3 w-full max-w-xl rounded" />
      </div>

      {/* The seven kinds, each a jump link to its card. */}
      <div aria-hidden className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className={cn("rounded-lg bg-white p-3", PULSE)} style={{ animationDelay: `${80 + i * 15}ms` }}>
            <div className="flex items-start justify-between gap-2">
              <Bone className="h-8 w-12 rounded" />
              <Bone className="h-3.5 w-3.5 rounded" />
            </div>
            <Bone className="mt-1 h-2.5 w-full rounded" />
            <Bone className="mt-1 h-2.5 w-2/3 rounded" />
          </div>
        ))}
      </div>

      {/* One card per kind: what it is, the bulk fix, then a row per stock line. */}
      {[0, 1, 2].map((i) => (
        <section key={i} aria-hidden className={SKELETON_CARD}>
          <div className={cn("space-y-1.5 px-4 pb-3 pt-4", PULSE)} style={{ animationDelay: `${160 + i * 30}ms` }}>
            <Bone className="h-5 w-64 max-w-full rounded" />
            <Bone className="h-2.5 w-full max-w-3xl rounded" />
            <Bone className="h-2.5 w-full max-w-2xl rounded" />
          </div>
          <div className={cn("border-t border-steel-100 px-4 pb-4 pt-3", PULSE)} style={{ animationDelay: `${180 + i * 30}ms` }}>
            <Bone className="mb-3 h-8 w-56 rounded-md" />
            {/* Bin · SKU · Batch · Expired · Qty · Catatan · Perbaikan. */}
            <TableSkeleton columns={7} rows={3} delayMs={200 + i * 30} />
          </div>
        </section>
      ))}
    </PageSkeleton>
  );
}
