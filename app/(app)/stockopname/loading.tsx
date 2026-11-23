import { PageSkeleton, SKELETON_CARD, TableSkeleton, ToolbarSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/** Stock Opname Rak: the rack picker and its buttons, then the bin list. */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat cek stok rak" className="flex flex-col">
      <div className="space-y-4 p-4 lg:p-8">
        <ToolbarSkeleton fields={2} checks={1} actions={2} delayMs={80} />
        <section aria-hidden className={cn(SKELETON_CARD, "p-4")}>
          <TableSkeleton columns={7} rows={14} phoneColumns={3} delayMs={120} />
        </section>
      </div>
    </PageSkeleton>
  );
}
