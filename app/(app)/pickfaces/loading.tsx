import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Pickface per SKU: the paragraph (what a fixed pickface does, and how many SKUs have one), the
 * toolbar — search, the "belum tetap" filter, "Isi saran" and "Simpan" — and the table with one row
 * per SKU: its fixed bin as an input, the suggestion the allocator would make today, and what the
 * bin currently holds.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat pickface" className="flex flex-col gap-4 p-4 lg:p-8">
      <div aria-hidden className={cn("space-y-1.5", PULSE)}>
        <Bone className="h-3 w-full max-w-3xl rounded" />
        <Bone className="h-3 w-full max-w-2xl rounded" />
      </div>

      {/* Cari · Hanya yang belum tetap · Isi saran · Simpan. */}
      <div aria-hidden className={cn("flex flex-wrap items-center gap-3", PULSE)} style={{ animationDelay: "60ms" }}>
        <Bone className="h-10 w-full max-w-xs rounded-md" />
        <div className="flex items-center gap-2">
          <Bone className="h-4 w-4 rounded-sm" />
          <Bone className="h-2.5 w-40 rounded" />
        </div>
        <Bone className="ml-auto h-10 w-64 rounded-md" />
        <Bone className="h-10 w-44 rounded-md" />
      </div>

      {/* SKU · Deskripsi · Pickface tetap · Saran otomatis · Isi bin pickface. */}
      <section aria-hidden className={SKELETON_CARD}>
        <TableSkeleton columns={5} rows={10} delayMs={120} />
      </section>
    </PageSkeleton>
  );
}
