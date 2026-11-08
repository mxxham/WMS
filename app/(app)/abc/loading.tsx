import { Bone, ChartCardSkeleton, PULSE, PageSkeleton, TableCardSkeleton, TilesSkeleton } from "@/components/loading/skeleton";
import { cn } from "@/lib/utils";

/**
 * Kelas ABC: the rule in one paragraph, the period with its picker and Excel button, one tile per class,
 * the Pareto curve beside the change matrix, then the SKU table. No class counts or percentages are drawn:
 * those are what the page computes, and a placeholder number would be a wrong one.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat kelas ABC" className="flex flex-col gap-6 p-4 lg:p-8">
      <div aria-hidden className={cn("space-y-1.5", PULSE)}>
        <Bone className="h-3 w-full max-w-3xl rounded" />
        <Bone className="h-3 w-full max-w-2xl rounded" />
      </div>
      <div aria-hidden className={cn("flex flex-wrap items-end justify-between gap-3", PULSE)} style={{ animationDelay: "60ms" }}>
        <div className="space-y-1.5"><Bone className="h-7 w-44 rounded" /><Bone className="h-3 w-72 rounded" /></div>
        <div className="flex gap-2"><Bone className="h-10 w-40 rounded-md" /><Bone className="h-10 w-24 rounded-md" /></div>
      </div>
      <TilesSkeleton count={3} columns="grid gap-4 md:grid-cols-3" />
      <div className="grid gap-4 lg:grid-cols-5">
        <ChartCardSkeleton bars={20} className="lg:col-span-3" />
        <ChartCardSkeleton bars={3} className="lg:col-span-2" delayMs={220} />
      </div>
      <TableCardSkeleton columns={8} rows={8} />
    </PageSkeleton>
  );
}
