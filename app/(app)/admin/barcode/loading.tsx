import { Bone, PULSE, PageSkeleton, SKELETON_CARD, TableSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Ikat barcode: the sentence that explains the rule, the bind card (scanned code beside the target
 * SKU, then the Ikat button), then the list of SKUs still without a barcode with its own search.
 * Nothing here names a SKU or prints a code — a placeholder code would be a claim about which SKU
 * owns it.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat ikat barcode" className="space-y-4 p-4 lg:p-8">
      {/* The rule: scan the carton, then choose the SKU. Two lines on anything wider than a phone. */}
      <div aria-hidden className={cn("max-w-3xl space-y-1.5", PULSE)}>
        <Bone className="h-2.5 w-full rounded" />
        <Bone className="h-2.5 w-4/5 rounded" />
      </div>

      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("space-y-3 p-4", PULSE)} style={{ animationDelay: "80ms" }}>
          {/* Barcode karton (with the camera button) beside SKU tujuan, then the result strip. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Bone className="mb-1 h-2.5 w-24 rounded" />
              <div className="flex gap-1">
                <Bone className="h-10 flex-1 rounded-md" />
                <Bone className="h-10 w-10 rounded-md" />
              </div>
            </div>
            <div>
              <Bone className="mb-1 h-2.5 w-20 rounded" />
              <Bone className="h-10 w-full rounded-md" />
            </div>
          </div>
          <Bone className="h-12 w-full rounded-md" />
          <Bone className="h-10 w-36 rounded-md" />
        </div>
      </section>

      <section aria-hidden className={SKELETON_CARD}>
        <div className={cn("flex flex-wrap items-end gap-3 p-4", PULSE)} style={{ animationDelay: "120ms" }}>
          <div className="min-w-64 flex-1">
            <Bone className="mb-1 h-2.5 w-16 rounded" />
            <Bone className="h-10 w-full rounded-md" />
          </div>
          {/* "N dari M SKU belum punya barcode" — a count is a measurement, so a bar instead. */}
          <Bone className="mb-2 h-2.5 w-52 rounded" />
        </div>

        <div className="border-t border-steel-100">
          {/* SKU · Deskripsi · UOM · Barcode · Pilih / Kosongkan. */}
          <TableSkeleton columns={5} rows={8} phoneColumns={3} delayMs={160} />
        </div>
      </section>
    </PageSkeleton>
  );
}
