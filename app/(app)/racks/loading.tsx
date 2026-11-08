import { Bone, PageSkeleton, TilesSkeleton } from "@/components/loading/skeleton";

/** Rak & Lokasi: the tiles, the tab row and the floor plan's aisle strips, where the page puts them. */
export default function Loading() {
  return (
    <PageSkeleton label="Memuat rak dan lokasi">
      <TilesSkeleton count={6} columns="grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" compact />
      <div aria-hidden className="flex gap-2"><Bone className="h-9 w-24 rounded-md" /><Bone className="h-9 w-24 rounded-md" /><Bone className="h-9 w-24 rounded-md" /></div>
      <div aria-hidden className="space-y-3 rounded-xl bg-steel-100/60 p-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Bone className="h-6 w-8" />
            <Bone className="h-7 flex-1 rounded-sm" />
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
