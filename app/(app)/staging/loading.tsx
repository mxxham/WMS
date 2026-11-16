import { PageSkeleton, TableCardSkeleton, TilesSkeleton, ToolbarSkeleton } from "@/components/loading/skeleton";

/** Staging: three tiles (lines, qty, waiting long), the search box, then the list. */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat staging">
      <TilesSkeleton count={3} columns="grid grid-cols-3 gap-3" compact />
      <ToolbarSkeleton fields={0} actions={0} />
      <TableCardSkeleton columns={8} rows={6} />
    </PageSkeleton>
  );
}
