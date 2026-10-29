import { Bone, CardHeadSkeleton, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton, ToolbarSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Master item: the sentence about carton barcode and shelf life, the two cards that add a SKU (one
 * typed, one read out of a WMS file), the search bar with its "Belum punya barcode" checkbox, and
 * the master table where every row is an editable input.
 *
 * The table is drawn with taller cells than the kit's default, because each real row *is* a set of
 * inputs (SKU · Deskripsi · UOM · UPP · Liter · Barcode · Umur simpan · Sisa umur · Simpan).
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat master item" className="space-y-4 p-4 lg:p-8">
      <div aria-hidden className={cn("max-w-3xl space-y-1.5", PULSE)}>
        <Bone className="h-2.5 w-full rounded" />
        <Bone className="h-2.5 w-3/4 rounded" />
      </div>

      {/* Tambah SKU beside Impor SKU baru dari file WMS. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <section key={i} aria-hidden className={SKELETON_CARD}>
            <CardHeadSkeleton titleClass="h-5 w-40" subClass={null} right={null} delayMs={60 + i * 20} />
            <div className={cn("grid grid-cols-2 gap-3 border-t border-steel-100 p-4", PULSE)} style={{ animationDelay: `${80 + i * 20}ms` }}>
              {[0, 1, 2, 3, 4, 5].map((f) => (
                <div key={f} className={f === 2 ? "col-span-2" : undefined}>
                  <Bone className="mb-1 h-2.5 w-16 rounded" />
                  <Bone className="h-10 w-full rounded-md" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <ToolbarSkeleton fields={0} checks={1} actions={0} delayMs={120} />

      <section aria-hidden className={SKELETON_CARD}>
        <div className="p-4">
          <TableSkeleton columns={9} rows={8} phoneColumns={3} delayMs={160} />
        </div>
      </section>
    </PageSkeleton>
  );
}
